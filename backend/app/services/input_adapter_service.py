from dataclasses import dataclass
import base64
from io import BytesIO
from pathlib import Path

from fastapi import UploadFile
from PIL import Image


TEXT_EXTENSIONS = {".txt", ".md", ".py", ".json", ".csv", ".log"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".webm", ".m4a", ".ogg", ".mp4"}
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
AUDIO_TYPES = {
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/mp4",
    "audio/ogg",
}


@dataclass
class NormalizedUpload:
    kind: str
    file_name: str
    summary: str
    raw_bytes: bytes


class InputAdapterService:
    async def normalize_upload(self, upload: UploadFile) -> NormalizedUpload:
        raw_bytes = await upload.read()
        file_name = upload.filename or "upload.bin"
        suffix = Path(file_name).suffix.lower()
        content_type = upload.content_type or "application/octet-stream"

        if content_type in IMAGE_TYPES or suffix in IMAGE_EXTENSIONS:
            return NormalizedUpload(
                kind="image",
                file_name=file_name,
                summary=f"Imagem enviada: {file_name}",
                raw_bytes=raw_bytes,
            )

        if content_type in AUDIO_TYPES or suffix in AUDIO_EXTENSIONS or content_type.startswith("audio/"):
            return NormalizedUpload(
                kind="audio",
                file_name=file_name,
                summary=f"Áudio enviado: {file_name}",
                raw_bytes=raw_bytes,
            )

        if suffix in TEXT_EXTENSIONS:
            preview = raw_bytes.decode("utf-8", errors="ignore")[:4000]
            return NormalizedUpload(
                kind="file",
                file_name=file_name,
                summary=f"Arquivo textual enviado: {file_name}\n\n{preview}",
                raw_bytes=raw_bytes,
            )

        return NormalizedUpload(
            kind="unsupported",
            file_name=file_name,
            summary=(
                "Tipo de arquivo ainda não suportado na V1. Use texto, imagem, áudio ou arquivo textual simples."
            ),
            raw_bytes=raw_bytes,
        )

    def load_image(self, file_path: str):
        with Image.open(file_path) as image:
            return image.convert("RGB")

    def load_image_base64(self, file_path: str) -> str:
        """Load image and return as base64 data URL for llama-cpp-python multimodal."""
        with Image.open(file_path) as img:
            img = img.convert("RGB")
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
            return f"data:image/png;base64,{b64}"


input_adapter_service = InputAdapterService()
