import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import get_settings


router = APIRouter(tags=["legal"])


def _acceptance_path() -> Path:
    settings = get_settings()
    return settings.resolved_upload_dir.parent / "legal-acceptance.json"


class AcceptRequest(BaseModel):
    locale: str
    terms_hash: str


@router.get("/legal/acceptance")
def get_acceptance():
    path = _acceptance_path()
    if not path.exists():
        return {"accepted": False}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {"accepted": True, **data}
    except Exception:
        return {"accepted": False}


@router.post("/legal/accept")
def accept_terms(req: AcceptRequest):
    path = _acceptance_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "locale": req.locale,
        "terms_hash": req.terms_hash,
        "accepted_at": datetime.now(timezone.utc).isoformat(),
    }
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return {"ok": True, **data}
