const API_ORIGIN = 'http://127.0.0.1:8000';
const API_BASE = `${API_ORIGIN}/api`;

/** All known localStorage keys that should be server-persisted. */
const SETTING_KEYS = [
  'gemma-local-studio.enter-to-send',
  'gemma-local-studio.last-model',
  'gemma-local-studio.custom-instructions',
  'gemma-local-studio.custom-instructions-enabled',
  'gemma-local-studio.web-access',
  'gemma-local-studio.local-files',
  'gemma-local-studio.allowed-folders',
  'gemma-local-studio.location-sharing',
  'gemma-local-studio.voice',
  'locale',
  'sidebarWidth',
];

/**
 * Initialise settings from the backend (`data/settings.json`).
 *
 * Must be called **before** React renders so every `localStorage.getItem`
 * already returns the values that belong to this installation.
 *
 * localStorage is only a synchronous cache — the backend is the single
 * source of truth.  We clear all known keys first and then populate them
 * from the backend response so that stale values from another installation
 * sharing the same browser origin can never leak through.
 */
export async function initSettings(): Promise<void> {
  try {
    // Wipe any stale localStorage values before fetching from the backend.
    for (const key of SETTING_KEYS) {
      localStorage.removeItem(key);
    }

    const resp = await fetch(`${API_BASE}/settings`);
    if (!resp.ok) return;
    const remote: Record<string, string> = await resp.json();

    for (const [key, value] of Object.entries(remote)) {
      localStorage.setItem(key, value);
    }
  } catch {
    // Backend unreachable — defaults will be used (localStorage is clean)
  }
}

/** Persist a single key to the backend (fire-and-forget). */
export function persistSetting(key: string, value: string): void {
  fetch(`${API_BASE}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [key]: value }),
  }).catch(() => {});
}
