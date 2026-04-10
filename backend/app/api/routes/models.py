from fastapi import APIRouter, HTTPException

from app.core.config import get_settings
from app.schemas import ModelSelectionRequest, ModelSelectionResponse, ServerConfigResponse
from app.services.model_service import model_service


router = APIRouter(prefix="/models", tags=["models"])


@router.get("/active", response_model=ModelSelectionResponse)
def get_active_model() -> ModelSelectionResponse:
    return model_service.get_selection_state()


@router.post("/select", response_model=ModelSelectionResponse)
def select_model(payload: ModelSelectionRequest) -> ModelSelectionResponse:
    try:
        return model_service.select_model_async(payload.model_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/server-config", response_model=ServerConfigResponse)
def get_server_config() -> ServerConfigResponse:
    settings = get_settings()
    host = settings.llama_server_host
    port = settings.llama_server_port
    state = model_service.get_selection_state()
    return ServerConfigResponse(
        llama_server_url=f"http://{host}:{port}",
        model_id=state.model_id,
        model_status=state.model_status,
        model_loaded=state.model_loaded,
    )