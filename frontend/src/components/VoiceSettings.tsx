import { useEffect, useMemo, useState } from 'react';

import { useI18n } from '../lib/i18n';
import type { Locale } from '../lib/i18n';
import { listVoices, loadPreferredVoiceName, savePreferredVoiceName } from '../lib/speech';

interface VoiceSettingsProps {
  value: string;
  onChange: (voiceName: string) => void;
  locale: Locale;
}

/** Map app locale to BCP-47 language prefix for filtering voices. */
function localeLangPrefix(locale: Locale): string {
  if (locale.startsWith('pt')) return 'pt';
  if (locale.startsWith('es')) return 'es';
  if (locale.startsWith('fr')) return 'fr';
  return 'en';
}

/**
 * Pick the best default voice from a list, using this priority:
 * 1. First with "Online (Natural)" but NOT "Multilingual"
 * 2. First with "Online (Natural)" (even if Multilingual)
 * 3. First voice in the list
 */
function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const natural = voices.filter((v) => v.name.includes('Online (Natural)'));
  const nonMulti = natural.find((v) => !v.name.includes('Multilingual'));
  return nonMulti ?? natural[0] ?? voices[0];
}

export default function VoiceSettings({ value, onChange, locale }: VoiceSettingsProps) {
  const { t } = useI18n();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const updateVoices = () => setVoices(listVoices());
    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    const persisted = loadPreferredVoiceName();
    if (persisted && persisted !== value) {
      onChange(persisted);
    }
  }, [onChange, value]);

  const filteredVoices = useMemo(() => {
    const prefix = localeLangPrefix(locale);
    const filtered = voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
    if (filtered.length === 0) return voices;

    // Sort: exact locale match first (e.g. pt-BR before pt-PT when locale is pt-BR)
    const exactLocale = locale.toLowerCase();
    filtered.sort((a, b) => {
      const aExact = a.lang.toLowerCase().replace('_', '-') === exactLocale ? 0 : 1;
      const bExact = b.lang.toLowerCase().replace('_', '-') === exactLocale ? 0 : 1;
      return aExact - bExact;
    });

    return filtered;
  }, [voices, locale]);

  // If current voice isn't in filtered list, auto-select best match
  useEffect(() => {
    if (filteredVoices.length > 0 && !filteredVoices.some((v) => v.name === value)) {
      const best = pickBestVoice(filteredVoices);
      if (best) {
        savePreferredVoiceName(best.name);
        onChange(best.name);
      }
    }
  }, [filteredVoices, value, onChange]);

  return (
    <label className="voice-settings">
      <span>{t('settings.voiceLabel')}</span>
      <select
        value={value}
        onChange={(event) => {
          savePreferredVoiceName(event.target.value);
          onChange(event.target.value);
        }}
      >
        {filteredVoices.map((voice) => (
          <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
            {voice.name} ({voice.lang})
          </option>
        ))}
      </select>
    </label>
  );
}
