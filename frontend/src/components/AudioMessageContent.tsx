import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';

interface AudioMessageContentProps {
  src: string;
  transcript: string;
}

export default function AudioMessageContent({ src, transcript }: AudioMessageContentProps) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const syncPlaying = () => setPlaying(!audio.paused);
    audio.addEventListener('play', syncPlaying);
    audio.addEventListener('pause', syncPlaying);
    audio.addEventListener('ended', syncPlaying);

    return () => {
      audio.pause();
      audio.removeEventListener('play', syncPlaying);
      audio.removeEventListener('pause', syncPlaying);
      audio.removeEventListener('ended', syncPlaying);
    };
  }, []);

  async function handleTogglePlayback() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (audio.paused) {
      await audio.play();
      return;
    }

    audio.pause();
    audio.currentTime = 0;
  }

  return (
    <div className="audio-message">
      <button
        type="button"
        className={`audio-message__play ${playing ? 'audio-message__play--active' : ''}`}
        onClick={() => void handleTogglePlayback()}
        aria-label={playing ? t('audio.stop') : t('audio.play')}
        title={playing ? t('audio.stop') : t('audio.play')}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 10v4h4l5 4V6L7 10H3zm13.5 2a3.5 3.5 0 0 0-2.1-3.22v6.44A3.5 3.5 0 0 0 16.5 12zm0-8.5v2.06A6.5 6.5 0 0 1 21 12a6.5 6.5 0 0 1-4.5 6.44v2.06A8.5 8.5 0 0 0 23 12a8.5 8.5 0 0 0-6.5-8.5z" />
          </svg>
        )}
      </button>
      <p>{transcript || t('messages.audioSentFallback')}</p>
      <audio ref={audioRef} preload="metadata" src={src} />
    </div>
  );
}