import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import ChatRequest, ChatResponse, RiskEvaluationRequest, RiskEvaluationResponse
from app.services.chat_service import chat_service
from app.services.document_service import extract_text as extract_document_text
from app.services.input_adapter_service import input_adapter_service
from app.services.model_service import model_service
from app.services.storage_service import storage_service
from app.core.config import get_settings


router = APIRouter(prefix="/chat", tags=["chat"])


def _estimate_content_tokens(kind: str, file_path: str, raw_bytes: bytes) -> int:
    """Estimate tokens from the *actual* content that will be sent to the model."""
    if kind == "image":
        return 512
    if kind == "audio":
        return 200
    # Extract real text content, then count tokens
    if kind == "document":
        text = extract_document_text(file_path, sys.maxsize)
    else:
        text = raw_bytes.decode("utf-8", errors="ignore")
    return model_service.estimate_tokens(text)


def _check_upload_budget(total_tokens: int) -> None:
    """Raise 413 if estimated tokens exceed 90% of context budget."""
    ctx = model_service.context_size
    budget = int(ctx * 0.9)
    if total_tokens > budget:
        raise HTTPException(
            status_code=413,
            detail=(
                f"O conteúdo enviado é grande demais para o modelo atual "
                f"(~{total_tokens:,} tokens estimados, limite: ~{budget:,} tokens). "
                f"Envie um arquivo menor ou use um modelo com janela de contexto maior."
            ),
        )


def _local_iso(dt: datetime) -> str:
    """Convert a naive UTC datetime (from SQLite) to a local-time ISO string with offset."""
    utc_dt = dt.replace(tzinfo=timezone.utc)
    return utc_dt.astimezone().isoformat()


def _event_line(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


def _iter_stream(stream, chunks: list[str], tool_calls_out: list[dict]):
    """Iterate a model stream, yielding NDJSON event lines for deltas and tool events.

    tool_calls_out is populated as a side-effect so callers can include the
    accumulated list in the ``done`` event.
    """
    for chunk in stream:
        if isinstance(chunk, dict):
            if chunk.get("type") == "tool_start":
                tool_calls_out.append({"name": chunk["name"], "arguments": chunk["arguments"], "done": False})
            elif chunk.get("type") == "tool_done":
                for tc in tool_calls_out:
                    if tc["name"] == chunk["name"] and not tc["done"]:
                        tc["done"] = True
                        break
            yield _event_line(chunk)
        else:
            chunks.append(chunk)
            yield _event_line({"type": "delta", "delta": chunk})


def _serialize_conversation(current_conversation) -> dict:
    follow_ups = []
    if current_conversation.follow_ups_json:
        try:
            follow_ups = json.loads(current_conversation.follow_ups_json)
        except (json.JSONDecodeError, TypeError):
            pass
    return {
        "id": current_conversation.id,
        "title": current_conversation.title,
        "created_at": _local_iso(current_conversation.created_at),
        "updated_at": _local_iso(current_conversation.updated_at),
        "follow_ups": follow_ups,
        "messages": [
            {
                "id": message.id,
                "role": message.role,
                "content": message.content,
                "input_type": message.input_type,
                "model_key": message.model_key,
                "attachment_name": message.attachment_name,
                "attachment_path": message.attachment_path,
                "tool_calls": json.loads(message.tool_calls_json) if message.tool_calls_json else None,
                "custom_instructions_snapshot": message.custom_instructions_snapshot,
                "custom_instructions_risk_score": message.custom_instructions_risk_score,
                "created_at": _local_iso(message.created_at),
            }
            for message in current_conversation.messages
        ],
    }


def _serialize_message(message) -> dict:
    return {
        "id": message.id,
        "role": message.role,
        "content": message.content,
        "input_type": message.input_type,
        "model_key": message.model_key,
        "attachment_name": message.attachment_name,
        "attachment_path": message.attachment_path,
        "tool_calls": json.loads(message.tool_calls_json) if message.tool_calls_json else None,
        "custom_instructions_snapshot": message.custom_instructions_snapshot,
        "custom_instructions_risk_score": message.custom_instructions_risk_score,
        "created_at": _local_iso(message.created_at),
    }


@router.post("/evaluate-risk", response_model=RiskEvaluationResponse)
async def evaluate_risk(payload: RiskEvaluationRequest) -> RiskEvaluationResponse:
    score = chat_service.evaluate_custom_instructions_risk(payload.custom_instructions)
    return RiskEvaluationResponse(risk_score=score)


@router.get("/search")
async def search_conversations(q: str = "", db: Session = Depends(get_db)):
    if not q.strip():
        return []
    results = storage_service.search_conversations(db, q.strip())
    return [
        {
            "conversation": _serialize_conversation(r["conversation"]),
            "match_type": r["match_type"],
        }
        for r in results
    ]


@router.post("", response_model=ChatResponse)
async def send_text_message(payload: ChatRequest, db: Session = Depends(get_db)) -> ChatResponse:
    conversation, reply = chat_service.handle_text_message(
        db=db,
        conversation_id=payload.conversation_id,
        text=payload.message,
        enable_thinking=payload.enable_thinking,
        locale=payload.locale,
        custom_instructions=payload.custom_instructions,
        enable_web_access=payload.enable_web_access,
        enable_local_files=payload.enable_local_files,
        allowed_folders=payload.allowed_folders,
        user_location=payload.user_location,
    )
    return ChatResponse(conversation=conversation, reply=reply, model_loaded=chat_service.model_loaded)


@router.post("/stream")
async def stream_text_message(payload: ChatRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    conversation, stream = chat_service.prepare_text_stream(
        db=db,
        conversation_id=payload.conversation_id,
        text=payload.message,
        enable_thinking=payload.enable_thinking,
        locale=payload.locale,
        custom_instructions=payload.custom_instructions,
        enable_web_access=payload.enable_web_access,
        enable_local_files=payload.enable_local_files,
        allowed_folders=payload.allowed_folders,
        user_location=payload.user_location,
    )

    def event_stream():
        yield _event_line({"type": "conversation", "conversation": _serialize_conversation(conversation)})

        chunks: list[str] = []
        tool_calls_out: list[dict] = []
        try:
            yield from _iter_stream(stream, chunks, tool_calls_out)
        except GeneratorExit:
            return

        final_text = "".join(chunks).strip()
        final_conversation, reply = chat_service.finalize_streamed_reply(db, conversation.id, final_text, tool_calls=tool_calls_out, custom_instructions=payload.custom_instructions)

        user_msgs = [m for m in final_conversation.messages if m.role == "user"]
        is_first = len(user_msgs) == 1
        updated, follow_ups = chat_service.generate_metadata(
            db, final_conversation.id, final_text, is_first_message=is_first, locale=payload.locale,
        )
        if updated is not None:
            final_conversation = updated

        yield _event_line(
            {
                "type": "done",
                "conversation": _serialize_conversation(final_conversation),
                "reply": _serialize_message(reply),
                "model_loaded": chat_service.model_loaded,
                "tool_calls": tool_calls_out,
                "follow_ups": follow_ups,
            }
        )

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/upload", response_model=ChatResponse)
async def send_upload_message(
    message: str = Form(default=""),
    conversation_id: str | None = Form(default=None),
    enable_thinking: bool = Form(default=False),
    locale: str = Form(default="en-US"),
    custom_instructions: str = Form(default=""),
    enable_web_access: bool = Form(default=False),
    enable_local_files: bool = Form(default=False),
    allowed_folders: str = Form(default=""),
    user_location: str | None = Form(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ChatResponse:
    try:
        parsed_folders = json.loads(allowed_folders) if allowed_folders else []
        if not isinstance(parsed_folders, list) or not all(isinstance(f, str) for f in parsed_folders):
            raise ValueError
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="allowed_folders inválido.")
    normalized = await input_adapter_service.normalize_upload(file)
    if normalized.kind == "unsupported":
        raise HTTPException(status_code=400, detail=normalized.summary)

    saved_path = storage_service.save_upload(file_name=normalized.file_name, content=normalized.raw_bytes)
    _check_upload_budget(_estimate_content_tokens(normalized.kind, saved_path, normalized.raw_bytes))

    conversation, reply = chat_service.handle_file_message(
        db=db,
        conversation_id=conversation_id,
        text=message,
        input_type=normalized.kind,
        attachment_name=normalized.file_name,
        attachment_path=str(Path(saved_path)),
        attachment_summary=normalized.summary,
        enable_thinking=enable_thinking,
        locale=locale,
        custom_instructions=custom_instructions,
        enable_web_access=enable_web_access,
        enable_local_files=enable_local_files,
        allowed_folders=parsed_folders,
        user_location=user_location,
    )
    return ChatResponse(conversation=conversation, reply=reply, model_loaded=chat_service.model_loaded)


@router.post("/upload/stream")
async def stream_upload_message(
    message: str = Form(default=""),
    conversation_id: str | None = Form(default=None),
    enable_thinking: bool = Form(default=False),
    locale: str = Form(default="en-US"),
    custom_instructions: str = Form(default=""),
    enable_web_access: bool = Form(default=False),
    enable_local_files: bool = Form(default=False),
    allowed_folders: str = Form(default=""),
    user_location: str | None = Form(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    try:
        parsed_folders = json.loads(allowed_folders) if allowed_folders else []
        if not isinstance(parsed_folders, list) or not all(isinstance(f, str) for f in parsed_folders):
            raise ValueError
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="allowed_folders inválido.")
    normalized = await input_adapter_service.normalize_upload(file)
    if normalized.kind == "unsupported":
        raise HTTPException(status_code=400, detail=normalized.summary)

    saved_path = storage_service.save_upload(file_name=normalized.file_name, content=normalized.raw_bytes)
    _check_upload_budget(_estimate_content_tokens(normalized.kind, saved_path, normalized.raw_bytes))

    conversation, stream = chat_service.prepare_file_stream(
        db=db,
        conversation_id=conversation_id,
        text=message,
        input_type=normalized.kind,
        attachment_name=normalized.file_name,
        attachment_path=str(Path(saved_path)),
        attachment_summary=normalized.summary,
        enable_thinking=enable_thinking,
        locale=locale,
        custom_instructions=custom_instructions,
        enable_web_access=enable_web_access,
        enable_local_files=enable_local_files,
        allowed_folders=parsed_folders,
        user_location=user_location,
    )

    def event_stream():
        yield _event_line({"type": "conversation", "conversation": _serialize_conversation(conversation)})

        chunks: list[str] = []
        tool_calls_out: list[dict] = []
        try:
            yield from _iter_stream(stream, chunks, tool_calls_out)
        except GeneratorExit:
            return

        final_text = "".join(chunks).strip()
        final_conversation, reply = chat_service.finalize_streamed_reply(db, conversation.id, final_text, tool_calls=tool_calls_out, custom_instructions=custom_instructions)

        user_msgs = [m for m in final_conversation.messages if m.role == "user"]
        is_first = len(user_msgs) == 1
        updated, follow_ups = chat_service.generate_metadata(
            db, final_conversation.id, final_text, is_first_message=is_first, locale=locale,
        )
        if updated is not None:
            final_conversation = updated

        yield _event_line(
            {
                "type": "done",
                "conversation": _serialize_conversation(final_conversation),
                "reply": _serialize_message(reply),
                "model_loaded": chat_service.model_loaded,
                "tool_calls": tool_calls_out,
                "follow_ups": follow_ups,
            }
        )

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/upload/multi/stream")
async def stream_multi_upload_message(
    message: str = Form(default=""),
    conversation_id: str | None = Form(default=None),
    enable_thinking: bool = Form(default=False),
    locale: str = Form(default="en-US"),
    custom_instructions: str = Form(default=""),
    enable_web_access: bool = Form(default=False),
    enable_local_files: bool = Form(default=False),
    allowed_folders: str = Form(default=""),
    user_location: str | None = Form(default=None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    try:
        parsed_folders = json.loads(allowed_folders) if allowed_folders else []
        if not isinstance(parsed_folders, list) or not all(isinstance(f, str) for f in parsed_folders):
            raise ValueError
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="allowed_folders inválido.")
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo enviado.")

    file_infos: list[dict] = []
    normalized_files = []
    for upload in files:
        normalized = await input_adapter_service.normalize_upload(upload)
        if normalized.kind == "unsupported":
            raise HTTPException(status_code=400, detail=f"Arquivo não suportado: {normalized.file_name}")
        normalized_files.append(normalized)

    # Save all files first, then estimate tokens on actual extracted content
    total_tokens = 0
    for normalized in normalized_files:
        saved_path = storage_service.save_upload(file_name=normalized.file_name, content=normalized.raw_bytes)
        total_tokens += _estimate_content_tokens(normalized.kind, saved_path, normalized.raw_bytes)
        file_infos.append({
            "name": normalized.file_name,
            "path": str(Path(saved_path)),
            "kind": normalized.kind,
            "summary": normalized.summary,
        })
    _check_upload_budget(total_tokens)

    names_json = json.dumps([f["name"] for f in file_infos], ensure_ascii=False)
    paths_json = json.dumps([f["path"] for f in file_infos], ensure_ascii=False)
    summaries = "; ".join(f["summary"] for f in file_infos)

    conversation, stream = chat_service.prepare_file_stream(
        db=db,
        conversation_id=conversation_id,
        text=message,
        input_type="multi_file",
        attachment_name=names_json,
        attachment_path=paths_json,
        attachment_summary=summaries,
        enable_thinking=enable_thinking,
        locale=locale,
        custom_instructions=custom_instructions,
        enable_web_access=enable_web_access,
        enable_local_files=enable_local_files,
        allowed_folders=parsed_folders,
        user_location=user_location,
    )

    def event_stream():
        yield _event_line({"type": "conversation", "conversation": _serialize_conversation(conversation)})

        chunks: list[str] = []
        tool_calls_out: list[dict] = []
        try:
            yield from _iter_stream(stream, chunks, tool_calls_out)
        except GeneratorExit:
            return

        final_text = "".join(chunks).strip()
        final_conversation, reply = chat_service.finalize_streamed_reply(db, conversation.id, final_text, tool_calls=tool_calls_out, custom_instructions=custom_instructions)

        user_msgs = [m for m in final_conversation.messages if m.role == "user"]
        is_first = len(user_msgs) == 1
        updated, follow_ups = chat_service.generate_metadata(
            db, final_conversation.id, final_text, is_first_message=is_first, locale=locale,
        )
        if updated is not None:
            final_conversation = updated

        yield _event_line(
            {
                "type": "done",
                "conversation": _serialize_conversation(final_conversation),
                "reply": _serialize_message(reply),
                "model_loaded": chat_service.model_loaded,
                "tool_calls": tool_calls_out,
                "follow_ups": follow_ups,
            }
        )

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


# ──────────────────────────────────────────────
# File actions (local app only)
# ──────────────────────────────────────────────

class FileActionRequest(BaseModel):
    path: str

class SavePartialRequest(BaseModel):
    text: str


@router.post("/{conversation_id}/save-partial")
async def save_partial(
    conversation_id: str,
    payload: SavePartialRequest,
    db: Session = Depends(get_db),
):
    conversation = storage_service.get_conversation(db, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversa não encontrada")
    if not payload.text.strip():
        return {"ok": True}
    chat_service.finalize_streamed_reply(db, conversation_id, payload.text.strip())
    return {"ok": True}


def _get_settings():
    return get_settings()


@router.post("/file/open")
async def open_file(payload: FileActionRequest):
    settings = _get_settings()
    uploads_root = Path(settings.resolved_upload_dir).resolve()
    target = Path(payload.path).resolve()
    try:
        target.relative_to(uploads_root)
    except ValueError:
        raise HTTPException(status_code=403, detail="Acesso negado")
    if not target.exists():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    if sys.platform == "win32":
        os.startfile(str(target))
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(target)])
    else:
        subprocess.Popen(["xdg-open", str(target)])
    return {"ok": True}


@router.post("/file/reveal")
async def reveal_file(payload: FileActionRequest):
    settings = _get_settings()
    uploads_root = Path(settings.resolved_upload_dir).resolve()
    target = Path(payload.path).resolve()
    try:
        target.relative_to(uploads_root)
    except ValueError:
        raise HTTPException(status_code=403, detail="Acesso negado")
    if not target.exists():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    if sys.platform == "win32":
        subprocess.Popen(["explorer", "/select,", str(target)])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(target)])
    else:
        subprocess.Popen(["xdg-open", str(target.parent)])
    return {"ok": True}


# ──────────────────────────────────────────────
# Edit last message & Regenerate
# ──────────────────────────────────────────────

class EditLastRequest(BaseModel):
    message: str
    locale: str = "en-US"
    custom_instructions: str = ""
    enable_web_access: bool = False
    enable_local_files: bool = False
    allowed_folders: list[str] = Field(default_factory=list)
    user_location: str | None = None


@router.post("/{conversation_id}/edit-last/stream")
async def edit_last_message_stream(
    conversation_id: str,
    payload: EditLastRequest,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    conversation = storage_service.get_conversation(db, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversa não encontrada")

    user_messages = [m for m in conversation.messages if m.role == "user"]
    if not user_messages:
        raise HTTPException(status_code=400, detail="Nenhuma mensagem de usuário encontrada")
    last_user = user_messages[-1]

    msgs_after = [m for m in conversation.messages if m.created_at > last_user.created_at and m.role == "assistant"]
    for m in msgs_after:
        storage_service.delete_message(db, m.id)

    storage_service.update_message_content(db, last_user.id, payload.message)
    storage_service.clear_follow_ups(db, conversation_id)

    conversation = storage_service.get_conversation(db, conversation_id)
    tools = chat_service._get_tools(payload.enable_web_access, payload.enable_local_files, payload.allowed_folders)
    tool_executor = chat_service._make_tool_executor(payload.enable_web_access, payload.enable_local_files, payload.allowed_folders)
    stream = model_service.generate_reply_stream(
        chat_service._build_messages(
            conversation, locale=payload.locale, custom_instructions=payload.custom_instructions,
            enable_web_access=payload.enable_web_access, enable_local_files=payload.enable_local_files,
            allowed_folders=payload.allowed_folders, user_location=payload.user_location,
        ),
        enable_thinking=False,
        tools=tools,
        tool_executor=tool_executor,
    )

    def event_stream():
        yield _event_line({"type": "conversation", "conversation": _serialize_conversation(conversation)})
        chunks: list[str] = []
        tool_calls_out: list[dict] = []
        try:
            yield from _iter_stream(stream, chunks, tool_calls_out)
        except GeneratorExit:
            return
        final_text = "".join(chunks).strip()
        final_conversation, reply = chat_service.finalize_streamed_reply(db, conversation.id, final_text, tool_calls=tool_calls_out, custom_instructions=payload.custom_instructions)

        updated, follow_ups = chat_service.generate_metadata(
            db, final_conversation.id, final_text, is_first_message=False, locale=payload.locale,
        )
        if updated is not None:
            final_conversation = updated

        yield _event_line({
            "type": "done",
            "conversation": _serialize_conversation(final_conversation),
            "reply": _serialize_message(reply),
            "model_loaded": chat_service.model_loaded,
            "tool_calls": tool_calls_out,
            "follow_ups": follow_ups,
        })

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


class RegenerateRequest(BaseModel):
    locale: str = "en-US"
    custom_instructions: str = ""
    enable_web_access: bool = False
    enable_local_files: bool = False
    allowed_folders: list[str] = Field(default_factory=list)
    user_location: str | None = None


@router.post("/{conversation_id}/regenerate/stream")
async def regenerate_last_stream(
    conversation_id: str,
    payload: RegenerateRequest = RegenerateRequest(),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    conversation = storage_service.get_conversation(db, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversa não encontrada")

    assistant_messages = [m for m in conversation.messages if m.role == "assistant"]
    if not assistant_messages:
        raise HTTPException(status_code=400, detail="Nenhuma resposta para regenerar")
    last_assistant = assistant_messages[-1]
    storage_service.delete_message(db, last_assistant.id)
    storage_service.clear_follow_ups(db, conversation_id)

    conversation = storage_service.get_conversation(db, conversation_id)
    tools = chat_service._get_tools(payload.enable_web_access, payload.enable_local_files, payload.allowed_folders)
    tool_executor = chat_service._make_tool_executor(payload.enable_web_access, payload.enable_local_files, payload.allowed_folders)
    stream = model_service.generate_reply_stream(
        chat_service._build_messages(
            conversation, locale=payload.locale, custom_instructions=payload.custom_instructions,
            enable_web_access=payload.enable_web_access, enable_local_files=payload.enable_local_files,
            allowed_folders=payload.allowed_folders, user_location=payload.user_location,
        ),
        enable_thinking=False,
        tools=tools,
        tool_executor=tool_executor,
    )

    def event_stream():
        yield _event_line({"type": "conversation", "conversation": _serialize_conversation(conversation)})
        chunks: list[str] = []
        tool_calls_out: list[dict] = []
        try:
            yield from _iter_stream(stream, chunks, tool_calls_out)
        except GeneratorExit:
            return
        final_text = "".join(chunks).strip()
        final_conversation, reply = chat_service.finalize_streamed_reply(db, conversation.id, final_text, tool_calls=tool_calls_out, custom_instructions=payload.custom_instructions)

        updated, follow_ups = chat_service.generate_metadata(
            db, final_conversation.id, final_text, is_first_message=False, locale=payload.locale,
        )
        if updated is not None:
            final_conversation = updated

        yield _event_line({
            "type": "done",
            "conversation": _serialize_conversation(final_conversation),
            "reply": _serialize_message(reply),
            "model_loaded": chat_service.model_loaded,
            "tool_calls": tool_calls_out,
            "follow_ups": follow_ups,
        })

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")
