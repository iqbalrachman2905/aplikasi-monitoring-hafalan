# PRODUCT REQUIREMENTS DOCUMENT (PRD) v4
## Aplikasi Monitoring Hafalan Al-Qur'an Berbasis Retensi
### Consolidated, Retention-First & Technically Hardened

> Perubahan dari v3: seluruh keputusan terbuka di v3 (Section 20) sudah dikunci, formula interval adaptif dibuat konkret, strategi performa Sheets/GAS ditambahkan, dan mekanisme auth/concurrency dispesifikasi. Bagian baru ditandai **[BARU]**.

---

## 1. Ringkasan Eksekutif

Produk ini adalah web app mobile-first berbasis Google Apps Script (GAS) dan Google Sheets untuk membantu Ustaz, Santri, dan Orang Tua menjaga kualitas retensi hafalan Al-Qur'an. Produk tidak diposisikan sebagai sekadar pencatat setoran, tetapi sebagai *retention engine* yang mengubah riwayat hafalan dan evaluasi menjadi jadwal review, misi harian, indikator kesehatan hafalan, dan dukungan motivasi.

Prinsip utama: database menyimpan fakta/history; business logic menghitung kondisi dan rekomendasi; frontend menampilkan pengalaman yang sederhana dan memotivasi.

**[BARU]** Karena database yang dipakai adalah Google Sheets (bukan database relasional), prinsip tambahan yang mengikat seluruh desain teknis di bawah adalah: **minimalkan jumlah panggilan I/O ke Sheets, dan pisahkan data mentah dari status turunan (cache) yang mahal dihitung ulang.**

---

## 2. Tujuan Produk

- Membantu Santri konsisten menjaga hafalan, bukan hanya menambah jumlah hafalan.
- Membantu Ustaz mengetahui santri yang aman, perlu perhatian, atau membutuhkan intervensi.
- Membantu Orang Tua melakukan tes hafalan secara sederhana tanpa harus memahami seluruh metodologi tahfidz.
- Menerapkan pola review bertahap Sabaq, Sabqi, dan Manzil dengan penjadwalan yang dapat berkembang menjadi adaptive spaced repetition.
- Menyediakan feedback, reward, dan streak sebagai lapisan motivasi tanpa menjadikan kompetisi sebagai tujuan utama.

---

## 3. Prinsip Produk

| Prinsip | Makna |
|---|---|
| Retention over Quantity | Keberhasilan utama diukur dari konsistensi dan kualitas retensi. |
| Facts over Derived State | Hafalan, murojaah, dan hasil tes adalah fakta. Status retention dihitung oleh engine. |
| Recovery, Not Punishment | Status Merah harus mempunyai jalur pemulihan yang jelas. |
| Simple for Parents | Orang tua dapat melakukan tes dengan satu-dua klik. |
| Mobile First | Interaksi utama dirancang untuk layar ponsel. |
| Configurable | Ambang dan parameter inti dapat diatur tanpa mengubah kode. |
| Gamification as Support | XP, streak, dan badge memperkuat kebiasaan, bukan menggantikan kualitas hafalan. |
| **[BARU] Compute Once, Cache Often** | Status turunan yang mahal (retention status, next review) dihitung berkala/event-driven dan disimpan sebagai cache, bukan direcompute setiap dashboard dibuka. |

---

## 4. User Personas & Hak Akses

| Role | Fokus | Hak Utama |
|---|---|---|
| Ustaz | Pengelolaan & evaluasi | Kelola santri, target, setoran, feedback, lihat status kelompok, auto-flag. |
| Santri | Eksekusi & motivasi | Lihat misi, konfirmasi murojaah, flashcard, audio, XP, streak, badge, riwayat. |
| Orang Tua | Pengawasan & testing | Lihat rapor, tes acak, audio, evaluasi 1-klik, apresiasi, ringkasan. |

---

## 5. Arsitektur Teknologi

- **Frontend:** HTML + CSS + Vanilla JavaScript melalui GAS HTML Service.
- **Backend/API:** Google Apps Script (Code.gs).
- **Database:** Google Sheets.
- **External API:** Public Qur'an API untuk teks Arab dan audio murattal.
- **Komunikasi frontend-backend:** `google.script.run` dengan pola asynchronous success/failure handler.
- **Prinsip keamanan:** seluruh validasi otorisasi dan business logic penting dilakukan di backend; frontend tidak dipercaya sebagai sumber otorisasi.

**[BARU] Lapisan performa & reliabilitas tambahan:**

| Lapisan | Teknologi GAS | Fungsi |
|---|---|---|
| Token Auth | `PropertiesService` | Menyimpan token sesi setelah login, tervalidasi di setiap request. |
| Response Cache | `CacheService` | Menyimpan hasil fetch API Qur'an eksternal (teks & metadata audio) agar tidak fetch berulang. |
| Write Lock | `LockService.getScriptLock()` | Mencegah race condition saat beberapa Santri/Ortu menulis ke sheet yang sama secara bersamaan. |
| Batch I/O | `getValues()` / `setValues()` sekali per sheet | Menghindari panggilan `getRange` berulang dalam loop — ini adalah sumber utama pelanggaran target performa 3 detik. |

---

## 6. Modul Inti

| Modul | Fungsi |
|---|---|
| Authentication & Routing | Login, session (token-based), role-based routing. |
| Target Management | Target bulanan per Santri. |
| Hafalan & Setoran | Riwayat setoran aktual dan rentang ayat. |
| Murojaah | Log aktivitas Sabaq/Sabqi/Manzil. |
| Retention Engine | Menentukan kualitas, status, dan next review — **dihitung via trigger + cache**. |
| Daily Mission | Menghasilkan tugas harian dari retention state (baca dari cache). |
| Testing | Flashcard Santri dan random test Orang Tua. |
| Gamification | XP, level, streak, badge. |
| Notification | Reminder, apresiasi, dan ringkasan. |
| Ustaz Monitoring | Traffic light, auto-flag, feedback, rekap kelompok. |

---

## 7. Retention Engine — Core Product Logic

Alur utama:

`Hafalan → Evaluasi → Retention State → Next Review → Sabaq/Sabqi/Manzil → Daily Mission → Evaluasi baru → Retention State diperbarui.`

### 7.1 Klasifikasi Review

| Kategori | Default (dikunci) | Catatan |
|---|---|---|
| Sabaq | Hafalan hari ini / terbaru | Prioritas hafalan baru. |
| Sabqi | 1–30 hari | Review hafalan relatif baru. |
| Manzil | >30 hari | Review hafalan lama; kandidat utama random test. |

Nilai ambang disimpan di sheet **Config** (`AMBANG_SABQI_HARI = 30`) — dapat diubah terpusat tanpa ubah kode. Override per Santri hanya jika benar-benar diperlukan (mis. santri berkebutuhan khusus).

### 7.2 Review Interval Adaptif — **[BARU: formula dikunci, SM-2-lite]**

Formula final untuk MVP (bukan SuperMemo penuh, cukup untuk kebutuhan retensi hafalan):

| Hasil Evaluasi | Aksi Interval |
|---|---|
| Lancar | `interval_baru = interval_lama × 1.5` (dibulatkan ke atas, **capped maks 60 hari**) |
| Tersendat | `interval_baru = interval_lama × 0.5` (**minimum 1 hari**) |
| Lupa | `interval_baru = 1 hari` (unit langsung masuk antrian Sabaq ulang) |
| Lupa ≥2x beruntun | Status Merah — interval di-override oleh Recovery Policy (lihat 7.4), bukan oleh formula di atas |

Multiplier (`1.5`, `0.5`) dan cap (`60`) disimpan sebagai baris di sheet **Config**, bukan hard-code, agar Ustaz/admin bisa menyesuaikan tanpa ubah script.

### 7.3 Retention Status

| Status | Kondisi Umum | Aksi Sistem |
|---|---|---|
| Hijau | Retensi stabil; evaluasi terbaru lancar. | Review normal, tampilkan sebagai aman. |
| Kuning | Tersendat atau sinyal penurunan. | Prioritaskan review lebih dekat. |
| Merah | Lupa ≥2x berturut-turut atau kondisi kritis. | Masuk recovery dan auto-flag Ustaz. |

Status adalah **derived state**, bukan sumber data manual. Engine menghitungnya dari histori evaluasi dan parameter konfigurasi, lalu **disimpan sebagai cache** di `Master_Hafalan` (lihat Section 15) — tidak dihitung ulang setiap dashboard dibuka.

### 7.4 Recovery

Default policy: dua hasil Lancar berturut-turut pada unit hafalan yang sama mengeluarkan status dari Merah ke Kuning; evaluasi Lancar berikutnya dan kondisi stabil memungkinkan kembali ke Hijau. Parameter jumlah evaluasi Lancar berturut-turut yang dibutuhkan disimpan di Config (default: 2).

### 7.5 **[BARU] Kapan Retention Engine Dijalankan (Compute Strategy)**

Untuk menghindari recompute penuh atas seluruh histori setiap dashboard dibuka:

- **Time-driven trigger (harian, malam hari):** menjalankan ulang perhitungan status & next-review untuk seluruh `Master_Hafalan`, menulis hasil ke kolom cache. Ini menjaga data "segar" setiap pagi tanpa membebani jam aktif pengguna.
- **Event-driven (real-time, scope kecil):** begitu satu evaluasi baru masuk (dari Riwayat_Tes atau Hafalan), engine langsung menghitung ulang **hanya untuk satu unit `Master_Hafalan` terkait** dan update cache-nya — bukan seluruh dataset.
- Dashboard (Santri/Ortu/Ustaz) **hanya membaca kolom cache**, tidak pernah memicu recompute penuh saat load halaman.

---

## 8. Daily Mission Generator

Generator mengambil `Target`, `Master_Hafalan` (kolom cache), `Hafalan`, `Murojaah`, `Riwayat_Tes` untuk membentuk misi harian.

| Misi | Tujuan | Output |
|---|---|---|
| Sabaq | Menjaga hafalan terbaru. | Rentang hafalan yang harus direview/setor. |
| Sabqi | Memperkuat hafalan 1–30 hari. | Daftar review terjadwal. |
| Manzil | Menjaga hafalan lama. | Daftar review prioritas. |

Konfirmasi selesai hanya dicatat setelah aksi bermakna (evaluasi tercatat); membuka halaman tidak dihitung sebagai penyelesaian.

**[BARU]** Karena generator membaca dari cache (Section 7.5), operasi ini ringan — cukup 1x batch read per sheet, tidak perlu menghitung ulang retention di tempat.

---

## 9. Fitur Dashboard Santri

- Misi harian Sabaq, Sabqi, Manzil.
- One-click 'Selesai Murojaah'.
- Flashcard: potongan ayat → tebak kelanjutan → skor/reward instan.
- Mode 'Dengar Dulu, Baru Uji' dengan opsi Skip.
- XP dan Level berbasis konsistensi menjaga hafalan.
- Streak berbasis **qualifying activity** (lihat definisi terkunci di 13.3), bukan login.
- Heatmap kalender berdasarkan persentase penyelesaian misi.
- Badge milestone.
- Feedback singkat dari Ustaz.
- Leaderboard kelompok — opsional, **OFF default**, Phase 4.

---

## 10. Fitur Dashboard Orang Tua

- Rapor visual traffic light.
- Tes acak tanpa input Surah/Ayat.
- Randomizer memprioritaskan hafalan lama/overdue dan status Kuning/Merah, bukan random murni.
- Audio murattal.
- Evaluasi 1-klik: Lancar/Tersendat/Lupa.
- Grafik perkembangan sederhana.
- Kirim Semangat 1-klik.
- Ringkasan mingguan.

---

## 11. Fitur Dashboard Ustaz

- Kelola target bulanan.
- Input dan validasi setoran.
- Rekap traffic light seluruh kelompok dalam satu layar.
- Auto-Flag: Merah, review overdue, streak terputus, atau penurunan performa.
- Feedback singkat ke Santri.
- Rekomendasi penjadwalan ulang sebagai **rekomendasi**, bukan perubahan otomatis tanpa persetujuan.
- Broadcast motivasi ke kelompok.

---

## 12. Randomizer Orang Tua

Candidate pool difilter berdasarkan `ID_Santri`. Hafalan terlalu baru dikeluarkan dari pool. Sistem memprioritaskan hafalan yang overdue atau berstatus lemah (dibaca dari cache Section 7.5); jika beberapa kandidat setara, satu kandidat dipilih secara acak.

Tujuan: tes acak menjadi alat pemeriksaan retensi, bukan sekadar undian hafalan.

---

## 13. Gamifikasi

### 13.1 Elemen

| Elemen | Aturan |
|---|---|
| XP | Diberikan untuk aktivitas bermakna; bobot Manzil lebih tinggi karena menjaga hafalan lama lebih sulit. |
| Level | Turunan dari XP; nama level bernuansa positif. |
| Streak | Hari berturut-turut dengan minimal satu qualifying activity. |
| Badge | Milestone seperti konsistensi, retensi, dan recovery. |
| Leaderboard | Opsional, per kelompok, weekly, **OFF default**, tidak berdasarkan jumlah hafalan mentah. |

XP bukan pengganti penilaian Ustaz dan tidak boleh membuat anak mengejar kuantitas dengan mengorbankan kualitas.

### 13.2 **[BARU] Bobot XP (dikunci untuk MVP)**

| Aktivitas | XP |
|---|---|
| Menyelesaikan review Sabaq | 5 |
| Menyelesaikan review Sabqi | 8 |
| Menyelesaikan review Manzil | 12 |
| Evaluasi "Lancar" dari Ortu/Ustaz | +5 bonus |
| Recovery berhasil (Merah → Kuning) | +15 bonus |

Nilai ini disimpan di Config sebagai `XP_SABAQ`, `XP_SABQI`, `XP_MANZIL`, dst — bukan hard-code.

### 13.3 **[BARU] Definisi Qualifying Activity untuk Streak (dikunci)**

Streak bertambah pada suatu hari **jika dan hanya jika** minimal satu misi (Sabaq/Sabqi/Manzil) dikonfirmasi selesai **dengan evaluasi tercatat** pada hari itu. Membuka dashboard, membuka flashcard tanpa menjawab, atau memutar audio saja **tidak** dihitung. Metrik "Mission Completion Rate" (Section 21) dihitung terpisah berdasarkan proporsi misi selesai per hari, agar tidak tercampur dengan logika streak.

---

## 14. Notifikasi & Komunikasi

| Fitur | Prioritas | Catatan |
|---|---|---|
| In-app reminder | MVP+ | Reminder misi. |
| Email | Opsional | Ringkasan mingguan bila diperlukan. |
| WhatsApp | Phase berikutnya | Tidak menjadi dependency core karena memerlukan provider/API pihak ketiga. |
| Apresiasi Ortu | Phase 3 | Pesan singkat ke dashboard Santri. |
| Feedback Ustaz | Phase 3 | Pesan singkat terkait setoran. |

---

## 15. Struktur Database (Google Sheets)

| Sheet | Kolom Inti | Fungsi |
|---|---|---|
| Users | ID, Username, **Password_Hash**, Role, Nama, ID_Terkait | Akun & relasi role. Password di-hash (lihat Section 16), tidak plaintext. |
| Santri | ID_Santri, Nama, ID_Ustaz, Status | Master santri. |
| Target | ID_Target, Bulan, ID_Santri, Target_Surah, Ayat_Mulai, Ayat_Akhir | Target bulanan. |
| Hafalan | ID_Hafalan, Tgl, ID_Santri, Surah, Ayat_Mulai, Ayat_Akhir, Nilai, Catatan, ID_Target, Timestamp | History setoran. |
| Master_Hafalan | ID_Master, ID_Santri, Surah, Ayat_Mulai, Ayat_Akhir, Tgl_Mulai, Status, **Retention_Status_Cache, Next_Review_Cache, Current_Interval_Hari, Consecutive_Lupa** | Unit hafalan yang dilacak retensinya. Kolom bercetak tebal adalah **[BARU]** — hasil hitung Retention Engine, bukan input manual. |
| Murojaah | ID_Murojaah, Tgl, ID_Santri, Jenis_Misi, Detail, Pelapor, Timestamp | History aktivitas review. |
| Riwayat_Tes | ID_Tes, Tgl, ID_Santri, ID_Master, Surah, Ayat_Mulai, Ayat_Akhir, Kualitas, Pelapor | History evaluasi retensi — trigger utama Retention Engine event-driven. |
| Gamifikasi | ID_Santri, XP_Total, Level, Streak_Saat_Ini, Streak_Terpanjang, **Last_Qualifying_Date** | State agregat gamifikasi. Kolom terakhir **[BARU]** untuk validasi streak tanpa scan histori penuh. |
| Badge | ID_Badge, ID_Santri, Nama_Badge, Tgl_Diperoleh | Log milestone. |
| Notifikasi | ID_Notif, ID_User, Tipe, Pesan, Tgl_Kirim, Status_Baca | Log notifikasi. |
| Feedback | ID_Feedback, ID_Santri, ID_Hafalan, ID_Ustaz, Pesan, Tgl, Status_Baca | Feedback Ustaz. |
| Config | Key, Value, Description | Parameter sistem — lihat daftar lengkap di Section 20.1. |
| **[BARU] Sessions** | Token, ID_User, Role, Expiry | Menyimpan token aktif untuk validasi auth server-side (lihat Section 16). |
| **[BARU] Cache_Ayat** | Surah, Ayat, Teks_Arab, Audio_URL, Last_Fetched | Cache lokal hasil fetch API Qur'an eksternal, agar tidak fetch berulang untuk ayat yang sama. |

Catatan desain: `Retention_Status_Cache` dan `Next_Review_Cache` adalah cache yang dapat diregenerasi kapan saja dari histori mentah (Hafalan, Murojaah, Riwayat_Tes) — bukan sumber kebenaran utama, sehingga aman untuk di-refresh ulang penuh via trigger jika terjadi inkonsistensi.

**[BARU] Strategi Archive:** setelah 6 bulan, baris `Murojaah` dan `Riwayat_Tes` yang lebih lama dipindahkan ke spreadsheet arsip terpisah (dihubungkan via `ID_Santri`), agar sheet aktif tetap ramping dan tidak memperlambat batch read Retention Engine.

---

## 16. Keamanan & Data Integrity

- Password tidak disimpan plaintext; gunakan password hash (`Utilities.computeDigest` dengan salt, disimpan di kolom `Password_Hash`).
- Validasi role dan `ID_Terkait` dilakukan server-side.
- Orang Tua hanya boleh mengakses Santri yang terikat pada `ID_Terkait`.
- Santri hanya boleh membaca dan menulis data yang terkait dengan ID-nya.
- Ustaz hanya dapat mengelola santri dalam kelompoknya.
- Frontend tidak menjadi sumber otorisasi.
- ID record dibuat server-side.
- Perubahan penting dicatat dengan timestamp dan actor/pelapor.

**[BARU] Mekanisme Session/Auth (menutup Section 20 poin 7 di v3):**
1. Login sukses → backend generate token acak (UUID), simpan ke sheet `Sessions` dengan `ID_User`, `Role`, dan `Expiry` (mis. 24 jam).
2. Token dikirim ke frontend, disimpan di variabel JS sisi client (bukan localStorage — mengikuti batasan platform artifact/GAS HTML Service) dan disertakan di setiap parameter `google.script.run`.
3. Setiap fungsi backend yang mengakses data **wajib** memvalidasi token terhadap sheet `Sessions` dan mencocokkan `Role`/`ID_Terkait` sebelum eksekusi — `ID_Santri` yang dikirim dari client tidak pernah dipercaya mentah-mentah.
4. Token kedaluwarsa otomatis dibersihkan via trigger harian.

**[BARU] Concurrency Control:** setiap fungsi backend yang menulis ke sheet (submit setoran, konfirmasi murojaah, evaluasi tes) wajib menggunakan `LockService.getScriptLock()` dengan timeout pendek (≈5 detik) untuk mencegah race condition saat beberapa user menulis ke sheet yang sama secara bersamaan.

---

## 17. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Responsive | Mobile-first dan nyaman pada browser ponsel. |
| Performance | Operasi CRUD utama ditargetkan selesai ≤3 detik pada kondisi normal. |
| Reliability | Error backend dikembalikan secara terstruktur; UI menampilkan feedback yang jelas. |
| Maintainability | Business logic dipisah menjadi fungsi modular; konfigurasi tidak hard-code. |
| Scalability | Pembacaan Sheet dioptimalkan dengan batch read/write; hindari `getRange` berulang dalam loop. |
| Privacy | Data hafalan dan akun dibatasi berdasarkan role dan relasi. |
| **[BARU] External API Resilience** | Fetch ke API Qur'an eksternal selalu melalui `Cache_Ayat`/`CacheService` terlebih dahulu; sistem tidak boleh gagal total jika provider eksternal down — tampilkan fallback teks dari cache terakhir jika audio/teks realtime tidak tersedia. |
| **[BARU] Data Growth Management** | Sheet histori (Murojaah, Riwayat_Tes) diarsipkan berkala (Section 15) agar performa batch read tidak menurun seiring waktu. |

---

## 18. Prioritas Implementasi

| Phase | Scope |
|---|---|
| Phase 1 — Core Engine | Auth (token-based), role, target, hafalan, murojaah, riwayat tes, Master_Hafalan, Retention Engine (formula + cache strategy), Sabaq/Sabqi/Manzil, recovery, daily mission, LockService pada semua write. |
| Phase 2 — UX & Motivation | Dashboard tiga role, flashcard, audio (dengan cache), XP (bobot terkunci), streak (definisi terkunci), heatmap, badge. |
| Phase 3 — Engagement | Notifikasi, feedback Ustaz, apresiasi Ortu, weekly summary, auto-flag, broadcast. |
| Phase 4 — Advanced | Leaderboard, sinkronisasi tajwid per kata bila API mendukung, adaptive scheduling lebih lanjut, archive otomatis histori. |

---

## 19. Acceptance Criteria

- Login mengarahkan user ke dashboard sesuai role, tervalidasi via token session.
- Santri melihat misi Sabaq/Sabqi/Manzil yang dihasilkan dari data cache retention state (bukan recompute on-the-fly).
- Konfirmasi murojaah tercatat dengan actor dan timestamp, dilindungi oleh script lock.
- Setoran Ustaz tercatat dengan rentang ayat dan nilai.
- Tes Orang Tua dapat dilakukan tanpa mengetik Surah/Ayat.
- Randomizer tidak memilih hafalan yang terlalu baru dan memprioritaskan hafalan overdue/lemah berdasarkan cache status.
- Status Merah memiliki jalur recovery yang dapat diuji (2x Lancar berturut-turut → Kuning).
- XP dan streak hanya bertambah dari qualifying activity sesuai definisi Section 13.3.
- Traffic light konsisten antara dashboard Santri, Orang Tua, dan Ustaz (karena sama-sama membaca cache yang sama).
- CRUD utama menargetkan ≤3 detik pada kondisi normal, diuji dengan dataset simulasi ≥1 tahun aktivitas.
- Aplikasi usable pada browser mobile.
- **[BARU]** Fetch API Qur'an eksternal tidak dilakukan berulang untuk ayat yang sama dalam satu hari (tervalidasi via `Cache_Ayat`).
- **[BARU]** Dua request tulis bersamaan ke unit hafalan yang sama tidak menyebabkan data korup atau hilang (diuji dengan simulasi concurrent write).

---

## 20. Keputusan yang Sudah Dikunci **[BARU — sebelumnya Section 20 "Open Decisions" di v3]**

| Keputusan (v3) | Hasil Kunci (v4) |
|---|---|
| Unit pelacakan retensi: per rentang ayat atau per ayat | **Per-rentang sesuai unit setoran** (mengikuti struktur `Master_Hafalan` yang sudah ada). Presisi per-ayat ditunda ke phase lanjutan jika performa Sheets terbukti sanggup. |
| Formula Retention Score/interval adaptif final | **SM-2-lite** — lihat Section 7.2 (multiplier 1.5/0.5, cap 60 hari, disimpan di Config). |
| Definisi qualifying activity untuk streak | Minimal satu misi dengan evaluasi tercatat per hari — lihat Section 13.3. |
| Bobot XP masing-masing aktivitas | Lihat tabel Section 13.2 (Sabaq 5, Sabqi 8, Manzil 12, dst). |
| Apakah leaderboard diperlukan pada rilis awal | **Tidak** — OFF default, masuk Phase 4. |
| API Al-Qur'an dan sumber audio final | Dipilih satu provider di awal Phase 1 (equran.id atau quran.com), hasil fetch selalu melalui `Cache_Ayat`. Keputusan provider spesifik menunggu evaluasi rate-limit masing-masing sebelum Phase 1 dimulai. |
| Metode session/authentication GAS yang digunakan | Token custom + sheet `Sessions` + `PropertiesService` — lihat Section 16. |
| Parameter Config default dan siapa yang berhak mengubahnya | Disimpan di sheet `Config`; hanya Ustaz/Admin (role tertinggi) yang punya akses tulis ke sheet ini. |

### 20.1 Daftar Parameter Config Minimum untuk Phase 1

```
AMBANG_SABQI_HARI = 30
INTERVAL_MULTIPLIER_LANCAR = 1.5
INTERVAL_MULTIPLIER_TERSENDAT = 0.5
INTERVAL_CAP_MAKS_HARI = 60
INTERVAL_LUPA_HARI = 1
RECOVERY_LANCAR_BERUNTUN_DIBUTUHKAN = 2
XP_SABAQ = 5
XP_SABQI = 8
XP_MANZIL = 12
XP_BONUS_LANCAR = 5
XP_BONUS_RECOVERY = 15
SESSION_EXPIRY_JAM = 24
ARCHIVE_AMBANG_BULAN = 6
```

---

## 21. Product Success Metrics

| Metric | Tujuan |
|---|---|
| Mission Completion Rate | Mengukur konsistensi penyelesaian misi. |
| 7/30-day Active Retention | Mengukur apakah Santri kembali menjaga hafalan. |
| Overdue Review Rate | Mengukur jumlah review yang terlambat. |
| Red → Green Recovery Rate | Mengukur efektivitas recovery. |
| Parent Test Participation | Mengukur keterlibatan Orang Tua. |
| Streak Distribution | Melihat pola konsistensi tanpa menjadikannya satu-satunya KPI. |

---

## 22. **[BARU] Risiko Teknis & Mitigasi (Ringkasan)**

| Risiko | Dampak Jika Diabaikan | Mitigasi |
|---|---|---|
| `getRange` dipanggil dalam loop | Target performa 3 detik gagal saat data menumpuk | Batch `getValues()`/`setValues()`, wajib di semua fungsi Phase 1 |
| Retention Engine dihitung ulang tiap dashboard load | Lag signifikan, quota GAS execution time terlampaui | Cache + trigger harian + event-driven scope kecil (Section 7.5) |
| Tidak ada session management | Celah keamanan, Ortu/Santri bisa akses data lintas akun | Token + validasi server-side wajib (Section 16) |
| Tidak ada lock saat multi-user submit | Data tertimpa/korup | `LockService.getScriptLock()` di semua fungsi tulis |
| Sheet histori tumbuh tanpa batas | Performa menurun seiring waktu, akhirnya melebihi limit Sheets | Archive strategy 6 bulan (Section 15, 17) |
| Ketergantungan penuh pada API Qur'an eksternal real-time | Fitur inti (audio tes Ortu) gagal total saat provider down/rate-limited | Cache lokal (`Cache_Ayat`) + fallback (Section 17) |
