import { useState } from 'react';

import { useI18n } from '../lib/i18n';
import { createUtterance, stopSpeaking } from '../lib/speech';

interface SpeakButtonProps {
  text: string;
  preferredVoice: string;
}

/** Strip markdown syntax so TTS reads clean text */
function stripMarkdown(md: string): string {
  return md
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove inline code
    .replace(/`([^`]*)`/g, '$1')
    // Remove images
    .replace(/!\[.*?\]\(.*?\)/g, '')
    // Remove links, keep text
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
    // Remove bold/italic markers
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2')
    // Remove strikethrough
    .replace(/~~(.*?)~~/g, '$1')
    // Remove heading markers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove blockquote markers
    .replace(/^>\s+/gm, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Collapse multiple newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function SpeakButton({ text, preferredVoice }: SpeakButtonProps) {
  const { t } = useI18n();
  const [speaking, setSpeaking] = useState(false);

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
