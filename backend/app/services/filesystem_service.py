"""Local filesystem access service for model tool calling.

Security measures:
- Read-only access (no writing, deletion, or modification)
- Only user-specified folders are accessible
- Paths are validated against allowed folders (prevents path traversal)
- Binary files are rejected
- Symlinks outside allowed folders are blocked
"""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────

_MAX_LIST_ENTRIES = 2000  # max directory entries returned
_MAX_FILE_SIZE = 2_000_000  # ~2 MB hard read cap for text files
_BINARY_EXTENSIONS = {
    ".exe", ".dll", ".so", ".dylib", ".bin", ".dat", ".db", ".sqlite",
    ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".xz",
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
    ".mp3", ".wav", ".ogg", ".flac", ".aac", ".wma",
    ".mp4", ".avi", ".mkv", ".mov", ".wmv", ".webm",
    ".pyc", ".pyo", ".class", ".o", ".obj",
}
_DOCUMENT_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".pptx"}


# ── Path validation ──────────────────────────────────────────────


def _is_path_within_allowed(target: Path, allowed_folders: list[str]) -> bool:
    """Check if a resolved path is within any of the allowed folders."""
    target_resolved = target.resolve()
    for folder in allowed_folders:
        folder_resolved = Path(folder).resolve()
        try:
            target_resolved.relative_to(folder_resolved)
            return True
        except ValueError:
            continue
    return False


def _validate_path(path_str: str, allowed_folders: list[str]) -> tuple[Path | None, str]:
    """Validate and resolve a path. Returns (resolved_path, error_message)."""
    if not allowed_folders:
        return None, "No allowed folders configured. Set up allowed folders in Settings."

    try:
        target = Path(path_str).resolve()
    except (ValueError, OSError) as exc:
        return None, f"Invalid path: {exc}"

    if not _is_path_within_allowed(target, allowed_folders):
        return None, (
            f"Access denied: the path '{path_str}' is outside the allowed folders. "
            f"Allowed folders: {', '.join(allowed_folders)}"
        )

    # Check for symlink pointing outside allowed folders
    if target.is_symlink():
        real_target = target.resolve()
        if not _is_path_within_allowed(real_target, allowed_folders):
            return None, "Access denied: symlink points outside allowed folders."

    return target, ""


# ── Tool implementations ─────────────────────────────────────────


def list_directory(path: str, allowed_folders: list[str]) -> dict[str, object]:
    """List contents of a directory within allowed folders."""
    result: dict[str, object] = {"path": path, "entries": [], "error": ""}

    target, error = _validate_path(path, allowed_folders)
    if error:
        result["error"] = error
        return result

    if not target.exists():
        result["error"] = f"Directory not found: {path}"
        return result

    if not target.is_dir():
        result["error"] = f"Path is not a directory: {path}"
        return result

    try:
        entries = []
        count = 0
        for entry in sorted(target.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            if count >= _MAX_LIST_ENTRIES:
                entries.append({"name": f"... ({count}+ entries, truncated)", "type": "info", "size": 0})
                break
            try:
                stat = entry.stat()
                entries.append({
                    "name": entry.name,
                    "type": "directory" if entry.is_dir() else "file",
                    "size": stat.st_size if entry.is_file() else 0,
                })
                count += 1
            except (PermissionError, OSError):
                entries.append({"name": entry.name, "type": "error", "size": 0})
                count += 1

        result["entries"] = entries
    except PermissionError:
        result["error"] = f"Permission denied: {path}"
    except OSError as exc:
        result["error"] = f"Error listing directory: {exc}"

    return result


def read_file(path: str, allowed_folders: list[str]) -> dict[str, str]:
    """Read a text or document file within allowed folders."""
    result: dict[str, str] = {"path": path, "content": "", "error": ""}

    target, error = _validate_path(path, allowed_folders)
    if error:
        result["error"] = error
        return result

    if not target.exists():
        result["error"] = f"File not found: {path}"
        return result

    if not target.is_file():
        result["error"] = f"Path is not a file: {path}"
        return result

    suffix = target.suffix.lower()

    # Enforce file size limit
    try:
        size = target.stat().st_size
    except OSError as exc:
        result["error"] = f"Error checking file size: {exc}"
        return result

    # Handle document files (PDF, DOCX, XLSX, PPTX) via document_service
    if suffix in _DOCUMENT_EXTENSIONS:
        try:
            from app.services.document_service import extract_text as extract_document_text
            text = extract_document_text(str(target), max_chars=_MAX_FILE_SIZE)
            if text.startswith("(Error") or text.startswith("(Unrecognized"):
                result["error"] = text
            else:
                result["content"] = text
        except Exception as exc:
            result["error"] = f"Error extracting text from document: {exc}"
        return result

    # Block binary files
    if suffix in _BINARY_EXTENSIONS:
        result["error"] = f"Binary file cannot be read as text: {target.name}"
        return result

    if size > _MAX_FILE_SIZE:
        try:
            with open(target, "r", encoding="utf-8", errors="ignore") as f:
                result["content"] = f.read(_MAX_FILE_SIZE)
            result["error"] = f"(File truncated: {size:,} bytes total, first {_MAX_FILE_SIZE:,} bytes shown)"
        except Exception as exc:
            result["error"] = f"Error reading file: {exc}"
        return result

    try:
        result["content"] = target.read_text(encoding="utf-8", errors="ignore")
    except PermissionError:
        result["error"] = f"Permission denied: {path}"
    except OSError as exc:
        result["error"] = f"Error reading file: {exc}"

    return result


# ── Tool definitions for OpenAI-compatible API ────────────────────

LIST_DIRECTORY_TOOL = {
    "type": "function",
    "function": {
        "name": "list_directory",
        "description": (
            "List the contents of a directory on the user's local file system. "
            "Returns names, types (file/directory), and sizes of entries. "
            "Only works within folders the user has explicitly allowed."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The absolute path to the directory to list",
                }
            },
            "required": ["path"],
        },
    },
}

READ_FILE_TOOL = {
    "type": "function",
    "function": {
        "name": "read_file",
        "description": (
            "Read the content of a file on the user's local file system. "
            "Supports text files, PDFs, Word documents (.docx), Excel spreadsheets (.xlsx), "
            "and PowerPoint presentations (.pptx). Cannot read binary files like images or videos. "
            "Only works within folders the user has explicitly allowed."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The absolute path to the file to read",
                }
            },
            "required": ["path"],
        },
    },
}

_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}

VIEW_IMAGE_TOOL = {
    "type": "function",
    "function": {
        "name": "view_image",
        "description": (
            "View an image file on the user's local file system. "
            "Loads the image so you can see and describe its visual content. "
            "Supported formats: PNG, JPG, JPEG, GIF, BMP, WEBP. "
            "Only works within folders the user has explicitly allowed."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The absolute path to the image file to view",
                }
            },
            "required": ["path"],
        },
    },
}


def execute_filesystem_tool(name: str, arguments: dict, allowed_folders: list[str]) -> str | dict:
    """Execute a filesystem tool call and return the result as a string (or dict for images)."""
    if name == "list_directory":
        path = arguments.get("path", "")
        if not path:
            return "Error: no path provided."
        result = list_directory(path, allowed_folders)
        if result["error"]:
            return f"Error: {result['error']}"
        entries = result.get("entries", [])
        if not entries:
            return f"Directory {path} is empty."
        lines = [f"Contents of {path}:"]
        for e in entries:
            etype = e.get("type", "")
            name_str = e.get("name", "")
            size = e.get("size", 0)
            if etype == "directory":
                lines.append(f"  [DIR]  {name_str}/")
            elif etype == "file":
                lines.append(f"  [FILE] {name_str} ({size:,} bytes)")
            else:
                lines.append(f"  [???]  {name_str}")
        return "\n".join(lines)

    if name == "read_file":
        path = arguments.get("path", "")
        if not path:
            return "Error: no path provided."
        result = read_file(path, allowed_folders)
        if result["error"] and not result["content"]:
            return f"Error: {result['error']}"
        parts = [f"Content of {path}:"]
        if result["error"]:
            parts.append(f"({result['error']})")
        parts.append(result["content"])
        return "\n".join(parts)

    if name == "view_image":
        path = arguments.get("path", "")
        if not path:
            return "Error: no path provided."
        target, error = _validate_path(path, allowed_folders)
        if error:
            return f"Error: {error}"
        if not target.exists():
            return f"Error: File not found: {path}"
        if not target.is_file():
            return f"Error: Not a file: {path}"
        suffix = target.suffix.lower()
        if suffix not in _IMAGE_EXTENSIONS:
            return f"Error: Unsupported image format: {suffix}. Supported: {', '.join(sorted(_IMAGE_EXTENSIONS))}"
        try:
            from app.services.input_adapter_service import InputAdapterService
            adapter = InputAdapterService()
            data_url = adapter.load_image_base64(str(target))
            return {"__multimodal__": True, "text": f"Image loaded from: {path}", "image_url": data_url}
        except Exception as exc:
            return f"Error loading image: {exc}"

    return f"Error: unknown filesystem tool '{name}'."
