import { useEffect, useMemo, useRef, useState } from 'react';

import ApiAccessPanel from './components/ApiAccessPanel';
import ChatLayout from './components/ChatLayout';
import LegalGate from './components/LegalGate';
import LegalModal from './components/LegalModal';
import ModelSelectorModal from './components/ModelSelectorModal';
import SettingsPanel from './components/SettingsPanel';
import { useI18n } from './lib/i18n';
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
import { loadPreferredVoiceName } from './lib/speech';
import type { ChatStreamEvent, Conversation, HealthResponse, ModelKey } from './types';

const DRAFT_ID = 'draft';

function isDraft(id: string | null): boolean {
  return id === DRAFT_ID;
}

function makeDraftConversation(): Conversation {
  const now = new Date().toISOString();
  return { id: DRAFT_ID, title: '', created_at: now, updated_at: now, messages: [] };
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingTextRef = useRef('');
  const activeConversationIdRef = useRef<string | null>(null);

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
        setUserLocation(`${position.coords.latitude.toFixed(4)},${position.coords.longitude.toFixed(4)}`);
      },
      () => {
        setUserLocation(null);
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }, [locationSharing]);

  async function refreshHealth() {
    const nextHealth = await fetchHealth();
    setHealth(nextHealth);
    return nextHealth;
  }

  function upsertConversation(nextConversation: Conversation) {
    setConversations((current) => {
      const remaining = current.filter((conversation) => conversation.id !== nextConversation.id);
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
    if (health?.model_status !== 'loading') {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshHealth().catch(() => null);
    }, 2000);

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

  async function handleSendText(text: string) {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const effectiveId = isDraft(currentConversationId) ? null : currentConversationId;
    activeConversationIdRef.current = effectiveId;
    setStreamingConversationId(currentConversationId);
    // Remove draft from list once we're sending
    if (isDraft(currentConversationId)) {
      setConversations((prev) => prev.filter((c) => c.id !== DRAFT_ID));
    }
    try {
      setBusy(true);
      setStreamingText('');
      streamingTextRef.current = '';
      setActiveToolCalls([]);
      setError(null);
      await streamTextMessage(effectiveId, text, (event: ChatStreamEvent) => {
        if (event.type === 'tool_start') {
          setActiveToolCalls((prev) => [...prev, { name: event.name, arguments: event.arguments, done: false }]);
          return;
        }
        if (event.type === 'tool_done') {
          setActiveToolCalls((prev) => prev.map((tc) =>
            tc.name === event.name && !tc.done ? { ...tc, done: true } : tc,
          ));
          return;
        }
        if (event.type === 'conversation') {
          upsertConversation(event.conversation);
          setCurrentConversationId(event.conversation.id);
          activeConversationIdRef.current = event.conversation.id;
          setStreamingConversationId(event.conversation.id);
          return;
        }

        if (event.type === 'delta') {
          streamingTextRef.current += event.delta;
          setStreamingText((current) => current + event.delta);
          return;
        }

        upsertConversation(event.conversation);
        setCurrentConversationId(event.conversation.id);
        setActiveToolCalls([]);
        setStreamingText('');
        streamingTextRef.current = '';
      }, controller.signal, locale, effectiveCustomInstructions, webAccess, localFiles, allowedFolders, userLocation);
      await refreshHealth().catch(() => null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        const partial = streamingTextRef.current.trim();
        const convId = activeConversationIdRef.current;
        setStreamingText('');
        streamingTextRef.current = '';
        if (partial && convId) {
          // Show partial immediately
          setConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? { ...c, messages: [...c.messages, { id: `partial-${Date.now()}`, role: 'assistant' as const, content: partial, input_type: 'text' as const, created_at: new Date().toISOString() }] }
                : c,
            ),
          );
          // Persist to backend, then reload to get real IDs
          await savePartial(convId, partial).catch(() => null);
          await reloadConversations().catch(() => null);
        }
      } else {
        setError(err instanceof Error ? err.message : t('error.sendMessage'));
        setRestoreComposer({ text, files: [] });
        setStreamingText('');
        streamingTextRef.current = '';
      }
    } finally {
      abortControllerRef.current = null;
      setStreamingConversationId(null);
      setBusy(false);
    }
  }

  async function handleSendFile(text: string, file: File) {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const effectiveId = isDraft(currentConversationId) ? null : currentConversationId;
    activeConversationIdRef.current = effectiveId;
    setStreamingConversationId(currentConversationId);
    if (isDraft(currentConversationId)) {
      setConversations((prev) => prev.filter((c) => c.id !== DRAFT_ID));
    }
    try {
      setBusy(true);
      setStreamingText('');
      streamingTextRef.current = '';
      setActiveToolCalls([]);
      setError(null);
      await streamUploadMessage(effectiveId, text, file, (event: ChatStreamEvent) => {
        if (event.type === 'tool_start') {
          setActiveToolCalls((prev) => [...prev, { name: event.name, arguments: event.arguments, done: false }]);
          return;
        }
        if (event.type === 'tool_done') {
          setActiveToolCalls((prev) => prev.map((tc) =>
            tc.name === event.name && !tc.done ? { ...tc, done: true } : tc,
          ));
          return;
        }
        if (event.type === 'conversation') {
          upsertConversation(event.conversation);
          setCurrentConversationId(event.conversation.id);
          activeConversationIdRef.current = event.conversation.id;
          setStreamingConversationId(event.conversation.id);
          return;
        }

        if (event.type === 'delta') {
          streamingTextRef.current += event.delta;
          setStreamingText((current) => current + event.delta);
          return;
        }

        upsertConversation(event.conversation);
        setCurrentConversationId(event.conversation.id);
        setActiveToolCalls([]);
        setStreamingText('');
        streamingTextRef.current = '';
      }, controller.signal, locale, effectiveCustomInstructions, webAccess, localFiles, allowedFolders, userLocation);
      await refreshHealth().catch(() => null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        const partial = streamingTextRef.current.trim();
        const convId = activeConversationIdRef.current;
        setStreamingText('');
        streamingTextRef.current = '';
        if (partial && convId) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? { ...c, messages: [...c.messages, { id: `partial-${Date.now()}`, role: 'assistant' as const, content: partial, input_type: 'text' as const, created_at: new Date().toISOString() }] }
                : c,
            ),
          );
          await savePartial(convId, partial).catch(() => null);
          await reloadConversations().catch(() => null);
        }
      } else {
        setError(err instanceof Error ? err.message : t('error.sendFile'));
        setRestoreComposer({ text, files: [file] });
        setStreamingText('');
        streamingTextRef.current = '';
      }
    } finally {
      abortControllerRef.current = null;
      setStreamingConversationId(null);
      setBusy(false);
    }
  }

  async function handleSendFiles(text: string, files: File[]) {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const effectiveId = isDraft(currentConversationId) ? null : currentConversationId;
    activeConversationIdRef.current = effectiveId;
    setStreamingConversationId(currentConversationId);
    if (isDraft(currentConversationId)) {
      setConversations((prev) => prev.filter((c) => c.id !== DRAFT_ID));
    }
    try {
      setBusy(true);
      setStreamingText('');
      streamingTextRef.current = '';
      setActiveToolCalls([]);
      setError(null);
      await streamMultiUploadMessage(effectiveId, text, files, (event: ChatStreamEvent) => {
        if (event.type === 'tool_start') {
          setActiveToolCalls((prev) => [...prev, { name: event.name, arguments: event.arguments, done: false }]);
          return;
        }
        if (event.type === 'tool_done') {
          setActiveToolCalls((prev) => prev.map((tc) =>
            tc.name === event.name && !tc.done ? { ...tc, done: true } : tc,
          ));
          return;
        }
        if (event.type === 'conversation') {
          upsertConversation(event.conversation);
          setCurrentConversationId(event.conversation.id);
          activeConversationIdRef.current = event.conversation.id;
          setStreamingConversationId(event.conversation.id);
          return;
        }

        if (event.type === 'delta') {
          streamingTextRef.current += event.delta;
          setStreamingText((current) => current + event.delta);
          return;
        }

        upsertConversation(event.conversation);
        setCurrentConversationId(event.conversation.id);
        setActiveToolCalls([]);
        setStreamingText('');
        streamingTextRef.current = '';
      }, controller.signal, locale, effectiveCustomInstructions, webAccess, localFiles, allowedFolders, userLocation);
      await refreshHealth().catch(() => null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        const partial = streamingTextRef.current.trim();
        const convId = activeConversationIdRef.current;
        setStreamingText('');
        streamingTextRef.current = '';
        if (partial && convId) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? { ...c, messages: [...c.messages, { id: `partial-${Date.now()}`, role: 'assistant' as const, content: partial, input_type: 'text' as const, created_at: new Date().toISOString() }] }
                : c,
            ),
          );
          await savePartial(convId, partial).catch(() => null);
          await reloadConversations().catch(() => null);
        }
      } else {
        setError(err instanceof Error ? err.message : t('error.sendFile'));
        setRestoreComposer({ text, files });
        setStreamingText('');
        streamingTextRef.current = '';
      }
    } finally {
      abortControllerRef.current = null;
      setStreamingConversationId(null);
      setBusy(false);
    }
  }

  function handleStop() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }

  async function handleEditLastMessage(newText: string) {
    if (!currentConversationId) return;
    // Abort any ongoing generation first
    if (abortControllerRef.current) {
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
      await streamEditLastMessage(currentConversationId, newText, (event: ChatStreamEvent) => {
        if (event.type === 'tool_start') {
          setActiveToolCalls((prev) => [...prev, { name: event.name, arguments: event.arguments, done: false }]);
          return;
        }
        if (event.type === 'tool_done') {
          setActiveToolCalls((prev) => prev.map((tc) =>
            tc.name === event.name && !tc.done ? { ...tc, done: true } : tc,
          ));
          return;
        }
        if (event.type === 'conversation') {
          upsertConversation(event.conversation);
          activeConversationIdRef.current = event.conversation.id;
          setStreamingConversationId(event.conversation.id);
          return;
        }
        if (event.type === 'delta') {
          streamingTextRef.current += event.delta;
          setStreamingText((current) => current + event.delta);
          return;
        }
        upsertConversation(event.conversation);
        setActiveToolCalls([]);
        setStreamingText('');
        streamingTextRef.current = '';
      }, controller.signal, locale, effectiveCustomInstructions, webAccess, localFiles, allowedFolders, userLocation);
      await refreshHealth().catch(() => null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        const partial = streamingTextRef.current.trim();
        const convId = activeConversationIdRef.current;
        setStreamingText('');
        streamingTextRef.current = '';
        if (partial && convId) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? { ...c, messages: [...c.messages, { id: `partial-${Date.now()}`, role: 'assistant' as const, content: partial, input_type: 'text' as const, created_at: new Date().toISOString() }] }
                : c,
            ),
          );
          await savePartial(convId, partial).catch(() => null);
          await reloadConversations().catch(() => null);
        }
      } else {
        setError(err instanceof Error ? err.message : t('error.editMessage'));
        setStreamingText('');
        streamingTextRef.current = '';
      }
    } finally {
      abortControllerRef.current = null;
      setStreamingConversationId(null);
      setBusy(false);
    }
  }

  async function handleRegenerate() {
    if (!currentConversationId) return;
    // Abort any ongoing generation first
    if (abortControllerRef.current) {
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
        if (event.type === 'tool_start') {
          setActiveToolCalls((prev) => [...prev, { name: event.name, arguments: event.arguments, done: false }]);
          return;
        }
        if (event.type === 'tool_done') {
          setActiveToolCalls((prev) => prev.map((tc) =>
            tc.name === event.name && !tc.done ? { ...tc, done: true } : tc,
          ));
          return;
        }
        if (event.type === 'conversation') {
          upsertConversation(event.conversation);
          activeConversationIdRef.current = event.conversation.id;
          setStreamingConversationId(event.conversation.id);
          return;
        }
        if (event.type === 'delta') {
          streamingTextRef.current += event.delta;
          setStreamingText((current) => current + event.delta);
          return;
        }
        upsertConversation(event.conversation);
        setActiveToolCalls([]);
        setStreamingText('');
        streamingTextRef.current = '';
      }, controller.signal, locale, effectiveCustomInstructions, webAccess, localFiles, allowedFolders, userLocation);
      await refreshHealth().catch(() => null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        const partial = streamingTextRef.current.trim();
        const convId = activeConversationIdRef.current;
        setStreamingText('');
        streamingTextRef.current = '';
        if (partial && convId) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? { ...c, messages: [...c.messages, { id: `partial-${Date.now()}`, role: 'assistant' as const, content: partial, input_type: 'text' as const, created_at: new Date().toISOString() }] }
                : c,
            ),
          );
          await savePartial(convId, partial).catch(() => null);
          await reloadConversations().catch(() => null);
        }
      } else {
        setError(err instanceof Error ? err.message : t('error.regenerate'));
        setStreamingText('');
        streamingTextRef.current = '';
      }
    } finally {
      abortControllerRef.current = null;
      setStreamingConversationId(null);
      setBusy(false);
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
        conversations={conversations}
        currentConversation={currentConversation}
        streamingText={effectiveStreamingText}
        streamingConversationId={streamingConversationId}
        preferredVoice={preferredVoice}
        health={health}
        error={error}
        onNewConversation={handleNewConversation}
        onSelectConversation={setCurrentConversationId}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenApi={() => setApiPanelOpen(true)}
        onOpenLegal={setLegalDocument}
        onOpenModelSelector={() => setModelSelectorOpen(true)}
        onSendText={handleSendText}
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
      />
    </>
  );
}
