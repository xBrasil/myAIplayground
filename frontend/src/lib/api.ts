import type {
  ChatStreamEvent,
  ChatResponse,
  Conversation,
  DeleteConversationResponse,
  HealthResponse,
  ModelKey,
  ModelSelectionResponse,
  ServerConfig,
} from '../types';

const API_PORT = import.meta.env.VITE_API_PORT || '8000';
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const API_BASE = `${API_ORIGIN}/api`;

export function getUploadAssetUrl(attachmentPath?: string | null): string | null {
  if (!attachmentPath) {
    return null;
  }

  const fileName = attachmentPath.split(/[/\\]/).pop();
  if (!fileName) {
    return null;
  }

  return `${API_ORIGIN}/uploads/${encodeURIComponent(fileName)}`;
}

function getUploadMessage(message: string, file: File): string {
  const trimmed = message.trim();
  if (trimmed) {
    return trimmed;
  }

  if (file.type.startsWith('audio/') || file.name.toLowerCase().endsWith('.wav') || file.name.toLowerCase().endsWith('.webm')) {
    return '';
  }

  if (file.type.startsWith('image/')) {
    return '';
  }

  return '';
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE}/health`);
  if (!response.ok) {
    throw new Error('Falha ao consultar healthcheck');
  }
  return response.json();
}

export async function shutdownServer(): Promise<void> {
  await fetch(`${API_BASE}/shutdown`, { method: 'POST' });
}

export async function evaluateCustomInstructionsRisk(customInstructions: string): Promise<number> {
  const response = await fetch(`${API_BASE}/chat/evaluate-risk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ custom_instructions: customInstructions }),
  });
  if (!response.ok) {
    return 0;
  }
  const data = await response.json();
  return data.risk_score ?? 0;
}

export interface SearchResult {
  conversation: Conversation;
  match_type: 'title' | 'content';
}

export async function searchConversations(query: string): Promise<SearchResult[]> {
  const response = await fetch(`${API_BASE}/chat/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    return [];
  }
  return response.json();
}

export async function fetchConversations(): Promise<Conversation[]> {
  const response = await fetch(`${API_BASE}/conversations`);
  if (!response.ok) {
    throw new Error('Falha ao carregar conversas');
  }
  return response.json();
}

export async function createConversation(title = 'Nova conversa'): Promise<Conversation> {
  const response = await fetch(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw new Error('Falha ao criar conversa');
  }
  return response.json();
}

export async function selectModel(modelKey: ModelKey): Promise<ModelSelectionResponse> {
  const response = await fetch(`${API_BASE}/models/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_key: modelKey }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || 'Falha ao trocar modelo');
  }
  return response.json();
}

export async function deleteConversation(
  conversationId: string,
): Promise<DeleteConversationResponse> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || 'Falha ao apagar conversa');
  }
  return response.json();
}

export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<Conversation> {
  const response = await fetch(`${API_BASE}/conversations/${conversationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || 'Falha ao renomear conversa');
  }
  return response.json();
}

export async function deleteAllConversations(
  confirmationText: string,
): Promise<DeleteConversationResponse> {
  const response = await fetch(`${API_BASE}/conversations/delete-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation_text: confirmationText }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || 'Falha ao apagar todas as conversas');
  }
  return response.json();
}

export async function sendTextMessage(
  conversationId: string | null,
  message: string,
  locale: string = 'en-US',
  customInstructions: string = '',
  enableWebAccess: boolean = false,
  enableLocalFiles: boolean = false,
  allowedFolders: string[] = [],
): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: conversationId, message, locale, custom_instructions: customInstructions || undefined, enable_web_access: enableWebAccess, enable_local_files: enableLocalFiles, allowed_folders: allowedFolders.length ? allowedFolders : undefined }),
  });
  if (!response.ok) {
    throw new Error('Falha ao enviar mensagem');
  }
  return response.json();
}

export async function streamTextMessage(
  conversationId: string | null,
  message: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
  locale: string = 'en-US',
  customInstructions: string = '',
  enableWebAccess: boolean = false,
  enableLocalFiles: boolean = false,
  allowedFolders: string[] = [],
  userLocation: string | null = null,
): Promise<void> {
  const response = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: conversationId, message, locale, custom_instructions: customInstructions || undefined, enable_web_access: enableWebAccess, enable_local_files: enableLocalFiles, allowed_folders: allowedFolders.length ? allowedFolders : undefined, user_location: userLocation || undefined }),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error('Falha ao iniciar streaming da resposta');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      onEvent(JSON.parse(line) as ChatStreamEvent);
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as ChatStreamEvent);
  }
}

export async function sendUploadMessage(
  conversationId: string | null,
  message: string,
  file: File,
  locale: string = 'en-US',
  customInstructions: string = '',
  enableWebAccess: boolean = false,
  enableLocalFiles: boolean = false,
  allowedFolders: string[] = [],
): Promise<ChatResponse> {
  const formData = new FormData();
  formData.append('message', getUploadMessage(message, file));
  if (conversationId) {
    formData.append('conversation_id', conversationId);
  }
  formData.append('locale', locale);
  if (customInstructions) formData.append('custom_instructions', customInstructions);
  if (enableWebAccess) formData.append('enable_web_access', 'true');
  if (enableLocalFiles) formData.append('enable_local_files', 'true');
  if (allowedFolders.length) formData.append('allowed_folders', JSON.stringify(allowedFolders));
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/chat/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || 'Falha ao enviar arquivo');
  }
  return response.json();
}

export async function streamUploadMessage(
  conversationId: string | null,
  message: string,
  file: File,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
  locale: string = 'en-US',
  customInstructions: string = '',
  enableWebAccess: boolean = false,
  enableLocalFiles: boolean = false,
  allowedFolders: string[] = [],
  userLocation: string | null = null,
): Promise<void> {
  const formData = new FormData();
  formData.append('message', getUploadMessage(message, file));
  if (conversationId) {
    formData.append('conversation_id', conversationId);
  }
  formData.append('locale', locale);
  if (customInstructions) formData.append('custom_instructions', customInstructions);
  if (enableWebAccess) formData.append('enable_web_access', 'true');
  if (enableLocalFiles) formData.append('enable_local_files', 'true');
  if (allowedFolders.length) formData.append('allowed_folders', JSON.stringify(allowedFolders));
  if (userLocation) formData.append('user_location', userLocation);
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/chat/upload/stream`, {
    method: 'POST',
    body: formData,
    signal,
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || 'Falha ao iniciar streaming do arquivo');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      onEvent(JSON.parse(line) as ChatStreamEvent);
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as ChatStreamEvent);
  }
}

export async function streamMultiUploadMessage(
  conversationId: string | null,
  message: string,
  files: File[],
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
  locale: string = 'en-US',
  customInstructions: string = '',
  enableWebAccess: boolean = false,
  enableLocalFiles: boolean = false,
  allowedFolders: string[] = [],
  userLocation: string | null = null,
): Promise<void> {
  const formData = new FormData();
  formData.append('message', message.trim());
  if (conversationId) {
    formData.append('conversation_id', conversationId);
  }
  formData.append('locale', locale);
  if (customInstructions) formData.append('custom_instructions', customInstructions);
  if (enableWebAccess) formData.append('enable_web_access', 'true');
  if (enableLocalFiles) formData.append('enable_local_files', 'true');
  if (allowedFolders.length) formData.append('allowed_folders', JSON.stringify(allowedFolders));
  if (userLocation) formData.append('user_location', userLocation);
  for (const file of files) {
    formData.append('files', file);
  }

  const response = await fetch(`${API_BASE}/chat/upload/multi/stream`, {
    method: 'POST',
    body: formData,
    signal,
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || 'Falha ao iniciar streaming dos arquivos');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      onEvent(JSON.parse(line) as ChatStreamEvent);
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as ChatStreamEvent);
  }
}

export async function savePartial(conversationId: string, text: string): Promise<void> {
  await fetch(`${API_BASE}/chat/${conversationId}/save-partial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export async function openFile(attachmentPath: string): Promise<void> {
  await fetch(`${API_BASE}/chat/file/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: attachmentPath }),
  });
}

export async function revealFile(attachmentPath: string): Promise<void> {
  await fetch(`${API_BASE}/chat/file/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: attachmentPath }),
  });
}

export async function streamEditLastMessage(
  conversationId: string,
  message: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
  locale: string = 'en-US',
  customInstructions: string = '',
  enableWebAccess: boolean = false,
  enableLocalFiles: boolean = false,
  allowedFolders: string[] = [],
  userLocation: string | null = null,
): Promise<void> {
  const response = await fetch(`${API_BASE}/chat/${conversationId}/edit-last/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, locale, custom_instructions: customInstructions || undefined, enable_web_access: enableWebAccess, enable_local_files: enableLocalFiles, allowed_folders: allowedFolders.length ? allowedFolders : undefined, user_location: userLocation || undefined }),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error('Falha ao editar mensagem');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    buf += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as ChatStreamEvent);
    }
    if (done) break;
  }
  if (buf.trim()) onEvent(JSON.parse(buf) as ChatStreamEvent);
}

export async function streamRegenerate(
  conversationId: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
  locale: string = 'en-US',
  customInstructions: string = '',
  enableWebAccess: boolean = false,
  enableLocalFiles: boolean = false,
  allowedFolders: string[] = [],
  userLocation: string | null = null,
): Promise<void> {
  const response = await fetch(`${API_BASE}/chat/${conversationId}/regenerate/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale, custom_instructions: customInstructions || undefined, enable_web_access: enableWebAccess, enable_local_files: enableLocalFiles, allowed_folders: allowedFolders.length ? allowedFolders : undefined, user_location: userLocation || undefined }),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error('Falha ao regenerar resposta');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    buf += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as ChatStreamEvent);
    }
    if (done) break;
  }
  if (buf.trim()) onEvent(JSON.parse(buf) as ChatStreamEvent);
}

export async function fetchServerConfig(): Promise<ServerConfig> {
  const response = await fetch(`${API_BASE}/models/server-config`);
  if (!response.ok) {
    throw new Error('Failed to fetch server config');
  }
  return response.json();
}

export interface LegalAcceptanceResponse {
  accepted: boolean;
  locale?: string;
  terms_hash?: string;
  accepted_at?: string;
}

export async function fetchLegalAcceptance(): Promise<LegalAcceptanceResponse> {
  try {
    const response = await fetch(`${API_BASE}/legal/acceptance`);
    if (!response.ok) return { accepted: false };
    return response.json();
  } catch {
    return { accepted: false };
  }
}

export async function acceptLegal(locale: string, termsHash: string): Promise<void> {
  const response = await fetch(`${API_BASE}/legal/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale, terms_hash: termsHash }),
  });
  if (!response.ok) {
    throw new Error('Failed to save legal acceptance');
  }
}
