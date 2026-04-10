import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import Composer from './Composer';
import MessageList from './MessageList';
import Sidebar from './Sidebar';
import type { Conversation, HealthResponse, ModelKey } from '../types';

interface ChatLayoutProps {
  busy: boolean;
  enterToSend: boolean;
  conversations: Conversation[];
  currentConversation: Conversation | null;
  streamingText: string;
  preferredVoice: string;
  health: HealthResponse | null;
  error: string | null;
  onNewConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => Promise<void>;
  onRenameConversation: (conversationId: string, newTitle: string) => Promise<void>;
  onOpenSettings: () => void;
  onOpenApi: () => void;
  onOpenLegal: (document: 'terms' | 'privacy') => void;
  onSendText: (text: string) => Promise<void>;
  onSendFile: (text: string, file: File) => Promise<void>;
  onStop: () => void;
  onSelectModel: (modelKey: ModelKey) => Promise<void>;
  onEditLastMessage?: (newText: string) => void;
  onRegenerate?: () => void;
}

export default function ChatLayout({
  busy,
  enterToSend,
  conversations,
  currentConversation,
  streamingText,
  preferredVoice,
  health,
  error,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  onOpenSettings,
  onOpenApi,
  onOpenLegal,
  onSendText,
  onSendFile,
  onStop,
  onSelectModel,
  onEditLastMessage,
  onRegenerate,
}: ChatLayoutProps) {
  const { t } = useI18n();

  function statusLabel(health: HealthResponse | null): string {
    if (!health) return t('status.connecting');
    if (health.model_status === 'loading') return t('status.loading');
    if (health.model_status === 'loaded') return t('status.ready');
    if (health.model_status === 'error') return t('status.error');
    return t('status.idle');
  }

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebarWidth');
    return saved ? Number(saved) : 280;
  });
  const isResizing = useRef(false);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    e.preventDefault();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(500, Math.max(180, e.clientX));
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => {
      if (isResizing.current) {
        localStorage.setItem('sidebarWidth', String(sidebarWidthRef.current));
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      isResizing.current = false;
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <main
      className="app-shell"
      style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
    >
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversation?.id || null}
        onSelectConversation={onSelectConversation}
        onNewConversation={onNewConversation}
        onDeleteConversation={onDeleteConversation}
        onRenameConversation={onRenameConversation}
        onOpenSettings={onOpenSettings}
        onOpenLegal={onOpenLegal}
      />
      <div
        className="resize-handle"
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
      />
      <section className="chat-panel">
        <header className="chat-header">
          <div className="chat-header__title">
            <span className="local-badge">{t('chat.localBadge')}</span>
            <h2>{currentConversation?.title || t('chat.newConversation')}</h2>
          </div>
          <div className="chat-header__controls">
            <div className="model-select">
              <select
                value={health?.active_model_key || 'e4b'}
                onChange={(e) => void onSelectModel(e.target.value as ModelKey)}
                disabled={!health || health.model_status === 'loading'}
                aria-label={t('chat.selectModel')}
              >
                {(health?.available_models || []).map((model) => (
                  <option key={model.key} value={model.key}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>
            <span className={`status-badge status-badge--${health?.model_status || 'idle'}`}>
              <span className="status-badge__dot" />
              {statusLabel(health)}
            </span>
            <button
              type="button"
              className="header-api-btn"
              onClick={onOpenApi}
              aria-label={t('api.buttonLabel')}
              title={t('api.buttonLabel')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 17l6-6-6-6" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </button>
            <button
              type="button"
              className="header-settings-btn"
              onClick={onOpenSettings}
              aria-label={t('settings')}
              title={t('settings')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </header>
        {error ? <div className="error-banner">{error}</div> : null}
        <MessageList
          messages={currentConversation?.messages || []}
          preferredVoice={preferredVoice}
          streamingText={streamingText}
          onEditLastMessage={onEditLastMessage}
          onRegenerate={onRegenerate}
        />
        <Composer
          busy={busy}
          enterToSend={enterToSend}
          activeModelKey={health?.active_model_key}
          onSendText={onSendText}
          onSendFile={onSendFile}
          onStop={onStop}
        />
      </section>
    </main>
  );
}
