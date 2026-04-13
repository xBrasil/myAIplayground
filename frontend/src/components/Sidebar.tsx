import { useEffect, useRef, useState } from 'react';

import { APP_VERSION } from '../app-info';
import { useI18n } from '../lib/i18n';
import { searchConversations, type SearchResult } from '../lib/api';
import type { Conversation } from '../types';

interface SidebarProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  streamingConversationId: string | null;
  onSearchQueryChange: (query: string) => void;
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
  streamingConversationId,
  onSearchQueryChange,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onRenameConversation,
  onOpenSettings,
  onOpenLegal,
}: SidebarProps) {
  const { t, locale } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchInput.trim()) {
      setSearchResults([]);
      onSearchQueryChange('');
      return;
    }
    searchTimerRef.current = setTimeout(() => {
      onSearchQueryChange(searchInput.trim());
      void searchConversations(searchInput.trim()).then(setSearchResults);
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchInput]);

  function handleCloseSearch() {
    setSearchOpen(false);
    setSearchInput('');
    setSearchResults([]);
    onSearchQueryChange('');
  }

  const displayList = searchInput.trim() ? searchResults.map((r) => r.conversation) : conversations;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <img src="/android-chrome-192x192.png" alt="" className="sidebar-brand__logo" width={32} height={32} />
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

      {searchOpen && (
        <div className="sidebar-search">
          <input
            ref={searchInputRef}
            type="text"
            className="sidebar-search__input"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('sidebar.searchPlaceholder')}
            onKeyDown={(e) => { if (e.key === 'Escape') handleCloseSearch(); }}
          />
          <button type="button" className="sidebar-search__close" onClick={handleCloseSearch} aria-label={t('sidebar.closeSearch')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      )}

      <div className="sidebar-list">
        {displayList.map((conversation) => {
          const isDraft = conversation.id === 'draft';
          const isStreaming = conversation.id === streamingConversationId;
          const displayTitle = conversation.title || t('chat.newConversation');
          return (
          <div
            key={conversation.id}
            className={`sidebar-item ${conversation.id === currentConversationId ? 'active' : ''} ${isStreaming ? 'streaming' : ''}`}
          >
            <button
              type="button"
              className="sidebar-item__select"
              onClick={() => onSelectConversation(conversation.id)}
            >
              <span className="sidebar-item__title">
                {isStreaming && <span className="sidebar-item__streaming-dot" aria-label={t('sidebar.generating')} />}
                {displayTitle}
              </span>
              <span className="sidebar-item__date">
                {new Date(conversation.updated_at).toLocaleDateString(locale)}
              </span>
            </button>
            {!isDraft && !searchInput.trim() && (
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
        {searchInput.trim() && displayList.length === 0 && (
          <div className="sidebar-search__empty">{t('sidebar.searchNoResults')}</div>
        )}
      </div>

      <div className="sidebar-footer">
        <button type="button" onClick={() => onOpenLegal('terms')}>{t('sidebar.terms')}</button>
        <button type="button" onClick={() => onOpenLegal('privacy')}>{t('sidebar.privacy')}</button>
        <button
          type="button"
          className="sidebar-footer__search-btn"
          onClick={() => setSearchOpen(!searchOpen)}
          aria-label={t('sidebar.search')}
          title={t('sidebar.search')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <span className="sidebar-footer__version">v{APP_VERSION}</span>
      </div>
    </aside>
  );
}
