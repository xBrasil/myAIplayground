import os
import threading

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


@router.post("/shutdown")
def shutdown() -> dict:
    """Gracefully stop the backend server.

    Explicitly stops llama-server first (os._exit bypasses atexit handlers),
    then exits after a short delay so the HTTP response reaches the client.
    The launcher script (run.ps1 / run.sh) detects the backend exit and
    cleans up the frontend and any remaining child processes.
    """

    def _deferred_exit() -> None:
        import time
        time.sleep(0.5)
        model_service._shutdown()
        os._exit(0)

    threading.Thread(target=_deferred_exit, daemon=True).start()
    return {"ok": True}
