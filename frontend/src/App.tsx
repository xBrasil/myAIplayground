import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import ApiAccessPanel from './components/ApiAccessPanel';
import ChatLayout from './components/ChatLayout';
import LegalGate from './components/LegalGate';
import LegalModal from './components/LegalModal';
import ModelSelectorModal from './components/ModelSelectorModal';
import SettingsPanel from './components/SettingsPanel';
import { useI18n } from './lib/i18n';
import { isDevMode } from './lib/devMode';
import { AutoplayEngine } from './lib/autoplay';
import type { ToolCallInfo } from './types';
import {
  acceptLegal,
  deleteAllConversations,
  deleteConversation,
  fetchConversations,
  fetchHealth,
  fetchLegalAcceptance,
  renameConversation,
  savePartial,
  selectModel,
  streamEditLastMessage,
  streamRegenerate,
  streamTextMessage,
  streamUploadMessage,
  streamMultiUploadMessage,
} from './lib/api';
import { loadEnterToSendPreference, loadLastModelKey, loadCustomInstructions, loadCustomInstructionsEnabled, loadWebAccess, loadLocalFiles, loadAllowedFolders, loadLocationSharing, saveEnterToSendPreference, saveLastModelKey, saveCustomInstructions, saveCustomInstructionsEnabled, saveWebAccess, saveLocalFiles, saveAllowedFolders, saveLocationSharing } from './lib/preferences';
import { loadPreferredVoiceName, stopSpeaking } from './lib/speech';
import type { ChatStreamEvent, Conversation, HealthResponse, InputType, Message, ModelKey } from './types';

const DRAFT_ID = 'draft';

function isDraft(id: string | null): boolean {
  return id === DRAFT_ID;
}

function makeDraftConversation(): Conversation {
  const now = new Date().toISOString();
  return { id: DRAFT_ID, title: '', created_at: now, updated_at: now, messages: [] };
}

/** Create a temporary user message for optimistic UI display. */
function makeOptimisticMessage(content: string, inputType: InputType = 'text'): Message {
  return {
    id: `optimistic-${Date.now()}`,
    role: 'user',
    content,
    input_type: inputType,
    created_at: new Date().toISOString(),
  };
}

async function computeTermsHash(terms: string[], privacy: string[]): Promise<string> {
  const text = JSON.stringify({ terms, privacy });
  const encoded = new TextEncoder().encode(text);
  const buffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function App() {
  const { t, locale, tList } = useI18n();
  const [legalAccepted, setLegalAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    document.title = 'My AI Playground - RMSaraiva.com';
  }, []);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const wasConnectedRef = useRef(false);
  const [streamingText, setStreamingText] = useState('');
  const [preferredVoice, setPreferredVoice] = useState(loadPreferredVoiceName());
  const [enterToSend, setEnterToSend] = useState(loadEnterToSendPreference());
  const [customInstructions, setCustomInstructions] = useState(loadCustomInstructions());
  const [customInstructionsEnabled, setCustomInstructionsEnabled] = useState(loadCustomInstructionsEnabled());
  const [webAccess, setWebAccess] = useState(loadWebAccess());
  const [localFiles, setLocalFiles] = useState(loadLocalFiles());
  const [allowedFolders, setAllowedFolders] = useState(loadAllowedFolders());
  const [locationSharing, setLocationSharing] = useState(loadLocationSharing());
  const [userLocation, setUserLocation] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [apiPanelOpen, setApiPanelOpen] = useState(false);
  const [legalDocument, setLegalDocument] = useState<'terms' | 'privacy' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [restoreComposer, setRestoreComposer] = useState<{ text: string; files: File[] } | null>(null);
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallInfo[]>([]);
  const [streamingConversationId, setStreamingConversationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [systemMessage, setSystemMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingTextRef = useRef('');
  const activeConversationIdRef = useRef<string | null>(null);
  /** Set to true when the user manually navigates away from a streaming conversation. */
  const userNavigatedAwayRef = useRef(false);
  const autoplayRef = useRef<AutoplayEngine | null>(null);

  // Fetch geolocation when location sharing is enabled
  useEffect(() => {
    if (!locationSharing) {
      setUserLocation(null);
      return;
    }
    if (!navigator.geolocation) {
      setUserLocation(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // 1 decimal â‰ˆ 11 km â€” matches the "city-level" promise in the settings copy.
        setUserLocation(`${position.coords.latitude.toFixed(1)},${position.coords.longitude.toFixed(1)}`);
      },
      () => {
        setUserLocation(null);
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }, [locationSharing]);

  async function refreshHealth() {
    try {
      const nextHealth = await fetchHealth();
      wasConnectedRef.current = true;
      setHealth(nextHealth);
      return nextHealth;
    } catch {
      // Mark as disconnected only if we were previously connected
      if (wasConnectedRef.current) {
        setHealth(null);
      }
      return null;
    }
  }

  function upsertConversation(nextConversation: Conversation) {
    setConversations((current) => {
      // Also remove the optimistic draft â€” the real conversation replaces it.
      const remaining = current.filter((c) => c.id !== nextConversation.id && c.id !== DRAFT_ID);
      return [nextConversation, ...remaining];
    });
  }

  async function reloadConversations() {
    const items = await fetchConversations();
    setConversations((prev) => {
      // Preserve a draft if it exists
      const draft = prev.find((c) => c.id === DRAFT_ID);
      return draft ? [draft, ...items] : items;
    });
    if (isDraft(currentConversationId)) return;
    if (items.some((conversation) => conversation.id === currentConversationId)) {
      return;
    }
    if (items[0]) {
      setCurrentConversationId(items[0].id);
      return;
    }
    setCurrentConversationId(null);
  }

  useEffect(() => {
    void refreshHealth()
      .then((h) => {
        const stored = loadLastModelKey();
        if (stored && h && stored !== h.active_model_key) {
          return selectModel(stored as ModelKey)
            .then(() => refreshHealth())
            .catch(() => null);
        }
      })
      .catch(() => null);
    void reloadConversations().catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    // Fast polling (2s) while the model is loading; slower (10s) otherwise
    // to detect disconnections promptly.
    const interval = health?.model_status === 'loading' ? 2000 : 10000;
    const intervalId = window.setInterval(() => {
      void refreshHealth();
    }, interval);
    return () => window.clearInterval(intervalId);
  }, [health?.model_status]);

  // Clear error banner when switching conversations
  useEffect(() => {
    setError(null);
  }, [currentConversationId]);

  useEffect(() => {
    async function checkLegalAcceptance() {
      const terms = tList('legal.terms');
      const privacy = tList('legal.privacy');
      const hash = await computeTermsHash(terms, privacy);
      const stored = await fetchLegalAcceptance();
      setLegalAccepted(stored.accepted && stored.locale === locale && stored.terms_hash === hash);
    }
    void checkLegalAcceptance();
  }, [locale, tList]);

  async function handleAcceptLegal() {
    const terms = tList('legal.terms');
    const privacy = tList('legal.privacy');
    const hash = await computeTermsHash(terms, privacy);
    await acceptLegal(locale, hash);
    setLegalAccepted(true);
  }

  const currentConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === currentConversationId) || null,
    [conversations, currentConversationId],
  );

  // -- Dev-mode: autoplay engine --
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const currentConversationIdRef = useRef(currentConversationId);
  currentConversationIdRef.current = currentConversationId;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const preferredVoiceRef = useRef(preferredVoice);
  preferredVoiceRef.current = preferredVoice;
  const localeRef = useRef(locale);
  localeRef.current = locale;

  /** Stable ref to the raw sendText so autoplay can call it without re-creating the engine. */
  const sendTextRef = useRef<(text: string) => Promise<void>>(async () => {});

  const getAutoplay = useCallback(() => {
    if (!autoplayRef.current) {
      autoplayRef.current = new AutoplayEngine({
        getConversation: () => {
          const id = currentConversationIdRef.current;
          return conversationsRef.current.find((c) => c.id === id) ?? null;
        },
        isBusy: () => busyRef.current,
        sendText: (text: string) => sendTextRef.current(text),
        showSystemMessage: (msg: string) => setSystemMessage(msg),
        getPreferredVoice: () => preferredVoiceRef.current,
        getLocale: () => localeRef.current,
      });
    }
    return autoplayRef.current;
  }, []);

  /** Handle dev-mode /commands. Returns true if the text was consumed as a command. */
  function handleDevCommand(text: string): boolean {
    if (!isDevMode()) return false;
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) return false;
    const cmd = trimmed.split(/\s+/)[0].toLowerCase();
    switch (cmd) {
      case '/autoplay': {
        getAutoplay().start();
        return true;
      }
      case '/stop': {
        getAutoplay().stop();
        stopSpeaking();
        handleStop();
        setSystemMessage(null);
        return true;
      }
      default:
        setSystemMessage(`Unknown command: ${cmd}`);
        return true;
    }
  }

  function handleNewConversation() {
    // If we're already viewing an empty draft, don't create another
    if (isDraft(currentConversationId)) return;
    const draft = makeDraftConversation();
    setConversations((current) => {
      const withoutDraft = current.filter((c) => c.id !== DRAFT_ID);
      return [draft, ...withoutDraft];
    });
    setCurrentConversationId(DRAFT_ID);
  }

  function handleSelectConversation(conversationId: string) {
    // If the user is switching away from a streaming conversation, mark it
    if (streamingConversationId && conversationId !== streamingConversationId) {
      userNavigatedAwayRef.current = true;
    }
    setCurrentConversationId(conversationId);
  }

  async function handleDeleteConversation(conversationId: string) {
    // Draft: just discard locally
    if (isDraft(conversationId)) {
      setConversations((prev) => prev.filter((c) => c.id !== DRAFT_ID));
      if (currentConversationId === DRAFT_ID) setCurrentConversationId(null);
      return;
    }

    const conversation = conversations.find((item) => item.id === conversationId);
    const confirmed = window.confirm(
      t('confirm.deleteConversation', {
        titlePart: conversation ? t('confirm.titlePart', { title: conversation.title }) : '',
      }),
    );
    if (!confirmed) {
      return;
    }

    try {
      setError(null);
      await deleteConversation(conversationId);
      if (conversationId === currentConversationId) {
        setCurrentConversationId(null);
      }
      await reloadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.deleteConversation'));
    }
  }

  async function handleRenameConversation(conversationId: string, newTitle: string) {
    try {
      setError(null);
      const updated = await renameConversation(conversationId, newTitle);
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? { ...c, title: updated.title } : c)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.renameConversation'));
    }
  }

  async function handleDeleteAllConversations() {
    try {
      setBusy(true);
      setError(null);
      await deleteAllConversations('APAGAR TUDO');
      setCurrentConversationId(null);
      await reloadConversations();
      setSettingsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.deleteAll'));
    } finally {
      setBusy(false);
    }
  }

  /** Remove any optimistic messages (not yet persisted) from a conversation. */
  function removeOptimisticMessages(convId: string | null) {
    if (!convId) return;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? { ...c, messages: c.messages.filter((m) => !m.id.startsWith('optimistic-')) }
          : c,
      ),
    );
  }

  async function handleSendText(text: string) {
    // Don't abort the previous stream â€“ let it finish in the background so its
    // conversation keeps its response.  We just take over the shared UI state.
    const controller = new AbortController();
    abortControllerRef.current = controller;
    userNavigatedAwayRef.current = false;
    const effectiveId = isDraft(currentConversationId) ? null : currentConversationId;
    let handlerConvId: string | null = effectiveId;
    activeConversationIdRef.current = effectiveId;
    setStreamingConversationId(currentConversationId);
    // Show user message immediately (optimistic update)
    const optimistic = makeOptimisticMessage(text);
    if (isDraft(currentConversationId)) {
      setConversations((prev) =>
        prev.map((c) => c.id === DRAFT_ID ? { ...c, messages: [optimistic] } : c),
      );
    } else if (currentConversationId) {
      setConversations((prev) =>
        prev.map((c) => c.id === currentConversationId ? { ...c, messages: [...c.messages, optimistic] } : c),
      );
    }
    try {
      setBusy(true);
      setStreamingText('');
      streamingTextRef.current = '';
      setActiveToolCalls([]);
      setError(null);
      await streamTextMessage(effectiveId, text, (event: ChatStreamEvent) => {
        const isOwner = abortControllerRef.current === controller;
        if (event.type === 'tool_start') {
          if (isOwner) setActiveToolCalls((prev) => [...prev, { name: event.name, arguments: event.arguments, done: false }]);
          return;
        }
        if (event.type === 'tool_done') {
          if (isOwner) setActiveToolCalls((prev) => prev.map((tc) =>
            tc.name === event.name && !tc.done ? { ...tc, done: true } : tc,
          ));
          return;
        }
        if (event.type === 'conversation') {
          upsertConversation(event.conversation);
          handlerConvId = event.conversation.id;
          if (isOwner) {
            if (!userNavigatedAwayRef.current) {
              setCurrentConversationId(event.conversation.id);
            }
            activeConversationIdRef.current = event.conversation.id;
            setStreamingConversationId(event.conversation.id);
          }
          return;
        }

        if (event.type === 'delta') {
          if (isOwner) {
            streamingTextRef.current += event.delta;
            setStreamingText((current) => current + event.delta);
          }
          return;
        }

        upsertConversation(event.conversation);
        if (isOwner) {
          if (!userNavigatedAwayRef.current) {
            setCurrentConversationId(event.conversation.id);
          }
          setActiveToolCalls([]);
          setStreamingText('');
          streamingTextRef.current = '';
        }
      }, controller.signal, locale, effectiveCustomInstructions, webAccess, localFiles, allowedFolders, userLocation);
      await refreshHealth().catch(() => null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (abortControllerRef.current === controller) {
          const partial = streamingTextRef.current.trim();
          setStreamingText('');
          streamingTextRef.current = '';
          if (partial && handlerConvId) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === handlerConvId
                  ? { ...c, messages: [...c.messages, { id: `partial-${Date.now()}`, role: 'assistant' as const, content: partial, input_type: 'text' as const, created_at: new Date().toISOString() }] }
                  : c,
              ),
            );
            await savePartial(handlerConvId, partial).catch(() => null);
          }
        }
      } else if (abortControllerRef.current === controller) {
        removeOptimisticMessages(handlerConvId ?? currentConversationId);
        setError(err instanceof Error ? err.message : t('error.sendMessage'));
        setRestoreComposer({ text, files: [] });
        setStreamingText('');
        streamingTextRef.current = '';
      } else {
        removeOptimisticMessages(handlerConvId);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setStreamingConversationId(null);
        setBusy(false);
      }
    }
  }

  // Keep ref in sync so autoplay can call the raw send function
  sendTextRef.current = handleSendText;

  /** Wrapper that intercepts /commands in dev mode, otherwise sends normally. */
  async function handleSendTextOrCommand(text: string) {
    setSystemMessage(null);
    if (handleDevCommand(text)) return;
    return handleSendText(text);
  }

  async function handleSendFile(text: string, file: File) {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    userNavigatedAwayRef.current = false;
    const effectiveId = isDraft(currentConversationId) ? null : currentConversationId;
    let handlerConvId: string | null = effectiveId;
    activeConversationIdRef.current = effectiveId;
    setStreamingConversationId(currentConversationId);
    // Show user message immediately (optimistic update)
    const optimistic = makeOptimisticMessage(text || file.name, 'file');
    if (isDraft(currentConversationId)) {
      setConversations((prev) =>
        prev.map((c) => c.id === DRAFT_ID ? { ...c, messages: [optimistic] } : c),
      );
    } else if (currentConversationId) {
      setConversations((prev) =>
        prev.map((c) => c.id === currentConversationId ? { ...c, messages: [...c.messages, optimistic] } : c),
      );
    }
    try {
      setBusy(true);
      setStreamingText('');
      streamingTextRef.current = '';
      setActiveToolCalls([]);
      setError(null);
      await streamUploadMessage(effectiveId, text, file, (event: ChatStreamEvent) => {
        const isOwner = abortControllerRef.current === controller;
        if (event.type === 'tool_start') {
          if (isOwner) setActiveToolCalls((prev) => [...prev, { name: event.name, arguments: event.arguments, done: false }]);
          return;
        }
        if (event.type === 'tool_done') {
          if (isOwner) setActiveToolCalls((prev) => prev.map((tc) =>
            tc.name === event.name && !tc.done ? { ...tc, done: true } : tc,
          ));
          return;
        }
        if (event.type === 'conversation') {
          upsertConversation(event.conversation);
          handlerConvId = event.conversation.id;
          if (isOwner) {
            if (!userNavigatedAwayRef.current) {
              setCurrentConversationId(event.conversation.id);
            }
            activeConversationIdRef.current = event.conversation.id;
            setStreamingConversationId(event.conversation.id);
          }
          return;
        }

        if (event.type === 'delta') {
          if (isOwner) {
            streamingTextRef.current += event.delta;
            setStreamingText((current) => current + event.delta);
          }
          return;
        }

        upsertConversation(event.conversation);
        if (isOwner) {
          if (!userNavigatedAwayRef.current) {
            setCurrentConversationId(event.conversation.id);
          }
          setActiveToolCalls([]);
          setStreamingText('');
          streamingTextRef.current = '';
        }
      }, controller.signal, locale, effectiveCustomInstructions, webAccess, localFiles, allowedFolders, userLocation);
      await refreshHealth().catch(() => null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (abortControllerRef.current === controller) {
          const partial = streamingTextRef.current.trim();
          setStreamingText('');
          streamingTextRef.current = '';
          if (partial && handlerConvId) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === handlerConvId
                  ? { ...c, messages: [...c.messages, { id: `partial-${Date.now()}`, role: 'assistant' as const, content: partial, input_type: 'text' as const, created_at: new Date().toISOString() }] }
                  : c,
              ),
            );
            await savePartial(handlerConvId, partial).catch(() => null);
          }
        }
      } else if (abortControllerRef.current === controller) {
        removeOptimisticMessages(handlerConvId ?? currentConversationId);
        setError(err instanceof Error ? err.message : t('error.sendFile'));
        setRestoreComposer({ text, files: [file] });
        setStreamingText('');
        streamingTextRef.current = '';
      } else {
        removeOptimisticMessages(handlerConvId);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setStreamingConversationId(null);
        setBusy(false);
      }
    }
  }

  async function handleSendFiles(text: string, files: File[]) {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    userNavigatedAwayRef.current = false;
    const effectiveId = isDraft(currentConversationId) ? null : currentConversationId;
    let handlerConvId: string | null = effectiveId;
    activeConversationIdRef.current = effectiveId;
    setStreamingConversationId(currentConversationId);
    // Show user message immediately (optimistic update)
    const label = text || files.map((f) => f.name).join(', ');
    const optimistic = makeOptimisticMessage(label, 'multi_file');
    if (isDraft(currentConversationId)) {
      setConversations((prev) =>
        prev.map((c) => c.id === DRAFT_ID ? { ...c, messages: [optimistic] } : c),
      );
    } else if (currentConversationId) {
      setConversations((prev) =>
        prev.map((c) => c.id === currentConversationId ? { ...c, messages: [...c.messages, optimistic] } : c),
      );
    }
    try {
      setBusy(true);
      setStreamingText('');
      streamingTextRef.current = '';
      setActiveToolCalls([]);
      setError(null);
      await streamMultiUploadMessage(effectiveId, text, files, (event: ChatStreamEvent) => {
        const isOwner = abortControllerRef.current === controller;
        if (event.type === 'tool_start') {
          if (isOwner) setActiveToolCalls((prev) => [...prev, { name: event.name, arguments: event.arguments, done: false }]);
          return;
        }
        if (event.type === 'tool_done') {
          if (isOwner) setActiveToolCalls((prev) => prev.map((tc) =>
            tc.name === event.name && !tc.done ? { ...tc, done: true } : tc,
          ));
          return;
        }
        if (event.type === 'conversation') {
          upsertConversation(event.conversation);
          handlerConvId = event.conversation.id;
          if (isOwner) {
            if (!userNavigatedAwayRef.current) setCurrentConversationId(event.conversation.id);
            activeConversationIdRef.current = event.conversation.id;
            setStreamingConversationId(event.conversation.id);
          }
          return;
        }

        if (event.type === 'delta') {
          if (isOwner) {
            streamingTextRef.current += event.delta;
            setStreamingText((current) => current + event.delta);
          }
          return;
        }

        upsertConversation(event.conversation);
        if (isOwner) {
          if (!userNavigatedAwayRef.current) setCurrentConversationId(event.conversation.id);
          setActiveToolCalls([]);
          setStreamingText('');
          streamingTextRef.current = '';
        }
      }, controller.signal, locale, effectiveCustomInstructions, webAccess, localFiles, allowedFolders, userLocation);
      await refreshHealth().catch(() => null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (abortControllerRef.current === controller) {
          const partial = streamingTextRef.current.trim();
          setStreamingText('');
          streamingTextRef.current = '';
          if (partial && handlerConvId) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === handlerConvId
                  ? { ...c, messages: [...c.messages, { id: `partial-${Date.now()}`, role: 'assistant' as const, content: partial, input_type: 'text' as const, created_at: new Date().toISOString() }] }
                  : c,
              ),
            );
            await savePartial(handlerConvId, partial).catch(() => null);
          }
        }
      } else if (abortControllerRef.current === controller) {
        removeOptimisticMessages(handlerConvId ?? currentConversationId);
        setError(err instanceof Error ? err.message : t('error.sendFile'));
        setRestoreComposer({ text, files });
        setStreamingText('');
        streamingTextRef.current = '';
      } else {
        removeOptimisticMessages(handlerConvId);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setStreamingConversationId(null);
        setBusy(false);
      }
    }
  }

  function handleStop() {
    autoplayRef.current?.stop();
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreamingConversationId(null);
    setBusy(false);
  }

  async function handleEditLastMessage(newText: string) {
    if (!currentConversationId) return;
    // Only abort if the active stream belongs to this same conversation
    if (abortControllerRef.current && activeConversationIdRef.current === currentConversationId) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setStreamingText('');
      streamingTextRef.current = '';
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    activeConversationIdRef.current = currentConversationId;
    setStreamingConversationId(currentConversationId);
    // Optimistically show the edited user message and remove the old assistant reply
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== currentConversationId) return c;
        const msgs = [...c.messages];
        // Remove trailing assistant message
        if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') msgs.pop();
        // Update last user message content
        let lastUserIdx = -1;
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'user') { lastUserIdx = i; break; }
        }
        if (lastUserIdx >= 0) msgs[lastUserIdx] = { ...msgs[lastUserIdx], content: newText };
        return { ...c, messages: msgs };
      }),
    );
    try {
      setBusy(true);
      setStreamingText('');
      streamingTextRef.current = '';
      setActiveToolCalls([]);
      setError(null);
      await streamEditLastMessage(currentConversationId, newText, (event: ChatStreamEvent) => {
        const isOwner = abortControllerRef.current === controller;
        if (event.type === 'tool_start') {
          if (isOwner) setActiveToolCalls((prev) => [...prev, { name: event.name, arguments: event.arguments, done: false }]);
          return;
        }
        if (event.type === 'tool_done') {
          if (isOwner) setActiveToolCalls((prev) => prev.map((tc) =>
            tc.name === event.name && !tc.done ? { ...tc, done: true } : tc,
          ));
          return;
        }
        if (event.type === 'conversation') {
          upsertConversation(event.conversation);
          if (isOwner) {
            activeConversationIdRef.current = event.conversation.id;
            setStreamingConversationId(event.conversation.id);
          }
          return;
        }
        if (event.type === 'delta') {
          if (isOwner) {
            streamingTextRef.current += event.delta;
            setStreamingText((current) => current + event.delta);
          }
          return;
        }
        upsertConversation(event.conversation);
        if (isOwner) {
          setActiveToolCalls([]);
          setStreamingText('');
          streamingTextRef.current = '';
        }
      }, controller.signal, locale, effectiveCustomInstructions, webAccess, localFiles, allowedFolders, userLocation);
      await refreshHealth().catch(() => null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (abortControllerRef.current === controller) {
          const partial = streamingTextRef.current.trim();
          setStreamingText('');
          streamingTextRef.current = '';
          if (partial && currentConversationId) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === currentConversationId
                  ? { ...c, messages: [...c.messages, { id: `partial-${Date.now()}`, role: 'assistant' as const, content: partial, input_type: 'text' as const, created_at: new Date().toISOString() }] }
                  : c,
              ),
            );
            await savePartial(currentConversationId, partial).catch(() => null);
          }
        }
      } else if (abortControllerRef.current === controller) {
        setError(err instanceof Error ? err.message : t('error.editMessage'));
        setStreamingText('');
        streamingTextRef.current = '';
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setStreamingConversationId(null);
        setBusy(false);
      }
    }
  }

  async function handleRegenerate() {
    if (!currentConversationId) return;
    // Only abort if the active stream belongs to this same conversation
    if (abortControllerRef.current && activeConversationIdRef.current === currentConversationId) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setStreamingText('');
      streamingTextRef.current = '';
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    activeConversationIdRef.current = currentConversationId;
    setStreamingConversationId(currentConversationId);
    try {
      setBusy(true);
      setStreamingText('');
      streamingTextRef.current = '';
      setActiveToolCalls([]);
      setError(null);
      await streamRegenerate(currentConversationId, (event: ChatStreamEvent) => {
        const isOwner = abortControllerRef.current === controller;
        if (event.type === 'tool_start') {
          if (isOwner) setActiveToolCalls((prev) => [...prev, { name: event.name, arguments: event.arguments, done: false }]);
          return;
        }
        if (event.type === 'tool_done') {
          if (isOwner) setActiveToolCalls((prev) => prev.map((tc) =>
            tc.name === event.name && !tc.done ? { ...tc, done: true } : tc,
          ));
          return;
        }
        if (event.type === 'conversation') {
          upsertConversation(event.conversation);
          if (isOwner) {
            activeConversationIdRef.current = event.conversation.id;
            setStreamingConversationId(event.conversation.id);
          }
          return;
        }
        if (event.type === 'delta') {
          if (isOwner) {
            streamingTextRef.current += event.delta;
            setStreamingText((current) => current + event.delta);
          }
          return;
        }
        upsertConversation(event.conversation);
        if (isOwner) {
          setActiveToolCalls([]);
          setStreamingText('');
          streamingTextRef.current = '';
        }
      }, controller.signal, locale, effectiveCustomInstructions, webAccess, localFiles, allowedFolders, userLocation);
      await refreshHealth().catch(() => null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (abortControllerRef.current === controller) {
          const partial = streamingTextRef.current.trim();
          setStreamingText('');
          streamingTextRef.current = '';
          if (partial && currentConversationId) {
            setConversations((prev) =>
              prev.map((c) =>
                c.id === currentConversationId
                  ? { ...c, messages: [...c.messages, { id: `partial-${Date.now()}`, role: 'assistant' as const, content: partial, input_type: 'text' as const, created_at: new Date().toISOString() }] }
                  : c,
              ),
            );
            await savePartial(currentConversationId, partial).catch(() => null);
          }
        }
      } else if (abortControllerRef.current === controller) {
        setError(err instanceof Error ? err.message : t('error.regenerate'));
        setStreamingText('');
        streamingTextRef.current = '';
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setStreamingConversationId(null);
        setBusy(false);
      }
    }
  }

  function handleToggleEnterToSend(value: boolean) {
    saveEnterToSendPreference(value);
    setEnterToSend(value);
  }

  function handleChangeCustomInstructions(value: string) {
    saveCustomInstructions(value);
    setCustomInstructions(value);
  }

  function handleChangeCustomInstructionsEnabled(value: boolean) {
    saveCustomInstructionsEnabled(value);
    setCustomInstructionsEnabled(value);
  }

  function handleChangeWebAccess(value: boolean) {
    saveWebAccess(value);
    setWebAccess(value);
  }

  function handleChangeLocalFiles(value: boolean) {
    saveLocalFiles(value);
    setLocalFiles(value);
  }

  function handleChangeAllowedFolders(folders: string[]) {
    saveAllowedFolders(folders);
    setAllowedFolders(folders);
  }

  function handleChangeLocationSharing(value: boolean) {
    saveLocationSharing(value);
    setLocationSharing(value);
  }

  async function handleSelectModel(modelKey: ModelKey) {
    try {
      setError(null);
      setBusy(true);
      const selection = await selectModel(modelKey);
      saveLastModelKey(modelKey);
      setHealth((current) =>
        current
          ? {
              ...current,
              active_model_key: selection.active_model_key,
              model_id: selection.model_id,
              model_status: selection.model_status,
              model_loaded: selection.model_loaded,
              model_setup_status: selection.model_setup_status,
            }
          : current,
      );
      await refreshHealth().catch(() => null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.switchModel'));
    } finally {
      setBusy(false);
    }
  }

  const modelLoading = health?.model_status === 'loading';
  const effectiveCustomInstructions = customInstructionsEnabled ? customInstructions : '';

  const isViewingStreamingConversation = currentConversationId != null && currentConversationId === streamingConversationId;
  const interfaceBusy = (busy && isViewingStreamingConversation) || modelLoading;
  const effectiveStreamingText = isViewingStreamingConversation ? streamingText : '';
  const effectiveToolCalls = isViewingStreamingConversation ? activeToolCalls : [];

  if (legalAccepted === null) {
    return null;
  }

  if (!legalAccepted) {
    return <LegalGate onAccept={() => void handleAcceptLegal()} />;
  }

  return (
    <>
      <SettingsPanel
        open={settingsOpen}
        busy={interfaceBusy}
        preferredVoice={preferredVoice}
        enterToSend={enterToSend}
        customInstructions={customInstructions}
        customInstructionsEnabled={customInstructionsEnabled}
        webAccess={webAccess}
        localFiles={localFiles}
        allowedFolders={allowedFolders}
        onClose={() => setSettingsOpen(false)}
        onChangePreferredVoice={setPreferredVoice}
        onToggleEnterToSend={handleToggleEnterToSend}
        onChangeCustomInstructions={handleChangeCustomInstructions}
        onChangeCustomInstructionsEnabled={handleChangeCustomInstructionsEnabled}
        onChangeWebAccess={handleChangeWebAccess}
        onChangeLocalFiles={handleChangeLocalFiles}
        onChangeAllowedFolders={handleChangeAllowedFolders}
        locationSharing={locationSharing}
        onChangeLocationSharing={handleChangeLocationSharing}
        onDeleteAll={handleDeleteAllConversations}
      />
      <ModelSelectorModal
        open={modelSelectorOpen}
        health={health}
        onClose={() => setModelSelectorOpen(false)}
        onSelectModel={handleSelectModel}
        onRefreshHealth={refreshHealth}
      />
      <ApiAccessPanel open={apiPanelOpen} onClose={() => setApiPanelOpen(false)} />
      <LegalModal document={legalDocument} onClose={() => setLegalDocument(null)} />
      <ChatLayout
        busy={interfaceBusy}
        modelLoading={!!modelLoading}
        enterToSend={enterToSend}
        customInstructionsEnabled={customInstructionsEnabled && !!customInstructions.trim()}
        webAccess={webAccess}
        localFiles={localFiles}
        locationSharing={locationSharing}
        conversations={conversations}
        currentConversation={currentConversation}
        streamingText={effectiveStreamingText}
        streamingConversationId={streamingConversationId}
        preferredVoice={preferredVoice}
        health={health}
        error={error}
        onNewConversation={handleNewConversation}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenApi={() => setApiPanelOpen(true)}
        onOpenLegal={setLegalDocument}
        onOpenModelSelector={() => setModelSelectorOpen(true)}
        onSendText={handleSendTextOrCommand}
        onSendFile={handleSendFile}
        onSendFiles={handleSendFiles}
        onDropFiles={(files) => setDroppedFiles(files)}
        droppedFiles={droppedFiles}
        onDroppedFilesConsumed={() => setDroppedFiles([])}
        restoreComposer={restoreComposer}
        onRestoreComposerConsumed={() => setRestoreComposer(null)}
        onStop={handleStop}
        onEditLastMessage={handleEditLastMessage}
        onRegenerate={handleRegenerate}
        activeToolCalls={effectiveToolCalls}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        followUps={currentConversation?.follow_ups}
        onFollowUpClick={handleSendText}
        systemMessage={systemMessage}
      />
    </>
  );
}
