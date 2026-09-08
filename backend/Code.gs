const SPREADSHEET_ID = '16Bg7EG0NXQZkELkzB1mb8RorIv8ruLVgi6ZiGEDLMLU';
const SESSION_EXPIRY_JAM = 24; // pindahkan ke sheet Config jika ingin diubah tanpa deploy ulang

// Menangani request GET (misal: test ping API)
function doGet(e) {
  return responseJSON({ status: 'API Aktif', versi: '1.0' });
}

// Menangani request POST dari Frontend GitHub
// PENTING: frontend WAJIB kirim dengan Content-Type: text/plain;charset=utf-8
// (bukan application/json) supaya browser tidak memicu CORS preflight (OPTIONS)
// yang tidak ditangani oleh GAS Web App.
function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents);
    const action = request.action;

    if (action === 'login') {
      return responseJSON(loginUser(request.username, request.password));
    }
    if (action === 'getSantriDashboard') {
      return responseJSON(getSantriDashboard(request.token));
    }
    if (action === 'confirmMisi') {
      return responseJSON(confirmMisi(request.token, request.jenisMisi, request.idMaster));
    }
    if (action === 'getFlashcard') {
      return responseJSON(getFlashcard(request.token));
    }
    if (action === 'getAyatRange') {
      return responseJSON(getAyatRangeAction(request.token, request.surah, request.ayatMulai, request.ayatAkhir));
    }
    if (action === 'getOrtuDashboard') {
      return responseJSON(getOrtuDashboard(request.token));
    }
    if (action === 'recordTesOrtu') {
      return responseJSON(recordTesOrtu(request.token, request.idMaster, request.kualitas));
    }
    if (action === 'getTesAcak') {
      return responseJSON(getTesAcak(request.token));
    }
    if (action === 'kirimSemangat') {
      return responseJSON(kirimSemangat(request.token));
    }
    if (action === 'getUstazDashboard') {
      return responseJSON(getUstazDashboard(request.token));
    }
    if (action === 'inputSetoran') {
      return responseJSON(inputSetoran(request.token, request.idSantri, request.surah, request.ayatMulai, request.ayatAkhir, request.nilai, request.catatan));
    }
    if (action === 'broadcastMotivasi') {
      return responseJSON(broadcastMotivasi(request.token, request.pesan));
    }

    return responseJSON({ success: false, message: 'Action tidak ditemukan' });
  } catch (error) {
    return responseJSON({ success: false, message: 'Format request salah', error: error.message });
  }
}

// Helper untuk format output JSON
function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// AUTH
// ============================================================

// Hash password dengan SHA-256. Dipakai baik saat login maupun
// saat membuat/mengganti password user (mis. dari admin panel).
function hashPassword(plainPassword) {
  const rawHash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    plainPassword,
    Utilities.Charset.UTF_8
  );
  return rawHash
    .map(function (byte) {
      const v = (byte < 0 ? byte + 256 : byte).toString(16);
      return v.length === 1 ? '0' + v : v;
    })
    .join('');
}

function loginUser(username, password) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Users');
  const data = sheet.getDataRange().getValues();
  const inputHash = hashPassword(password);

  for (let i = 1; i < data.length; i++) {
    // Kolom: ID(0), Username(1), Password_Hash(2), Role(3), Nama(4), ID_Terkait(5)
    if (data[i][1] === username && data[i][2] === inputHash) {
      const userId = data[i][0];
      const role = data[i][3];
      const nama = data[i][4];
      const token = saveSession(userId, role);

      if (!token) {
        return { success: false, message: 'Gagal membuat sesi, coba lagi' };
      }

      return { success: true, token: token, role: role, nama: nama, userId: userId };
    }
  }
  return { success: false, message: 'Kredensial salah' };
}

// Menyimpan token ke sheet Sessions, dilindungi LockService supaya
// aman dari race condition kalau ada beberapa login bersamaan.
function saveSession(userId, role) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000); // tunggu maks 5 detik
  } catch (e) {
    return null; // gagal dapat lock, biar caller yang handle
  }

  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Sessions');
    const token = Utilities.getUuid();
    const expiry = new Date(Date.now() + SESSION_EXPIRY_JAM * 60 * 60 * 1000);
    sheet.appendRow([token, userId, role, expiry]);
    return token;
  } finally {
    lock.releaseLock();
  }
}

// Validasi token — dipanggil di awal SETIAP fungsi backend yang
// mengakses data milik user (jangan pernah percaya ID dari client mentah-mentah).
function validateSession(token) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Sessions');
  const data = sheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    // Kolom: Token(0), ID_User(1), Role(2), Expiry(3)
    if (data[i][0] === token) {
      if (new Date(data[i][3]) < now) {
        return null; // token kedaluwarsa
      }
      return { userId: data[i][1], role: data[i][2] };
    }
  }
  return null; // token tidak ditemukan
}

// Helper generik: ambil satu nilai dari sheet Config, dengan fallback
// kalau baris belum ada (supaya tidak crash saat Config belum lengkap diisi).
function getConfigValue(key, fallback) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Config');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return fallback;
}

function todayStr() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function daysBetween(dateA, dateB) {
  return Math.floor((dateB - dateA) / (1000 * 60 * 60 * 24));
}

// Nama level dibuat bertingkat dan bernuansa positif (Section 13.1 PRD).
// Threshold XP per level sengaja disimpan di sini sebagai satu larik,
// bukan tersebar — kalau mau ubah kurva level, cukup edit array ini.
const LEVEL_THRESHOLDS = [
  { min: 0, nama: 'Pejuang Sabaq' },
  { min: 100, nama: 'Penjaga Sabqi' },
  { min: 300, nama: 'Pengawal Manzil' },
  { min: 600, nama: 'Hafizh Muda' },
  { min: 1000, nama: 'Penjaga Hafalan Sejati' },
];
function getLevelInfo(xp) {
  let current = LEVEL_THRESHOLDS[0];
  let next = null;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i].min) {
      current = LEVEL_THRESHOLDS[i];
      next = LEVEL_THRESHOLDS[i + 1] || null;
    }
  }
  return {
    nama: current.nama,
    xpMenujuLevelBerikut: next ? next.min - xp : 0,
    persenProgress: next ? Math.round(((xp - current.min) / (next.min - current.min)) * 100) : 100,
  };
}

// ============================================================
// DASHBOARD SANTRI
// ============================================================

// CATATAN: klasifikasi Sabaq/Sabqi/Manzil di bawah ini masih memakai
// perhitungan umur sederhana (Tgl_Mulai vs hari ini) sebagai placeholder.
// Setelah Retention Engine penuh (trigger harian + cache, PRD Section 7.5)
// dibangun, fungsi ini tinggal diganti untuk membaca kolom
// Retention_Status_Cache / Next_Review_Cache alih-alih menghitung ulang di sini.
function getSantriDashboard(token) {
  const session = validateSession(token);
  if (!session) return { success: false, message: 'Sesi tidak valid, silakan login ulang' };

  const santriId = session.userId;
  const ambangSabqiHari = Number(getConfigValue('AMBANG_SABQI_HARI', 30));
  const today = new Date();

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const masterData = ss.getSheetByName('Master_Hafalan').getDataRange().getValues();

  const misi = { sabaq: [], sabqi: [], manzil: [] };
  for (let i = 1; i < masterData.length; i++) {
    const row = masterData[i];
    // Kolom: ID_Master(0), ID_Santri(1), Surah(2), Ayat_Mulai(3), Ayat_Akhir(4), Tgl_Mulai(5), Status(6)...
    if (row[1] !== santriId) continue;
    const umurHari = daysBetween(new Date(row[5]), today);
    const item = { idMaster: row[0], surah: row[2], ayatMulai: row[3], ayatAkhir: row[4] };
    if (umurHari <= 0) misi.sabaq.push(item);
    else if (umurHari <= ambangSabqiHari) misi.sabqi.push(item);
    else misi.manzil.push(item);
  }

  const gamifikasi = getGamifikasiRow(ss, santriId);
  const levelInfo = getLevelInfo(gamifikasi.xpTotal);

  const badgeData = ss.getSheetByName('Badge').getDataRange().getValues();
  const badges = [];
  for (let i = badgeData.length - 1; i >= 1 && badges.length < 5; i--) {
    if (badgeData[i][1] === santriId) {
      badges.push({ nama: badgeData[i][2], tanggal: badgeData[i][3] });
    }
  }

  return {
    success: true,
    misi: misi,
    gamifikasi: {
      xpTotal: gamifikasi.xpTotal,
      level: levelInfo.nama,
      xpMenujuLevelBerikut: levelInfo.xpMenujuLevelBerikut,
      persenProgress: levelInfo.persenProgress,
      streakSaatIni: gamifikasi.streakSaatIni,
      streakTerpanjang: gamifikasi.streakTerpanjang,
    },
    badges: badges,
  };
}

// Ambil (atau buat default) baris Gamifikasi untuk satu santri.
function getGamifikasiRow(ss, santriId) {
  const sheet = ss.getSheetByName('Gamifikasi');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === santriId) {
      return {
        rowIndex: i + 1, // 1-based untuk Range
        xpTotal: Number(data[i][1]) || 0,
        streakSaatIni: Number(data[i][3]) || 0,
        streakTerpanjang: Number(data[i][4]) || 0,
        lastQualifyingDate: data[i][5] || null,
      };
    }
  }
  // Belum ada baris — buat baru dengan nilai default.
  sheet.appendRow([santriId, 0, LEVEL_THRESHOLDS[0].nama, 0, 0, '']);
  return { rowIndex: sheet.getLastRow(), xpTotal: 0, streakSaatIni: 0, streakTerpanjang: 0, lastQualifyingDate: null };
}

// Konfirmasi satu misi selesai — inilah SATU-SATUNYA titik yang menambah XP
// dan streak (Section 13.3: qualifying activity = evaluasi tercatat, bukan buka halaman).
function confirmMisi(token, jenisMisi, idMaster) {
  const session = validateSession(token);
  if (!session) return { success: false, message: 'Sesi tidak valid, silakan login ulang' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (e) {
    return { success: false, message: 'Server sibuk, coba lagi sebentar' };
  }

  try {
    const santriId = session.userId;
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const today = todayStr();

    // 1. Catat log murojaah (fakta mentah)
    ss.getSheetByName('Murojaah').appendRow([
      Utilities.getUuid(), today, santriId, jenisMisi, idMaster, 'santri', new Date(),
    ]);

    // 2. Hitung XP yang didapat berdasarkan jenis misi (Section 13.2)
    const xpKey = 'XP_' + jenisMisi.toUpperCase(); // XP_SABAQ / XP_SABQI / XP_MANZIL
    const xpGained = Number(getConfigValue(xpKey, 5));

    // 3. Update Gamifikasi: XP + streak
    const gamSheet = ss.getSheetByName('Gamifikasi');
    const gam = getGamifikasiRow(ss, santriId);
    const newXp = gam.xpTotal + xpGained;

    let newStreak = gam.streakSaatIni;
    if (gam.lastQualifyingDate !== today) {
      const yesterday = Utilities.formatDate(new Date(Date.now() - 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      newStreak = gam.lastQualifyingDate === yesterday ? gam.streakSaatIni + 1 : 1;
    }
    const newStreakTerpanjang = Math.max(gam.streakTerpanjang, newStreak);
    const levelInfo = getLevelInfo(newXp);

    // Update satu baris sekaligus (batch write, bukan cell per cell)
    gamSheet.getRange(gam.rowIndex, 2, 1, 5).setValues([[newXp, levelInfo.nama, newStreak, newStreakTerpanjang, today]]);

    return {
      success: true,
      xpGained: xpGained,
      xpTotal: newXp,
      level: levelInfo.nama,
      streakSaatIni: newStreak,
    };
  } finally {
    lock.releaseLock();
  }
}

// Flashcard mandiri Santri — pilih 1 unit hafalan acak dari histori sendiri,
// mengecualikan hafalan yang baru dibuat (masih Sabaq) supaya tidak terlalu mudah.
// Teks ayat & audio diambil oleh frontend dari layer Cache_Ayat/API eksternal,
// bukan dari fungsi ini (lihat Section 16 PRD — pemisahan fakta vs konten eksternal).
function getFlashcard(token) {
  const session = validateSession(token);
  if (!session) return { success: false, message: 'Sesi tidak valid, silakan login ulang' };

  const santriId = session.userId;
  const data = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Master_Hafalan').getDataRange().getValues();

  const kandidat = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === santriId) kandidat.push(data[i]);
  }
  if (kandidat.length === 0) return { success: false, message: 'Belum ada hafalan untuk dikuiskan' };

  // Urutkan dari terlama, kecualikan 5 unit paling baru dari pool
  kandidat.sort((a, b) => new Date(a[5]) - new Date(b[5]));
  const pool = kandidat.length > 5 ? kandidat.slice(0, kandidat.length - 5) : kandidat;
  const pilihan = pool[Math.floor(Math.random() * pool.length)];

  const ayatTeks = getAyatRange(pilihan[2], pilihan[3], pilihan[4]);

  return {
    success: true,
    idMaster: pilihan[0],
    surah: pilihan[2],
    ayatMulai: pilihan[3],
    ayatAkhir: pilihan[4],
    ayat: ayatTeks, // [{ayat, teksArab, audioUrl}, ...] — kosong jika provider API sedang down
  };
}

// ============================================================
// LAYER TEKS & AUDIO AYAT (Cache_Ayat + API Qur'an eksternal)
// ============================================================
// Asumsi skema: kolom Surah di Master_Hafalan/Hafalan berisi NOMOR surah
// (1-114), bukan nama teks — supaya bisa langsung dipetakan ke API tanpa
// tabel lookup tambahan.

function getAyatRangeAction(token, surah, ayatMulai, ayatAkhir) {
  const session = validateSession(token);
  if (!session) return { success: false, message: 'Sesi tidak valid, silakan login ulang' };
  return { success: true, ayat: getAyatRange(surah, ayatMulai, ayatAkhir) };
}

function getAyatRange(surah, ayatMulai, ayatAkhir) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Cache_Ayat');

  let cacheMap = buildCacheMap(sheet.getDataRange().getValues());

  let butuhFetch = false;
  for (let a = ayatMulai; a <= ayatAkhir; a++) {
    if (!cacheMap[surah + '-' + a]) { butuhFetch = true; break; }
  }

  if (butuhFetch) {
    fetchAndCacheSurah(surah);
    cacheMap = buildCacheMap(sheet.getDataRange().getValues()); // baca ulang setelah fetch
  }

  const hasil = [];
  for (let a = ayatMulai; a <= ayatAkhir; a++) {
    const cached = cacheMap[surah + '-' + a];
    hasil.push({
      ayat: a,
      teksArab: cached ? cached.teksArab : '',
      audioUrl: cached ? cached.audioUrl : '',
    });
  }
  return hasil;
}

function buildCacheMap(rows) {
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    map[rows[i][0] + '-' + rows[i][1]] = { teksArab: rows[i][2], audioUrl: rows[i][3] };
  }
  return map;
}

// Fetch satu surah penuh dari API publik, simpan ke Cache_Ayat sekali untuk
// selamanya (batch write). Dilindungi lock supaya dua request bersamaan
// tidak fetch & tulis dobel untuk surah yang sama.
function fetchAndCacheSurah(surah) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(8000);
  } catch (e) {
    return; // biarkan caller lanjut dengan cache kosong daripada gagal total
  }

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Cache_Ayat');

    // Cek ulang: mungkin sudah di-cache oleh proses lain selagi menunggu lock
    const existing = sheet.getDataRange().getValues();
    for (let i = 1; i < existing.length; i++) {
      if (existing[i][0] === surah) return;
    }

    const response = UrlFetchApp.fetch('https://equran.id/api/v2/surat/' + surah, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return; // provider down — biarkan cache kosong (Section 17: External API Resilience)

    const json = JSON.parse(response.getContentText());
    const ayatList = (json.data && json.data.ayat) || [];
    const rows = ayatList.map(function (a) {
      const audioUrl = (a.audio && a.audio['01']) || '';
      return [surah, a.nomorAyat, a.teksArab, audioUrl, new Date()];
    });

    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
    }
  } catch (e) {
    // Kegagalan fetch (network/format berubah) tidak boleh membuat seluruh
    // request pengguna gagal — cache tetap kosong, frontend tampilkan fallback.
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// HELPER LINTAS-ROLE: USERS & TRAFFIC LIGHT
// ============================================================

function getUserRow(userId) {
  const data = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Users').getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId) return data[i]; // ID(0),Username(1),Password_Hash(2),Role(3),Nama(4),ID_Terkait(5)
  }
  return null;
}

function getRelatedSantriId(ortuUserId) {
  const row = getUserRow(ortuUserId);
  return row ? row[5] : null;
}

// Transisi status mengikuti aturan sederhana PRD v1 (Section: Sistem Traffic
// Light), BUKAN formula interval adaptif penuh (PRD v4 Section 7.2) — itu
// scope Retention Engine terpisah yang butuh trigger harian tersendiri.
// Recovery di sini 1 langkah per evaluasi Lancar (Merah->Kuning->Hijau),
// disederhanakan dari "2x Lancar berturut" karena skema belum punya kolom
// pelacak lancar-berturut terpisah dari Consecutive_Lupa.
function transitionStatus(currentStatus, kualitas, consecutiveLupaSebelum) {
  if (kualitas === 'Lancar') {
    if (currentStatus === 'Merah') return { status: 'Kuning', consecutiveLupaBaru: 0 };
    return { status: 'Hijau', consecutiveLupaBaru: 0 };
  }
  if (kualitas === 'Tersendat') {
    return { status: 'Kuning', consecutiveLupaBaru: 0 };
  }
  // Lupa
  const baru = (consecutiveLupaSebelum || 0) + 1;
  return { status: baru >= 2 ? 'Merah' : 'Kuning', consecutiveLupaBaru: baru };
}

function findMasterHafalanRow(sheet, idMaster) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === idMaster) return { rowIndex: i + 1, row: data[i] };
  }
  return null;
}

// ============================================================
// DASHBOARD ORANG TUA
// ============================================================

function getOrtuDashboard(token) {
  const session = validateSession(token);
  if (!session || session.role !== 'ortu') return { success: false, message: 'Sesi tidak valid, silakan login ulang' };

  const idSantri = getRelatedSantriId(session.userId);
  if (!idSantri) return { success: false, message: 'Akun ini belum terhubung ke data santri' };

  const santriUser = getUserRow(idSantri);
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const masterData = ss.getSheetByName('Master_Hafalan').getDataRange().getValues();

  const ringkasan = { hijau: 0, kuning: 0, merah: 0 };
  const daftar = [];
  for (let i = 1; i < masterData.length; i++) {
    const row = masterData[i];
    if (row[1] !== idSantri) continue;
    const status = row[7] || 'Hijau'; // default optimis kalau cache belum pernah diisi
    if (status === 'Hijau') ringkasan.hijau++;
    else if (status === 'Kuning') ringkasan.kuning++;
    else ringkasan.merah++;
    daftar.push({ idMaster: row[0], surah: row[2], ayatMulai: row[3], ayatAkhir: row[4], status: status });
  }

  return {
    success: true,
    namaAnak: santriUser ? santriUser[4] : 'Ananda',
    ringkasan: ringkasan,
    daftar: daftar,
  };
}

// Randomizer: prioritaskan hafalan lemah (Kuning/Merah) & bukan hafalan yang
// masih sangat baru (Sabaq), sesuai PRD Section 12.
function getTesAcak(token) {
  const session = validateSession(token);
  if (!session || session.role !== 'ortu') return { success: false, message: 'Sesi tidak valid, silakan login ulang' };

  const idSantri = getRelatedSantriId(session.userId);
  if (!idSantri) return { success: false, message: 'Akun ini belum terhubung ke data santri' };

  const masterData = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Master_Hafalan').getDataRange().getValues();
  const today = new Date();
  const kandidatLemah = [];
  const kandidatLain = [];

  for (let i = 1; i < masterData.length; i++) {
    const row = masterData[i];
    if (row[1] !== idSantri) continue;
    if (daysBetween(new Date(row[5]), today) < 1) continue; // kecualikan Sabaq (masih sangat baru)
    const status = row[7] || 'Hijau';
    if (status === 'Kuning' || status === 'Merah') kandidatLemah.push(row);
    else kandidatLain.push(row);
  }

  const pool = kandidatLemah.length > 0 ? kandidatLemah : kandidatLain;
  if (pool.length === 0) return { success: false, message: 'Belum ada hafalan yang cukup lama untuk dites' };

  const pilihan = pool[Math.floor(Math.random() * pool.length)];
  const ayatTeks = getAyatRange(pilihan[2], pilihan[3], pilihan[4]);

  return {
    success: true,
    idMaster: pilihan[0],
    surah: pilihan[2],
    ayatMulai: pilihan[3],
    ayatAkhir: pilihan[4],
    ayat: ayatTeks,
  };
}

function recordTesOrtu(token, idMaster, kualitas) {
  const session = validateSession(token);
  if (!session || session.role !== 'ortu') return { success: false, message: 'Sesi tidak valid, silakan login ulang' };

  const idSantri = getRelatedSantriId(session.userId);
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (e) {
    return { success: false, message: 'Server sibuk, coba lagi sebentar' };
  }

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const masterSheet = ss.getSheetByName('Master_Hafalan');
    const found = findMasterHafalanRow(masterSheet, idMaster);
    if (!found || found.row[1] !== idSantri) {
      return { success: false, message: 'Data hafalan tidak ditemukan' };
    }

    const currentStatus = found.row[7] || 'Hijau';
    const consecutiveLupaSebelum = Number(found.row[10]) || 0;
    const hasil = transitionStatus(currentStatus, kualitas, consecutiveLupaSebelum);

    masterSheet.getRange(found.rowIndex, 8).setValue(hasil.status);
    masterSheet.getRange(found.rowIndex, 11).setValue(hasil.consecutiveLupaBaru);

    ss.getSheetByName('Riwayat_Tes').appendRow([
      Utilities.getUuid(), todayStr(), idSantri, idMaster, found.row[2], found.row[3], found.row[4], kualitas, 'ortu',
    ]);

    return { success: true, statusBaru: hasil.status };
  } finally {
    lock.releaseLock();
  }
}

function kirimSemangat(token) {
  const session = validateSession(token);
  if (!session || session.role !== 'ortu') return { success: false, message: 'Sesi tidak valid, silakan login ulang' };

  const idSantri = getRelatedSantriId(session.userId);
  if (!idSantri) return { success: false, message: 'Akun ini belum terhubung ke data santri' };

  SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Notifikasi').appendRow([
    Utilities.getUuid(), idSantri, 'apresiasi', 'Orang tuamu mengirimkan semangat untukmu! 🎉', new Date(), false,
  ]);
  return { success: true };
}

// ============================================================
// DASHBOARD USTAZ
// ============================================================

function getUstazDashboard(token) {
  const session = validateSession(token);
  if (!session || session.role !== 'ustaz') return { success: false, message: 'Sesi tidak valid, silakan login ulang' };

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const santriData = ss.getSheetByName('Santri').getDataRange().getValues();
  const masterData = ss.getSheetByName('Master_Hafalan').getDataRange().getValues();
  const gamData = ss.getSheetByName('Gamifikasi').getDataRange().getValues();
  const ambangStreakTerputusHari = 3;
  const today = new Date();

  const daftarSantri = [];
  for (let i = 1; i < santriData.length; i++) {
    const s = santriData[i]; // ID_Santri(0), Nama(1), ID_Ustaz(2), Status(3)
    if (s[2] !== session.userId) continue;

    const ringkasan = { hijau: 0, kuning: 0, merah: 0 };
    for (let j = 1; j < masterData.length; j++) {
      if (masterData[j][1] !== s[0]) continue;
      const status = masterData[j][7] || 'Hijau';
      if (status === 'Hijau') ringkasan.hijau++;
      else if (status === 'Kuning') ringkasan.kuning++;
      else ringkasan.merah++;
    }

    let streakTerputus = false;
    for (let k = 1; k < gamData.length; k++) {
      if (gamData[k][0] !== s[0]) continue;
      const lastDate = gamData[k][5];
      if (lastDate && daysBetween(new Date(lastDate), today) > ambangStreakTerputusHari) streakTerputus = true;
      break;
    }

    daftarSantri.push({
      idSantri: s[0],
      nama: s[1],
      ringkasan: ringkasan,
      flagged: ringkasan.merah > 0 || streakTerputus,
    });
  }

  return { success: true, daftarSantri: daftarSantri };
}

function inputSetoran(token, idSantri, surah, ayatMulai, ayatAkhir, nilai, catatan) {
  const session = validateSession(token);
  if (!session || session.role !== 'ustaz') return { success: false, message: 'Sesi tidak valid, silakan login ulang' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (e) {
    return { success: false, message: 'Server sibuk, coba lagi sebentar' };
  }

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // Verifikasi santri memang di bawah bimbingan Ustaz ini
    const santriData = ss.getSheetByName('Santri').getDataRange().getValues();
    const milikUstazIni = santriData.some((row) => row[0] === idSantri && row[2] === session.userId);
    if (!milikUstazIni) return { success: false, message: 'Santri ini bukan bimbinganmu' };

    const today = todayStr();
    ss.getSheetByName('Hafalan').appendRow([
      Utilities.getUuid(), today, idSantri, surah, ayatMulai, ayatAkhir, nilai, catatan || '', '', new Date(),
    ]);

    const nilaiHijauMin = Number(getConfigValue('NILAI_HIJAU_MIN', 80));
    const statusAwal = Number(nilai) >= nilaiHijauMin ? 'Hijau' : 'Kuning';

    ss.getSheetByName('Master_Hafalan').appendRow([
      Utilities.getUuid(), idSantri, surah, ayatMulai, ayatAkhir, today, 'Aktif', statusAwal, '', 1, 0,
    ]);

    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function broadcastMotivasi(token, pesan) {
  const session = validateSession(token);
  if (!session || session.role !== 'ustaz') return { success: false, message: 'Sesi tidak valid, silakan login ulang' };
  if (!pesan || !pesan.trim()) return { success: false, message: 'Pesan tidak boleh kosong' };

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const santriData = ss.getSheetByName('Santri').getDataRange().getValues();
  const notifSheet = ss.getSheetByName('Notifikasi');

  let jumlah = 0;
  const rows = [];
  for (let i = 1; i < santriData.length; i++) {
    if (santriData[i][2] !== session.userId) continue;
    rows.push([Utilities.getUuid(), santriData[i][0], 'broadcast', pesan, new Date(), false]);
    jumlah++;
  }
  if (rows.length > 0) {
    notifSheet.getRange(notifSheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  }

  return { success: true, jumlahTerkirim: jumlah };
}
