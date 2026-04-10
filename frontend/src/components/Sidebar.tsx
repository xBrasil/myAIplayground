import { APP_VERSION } from '../app-info';
import { useI18n } from '../lib/i18n';
import type { Conversation } from '../types';

interface SidebarProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (conversationId: string) => Promise<void>;
  onRenameConversation: (conversationId: string, newTitle: string) => Promise<void>;
  onOpenSettings: () => void;
  onOpenLegal: (document: 'terms' | 'privacy') => void;
}

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onRenameConversation,
  onOpenSettings,
  onOpenLegal,
}: SidebarProps) {
  const { t, locale } = useI18n();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <img src="/favicon-32x32.png" alt="" className="sidebar-brand__logo" width={32} height={32} />
          <div className="sidebar-brand__text">
            <strong>My AI Playground</strong>
            <a href="https://rmsaraiva.com/" target="_blank" rel="noopener noreferrer" className="sidebar-brand__author">RMSaraiva.com</a>
          </div>
        </div>
        <button
          type="button"
          className="sidebar-new-btn"
          onClick={() => void onNewConversation()}
          aria-label={t('sidebar.newConversation')}
          title={t('sidebar.newConversation')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      <div className="sidebar-list">
        {conversations.map((conversation) => {
          const isDraft = conversation.id === 'draft';
          const displayTitle = conversation.title || t('chat.newConversation');
          return (
          <div
            key={conversation.id}
            className={`sidebar-item ${conversation.id === currentConversationId ? 'active' : ''}`}
          >
            <button
              type="button"
              className="sidebar-item__select"
              onClick={() => onSelectConversation(conversation.id)}
            >
              <span className="sidebar-item__title">{displayTitle}</span>
              <span className="sidebar-item__date">
                {new Date(conversation.updated_at).toLocaleDateString(locale)}
              </span>
            </button>
            {!isDraft && (
            <>
            <button
              type="button"
              className="sidebar-item__rename"
              aria-label={t('sidebar.renameConversation', { title: displayTitle })}
              title={t('sidebar.rename')}
              onClick={(e) => {
                e.stopPropagation();
                const newTitle = window.prompt(t('sidebar.renamePrompt'), conversation.title);
                if (newTitle !== null && newTitle.trim()) {
                  void onRenameConversation(conversation.id, newTitle.trim());
                }
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              type="button"
              className="sidebar-item__delete"
              aria-label={t('sidebar.deleteConversation', { title: displayTitle })}
              title={t('sidebar.delete')}
              onClick={(e) => {
                e.stopPropagation();
                void onDeleteConversation(conversation.id);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </button>
            </>
            )}
          </div>
          );
        })}
      </div>

      <div className="sidebar-footer">
        <button type="button" onClick={() => onOpenLegal('terms')}>{t('sidebar.terms')}</button>
        <button type="button" onClick={() => onOpenLegal('privacy')}>{t('sidebar.privacy')}</button>
        <span className="sidebar-footer__version">v{APP_VERSION}</span>
      </div>
    </aside>
  );
}
