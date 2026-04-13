import { persistSetting } from './settingsApi';

const ENTER_TO_SEND_KEY = 'gemma-local-studio.enter-to-send';
const LAST_MODEL_KEY = 'gemma-local-studio.last-model';
const CUSTOM_INSTRUCTIONS_KEY = 'gemma-local-studio.custom-instructions';
const CUSTOM_INSTRUCTIONS_ENABLED_KEY = 'gemma-local-studio.custom-instructions-enabled';
const WEB_ACCESS_KEY = 'gemma-local-studio.web-access';
const LOCAL_FILES_KEY = 'gemma-local-studio.local-files';
const ALLOWED_FOLDERS_KEY = 'gemma-local-studio.allowed-folders';
const LOCATION_SHARING_KEY = 'gemma-local-studio.location-sharing';

export function loadEnterToSendPreference(): boolean {
  const stored = window.localStorage.getItem(ENTER_TO_SEND_KEY);
  if (stored === null) {
    return true;
  }
  return stored === 'true';
}

export function saveEnterToSendPreference(value: boolean): void {
  const v = String(value);
  window.localStorage.setItem(ENTER_TO_SEND_KEY, v);
  persistSetting(ENTER_TO_SEND_KEY, v);
}

export function loadLastModelKey(): string | null {
  return window.localStorage.getItem(LAST_MODEL_KEY);
}

export function saveLastModelKey(modelKey: string): void {
  window.localStorage.setItem(LAST_MODEL_KEY, modelKey);
  persistSetting(LAST_MODEL_KEY, modelKey);
}

export function loadCustomInstructions(): string {
  return window.localStorage.getItem(CUSTOM_INSTRUCTIONS_KEY) || '';
}

export function saveCustomInstructions(value: string): void {
  window.localStorage.setItem(CUSTOM_INSTRUCTIONS_KEY, value);
  persistSetting(CUSTOM_INSTRUCTIONS_KEY, value);
}

export function loadCustomInstructionsEnabled(): boolean {
  return window.localStorage.getItem(CUSTOM_INSTRUCTIONS_ENABLED_KEY) === 'true';
}

export function saveCustomInstructionsEnabled(value: boolean): void {
  const v = String(value);
  window.localStorage.setItem(CUSTOM_INSTRUCTIONS_ENABLED_KEY, v);
  persistSetting(CUSTOM_INSTRUCTIONS_ENABLED_KEY, v);
}

export function loadWebAccess(): boolean {
  return window.localStorage.getItem(WEB_ACCESS_KEY) === 'true';
}

export function saveWebAccess(value: boolean): void {
  const v = String(value);
  window.localStorage.setItem(WEB_ACCESS_KEY, v);
  persistSetting(WEB_ACCESS_KEY, v);
}

export function loadLocalFiles(): boolean {
  return window.localStorage.getItem(LOCAL_FILES_KEY) === 'true';
}

export function saveLocalFiles(value: boolean): void {
  const v = String(value);
  window.localStorage.setItem(LOCAL_FILES_KEY, v);
  persistSetting(LOCAL_FILES_KEY, v);
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
  const v = JSON.stringify(folders);
  window.localStorage.setItem(ALLOWED_FOLDERS_KEY, v);
  persistSetting(ALLOWED_FOLDERS_KEY, v);
}

export function loadLocationSharing(): boolean {
  return window.localStorage.getItem(LOCATION_SHARING_KEY) === 'true';
}

export function saveLocationSharing(value: boolean): void {
  const v = String(value);
  window.localStorage.setItem(LOCATION_SHARING_KEY, v);
  persistSetting(LOCATION_SHARING_KEY, v);
}