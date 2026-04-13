import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter(tags=["settings"])


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
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


@router.get("/settings")
def get_all_settings():
    return _read_settings()


@router.patch("/settings")
def patch_settings(body: dict[str, Any]):
    current = _read_settings()
    for key, value in body.items():
        if value is None:
            current.pop(key, None)
        else:
            current[key] = value
    _write_settings(current)
    return current
