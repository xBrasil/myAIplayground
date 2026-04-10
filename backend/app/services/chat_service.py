import base64
from datetime import date
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Conversation, Message
from app.services.input_adapter_service import input_adapter_service
from app.services.model_service import model_service
from app.services.storage_service import storage_service
from app.services.whisper_service import whisper_service


class ChatService:
    LANG_NAMES: dict[str, str] = {
        "pt-BR": "Brazilian Portuguese",
        "en-US": "English",
        "es-ES": "Spanish",
        "fr-FR": "French",
    }

    def __init__(self) -> None:
        self._settings = get_settings()

    @property
    def model_loaded(self) -> bool:
        return model_service.is_loaded

    def _ensure_conversation(self, db: Session, conversation_id: str | None, seed_text: str) -> Conversation:
        if conversation_id:
            existing = storage_service.get_conversation(db, conversation_id)
            if existing is not None:
                return existing
        title = seed_text[:60].strip() or "Nova conversa"
        return storage_service.create_conversation(db, title)

    def _default_multimodal_instruction(self, input_type: str) -> str:
        if input_type == "audio":
            return (
                "Listen to the audio sent and respond based on what was said. "
                "If there is a question, answer it directly. If there is no clear question, "
                "provide a brief summary of the spoken content."
            )
        if input_type == "image":
            return "Analyze the image sent and respond based on the visual content."
        return "Analyze the content sent and respond."

    def _audio_transcription_instruction(self) -> str:
        return (
            "Transcribe the following speech segment in Brazilian Portuguese into Brazilian Portuguese text.\n\n"
            "Follow these specific instructions for formatting the answer:\n"
            "* Only output the transcription, with no newlines.\n"
            "* When transcribing numbers, write the digits."
        )

    def _transcribe_audio(self, attachment_path: str) -> str:
        try:
            return whisper_service.transcribe(attachment_path)
        except Exception:
            return ""

    def _read_text_file(self, file_path: str, max_chars: int = 64000) -> str:
        try:
            return Path(file_path).read_text("utf-8", errors="ignore")[:max_chars]
        except Exception:
            return "(Erro ao ler o arquivo)"

    def _load_audio_base64(self, file_path: str) -> tuple[str, str]:
        """Return (base64_data, audio_format) for native audio models."""
        raw = Path(file_path).read_bytes()
        b64 = base64.b64encode(raw).decode("utf-8")
        ext = Path(file_path).suffix.lower().lstrip(".")
        audio_fmt = {"wav": "wav", "mp3": "mp3", "webm": "webm", "ogg": "ogg", "m4a": "m4a"}.get(ext, "wav")
        return b64, audio_fmt

    def _conversation_seed_for_upload(
        self,
        content: str,
        input_type: str,
        attachment_name: str,
        attachment_summary: str,
    ) -> str:
        trimmed = content.strip()
        if trimmed:
            return trimmed
        if input_type == "audio":
            return attachment_name or "Áudio enviado"
        if input_type == "image":
            return attachment_name or "Imagem enviada"
        if input_type == "file":
            return attachment_summary or attachment_name or "Arquivo enviado"
        return attachment_name or "Nova conversa"

    def _stored_upload_content(
        self,
        text: str,
        input_type: str,
        attachment_path: str,
        attachment_summary: str,
    ) -> str:
        trimmed = text.strip()
        if input_type == "file":
            # File content is injected by _build_messages at inference time,
            # so we only store the user's own text here for clean display.
            return trimmed or "Analise o arquivo enviado."
        if input_type == "audio":
            transcript = self._transcribe_audio(attachment_path)
            return transcript or trimmed
        return trimmed

    def _build_system_prompt(self, locale: str = "en-US") -> str:
        base = self._settings.default_system_prompt
        today = date.today().isoformat()
        lang = self.LANG_NAMES.get(locale, "English")
        return (
            f"{base}\n\n"
            f"[System context]\n"
            f"Today's date: {today}\n"
            f"Your knowledge cut-off date: January 2025. Information after this date may not be in your training data.\n"
            f"User's preferred language: {lang}. Always respond in {lang} unless the user explicitly requests a different language."
        )

    def _build_messages(self, conversation: Conversation, locale: str = "en-US") -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self._build_system_prompt(locale)}
        ]
        for message in conversation.messages:
            # Image attachments: send as base64 for vision models
            if (
                message.role == "user"
                and message.attachment_path
                and message.input_type == "image"
                and model_service.supports_vision
            ):
                try:
                    data_url = input_adapter_service.load_image_base64(message.attachment_path)
                    text_content = message.content.strip() or self._default_multimodal_instruction("image")
                    messages.append({
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": data_url}},
                            {"type": "text", "text": text_content},
                        ],
                    })
                    continue
                except Exception:
                    pass

            # Text file attachments: read content from disk and inject into prompt
            if (
                message.role == "user"
                and message.attachment_path
                and message.input_type == "file"
            ):
                file_content = self._read_text_file(message.attachment_path)
                user_text = message.content.strip() or "Analise o arquivo enviado."
                prompt = f"[Arquivo: {message.attachment_name}]\n\n{file_content}\n\n{user_text}"
                messages.append({"role": "user", "content": prompt})
                continue

            # Audio and plain text — use stored transcript / content
            messages.append({"role": message.role, "content": message.content})
        return messages

    def handle_text_message(
        self,
        db: Session,
        conversation_id: str | None,
        text: str,
        enable_thinking: bool,
        locale: str = "en-US",
    ) -> tuple[Conversation, Message]:
        conversation = self._ensure_conversation(db, conversation_id, text)
        storage_service.append_message(db, conversation.id, "user", text, input_type="text", model_key=model_service.active_model_key)
        conversation = storage_service.get_conversation(db, conversation.id)
        reply_text = model_service.generate_reply(self._build_messages(conversation, locale), enable_thinking)
        reply = storage_service.append_message(db, conversation.id, "assistant", reply_text, input_type="text", model_key=model_service.active_model_key)
        conversation = storage_service.get_conversation(db, conversation.id)
        return conversation, reply

    def prepare_text_stream(
        self,
        db: Session,
        conversation_id: str | None,
        text: str,
        enable_thinking: bool,
        locale: str = "en-US",
    ) -> tuple[Conversation, object]:
        conversation = self._ensure_conversation(db, conversation_id, text)
        storage_service.append_message(db, conversation.id, "user", text, input_type="text", model_key=model_service.active_model_key)
        conversation = storage_service.get_conversation(db, conversation.id)
        stream = model_service.generate_reply_stream(self._build_messages(conversation, locale), enable_thinking)
        return conversation, stream

    def finalize_streamed_reply(self, db: Session, conversation_id: str, content: str) -> tuple[Conversation, Message]:
        reply = storage_service.append_message(db, conversation_id, "assistant", content, input_type="text", model_key=model_service.active_model_key)
        conversation = storage_service.get_conversation(db, conversation_id)
        return conversation, reply

    def generate_title(self, db: Session, conversation_id: str) -> Conversation | None:
        conversation = storage_service.get_conversation(db, conversation_id)
        if conversation is None:
            return None
        user_messages = [m for m in conversation.messages if m.role == "user"]
        if not user_messages:
            return None
        first_content = user_messages[0].content.strip()
        if not first_content:
            return None
        try:
            prompt = (
                "Generate a concise title (max 5 words) for a conversation that starts with the message below. "
                "Reply ONLY with the title, no quotes, no punctuation at the end, in the same language as the message.\n\n"
                f"Message: {first_content[:300]}"
            )
            title = model_service.generate_reply(
                [{"role": "user", "content": prompt}],
                enable_thinking=False,
            ).strip().strip('"').strip("'").strip(".")
            if not title or len(title) > 80:
                title = first_content[:40].strip()
        except Exception:
            title = first_content[:40].strip()
        if title:
            storage_service.rename_conversation(db, conversation_id, title)
            conversation = storage_service.get_conversation(db, conversation_id)
        return conversation

    def handle_file_message(
        self,
        db: Session,
        conversation_id: str | None,
        text: str,
        input_type: str,
        attachment_name: str,
        attachment_path: str,
        attachment_summary: str,
        enable_thinking: bool,
        locale: str = "en-US",
    ) -> tuple[Conversation, Message]:
        stored_content = self._stored_upload_content(text, input_type, attachment_path, attachment_summary)
        seed_text = self._conversation_seed_for_upload(stored_content, input_type, attachment_name, attachment_summary)

        conversation = self._ensure_conversation(db, conversation_id, seed_text)
        storage_service.append_message(
            db,
            conversation.id,
            "user",
            stored_content,
            input_type=input_type,
            model_key=model_service.active_model_key,
            attachment_name=attachment_name,
            attachment_path=attachment_path,
        )
        conversation = storage_service.get_conversation(db, conversation.id)
        reply_text = model_service.generate_reply(self._build_messages(conversation, locale), enable_thinking)
        reply = storage_service.append_message(db, conversation.id, "assistant", reply_text, input_type="text", model_key=model_service.active_model_key)
        conversation = storage_service.get_conversation(db, conversation.id)
        return conversation, reply

    def prepare_file_stream(
        self,
        db: Session,
        conversation_id: str | None,
        text: str,
        input_type: str,
        attachment_name: str,
        attachment_path: str,
        attachment_summary: str,
        enable_thinking: bool,
        locale: str = "en-US",
    ) -> tuple[Conversation, object]:
        stored_content = self._stored_upload_content(text, input_type, attachment_path, attachment_summary)
        seed_text = self._conversation_seed_for_upload(stored_content, input_type, attachment_name, attachment_summary)

        conversation = self._ensure_conversation(db, conversation_id, seed_text)
        storage_service.append_message(
            db,
            conversation.id,
            "user",
            stored_content,
            input_type=input_type,
            model_key=model_service.active_model_key,
            attachment_name=attachment_name,
            attachment_path=attachment_path,
        )
        conversation = storage_service.get_conversation(db, conversation.id)
        stream = model_service.generate_reply_stream(self._build_messages(conversation, locale), enable_thinking)
        return conversation, stream


chat_service = ChatService()
