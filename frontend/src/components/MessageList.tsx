import { useEffect, useRef, useState } from 'react';

import { getUploadAssetUrl, openFile, revealFile } from '../lib/api';
import { useI18n } from '../lib/i18n';
import AudioMessageContent from './AudioMessageContent';
import MarkdownContent from './MarkdownContent';
import SpeakButton from './SpeakButton';
import type { Message, ModelKey } from '../types';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);

const MODEL_LABELS: Record<string, string> = {
  e2b: 'Gemma 4 E2B',
  e4b: 'Gemma 4 E4B',
  '26b': 'Gemma 4 26B',
};

function formatCompactDate(isoString: string, locale: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  if (sameYear) {
    return `${day}/${month} ${hours}:${minutes}`;
  }
  const year = String(date.getFullYear()).slice(-2);
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function isImageAttachment(name?: string | null): boolean {
  if (!name) return false;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
}

interface MessageListProps {
  messages: Message[];
  preferredVoice: string;
  streamingText?: string;
  onEditLastMessage?: (newText: string) => void;
  onRegenerate?: () => void;
}

export default function MessageList({
  messages,
  preferredVoice,
  streamingText = '',
  onEditLastMessage,
  onRegenerate,
}: MessageListProps) {
  const { t, locale } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const isStreamingRef = useRef(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileMenuId, setFileMenuId] = useState<string | null>(null);

  // Scroll to bottom on conversation change (smooth)
  useEffect(() => {
    const el = containerRef.current;
    if (el && !isStreamingRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  // Scroll to bottom on streaming deltas (instant)
  useEffect(() => {
    const el = containerRef.current;
    if (el && streamingText) {
      isStreamingRef.current = true;
      el.scrollTop = el.scrollHeight;
    } else {
      isStreamingRef.current = false;
    }
  }, [streamingText]);

  // Close file menu on outside click
  useEffect(() => {
    if (!fileMenuId) return;
    const handler = () => setFileMenuId(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [fileMenuId]);

  // Find last user and last assistant message indices
  const lastUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return i;
    }
    return -1;
  })();
  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  })();

  function handleAttachmentClick(message: Message) {
    if (isImageAttachment(message.attachment_name)) {
      const url = getUploadAssetUrl(message.attachment_path);
      if (url) setPreviewUrl(url);
    } else {
      setFileMenuId((prev) => (prev === message.id ? null : message.id));
    }
  }

  function handleOpenFile(path: string) {
    setFileMenuId(null);
    void openFile(path);
  }

  function handleRevealFile(path: string) {
    setFileMenuId(null);
    void revealFile(path);
  }

  function handleEditClick() {
    const lastUserMsg = lastUserIdx >= 0 ? messages[lastUserIdx] : null;
    if (!lastUserMsg || !onEditLastMessage) return;
    const newText = window.prompt(t('messages.editPrompt'), lastUserMsg.content);
    if (newText !== null && newText.trim()) {
      onEditLastMessage(newText.trim());
    }
  }

  function handleRegenerateClick() {
    if (!onRegenerate) return;
    const confirmed = window.confirm(t('messages.confirmRegenerate'));
    if (confirmed) onRegenerate();
  }

  if (!messages.length && !streamingText) {
    return (
      <div className="message-list" ref={containerRef}>
        <div className="empty-state">
          <svg className="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <h2>{t('messages.emptyTitle')}</h2>
          <p>{t('messages.emptyHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list" ref={containerRef}>
      {messages.map((message, idx) => {
        if (message.role === 'system') return null;
        const isUser = message.role === 'user';
        const isAudio = message.input_type === 'audio' && isUser;
        const isLastUser = idx === lastUserIdx;
        const isLastAssistant = idx === lastAssistantIdx && !streamingText;

        return (
          <div key={message.id} className={`message-row message-row--${message.role}`}>
            <div className={`message-bubble message-bubble--${message.role}`}>
              {isAudio ? (
                (() => {
                  const audioUrl = getUploadAssetUrl(message.attachment_path);
                  if (!audioUrl) return <p>{message.content || t('messages.audioSent')}</p>;
                  return <AudioMessageContent src={audioUrl} transcript={message.content} />;
                })()
              ) : isUser ? (
                <>
                  {message.attachment_name ? (
                    <div className="attachment-pill-wrapper">
                      <div
                        className="attachment-pill attachment-pill--clickable"
                        onClick={(e) => { e.stopPropagation(); handleAttachmentClick(message); }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAttachmentClick(message); }}
                      >
                        {message.attachment_name}
                      </div>
                      {fileMenuId === message.id && message.attachment_path ? (
                        <div className="file-action-menu" onClick={(e) => e.stopPropagation()}>
                          <button type="button" onClick={() => handleOpenFile(message.attachment_path!)}>
                            <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                            {t('messages.openFile')}
                          </button>
                          <button type="button" onClick={() => handleRevealFile(message.attachment_path!)}>
                            <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                            {t('messages.revealInExplorer')}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <p>{message.content}</p>
                </>
              ) : (
                <>
                  <MarkdownContent content={message.content} />
                  <div className="assistant-actions">
                    <SpeakButton text={message.content} preferredVoice={preferredVoice} />
                    {isLastAssistant && !streamingText && onRegenerate ? (
                      <button
                        type="button"
                        className="msg-action-btn"
                        title={t('messages.regenerate')}
                        aria-label={t('messages.regenerate')}
                        onClick={handleRegenerateClick}
                      >
                        <svg viewBox="0 0 24 24">
                          <polyline points="23 4 23 10 17 10" />
                          <polyline points="1 20 1 14 7 14" />
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
            <div className="message-time">
              <span>
                {formatCompactDate(message.created_at, locale)}
              </span>
              {message.model_key && (
                <span className="message-model">{MODEL_LABELS[message.model_key] || message.model_key}</span>
              )}
            </div>
            {isLastUser && !streamingText && onEditLastMessage ? (
              <button
                type="button"
                className="msg-action-btn msg-action-btn--inline msg-edit-btn"
                title={t('messages.editMessage')}
                aria-label={t('messages.editMessage')}
                onClick={handleEditClick}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            ) : null}
          </div>
        );
      })}

      {streamingText ? (
        <div className="message-row message-row--assistant">
          <div className="message-bubble message-bubble--streaming">
            <MarkdownContent content={streamingText} />
            <div className="typing-indicator">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      ) : null}

      {/* Image preview modal */}
      {previewUrl ? (
        <div
          className="image-preview-backdrop"
          onClick={() => setPreviewUrl(null)}
          role="presentation"
        >
          <div className="image-preview-container" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="image-preview-close"
              onClick={() => setPreviewUrl(null)}
              aria-label={t('close')}
            >
              <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
            <img
              src={previewUrl}
              alt={t('messages.preview')}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
