const ENTER_TO_SEND_KEY = 'gemma-local-studio.enter-to-send';
const LAST_MODEL_KEY = 'gemma-local-studio.last-model';
const CUSTOM_INSTRUCTIONS_KEY = 'gemma-local-studio.custom-instructions';

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