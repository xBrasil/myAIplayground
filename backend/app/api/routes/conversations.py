from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import (
    ConversationCreate,
    ConversationRead,
    ConversationRename,
    DeleteAllConversationsRequest,
    DeleteConversationResponse,
)
from app.services.storage_service import storage_service


router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.get("", response_model=list[ConversationRead])
def list_conversations(db: Session = Depends(get_db)) -> list[ConversationRead]:
    return storage_service.list_conversations(db)


@router.post("", response_model=ConversationRead)
def create_conversation(payload: ConversationCreate, db: Session = Depends(get_db)) -> ConversationRead:
    return storage_service.create_conversation(db, payload.title)


@router.get("/{conversation_id}", response_model=ConversationRead)
def get_conversation(conversation_id: str, db: Session = Depends(get_db)) -> ConversationRead:
    conversation = storage_service.get_conversation(db, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.patch("/{conversation_id}", response_model=ConversationRead)
def rename_conversation(
    conversation_id: str,
    payload: ConversationRename,
    db: Session = Depends(get_db),
) -> ConversationRead:
    conversation = storage_service.rename_conversation(db, conversation_id, payload.title)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.delete("/{conversation_id}", response_model=DeleteConversationResponse)
def delete_conversation(conversation_id: str, db: Session = Depends(get_db)) -> DeleteConversationResponse:
    deleted = storage_service.delete_conversation(db, conversation_id)
    if deleted is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return deleted


@router.post("/delete-all", response_model=DeleteConversationResponse)
def delete_all_conversations(
    payload: DeleteAllConversationsRequest,
    db: Session = Depends(get_db),
) -> DeleteConversationResponse:
    if payload.confirmation_text != "APAGAR TUDO":
        raise HTTPException(status_code=400, detail="Digite APAGAR TUDO para confirmar.")
    return storage_service.delete_all_conversations(db)
