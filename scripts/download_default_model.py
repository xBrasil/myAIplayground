"""Pre-download the default GGUF model (and its mmproj, if any) to the local cache.

Invoked by scripts/install.ps1 so the app is ready to chat — fully offline —
as soon as the UI opens after install. Reads DEFAULT_MODEL_KEY and the matching
GGUF_REPO_* / GGUF_FILE_* / MMPROJ_FILE_* from data/.env (via app settings).
Exit 0 on success, non-zero on failure.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from huggingface_hub import hf_hub_download, try_to_load_from_cache  # noqa: E402

from app.core.config import get_settings  # noqa: E402


def main() -> int:
    settings = get_settings()
    key = settings.default_model_key.lower()

    repo = getattr(settings, f"gguf_repo_{key}", None)
    gguf_file = getattr(settings, f"gguf_file_{key}", None)
    mmproj_file = getattr(settings, f"mmproj_file_{key}", None)

    if not repo or not gguf_file:
        print(f"ERROR: unknown DEFAULT_MODEL_KEY '{key}'", file=sys.stderr)
        return 1

    cache_dir = str(settings.resolved_model_cache_dir)
    Path(cache_dir).mkdir(parents=True, exist_ok=True)

    files = [gguf_file]
    if mmproj_file:
        files.append(mmproj_file)

    for filename in files:
        cached = try_to_load_from_cache(repo_id=repo, filename=filename, cache_dir=cache_dir)
        if isinstance(cached, str):
            print(f"  [cached]     {repo}/{filename}")
            continue
        print(f"  [download]   {repo}/{filename}")
        hf_hub_download(repo_id=repo, filename=filename, cache_dir=cache_dir)

    print(f"OK: default model '{key}' ready in {cache_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
