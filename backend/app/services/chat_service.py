import base64
import json
import logging
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
from app.services.document_service import extract_text as extract_document_text
from app.services.web_service import FETCH_URL_TOOL, WEB_SEARCH_TOOL, execute_tool_call
from app.services.filesystem_service import (
    LIST_DIRECTORY_TOOL,
    READ_FILE_TOOL,
    VIEW_IMAGE_TOOL,
    execute_filesystem_tool,
)

logger = logging.getLogger(__name__)


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

    def _read_document_file(self, file_path: str, max_chars: int = 256000) -> str:
        return extract_document_text(file_path, max_chars)

    def _read_any_file(self, file_path: str) -> str:
        """Read a file by detecting its type from extension."""
        suffix = Path(file_path).suffix.lower()
        if suffix in (".pdf", ".docx", ".xlsx", ".pptx"):
            return self._read_document_file(file_path)
        return self._read_text_file(file_path)

    _IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".bmp", ".tiff", ".svg", ".heic", ".heif", ".avif"}

    def _build_multi_file_prompt(self, names_json: str, paths_json: str, user_content: str) -> str:
        try:
            names = json.loads(names_json)
            paths = json.loads(paths_json)
        except (json.JSONDecodeError, TypeError):
            return user_content or ""

        sections: list[str] = []
        for i, (name, path) in enumerate(zip(names, paths), 1):
            if Path(path).suffix.lower() in self._IMAGE_EXTS:
                sections.append(f"[Arquivo {i}: {name}]\n\n(Imagem — análise visual não disponível para o modelo atual)")
            else:
                content = self._read_any_file(path)
                sections.append(f"[Arquivo {i}: {name}]\n\n{content}")

        combined = "\n\n".join(sections)
        user_text = user_content.strip()
        if user_text:
            return combined + f"\n\n{user_text}"
        return combined

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
        if input_type == "document":
            return attachment_summary or attachment_name or "Documento enviado"
        if input_type == "multi_file":
            try:
                names = json.loads(attachment_name)
                return f"{len(names)} arquivos enviados"
            except Exception:
                return "Múltiplos arquivos enviados"
        return attachment_name or "Nova conversa"

    def _stored_upload_content(
        self,
        text: str,
        input_type: str,
        attachment_path: str,
        attachment_summary: str,
    ) -> str:
        trimmed = text.strip()
        if input_type in ("file", "document", "multi_file"):
            # File content is injected by _build_messages at inference time,
            # so we only store the user's own text here for clean display.
            return trimmed
        if input_type == "audio":
            transcript = self._transcribe_audio(attachment_path)
            return transcript or trimmed
        return trimmed

    def _build_system_prompt(
        self,
        locale: str = "en-US",
        custom_instructions: str = "",
        enable_web_access: bool = False,
        enable_local_files: bool = False,
        allowed_folders: list[str] | None = None,
    ) -> str:
        base = self._settings.default_system_prompt
        today = date.today().isoformat()
        lang = self.LANG_NAMES.get(locale, "English")
        prompt = (
            f"{base}\n\n"
            f"[System context]\n"
            f"Today's date: {today}\n"
            f"Your knowledge cut-off date: January 2025. Information after this date may not be in your training data.\n"
            f"User's preferred language: {lang}. Always respond in {lang} unless the user explicitly requests a different language."
        )
        if model_service.supports_vision:
            prompt += (
                "\nYou are a vision-capable model. When the user sends an image in the conversation, "
                "you can already see it directly — just describe or answer about it without using any tool. "
                "The view_image tool is ONLY for viewing images stored on the user's local file system, "
                "NOT for images the user has uploaded in the chat."
            )
        if enable_web_access:
            prompt += (
                "\n\n[Web access]\n"
                "You have access to web tools:\n"
                "- web_search: Search the web for information. Returns a list of results with titles, URLs, and snippets.\n"
                "- fetch_url: Fetch the full content of a specific web page.\n"
                "Use web_search when you need to find information or the user asks you to search for something. "
                "Use fetch_url to read specific pages you already know the URL of, or to read pages from search results. "
                "If the user explicitly asks you to search or look something up, ALWAYS use web_search "
                "even if you think you already know the answer — the user expects fresh, verified results.\n"
                "IMPORTANT — citing sources: Every piece of information you get from the web MUST be cited "
                "using inline numbered markdown links. The EXACT syntax is: [N](URL) where N is a sequential "
                "number and URL is the full page URL. Example: 'The population grew rapidly [1](https://example.com/article)'. "
                "Rules: use each number only once; do NOT repeat the same citation; do NOT group citations "
                "at the end; do NOT write a Sources/References section; do NOT write bare numbers like [1] "
                "without the (URL) part — every citation must be a clickable markdown link."
            )
        if enable_local_files and allowed_folders:
            folders_str = ", ".join(allowed_folders)
            prompt += (
                "\n\n[Local file access]\n"
                "You have access to list_directory and read_file tools that can list and read files "
                "on the user's local file system. You can ONLY access files within these allowed folders: "
                f"{folders_str}. "
                "Use list_directory to explore folder contents before reading specific files. "
                "You have READ-ONLY access — you cannot create, modify, or delete any files."
            )
            if model_service.supports_vision:
                prompt += (
                    " You also have a view_image tool that lets you see and describe image files "
                    "(PNG, JPG, GIF, BMP, WEBP). When the user asks about photos or images in their "
                    "files, use view_image to look at them."
                )
        if custom_instructions.strip():
            prompt += f"\n\n[User's custom instructions]\n{custom_instructions.strip()}"
        return prompt

    def _build_messages(
        self,
        conversation: Conversation,
        locale: str = "en-US",
        custom_instructions: str = "",
        enable_web_access: bool = False,
        enable_local_files: bool = False,
        allowed_folders: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self._build_system_prompt(
                locale, custom_instructions, enable_web_access, enable_local_files, allowed_folders,
            )}
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
                user_text = message.content.strip()
                header = f"[Arquivo: {message.attachment_name}]\n\n{file_content}"
                prompt = f"{header}\n\n{user_text}" if user_text else header
                messages.append({"role": "user", "content": prompt})
                continue

            # Document attachments (PDF, DOCX, XLSX, PPTX): extract and inject
            if (
                message.role == "user"
                and message.attachment_path
                and message.input_type == "document"
            ):
                doc_content = self._read_document_file(message.attachment_path)
                user_text = message.content.strip()
                header = f"[Documento: {message.attachment_name}]\n\n{doc_content}"
                prompt = f"{header}\n\n{user_text}" if user_text else header
                messages.append({"role": "user", "content": prompt})
                continue

            # Multi-file attachments: read all files and combine
            if (
                message.role == "user"
                and message.attachment_path
                and message.input_type == "multi_file"
            ):
                try:
                    names = json.loads(message.attachment_name or "[]")
                    paths = json.loads(message.attachment_path)
                except (json.JSONDecodeError, TypeError):
                    names, paths = [], []

                has_images = any(Path(p).suffix.lower() in self._IMAGE_EXTS for p in paths)

                if has_images and model_service.supports_vision:
                    content_parts: list[dict[str, Any]] = []
                    pending_text: list[str] = []
                    for i, (name, path) in enumerate(zip(names, paths), 1):
                        if Path(path).suffix.lower() in self._IMAGE_EXTS:
                            if pending_text:
                                content_parts.append({"type": "text", "text": "\n\n".join(pending_text)})
                                pending_text = []
                            try:
                                data_url = input_adapter_service.load_image_base64(path)
                                content_parts.append({"type": "image_url", "image_url": {"url": data_url}})
                                content_parts.append({"type": "text", "text": f"[Arquivo {i}: {name}]"})
                            except Exception:
                                pending_text.append(f"[Arquivo {i}: {name}]\n\n(Erro ao carregar imagem)")
                        else:
                            file_content = self._read_any_file(path)
                            pending_text.append(f"[Arquivo {i}: {name}]\n\n{file_content}")
                    if pending_text:
                        content_parts.append({"type": "text", "text": "\n\n".join(pending_text)})
                    user_text = message.content.strip()
                    if user_text:
                        content_parts.append({"type": "text", "text": user_text})
                    messages.append({"role": "user", "content": content_parts})
                else:
                    prompt = self._build_multi_file_prompt(
                        message.attachment_name or "[]",
                        message.attachment_path,
                        message.content,
                    )
                    messages.append({"role": "user", "content": prompt})
                continue

            # Audio and plain text — use stored transcript / content
            messages.append({"role": message.role, "content": message.content})

        return self._trim_messages_to_budget(messages)

    # ── Token budget management ──────────────────────────────────

    _GENERATION_RESERVE = 4096  # tokens reserved for the model's response

    def _estimate_message_tokens(self, messages: list[dict[str, Any]]) -> int:
        total = 0
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                total += model_service.estimate_tokens(content)
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict):
                        text = part.get("text", "")
                        if text:
                            total += model_service.estimate_tokens(text)
                        if "image_url" in part:
                            total += 512  # rough estimate for image tokens
        return total

    def _trim_messages_to_budget(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Truncate content and apply sliding window if tokens exceed budget."""
        context_size = model_service.context_size
        budget = context_size - self._GENERATION_RESERVE
        if budget <= 0:
            return messages

        total = self._estimate_message_tokens(messages)
        if total <= budget:
            return messages

        overflow = total - budget

        # Step 1: Try truncating the last large user message (file content)
        for i in range(len(messages) - 1, -1, -1):
            msg = messages[i]
            if msg.get("role") != "user" or not isinstance(msg.get("content"), str):
                continue
            content = msg["content"]
            content_tokens = model_service.estimate_tokens(content)
            if content_tokens < 200:
                continue
            chars_to_remove = overflow * 4
            if chars_to_remove >= len(content) - 200:
                chars_to_remove = len(content) - 200
            if chars_to_remove > 0:
                truncated = content[: len(content) - chars_to_remove]
                msg["content"] = truncated + "\n\n[...conteúdo truncado para caber no contexto do modelo]"
                logger.info(
                    "Conteúdo truncado: removidos ~%d tokens (overflow=%d, contexto=%d)",
                    overflow, overflow, context_size,
                )
            break

        # Re-check after truncation
        total = self._estimate_message_tokens(messages)
        if total <= budget:
            return messages

        # Step 2: Sliding window — keep system prompt + most recent messages
        if len(messages) <= 2:
            return messages

        system_msgs = [m for m in messages if m.get("role") == "system"]
        non_system = [m for m in messages if m.get("role") != "system"]

        # Drop oldest non-system messages until within budget
        while len(non_system) > 1:
            dropped = non_system.pop(0)
            result = system_msgs + non_system
            total = self._estimate_message_tokens(result)
            if total <= budget:
                logger.info(
                    "Sliding window: removida mensagem antiga (%s), %d mensagens restantes",
                    dropped.get("role"), len(result),
                )
                return result

        logger.warning("Após sliding window, mensagens ainda excedem orçamento de tokens.")
        return system_msgs + non_system

    def _get_tools(
        self,
        enable_web_access: bool,
        enable_local_files: bool = False,
        allowed_folders: list[str] | None = None,
    ) -> list[dict[str, Any]] | None:
        """Return tool definitions if any tools are enabled."""
        tools: list[dict[str, Any]] = []
        if enable_web_access:
            tools.append(FETCH_URL_TOOL)
            tools.append(WEB_SEARCH_TOOL)
        if enable_local_files and allowed_folders:
            tools.extend([LIST_DIRECTORY_TOOL, READ_FILE_TOOL])
            if model_service.supports_vision:
                tools.append(VIEW_IMAGE_TOOL)
        return tools or None

    def _make_tool_executor(
        self,
        enable_web_access: bool,
        enable_local_files: bool = False,
        allowed_folders: list[str] | None = None,
    ):
        """Build a combined tool executor callback."""
        if not enable_web_access and not (enable_local_files and allowed_folders):
            return None
        folders = allowed_folders or []

        def executor(name: str, arguments: dict) -> str | dict:
            if name in ("fetch_url", "web_search"):
                return execute_tool_call(name, arguments)
            if name in ("list_directory", "read_file", "view_image"):
                return execute_filesystem_tool(name, arguments, folders)
            return f"Error: unknown tool '{name}'."

        return executor

    def handle_text_message(
        self,
        db: Session,
        conversation_id: str | None,
        text: str,
        enable_thinking: bool,
        locale: str = "en-US",
        custom_instructions: str = "",
        enable_web_access: bool = False,
        enable_local_files: bool = False,
        allowed_folders: list[str] | None = None,
    ) -> tuple[Conversation, Message]:
        conversation = self._ensure_conversation(db, conversation_id, text)
        storage_service.append_message(db, conversation.id, "user", text, input_type="text", model_key=model_service.active_model_key)
        conversation = storage_service.get_conversation(db, conversation.id)
        tools = self._get_tools(enable_web_access, enable_local_files, allowed_folders)
        tool_executor = self._make_tool_executor(enable_web_access, enable_local_files, allowed_folders)
        reply_text = model_service.generate_reply(
            self._build_messages(conversation, locale, custom_instructions, enable_web_access, enable_local_files, allowed_folders),
            enable_thinking,
            tools=tools,
            tool_executor=tool_executor,
        )
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
        custom_instructions: str = "",
        enable_web_access: bool = False,
        enable_local_files: bool = False,
        allowed_folders: list[str] | None = None,
    ) -> tuple[Conversation, object]:
        conversation = self._ensure_conversation(db, conversation_id, text)
        storage_service.append_message(db, conversation.id, "user", text, input_type="text", model_key=model_service.active_model_key)
        conversation = storage_service.get_conversation(db, conversation.id)
        tools = self._get_tools(enable_web_access, enable_local_files, allowed_folders)
        tool_executor = self._make_tool_executor(enable_web_access, enable_local_files, allowed_folders)
        stream = model_service.generate_reply_stream(
            self._build_messages(conversation, locale, custom_instructions, enable_web_access, enable_local_files, allowed_folders),
            enable_thinking,
            tools=tools,
            tool_executor=tool_executor,
        )
        return conversation, stream

    def finalize_streamed_reply(self, db: Session, conversation_id: str, content: str, tool_calls: list[dict] | None = None) -> tuple[Conversation, Message]:
        import json as _json
        tc_json = _json.dumps(tool_calls, ensure_ascii=False) if tool_calls else None
        reply = storage_service.append_message(db, conversation_id, "assistant", content, input_type="text", model_key=model_service.active_model_key, tool_calls_json=tc_json)
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
        custom_instructions: str = "",
        enable_web_access: bool = False,
        enable_local_files: bool = False,
        allowed_folders: list[str] | None = None,
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
        tools = self._get_tools(enable_web_access, enable_local_files, allowed_folders)
        tool_executor = self._make_tool_executor(enable_web_access, enable_local_files, allowed_folders)
        reply_text = model_service.generate_reply(
            self._build_messages(conversation, locale, custom_instructions, enable_web_access, enable_local_files, allowed_folders),
            enable_thinking,
            tools=tools,
            tool_executor=tool_executor,
        )
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
        custom_instructions: str = "",
        enable_web_access: bool = False,
        enable_local_files: bool = False,
        allowed_folders: list[str] | None = None,
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
        assert conversation is not None
        tools = self._get_tools(enable_web_access, enable_local_files, allowed_folders)
        tool_executor = self._make_tool_executor(enable_web_access, enable_local_files, allowed_folders)
        stream = model_service.generate_reply_stream(
            self._build_messages(conversation, locale, custom_instructions, enable_web_access, enable_local_files, allowed_folders),
            enable_thinking,
            tools=tools,
            tool_executor=tool_executor,
        )
        return conversation, stream


chat_service = ChatService()
