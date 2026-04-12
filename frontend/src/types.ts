export type InputType = 'text' | 'image' | 'audio' | 'file' | 'document' | 'multi_file';
export type ModelKey = 'e2b' | 'e4b' | '26b';
export type ModelStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface ToolCallInfo {
  name: string;
  arguments: Record<string, unknown>;
  done: boolean;
}

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  input_type: InputType;
  model_key?: ModelKey | null;
  attachment_name?: string | null;
  attachment_path?: string | null;
  tool_calls?: ToolCallInfo[] | null;
  custom_instructions_snapshot?: string | null;
  custom_instructions_risk_score?: number | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: Message[];
}

export interface ChatResponse {
  conversation: Conversation;
  reply: Message;
  model_loaded: boolean;
}

export interface DeleteConversationResponse {
  deleted_conversations: number;
  deleted_messages: number;
  deleted_files: number;
}

export interface ModelOption {
  key: ModelKey;
  label: string;
  summary: string;
  model_id: string;
  cached: boolean;
}

export interface ModelSelectionResponse {
  active_model_key: ModelKey;
  model_id: string;
  model_status: ModelStatus;
  model_loaded: boolean;
  model_setup_status: string;
}

export interface StreamConversationEvent {
  type: 'conversation';
  conversation: Conversation;
}

export interface StreamDeltaEvent {
  type: 'delta';
  delta: string;
}

export interface StreamDoneEvent {
  type: 'done';
  conversation: Conversation;
  reply: Message;
  model_loaded: boolean;
  tool_calls?: ToolCallInfo[];
}

export interface StreamToolStartEvent {
  type: 'tool_start';
  name: string;
  arguments: Record<string, unknown>;
}

export interface StreamToolDoneEvent {
  type: 'tool_done';
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatStreamEvent = StreamConversationEvent | StreamDeltaEvent | StreamDoneEvent | StreamToolStartEvent | StreamToolDoneEvent;

export interface HealthResponse {
  app_name: string;
  environment: string;
  model_id: string;
  active_model_key: ModelKey;
  model_status: ModelStatus;
  model_loaded: boolean;
  cuda_available: boolean;
  context_size: number;
  model_setup_status: string;
  model_loading_enabled: boolean;
  available_models: ModelOption[];
}

export interface ServerConfig {
  llama_server_url: string;
  model_id: string;
  model_status: ModelStatus;
  model_loaded: boolean;
}
