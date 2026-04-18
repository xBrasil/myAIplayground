from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_serializer


def _utc_to_local_iso(dt: datetime) -> str:
    """Convert a naive UTC datetime (from SQLite) to a local-time ISO string with offset."""
    utc_dt = dt.replace(tzinfo=timezone.utc)
    return utc_dt.astimezone().isoformat()


class MessageCreate(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1)
    input_type: Literal["text", "image", "audio", "file"] = "text"
    attachment_name: str | None = None
    attachment_path: str | None = None


class MessageRead(BaseModel):
    id: str
    role: str
    content: str
    input_type: str
    model_key: str | None
    attachment_name: str | None
    attachment_path: str | None
    custom_instructions_snapshot: str | None = None
    custom_instructions_risk_score: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer('created_at')
    @staticmethod
    def _serialize_created(dt: datetime) -> str:
        return _utc_to_local_iso(dt)


class ConversationCreate(BaseModel):
    title: str = Field(default="New conversation", min_length=1)


class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class ConversationRead(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    follow_ups: list[str] = []
    messages: list[MessageRead] = []

    model_config = {"from_attributes": True}

    @field_serializer('created_at', 'updated_at')
    @staticmethod
    def _serialize_dates(dt: datetime) -> str:
        return _utc_to_local_iso(dt)


class ModelOption(BaseModel):
    key: Literal["e2b", "e4b", "26b"]
    label: str
    summary: str
    model_id: str
    cached: bool


class ModelSetupStatus(BaseModel):
    key: str
    label: str | None = None
    detail: str | None = None


class HealthResponse(BaseModel):
    app_name: str
    environment: str
    model_id: str
    active_model_key: Literal["e2b", "e4b", "26b"]
    model_status: Literal["idle", "loading", "loaded", "error"]
    model_loaded: bool
    cuda_available: bool
    gpu_vendor: Literal["nvidia", "amd", "apple", "none"]
    gpu_backend: Literal["cuda", "hip", "rocm", "metal", "vulkan", "cpu"]
    gpu_display_name: str
    context_size: int
    model_setup_status: ModelSetupStatus
    model_loading_enabled: bool
    available_models: list[ModelOption]


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str = Field(min_length=1)
    enable_thinking: bool = False
    locale: str = "en-US"
    custom_instructions: str = Field(default="", max_length=4000)
    enable_web_access: bool = False
    enable_local_files: bool = False
    allowed_folders: list[str] = Field(default_factory=list)
    user_location: str | None = Field(default=None, max_length=64)


class ChatResponse(BaseModel):
    conversation: ConversationRead
    reply: MessageRead
    model_loaded: bool


class DeleteConversationResponse(BaseModel):
    deleted_conversations: int
    deleted_messages: int
    deleted_files: int


class DeleteAllConversationsRequest(BaseModel):
    confirmation_text: str = Field(min_length=1)


class RiskEvaluationRequest(BaseModel):
    custom_instructions: str = Field(min_length=1, max_length=4000)


class RiskEvaluationResponse(BaseModel):
    risk_score: int


class ModelSelectionRequest(BaseModel):
    model_key: Literal["e2b", "e4b", "26b"]


class ModelSelectionResponse(BaseModel):
    active_model_key: Literal["e2b", "e4b", "26b"]
    model_id: str
    model_status: Literal["idle", "loading", "loaded", "error"]
    model_loaded: bool
    model_setup_status: ModelSetupStatus


class ServerConfigResponse(BaseModel):
    llama_server_url: str
    model_id: str
    model_status: Literal["idle", "loading", "loaded", "error"]
    model_loaded: bool


class VoicePreferences(BaseModel):
    preferred_voice: str = "Microsoft Antonio"
