import os
import signal
import sys
import threading

from fastapi import APIRouter, HTTPException, Request

from app.core.config import ALLOWED_ORIGINS, get_settings
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
def shutdown(request: Request) -> dict:
    """Gracefully stop the backend server.

    Explicitly stops llama-server first (os._exit bypasses atexit handlers),
    then exits after a short delay so the HTTP response reaches the client.
    The launcher script (run.ps1 / run.sh) detects the backend exit and
    cleans up the frontend and any remaining child processes.
    """
    origin = request.headers.get("origin") or ""
    referer = request.headers.get("referer") or ""
    if origin not in ALLOWED_ORIGINS and not any(referer.startswith(o) for o in ALLOWED_ORIGINS):
        raise HTTPException(status_code=403, detail="Forbidden")

    def _deferred_exit() -> None:
        import time
        import subprocess
        time.sleep(0.5)
        model_service._shutdown()
        if sys.platform == "win32":
            # With uvicorn --reload, the parent process spawns this worker.
            # os._exit(0) only kills the worker; the parent stays alive.
            # Kill the parent's entire process tree to clean up everything.
            ppid = os.getppid()
            try:
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(ppid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=0x08000000,  # CREATE_NO_WINDOW
                )
            except Exception:
                pass
            os._exit(0)
        else:
            # On Unix, kill our own process group to clean up parent + workers
            try:
                os.killpg(os.getpgid(os.getpid()), signal.SIGTERM)
            except OSError:
                os._exit(0)

    threading.Thread(target=_deferred_exit, daemon=True).start()
    return {"ok": True}
