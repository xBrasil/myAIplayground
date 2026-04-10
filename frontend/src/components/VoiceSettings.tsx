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
  if (locale === 'pt-BR') return 'pt';
  return 'en';
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
    return filtered.length > 0 ? filtered : voices;
  }, [voices, locale]);

  // If current voice isn't in filtered list, auto-select first match
  useEffect(() => {
    if (filteredVoices.length > 0 && !filteredVoices.some((v) => v.name === value)) {
      const first = filteredVoices[0];
      savePreferredVoiceName(first.name);
      onChange(first.name);
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
