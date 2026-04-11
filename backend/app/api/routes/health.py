from fastapi import APIRouter

from app.core.config import get_settings
from app.schemas import HealthResponse
from app.services.model_service import model_service


router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def healthcheck() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(
        app_name=settings.app_name,
        environment=settings.app_env,
        model_id=model_service.active_model_id,
        active_model_key=model_service.active_model_key,
        model_status=model_service.model_status,
        model_loaded=model_service.is_loaded,
        cuda_available=model_service.cuda_available,
        context_size=model_service.context_size,
        model_setup_status=model_service.setup_status,
        model_loading_enabled=settings.enable_model_loading,
        available_models=model_service.available_models(),
    )
