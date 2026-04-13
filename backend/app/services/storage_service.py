from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.models import Conversation, Message
from app.schemas import DeleteConversationResponse


class StorageService:
    def __init__(self) -> None:
        self._settings = get_settings()

    def search_conversations(self, db: Session, query: str) -> list[dict]:
        """Search conversations by title and message content.
        Returns title matches first, then content-only matches."""
        term = f"%{query}%"
        # Title matches
        title_stmt = (
            self._conversation_statement()
            .where(Conversation.title.ilike(term))
            .order_by(Conversation.updated_at.desc())
        )
        title_results = list(db.scalars(title_stmt).unique())
        title_ids = {c.id for c in title_results}

        # Content matches (excluding already-matched-by-title).
        # Explicit JOIN avoids an implicit multi-FROM query and duplicate rows.
        content_stmt = (
            self._conversation_statement()
            .join(Message, Message.conversation_id == Conversation.id)
            .where(Message.content.ilike(term))
            .order_by(Conversation.updated_at.desc())
            .distinct()
        )
        if title_ids:
            content_stmt = content_stmt.where(Conversation.id.notin_(title_ids))
        content_results = list(db.scalars(content_stmt).unique())

        results: list[dict] = []
        for conv in title_results:
            results.append({"conversation": conv, "match_type": "title"})
        for conv in content_results:
            results.append({"conversation": conv, "match_type": "content"})
        return results

    def _conversation_statement(self):
        return select(Conversation).options(selectinload(Conversation.messages))

    def list_conversations(self, db: Session) -> list[Conversation]:
        statement = self._conversation_statement().order_by(Conversation.updated_at.desc())
        return list(db.scalars(statement).unique())

    def create_conversation(self, db: Session, title: str) -> Conversation:
        conversation = Conversation(id=str(uuid4()), title=title)
        db.add(conversation)
        db.commit()
        db.refresh(conversation)
        return conversation

    def get_conversation(self, db: Session, conversation_id: str) -> Conversation | None:
        statement = self._conversation_statement().where(Conversation.id == conversation_id)
        return db.scalars(statement).first()

    def rename_conversation(self, db: Session, conversation_id: str, title: str) -> Conversation | None:
        conversation = self.get_conversation(db, conversation_id)
        if conversation is None:
            return None
        conversation.title = title
        db.commit()
        db.refresh(conversation)
        return conversation

    def append_message(
        self,
        db: Session,
        conversation_id: str,
        role: str,
        content: str,
        input_type: str = "text",
        model_key: str | None = None,
        attachment_name: str | None = None,
        attachment_path: str | None = None,
        tool_calls_json: str | None = None,
        custom_instructions_snapshot: str | None = None,
        custom_instructions_risk_score: int | None = None,
    ) -> Message:
        message = Message(
            id=str(uuid4()),
            conversation_id=conversation_id,
            role=role,
            content=content,
            input_type=input_type,
            model_key=model_key,
            attachment_name=attachment_name,
            attachment_path=attachment_path,
            tool_calls_json=tool_calls_json,
            custom_instructions_snapshot=custom_instructions_snapshot,
            custom_instructions_risk_score=custom_instructions_risk_score,
        )
        db.add(message)
        conv = db.get(Conversation, conversation_id)
        if conv is not None:
            conv.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(message)
        return message

    def touch_conversation(self, db: Session, conversation_id: str) -> None:
        conversation = self.get_conversation(db, conversation_id)
        if conversation is None:
            return
        conversation.updated_at = conversation.updated_at
        db.commit()

    def delete_message(self, db: Session, message_id: str) -> bool:
        msg = db.get(Message, message_id)
        if msg is None:
            return False
        db.delete(msg)
        db.commit()
        return True

    def update_message_content(self, db: Session, message_id: str, content: str) -> Message | None:
        msg = db.get(Message, message_id)
        if msg is None:
            return None
        msg.content = content
        db.commit()
        db.refresh(msg)
        return msg

    def save_upload(self, file_name: str, content: bytes) -> Path:
        safe_name = f"{uuid4()}-{file_name}"
        target = self._settings.resolved_upload_dir / safe_name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        return target

    def _safe_attachment_paths(self, conversation: Conversation) -> set[Path]:
        safe_paths: set[Path] = set()
        uploads_root = self._settings.resolved_upload_dir.resolve()

        for message in conversation.messages:
            if not message.attachment_path:
                continue

            candidate = Path(message.attachment_path).resolve()
            try:
                candidate.relative_to(uploads_root)
            except ValueError:
                continue
            safe_paths.add(candidate)

        return safe_paths

    def _delete_files(self, file_paths: set[Path]) -> int:
        deleted_files = 0
        for file_path in file_paths:
            try:
                if file_path.exists() and file_path.is_file():
                    file_path.unlink()
                    deleted_files += 1
            except OSError:
                continue
        return deleted_files

    def delete_conversation(self, db: Session, conversation_id: str) -> DeleteConversationResponse | None:
        conversation = self.get_conversation(db, conversation_id)
        if conversation is None:
            return None

        attachment_paths = self._safe_attachment_paths(conversation)
        deleted_messages = len(conversation.messages)

        db.delete(conversation)
        db.commit()

        deleted_files = self._delete_files(attachment_paths)
        return DeleteConversationResponse(
            deleted_conversations=1,
            deleted_messages=deleted_messages,
            deleted_files=deleted_files,
        )

    def delete_all_conversations(self, db: Session) -> DeleteConversationResponse:
        conversations = self.list_conversations(db)
        attachment_paths: set[Path] = set()
        deleted_messages = 0

        for conversation in conversations:
            attachment_paths.update(self._safe_attachment_paths(conversation))
            deleted_messages += len(conversation.messages)
            db.delete(conversation)

        db.commit()

        deleted_files = self._delete_files(attachment_paths)
        return DeleteConversationResponse(
            deleted_conversations=len(conversations),
            deleted_messages=deleted_messages,
            deleted_files=deleted_files,
        )


storage_service = StorageService()
