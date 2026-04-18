import logging
from threading import Lock

from app.core.config import get_settings

logger = logging.getLogger(__name__)

try:
    from faster_whisper import WhisperModel
except ImportError:  # pragma: no cover
    WhisperModel = None


class WhisperService:
    def __init__(self) -> None:
        self._model: object | None = None
        self._settings = get_settings()
        self._lock = Lock()

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        if WhisperModel is None:
            raise RuntimeError("faster-whisper is not installed in the backend Python environment.")
        with self._lock:
            if self._model is not None:
                return
            try:
                self._model = WhisperModel(
                    self._settings.whisper_model_size,
                    device="cuda",
                    compute_type="float16",
                )
            except Exception:
                logger.warning("CUDA unavailable for Whisper, using CPU")
                self._model = WhisperModel(
                    self._settings.whisper_model_size,
                    device="cpu",
                    compute_type="int8",
                )

    def transcribe(self, audio_path: str) -> str:
        self._ensure_loaded()
        segments, _ = self._model.transcribe(
            audio_path,
            beam_size=5,
        )
        return " ".join(segment.text.strip() for segment in segments).strip()

    @property
    def is_available(self) -> bool:
        return WhisperModel is not None


whisper_service = WhisperService()
