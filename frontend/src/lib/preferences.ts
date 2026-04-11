const ENTER_TO_SEND_KEY = 'gemma-local-studio.enter-to-send';
const LAST_MODEL_KEY = 'gemma-local-studio.last-model';
const CUSTOM_INSTRUCTIONS_KEY = 'gemma-local-studio.custom-instructions';
const CUSTOM_INSTRUCTIONS_ENABLED_KEY = 'gemma-local-studio.custom-instructions-enabled';
const WEB_ACCESS_KEY = 'gemma-local-studio.web-access';
const LOCAL_FILES_KEY = 'gemma-local-studio.local-files';
const ALLOWED_FOLDERS_KEY = 'gemma-local-studio.allowed-folders';

export function loadEnterToSendPreference(): boolean {
  const stored = window.localStorage.getItem(ENTER_TO_SEND_KEY);
  if (stored === null) {
    return true;
  }
  return stored === 'true';
}

export function saveEnterToSendPreference(value: boolean): void {
  window.localStorage.setItem(ENTER_TO_SEND_KEY, String(value));
}

export function loadLastModelKey(): string | null {
  return window.localStorage.getItem(LAST_MODEL_KEY);
}

export function saveLastModelKey(modelKey: string): void {
  window.localStorage.setItem(LAST_MODEL_KEY, modelKey);
}

export function loadCustomInstructions(): string {
  return window.localStorage.getItem(CUSTOM_INSTRUCTIONS_KEY) || '';
}

export function saveCustomInstructions(value: string): void {
  window.localStorage.setItem(CUSTOM_INSTRUCTIONS_KEY, value);
}

export function loadCustomInstructionsEnabled(): boolean {
  return window.localStorage.getItem(CUSTOM_INSTRUCTIONS_ENABLED_KEY) === 'true';
}

export function saveCustomInstructionsEnabled(value: boolean): void {
  window.localStorage.setItem(CUSTOM_INSTRUCTIONS_ENABLED_KEY, String(value));
}

export function loadWebAccess(): boolean {
  return window.localStorage.getItem(WEB_ACCESS_KEY) === 'true';
}

export function saveWebAccess(value: boolean): void {
  window.localStorage.setItem(WEB_ACCESS_KEY, String(value));
}

export function loadLocalFiles(): boolean {
  return window.localStorage.getItem(LOCAL_FILES_KEY) === 'true';
}

export function saveLocalFiles(value: boolean): void {
  window.localStorage.setItem(LOCAL_FILES_KEY, String(value));
}

export function loadAllowedFolders(): string[] {
  const stored = window.localStorage.getItem(ALLOWED_FOLDERS_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAllowedFolders(folders: string[]): void {
  window.localStorage.setItem(ALLOWED_FOLDERS_KEY, JSON.stringify(folders));
}