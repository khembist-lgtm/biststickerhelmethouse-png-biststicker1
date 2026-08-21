import { AppDataStore } from '../types';

type BackendResult = { success: boolean; error?: string };

const LOCAL_KEY = 'backend_store_v1';
const API_DATA_PATH = '/api/data';

export async function fetchStoreData(): Promise<AppDataStore> {
  // Try backend first
  try {
    const res = await fetch(API_DATA_PATH, { method: 'GET', headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = (await res.json()) as AppDataStore;
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); } catch {}
      return data;
    }
    console.warn(`fetchStoreData: server returned ${res.status}`);
  } catch (err) {
    console.warn('fetchStoreData: server fetch failed, falling back to local cache', err);
  }

  // Local fallback
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw) as AppDataStore;
  } catch (e) {
    console.warn('fetchStoreData: local cache read failed', e);
  }

  // As a final fallback, throw so caller handles initialization
  throw new Error('No store data available (server unreachable and no local cache).');
}

export async function saveStoreData(store: AppDataStore): Promise<boolean> {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
    return true;
  } catch (err) {
    console.error('saveStoreData: localStorage write failed', err);
    return false;
  }
}

export async function saveBackendStoreData(store: AppDataStore): Promise<BackendResult> {
  try {
    const res = await fetch(API_DATA_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(store),
    });
    if (res.ok) return { success: true };
    const body = await res.json().catch(() => ({}));
    const msg = body?.error || `Server responded ${res.status}`;
    console.error('saveBackendStoreData failed:', msg);
    return { success: false, error: msg };
  } catch (err: any) {
    console.error('saveBackendStoreData: network error', err);
    return { success: false, error: err?.message || String(err) };
  }
}

export function formatNPR(amount: number): string {
  try {
    return new Intl.NumberFormat('en-NP', { style: 'currency', currency: 'NPR', maximumFractionDigits: 0 }).format(Math.round(amount));
  } catch {
    return `NPR ${Math.round(amount).toLocaleString()}`;
  }
}
