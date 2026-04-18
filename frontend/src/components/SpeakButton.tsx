import { useEffect, useState } from 'react';

import { useI18n } from '../lib/i18n';
import { createUtterance, onAutoTtsStart, onAutoTtsStop, stopSpeaking, stripMarkdown } from '../lib/speech';

interface SpeakButtonProps {
  text: string;
  preferredVoice: string;
}

export default function SpeakButton({ text, preferredVoice }: SpeakButtonProps) {
  const { t } = useI18n();
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const offStart = onAutoTtsStart((spokenText) => {
      if (spokenText === stripMarkdown(text)) setSpeaking(true);
    });
    const offStop = onAutoTtsStop(() => setSpeaking(false));
    return () => { offStart(); offStop(); };
  }, [text]);

  async function handleClick() {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const cleanText = stripMarkdown(text);
    const utterance = await createUtterance(cleanText, preferredVoice);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
    // Return focus to the composer textarea so the user can keep typing
    const textarea = document.querySelector<HTMLTextAreaElement>('.composer-inner textarea');
    textarea?.focus();
  }

  return (
    <button
      className={`speak-icon-btn${speaking ? ' speak-icon-btn--active' : ''}`}
      type="button"
      onClick={() => void handleClick()}
      aria-label={speaking ? t('speak.stop') : t('speak.listen')}
      title={speaking ? t('speak.stop') : t('speak.listen')}
    >
      {speaking ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="2" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      )}
    </button>
  );
}
