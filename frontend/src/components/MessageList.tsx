import { useEffect, useMemo, useRef, useState } from 'react';

import { getUploadAssetUrl, openFile, revealFile } from '../lib/api';
import { useI18n } from '../lib/i18n';
import AudioMessageContent from './AudioMessageContent';
import CustomInstructionsModal from './CustomInstructionsModal';
import MarkdownContent from './MarkdownContent';
import SpeakButton from './SpeakButton';
import type { Message, ModelKey, ToolCallInfo } from '../types';

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

interface TipContext {
  webAccess: boolean;
  localFiles: boolean;
  locationSharing: boolean;
  customInstructionsEnabled: boolean;
  autoReadResponse: boolean;
  conversationCount: number;
  onOpenSettings: () => void;
}

interface MessageListProps {
  messages: Message[];
  preferredVoice: string;
  streamingText?: string;
  customInstructionsEnabled?: boolean;
  onEditLastMessage?: (newText: string) => void;
  onRegenerate?: () => void;
  activeToolCalls?: ToolCallInfo[];
  searchQuery?: string;
  tipContext?: TipContext;
}

function renderToolCallLabel(tc: ToolCallInfo, t: (key: string) => string) {
  const args = (tc.arguments ?? {}) as Record<string, unknown>;
  switch (tc.name) {
    case 'fetch_url': {
      const url = typeof args.url === 'string' ? args.url : '';
      const safe = /^https?:\/\//i.test(url);
      return <>{t('chat.toolFetchingUrl')}: {safe ? <a href={url} target="_blank" rel="noopener noreferrer">{url}</a> : url}</>;
    }
    case 'read_file':
      return `${t('chat.toolReadingFile')}: ${typeof args.path === 'string' ? args.path : ''}`;
    case 'list_directory':
      return `${t('chat.toolListingDir')}: ${typeof args.path === 'string' ? args.path : ''}`;
    case 'web_search':
      return `${t('chat.toolSearchingWeb')}: ${typeof args.query === 'string' ? args.query : ''}`;
    case 'view_image':
      return `${t('chat.toolViewingImage')}: ${typeof args.path === 'string' ? args.path : ''}`;
    default:
      return tc.name;
  }
}

export default function MessageList({
  messages,
  preferredVoice,
  streamingText = '',
  customInstructionsEnabled = false,
  onEditLastMessage,
  onRegenerate,
  activeToolCalls = [],
  searchQuery = '',
  tipContext,
}: MessageListProps) {
  const { t, locale } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const isStreamingRef = useRef(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileMenuId, setFileMenuId] = useState<string | null>(null);
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set());
  const [ciModalOpen, setCiModalOpen] = useState(false);

  // Collect custom instruction snapshots from messages for the audit modal
  const ciSnapshots = useMemo(() => {
    const snapshots: { text: string; date: string }[] = [];
    for (const msg of messages) {
      if (msg.custom_instructions_snapshot) {
        snapshots.push({ text: msg.custom_instructions_snapshot, date: msg.created_at });
      }
    }
    return snapshots;
  }, [messages]);

  // Compute the set of message indices that need a CI banner rendered before them.
  // A banner appears before the first assistant message that has a given snapshot text,
  // but ONLY if the risk score is above 50.
  const ciBannerBeforeIdx = useMemo(() => {
    const indices = new Set<number>();
    let lastSeenSnapshot: string | null = null;
    for (let i = 0; i < messages.length; i++) {
      const snap = messages[i].custom_instructions_snapshot;
      const risk = messages[i].custom_instructions_risk_score;
      if (snap && snap !== lastSeenSnapshot) {
        lastSeenSnapshot = snap;
        if (risk != null && risk > 50) {
          indices.add(i);
        }
      }
    }
    return indices;
  }, [messages]);

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

  // Highlight search query matches in messages
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Remove existing marks
    container.querySelectorAll('mark.search-highlight').forEach((m) => {
      const parent = m.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(m.textContent || ''), m);
        parent.normalize();
      }
    });
    if (!searchQuery.trim()) return;
    const term = searchQuery.trim().toLowerCase();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const matches: { node: Text; start: number; length: number }[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent || '';
      let idx = text.toLowerCase().indexOf(term);
      while (idx !== -1) {
        matches.push({ node, start: idx, length: term.length });
        idx = text.toLowerCase().indexOf(term, idx + term.length);
      }
    }
    // Apply marks in reverse to preserve node offsets
    for (let i = matches.length - 1; i >= 0; i--) {
      const { node: textNode, start, length } = matches[i];
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + length);
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      range.surroundContents(mark);
    }
    // Scroll to first match
    const firstMark = container.querySelector('mark.search-highlight');
    if (firstMark) {
      firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [searchQuery, messages]);

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

  // --- Rotating tips ---
  const currentTip = useMemo(() => {
    type Tip = { key: string; actionable?: boolean; condition?: (ctx: TipContext) => boolean };
    const tips: Tip[] = [
      // Context-aware tips (shown only when their condition is met)
      { key: 'messages.tip.enableWeb', actionable: true, condition: (ctx) => !ctx.webAccess },
      { key: 'messages.tip.enableFiles', actionable: true, condition: (ctx) => !ctx.localFiles },
      { key: 'messages.tip.enableLocation', actionable: true, condition: (ctx) => !ctx.locationSharing },
      { key: 'messages.tip.enableInstructions', actionable: true, condition: (ctx) => !ctx.customInstructionsEnabled },
      { key: 'messages.tip.enableAutoRead', actionable: true, condition: (ctx) => !ctx.autoReadResponse },
      // Generic tips (always shown)
      { key: 'messages.localTip' },
      { key: 'messages.tip.tryModels' },
      { key: 'messages.tip.sendMedia' },
      { key: 'messages.tip.keyboard' },
      { key: 'messages.tip.deleteAll', actionable: true },
    ];

    const available = tipContext
      ? tips.filter((tip) => !tip.condition || tip.condition(tipContext))
      : tips.filter((tip) => !tip.condition);

    if (!available.length) return null;

    // Rotate based on conversation count (deterministic per session)
    const idx = (tipContext?.conversationCount ?? 0) % available.length;
    return available[idx];
  }, [tipContext]);

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
          {currentTip && (
            <div
              className={`empty-state__local-tip${currentTip.actionable ? ' empty-state__local-tip--actionable' : ''}`}
              onClick={currentTip.actionable && tipContext ? () => tipContext.onOpenSettings() : undefined}
              role={currentTip.actionable ? 'button' : undefined}
              tabIndex={currentTip.actionable ? 0 : undefined}
              onKeyDown={currentTip.actionable && tipContext ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tipContext.onOpenSettings(); } } : undefined}
            >
              <svg className="empty-state__tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18h6" />
                <path d="M10 22h4" />
                <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
              </svg>
              <span>{t(currentTip.key)}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="message-list" ref={containerRef}>
      {messages.map((message, idx) => {
        if (message.role === 'system') return null;
        const isUser = message.role === 'user';
        const isAudio = message.input_type === 'audio' && isUser;
        const isLastUser = idx === lastUserIdx;
        const isLastAssistant = idx === lastAssistantIdx && !streamingText;
        const showCiBannerHere = ciBannerBeforeIdx.has(idx);

        return (
          <div key={message.id}>
            {showCiBannerHere && (
              <div
                className="custom-instructions-banner"
                role="button"
                tabIndex={0}
                onClick={() => setCiModalOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setCiModalOpen(true);
                  } else if (e.key === ' ') {
                    e.preventDefault();
                    setCiModalOpen(true);
                  }
                }}
              >
                ⚠ {t('chat.customInstructionsDisclaimer')}
              </div>
            )}
            <div className={`message-row message-row--${message.role}`}>
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
                    message.input_type === 'multi_file' ? (
                      <div className="attachment-pill-wrapper">
                        {(() => {
                          try {
                            const names: string[] = JSON.parse(message.attachment_name);
                            let paths: string[] = [];
                            try {
                              paths = message.attachment_path ? JSON.parse(message.attachment_path) : [];
                            } catch { /* ignore */ }
                            return names.map((name, idx) => {
                              const filePath = paths[idx] || null;
                              const isImg = isImageAttachment(name);
                              return (
                                <div key={idx}>
                                  <div
                                    className={`attachment-pill${filePath ? ' attachment-pill--clickable' : ''}`}
                                    onClick={filePath ? (e) => {
                                      e.stopPropagation();
                                      if (isImg) {
                                        const url = getUploadAssetUrl(filePath);
                                        if (url) setPreviewUrl(url);
                                      } else {
                                        setFileMenuId((prev) => (prev === `${message.id}-${idx}` ? null : `${message.id}-${idx}`));
                                      }
                                    } : undefined}
                                    role={filePath ? 'button' : undefined}
                                    tabIndex={filePath ? 0 : undefined}
                                    onKeyDown={filePath ? (e) => {
                                      if (e.key === 'Enter') {
                                        if (isImg) {
                                          const url = getUploadAssetUrl(filePath);
                                          if (url) setPreviewUrl(url);
                                        } else {
                                          setFileMenuId((prev) => (prev === `${message.id}-${idx}` ? null : `${message.id}-${idx}`));
                                        }
                                      }
                                    } : undefined}
                                  >
                                    {name}
                                  </div>
                                  {fileMenuId === `${message.id}-${idx}` && filePath ? (
                                    <div className="file-action-menu" onClick={(e) => e.stopPropagation()}>
                                      <button type="button" onClick={() => handleOpenFile(filePath)}>
                                        <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                                        {t('messages.openFile')}
                                      </button>
                                      <button type="button" onClick={() => handleRevealFile(filePath)}>
                                        <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                                        {t('messages.revealInExplorer')}
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            });
                          } catch {
                            return <div className="attachment-pill">{message.attachment_name}</div>;
                          }
                        })()}
                      </div>
                    ) : (
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
                    )
                  ) : null}
                  <p>{message.content}</p>
                </>
              ) : (
                <>
                  {message.tool_calls && message.tool_calls.length > 0 ? (
                    <div className="tool-calls-persisted">
                      <button
                        type="button"
                        className="tool-calls-toggle"
                        onClick={() => setExpandedToolCalls((prev) => {
                          const next = new Set(prev);
                          if (next.has(message.id)) next.delete(message.id);
                          else next.add(message.id);
                          return next;
                        })}
                        aria-expanded={expandedToolCalls.has(message.id)}
                      >
                        <svg className={`tool-calls-chevron${expandedToolCalls.has(message.id) ? ' tool-calls-chevron--open' : ''}`} viewBox="0 0 24 24" width="14" height="14"><polyline points="9 18 15 12 9 6" /></svg>
                        <span>{t('chat.toolCallsUsed').replace('{n}', String(message.tool_calls.length))}</span>
                      </button>
                      {expandedToolCalls.has(message.id) ? (
                        <div className="tool-calls-section tool-calls-section--persisted">
                          {message.tool_calls.map((tc, i) => (
                            <div key={i} className="tool-call-item tool-call-item--done">
                              <span className="tool-call-icon">✓</span>
                              <span className="tool-call-label">{renderToolCallLabel(tc, t)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
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
          </div>
        );
      })}

      {streamingText || activeToolCalls.length > 0 ? (
        <div className="message-row message-row--assistant">
          <div className="message-bubble message-bubble--streaming">
            {activeToolCalls.length > 0 ? (
              <div className="tool-calls-section">
                {activeToolCalls.map((tc, i) => (
                  <div key={i} className={`tool-call-item${tc.done ? ' tool-call-item--done' : ''}`}>
                    <span className="tool-call-icon">{tc.done ? '✓' : ''}</span>
                    <span className="tool-call-label">{renderToolCallLabel(tc, t)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {streamingText ? (
              <>
                <MarkdownContent content={streamingText} />
                <div className="typing-indicator">
                  <span />
                  <span />
                  <span />
                </div>
              </>
            ) : (
              <div className="typing-indicator">
                <span />
                <span />
                <span />
              </div>
            )}
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
    <CustomInstructionsModal open={ciModalOpen} snapshots={ciSnapshots} onClose={() => setCiModalOpen(false)} />
    </>
  );
}
