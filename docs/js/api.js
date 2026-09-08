import { CONFIG } from './config.js';

// PENTING: Content-Type di-set text/plain (bukan application/json) supaya
// browser menganggap ini "simple request" dan TIDAK mengirim preflight OPTIONS
// terlebih dahulu — GAS Web App tidak menangani OPTIONS sehingga request akan
// gagal kalau memakai application/json.
async function callApi(action, payload = {}) {
  const body = JSON.stringify({ action, ...payload });

  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
  });

  if (!res.ok) {
    throw new Error('Gagal menghubungi server (' + res.status + ')');
  }
  return res.json();
}

export async function login(username, password) {
  const result = await callApi('login', { username, password });
  if (result.success) {
    saveSession(result);
  }
  return result;
}

export function saveSession(session) {
  localStorage.setItem(CONFIG.SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function getSession() {
  const raw = localStorage.getItem(CONFIG.SESSION_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearSession() {
  localStorage.removeItem(CONFIG.SESSION_STORAGE_KEY);
}

export function requireSession(expectedRole) {
  const session = getSession();
  if (!session || (expectedRole && session.role !== expectedRole)) {
    window.location.href = 'index.html';
    return null;
  }
  return session;
}

// Semua panggilan setelah login menyertakan token — backend yang validasi,
// frontend tidak pernah mengirim ID santri secara langsung untuk data sensitif.
export async function getSantriDashboard(token) {
  return callApi('getSantriDashboard', { token });
}

export async function confirmMisi(token, jenisMisi, idMaster) {
  return callApi('confirmMisi', { token, jenisMisi, idMaster });
}

export async function getFlashcard(token) {
  return callApi('getFlashcard', { token });
}

export async function getAyatRange(token, surah, ayatMulai, ayatAkhir) {
  return callApi('getAyatRange', { token, surah, ayatMulai, ayatAkhir });
}

// --- Dashboard Orang Tua ---
export async function getOrtuDashboard(token) {
  return callApi('getOrtuDashboard', { token });
}
export async function getTesAcak(token) {
  return callApi('getTesAcak', { token });
}
export async function recordTesOrtu(token, idMaster, kualitas) {
  return callApi('recordTesOrtu', { token, idMaster, kualitas });
}
export async function kirimSemangat(token) {
  return callApi('kirimSemangat', { token });
}

// --- Dashboard Ustaz ---
export async function getUstazDashboard(token) {
  return callApi('getUstazDashboard', { token });
}
export async function inputSetoran(token, idSantri, surah, ayatMulai, ayatAkhir, nilai, catatan) {
  return callApi('inputSetoran', { token, idSantri, surah, ayatMulai, ayatAkhir, nilai, catatan });
}
export async function broadcastMotivasi(token, pesan) {
  return callApi('broadcastMotivasi', { token, pesan });
}
