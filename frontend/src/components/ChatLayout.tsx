import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { persistSetting } from '../lib/settingsApi';
import Composer from './Composer';
import MessageList from './MessageList';
import ServerStatusPanel from './ServerStatusPanel';
import Sidebar from './Sidebar';
import type { Conversation, HealthResponse, ToolCallInfo } from '../types';

interface ChatLayoutProps {
  busy: boolean;
  modelLoading: boolean;
  enterToSend: boolean;
  customInstructionsEnabled: boolean;
  webAccess: boolean;
  localFiles: boolean;
  locationSharing: boolean;
  conversations: Conversation[];
  currentConversation: Conversation | null;
  streamingText: string;
  streamingConversationId: string | null;
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
  onSendFiles: (text: string, files: File[]) => Promise<void>;
  onDropFiles?: (files: File[]) => void;
  onStop: () => void;
  onOpenModelSelector: () => void;
  onEditLastMessage?: (newText: string) => void;
  onRegenerate?: () => void;
  droppedFiles?: File[];
  onDroppedFilesConsumed?: () => void;
  restoreComposer?: { text: string; files: File[] } | null;
  onRestoreComposerConsumed?: () => void;
  activeToolCalls?: ToolCallInfo[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  followUps?: string[];
  onFollowUpClick?: (text: string) => void;
  systemMessage?: string | null;
}

export default function ChatLayout({
  busy,
  modelLoading,
  enterToSend,
  customInstructionsEnabled,
  webAccess,
  localFiles,
  locationSharing,
  conversations,
  currentConversation,
  streamingText,
  streamingConversationId,
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
  onSendFiles,
  onDropFiles,
  onStop,
  onOpenModelSelector,
  onEditLastMessage,
  onRegenerate,
  droppedFiles,
  onDroppedFilesConsumed,
  restoreComposer,
  onRestoreComposerConsumed,
  activeToolCalls,
  searchQuery,
  onSearchQueryChange,
  followUps,
  onFollowUpClick,
  systemMessage,
}: ChatLayoutProps) {
  const { t } = useI18n();
  const [isDragOver, setIsDragOver] = useState(false);
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && onDropFiles) {
      onDropFiles(files);
    }
  }, [onDropFiles]);

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
        const v = String(sidebarWidthRef.current);
        localStorage.setItem('sidebarWidth', v);
        persistSetting('sidebarWidth', v);
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
        streamingConversationId={streamingConversationId}
        onSearchQueryChange={onSearchQueryChange}
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
      <section
        className="chat-panel"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="drop-overlay">
            <div className="drop-overlay__content">
              <svg viewBox="0 0 24 24" aria-hidden="true" width="48" height="48">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>{t('composer.dropFilesHere')}</span>
            </div>
          </div>
        )}
        <header className="chat-header">
          <div className="chat-header__title">
            <span className="local-badge">{t('chat.localBadge')}</span>
            <h2>{currentConversation?.title || t('chat.newConversation')}</h2>
          </div>
          <div className="chat-header__controls">
            <button
              type="button"
              className="model-select-button model-select-button--compact"
              onClick={onOpenModelSelector}
              disabled={!health || health.model_status === 'loading'}
              aria-label={t('chat.selectModel')}
            >
              {health?.available_models?.find((m) => m.key === health.active_model_key)?.label || '...'}
            </button>
            <button
              type="button"
              className={`status-badge status-badge--${health?.model_status || 'idle'}`}
              onClick={() => setStatusPanelOpen(true)}
              title={t('serverPanel.title')}
            >
              <span className="status-badge__dot" />
              {statusLabel(health)}
            </button>
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
        <ServerStatusPanel open={statusPanelOpen} health={health} onClose={() => setStatusPanelOpen(false)} />
        <MessageList
          messages={currentConversation?.messages || []}
          preferredVoice={preferredVoice}
          streamingText={streamingText}
          customInstructionsEnabled={customInstructionsEnabled}
          onEditLastMessage={onEditLastMessage}
          onRegenerate={onRegenerate}
          activeToolCalls={activeToolCalls}
          searchQuery={searchQuery}
          tipContext={{
            webAccess,
            localFiles,
            locationSharing,
            customInstructionsEnabled,
            conversationCount: conversations.length,
            onOpenSettings,
          }}
        />
        {followUps && followUps.length > 0 && !busy && (
          <div className="follow-up-suggestions">
            {followUps.map((text) => (
              <button
                key={text}
                type="button"
                className="follow-up-chip"
                onClick={() => onFollowUpClick?.(text)}
              >
                {text}
              </button>
            ))}
          </div>
        )}
        {systemMessage && (
          <div className="system-message">{systemMessage}</div>
        )}
        <Composer
          busy={busy}
          modelLoading={modelLoading}
          enterToSend={enterToSend}
          activeModelKey={health?.active_model_key}
          conversationId={currentConversation?.id ?? null}
          onSendText={onSendText}
          onSendFile={onSendFile}
          onSendFiles={onSendFiles}
          onStop={onStop}
          droppedFiles={droppedFiles}
          onDroppedFilesConsumed={onDroppedFilesConsumed}
          restoreComposer={restoreComposer}
          onRestoreComposerConsumed={onRestoreComposerConsumed}
        />
      </section>
    </main>
  );
}
