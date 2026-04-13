import { persistSetting } from './settingsApi';

const STORAGE_KEY = 'gemma-local-studio.voice';
const DEFAULT_VOICE = 'Microsoft Antonio';

let voicesReady = false;

function ensureVoicesLoaded(): Promise<void> {
  if (voicesReady && window.speechSynthesis.getVoices().length > 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      voicesReady = true;
      resolve();
      return;
    }
    const onReady = () => {
      voicesReady = true;
      window.speechSynthesis.removeEventListener('voiceschanged', onReady);
      resolve();
    };
    window.speechSynthesis.addEventListener('voiceschanged', onReady);
    // Timeout fallback so we never hang forever
    setTimeout(() => {
      voicesReady = true;
      resolve();
    }, 2000);
  });
}

export { ensureVoicesLoaded };

export function loadPreferredVoiceName(): string {
  return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_VOICE;
}

export function savePreferredVoiceName(name: string): void {
  window.localStorage.setItem(STORAGE_KEY, name);
  persistSetting(STORAGE_KEY, name);
}

export function listVoices(): SpeechSynthesisVoice[] {
  return window.speechSynthesis.getVoices();
}

export function findPreferredVoice(preferredName: string): SpeechSynthesisVoice | null {
  const voices = listVoices();
  return (
    voices.find((voice) => voice.name === preferredName) ||
    voices.find((voice) => voice.name.includes(DEFAULT_VOICE)) ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith('pt')) ||
    voices[0] ||
    null
  );
}

export function speakText(text: string, preferredName: string): void {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = findPreferredVoice(preferredName);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  window.speechSynthesis.speak(utterance);
}

export async function createUtterance(text: string, preferredName: string): Promise<SpeechSynthesisUtterance> {
  await ensureVoicesLoaded();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = findPreferredVoice(preferredName);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  return utterance;
}

export function stopSpeaking(): void {
  window.speechSynthesis.cancel();
}
