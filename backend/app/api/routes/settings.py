import json
import os
import tempfile
from pathlib import Path
from threading import Lock
from typing import Any

from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter(tags=["settings"])

_lock = Lock()


def _settings_path() -> Path:
    settings = get_settings()
    return settings.resolved_upload_dir.parent / "settings.json"


def _read_settings() -> dict[str, Any]:
    path = _settings_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_settings(data: dict[str, Any]) -> None:
    path = _settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    # Write to a temp file then atomically replace to avoid corruption
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        Path(tmp).replace(path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


@router.get("/settings")
def get_all_settings():
    with _lock:
        return _read_settings()


@router.patch("/settings")
def patch_settings(body: dict[str, Any]):
    with _lock:
        current = _read_settings()
        for key, value in body.items():
            if value is None:
                current.pop(key, None)
            else:
                current[key] = value
        _write_settings(current)
        return current
