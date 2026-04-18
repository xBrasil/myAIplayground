import { persistSetting } from './settingsApi';

const STORAGE_KEY = 'gemma-local-studio.voice';

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
  return window.localStorage.getItem(STORAGE_KEY) || '';
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
  if (voices.length === 0) return null;
  // Exact match by name
  const exact = voices.find((voice) => voice.name === preferredName);
  if (exact) return exact;
  // Fallback: detect browser language prefix, pick best from that language
  const langPrefix = navigator.language.split('-')[0].toLowerCase();
  const langVoices = voices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
  const pool = langVoices.length > 0 ? langVoices : voices;
  const natural = pool.filter((v) => v.name.includes('Online (Natural)'));
  const nonMulti = natural.find((v) => !v.name.includes('Multilingual'));
  return nonMulti ?? natural[0] ?? pool[0] ?? null;
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

/** Notify SpeakButton instances that auto-TTS started/stopped */
const AUTO_TTS_START = 'auto-tts-start';
const AUTO_TTS_STOP = 'auto-tts-stop';

export function onAutoTtsStart(cb: (text: string) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<string>).detail);
  window.addEventListener(AUTO_TTS_START, handler);
  return () => window.removeEventListener(AUTO_TTS_START, handler);
}

export function onAutoTtsStop(cb: () => void): () => void {
  window.addEventListener(AUTO_TTS_STOP, cb);
  return () => window.removeEventListener(AUTO_TTS_STOP, cb);
}

export async function autoSpeakText(text: string, preferredName: string): Promise<void> {
  window.speechSynthesis.cancel();
  const utterance = await createUtterance(text, preferredName);
  const done = () => window.dispatchEvent(new CustomEvent(AUTO_TTS_STOP));
  utterance.onend = done;
  utterance.onerror = done;
  window.dispatchEvent(new CustomEvent(AUTO_TTS_START, { detail: text }));
  window.speechSynthesis.speak(utterance);
}

/** Strip markdown syntax so TTS reads clean text */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
