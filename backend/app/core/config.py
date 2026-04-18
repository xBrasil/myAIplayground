from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[2]
PROJECT_DIR = BASE_DIR.parent

# Origins allowed for CORS and sensitive endpoints (e.g. /shutdown).
# Accepts a range of ports to support automatic port fallback when
# the default frontend port (5173) is already in use.
ALLOWED_ORIGINS = [
    f"http://{host}:{port}"
    for host in ("127.0.0.1", "localhost")
    for port in range(5173, 5183)
]

# Locate .env file: prefer data/system/.env, fall back to legacy data/.env
_env_file = PROJECT_DIR / "data" / "system" / ".env"
if not _env_file.exists():
    _legacy_env = PROJECT_DIR / "data" / ".env"
    if _legacy_env.exists():
        _env_file = _legacy_env


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_env_file, env_file_encoding="utf-8", extra="ignore")

    app_name: str = Field(default="Gemma 4 Local Studio", alias="APP_NAME")
    app_env: str = Field(default="development", alias="APP_ENV")
    api_host: str = Field(default="127.0.0.1", alias="API_HOST")
    api_port: int = Field(default=8000, alias="API_PORT")
    database_url: str = Field(default="sqlite:///../data/user/app.db", alias="DATABASE_URL")
    upload_dir: str = Field(default="../data/user/uploads", alias="UPLOAD_DIR")
    model_cache_dir: str = Field(default="../data/system/model-cache", alias="MODEL_CACHE_DIR")
    enable_model_loading: bool = Field(default=False, alias="ENABLE_MODEL_LOADING")
    default_model_key: str = Field(default="e4b", alias="DEFAULT_MODEL_KEY")
    default_system_prompt: str = Field(
        default="You are a helpful local assistant.",
        alias="DEFAULT_SYSTEM_PROMPT",
    )
    preferred_tts_voice: str = Field(default="Microsoft Antonio", alias="PREFERRED_TTS_VOICE")

    # GGUF model repos
    gguf_repo_e2b: str = Field(default="unsloth/gemma-4-E2B-it-GGUF", alias="GGUF_REPO_E2B")
    gguf_repo_e4b: str = Field(default="unsloth/gemma-4-E4B-it-GGUF", alias="GGUF_REPO_E4B")
    gguf_repo_26b: str = Field(default="unsloth/gemma-4-26B-A4B-it-GGUF", alias="GGUF_REPO_26B")

    # GGUF model filenames
    gguf_file_e2b: str = Field(default="gemma-4-E2B-it-Q8_0.gguf", alias="GGUF_FILE_E2B")
    gguf_file_e4b: str = Field(default="gemma-4-E4B-it-Q4_K_M.gguf", alias="GGUF_FILE_E4B")
    gguf_file_26b: str = Field(default="gemma-4-26B-A4B-it-UD-IQ4_XS.gguf", alias="GGUF_FILE_26B")

    # Multimodal projector (mmproj) files — empty disables vision/audio for that model
    # BF16 recommended for native audio quality (llama.cpp PR #21421)
    mmproj_file_e2b: str = Field(default="mmproj-BF16.gguf", alias="MMPROJ_FILE_E2B")
    mmproj_file_e4b: str = Field(default="mmproj-BF16.gguf", alias="MMPROJ_FILE_E4B")
    mmproj_file_26b: str = Field(default="mmproj-BF16.gguf", alias="MMPROJ_FILE_26B")

    # llama.cpp engine settings
    n_ctx: int = Field(default=0, alias="N_CTX")
    n_gpu_layers: int = Field(default=-1, alias="N_GPU_LAYERS")
    flash_attn: bool = Field(default=True, alias="FLASH_ATTN")
    llama_server_host: str = Field(default="127.0.0.1", alias="LLAMA_SERVER_HOST")
    llama_server_port: int = Field(default=8081, alias="LLAMA_SERVER_PORT")
    image_min_tokens: int = Field(default=280, alias="IMAGE_MIN_TOKENS")
    image_max_tokens: int = Field(default=512, alias="IMAGE_MAX_TOKENS")

    # Whisper ASR
    whisper_model_size: str = Field(default="base", alias="WHISPER_MODEL_SIZE")

    @property
    def resolved_database_path(self) -> Path:
        if self.database_url.startswith("sqlite:///"):
            relative = self.database_url.removeprefix("sqlite:///")
            return (BASE_DIR / relative).resolve()
        raise ValueError("Only sqlite DATABASE_URL values are currently supported.")

    @property
    def resolved_upload_dir(self) -> Path:
        return (BASE_DIR / self.upload_dir).resolve()

    @property
    def resolved_model_cache_dir(self) -> Path:
        return (BASE_DIR / self.model_cache_dir).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
