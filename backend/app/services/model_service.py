import atexit
import json
import logging
import os
import platform
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock, Thread
from typing import Any, Iterator

import httpx

from app.core.config import get_settings
from app.schemas import ModelOption, ModelSelectionResponse

logger = logging.getLogger(__name__)

try:
    from huggingface_hub import hf_hub_download
except ImportError:  # pragma: no cover
    hf_hub_download = None


@dataclass(frozen=True)
class GpuInfo:
    """Detected GPU hardware info — drives binary selection, model fallback, and UI display."""
    available: bool          # Any accelerated GPU detected?
    vendor: str              # "nvidia" | "amd" | "apple" | "none"
    backend: str             # "cuda" | "hip" | "rocm" | "metal" | "vulkan" | "cpu"
    display_name: str        # Human-readable, e.g. "NVIDIA RTX 4070"


@dataclass(frozen=True)
class ModelProfile:
    key: str
    label: str
    summary: str
    gguf_repo: str
    gguf_file: str
    mmproj_file: str = ""
    kv_cache_quant: bool = False
    n_ctx: int = 32768
    audio_capable: bool = False


class ModelService:
    _SERVER_STARTUP_TIMEOUT = 300  # seconds to wait for model load
    _HTTP_TIMEOUT = 300.0  # seconds for generation requests

    def __init__(self) -> None:
        self._settings = get_settings()
        self._profiles = {
            "e2b": ModelProfile(
                key="e2b",
                label="Gemma 4 E2B",
                summary="Gemma4E2B",
                gguf_repo=self._settings.gguf_repo_e2b,
                gguf_file=self._settings.gguf_file_e2b,
                mmproj_file=self._settings.mmproj_file_e2b,
                n_ctx=131072,
                audio_capable=True,
            ),
            "e4b": ModelProfile(
                key="e4b",
                label="Gemma 4 E4B",
                summary="Gemma4E4B",
                gguf_repo=self._settings.gguf_repo_e4b,
                gguf_file=self._settings.gguf_file_e4b,
                mmproj_file=self._settings.mmproj_file_e4b,
                n_ctx=131072,
                audio_capable=True,
            ),
            "26b": ModelProfile(
                key="26b",
                label="Gemma 4 26B A4B",
                summary="Gemma426BA4B",
                gguf_repo=self._settings.gguf_repo_26b,
                gguf_file=self._settings.gguf_file_26b,
                mmproj_file=self._settings.mmproj_file_26b,
                kv_cache_quant=True,
                n_ctx=262144,
            ),
        }
        self._active_model_key = self._settings.default_model_key
        self._model_status: str = "idle"
        self._last_error: str | None = None
        self._load_attempted = False
        self._lock = Lock()
        self._server_process: subprocess.Popen | None = None
        self._server_port = self._settings.llama_server_port
        self._server_url = f"http://127.0.0.1:{self._server_port}"
        self._client = httpx.Client(timeout=self._HTTP_TIMEOUT)
        self._has_vision = False
        self._has_audio = False
        self._actual_n_ctx: int = 0
        self._gpu_info: GpuInfo = self._detect_gpu()
        self._log_file_handle = None
        atexit.register(self._shutdown)

        logger.info(
            "GPU detected: vendor=%s, backend=%s, name=%s",
            self._gpu_info.vendor, self._gpu_info.backend, self._gpu_info.display_name,
        )

        # Override default to e2b only when NO GPU is available at all
        if not self._gpu_info.available and self._active_model_key != "e2b":
            logger.info("No GPU detected — defaulting to e2b model")
            self._active_model_key = "e2b"

    # ── Log file ─────────────────────────────────────────────────

    @property
    def _log_path(self) -> Path:
        return self._settings.resolved_model_cache_dir.parent / "llama-server.log"

    def _open_log(self):
        self._close_log()
        self._log_file_handle = open(self._log_path, "w", encoding="utf-8", buffering=1)
        return self._log_file_handle

    def _start_log_timestamper(self, pipe):
        """Read lines from *pipe* and write them to the log file with timestamps."""
        from datetime import datetime
        fh = self._log_file_handle
        try:
            for raw in iter(pipe.readline, b""):
                line = raw.decode("utf-8", errors="replace").rstrip("\n\r")
                ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                fh.write(f"{ts} {line}\n")
                fh.flush()
        except Exception:
            pass
        finally:
            pipe.close()

    def _close_log(self):
        if self._log_file_handle:
            try:
                self._log_file_handle.close()
            except Exception:
                pass
            self._log_file_handle = None

    def _read_log_tail(self, lines: int = 30) -> str:
        try:
            self._close_log()
            text = self._log_path.read_text(encoding="utf-8", errors="replace")
            tail = text.strip().splitlines()[-lines:]
            return "\n".join(tail)
        except Exception:
            return ""

    # ── Cleanup ──────────────────────────────────────────────────

    def _shutdown(self) -> None:
        self._stop_server()
        self._close_log()
        self._client.close()

    # ── Server binary location ───────────────────────────────────

    def _server_dir(self) -> Path:
        return self._settings.resolved_model_cache_dir.parent / "llama-server"

    def _find_server_binary(self) -> Path | None:
        sd = self._server_dir()
        if not sd.exists():
            return None
        for name in ("llama-server.exe", "llama-server"):
            candidate = sd / name
            if candidate.is_file():
                return candidate
        bin_dir = sd / "bin"
        if bin_dir.exists():
            for name in ("llama-server.exe", "llama-server"):
                candidate = bin_dir / name
                if candidate.is_file():
                    return candidate

    _VALID_BACKENDS = frozenset({"cuda", "hip", "rocm", "metal", "vulkan", "cpu"})

    @property
    def server_backend(self) -> str:
        """Return the installed llama-server backend (from backend.txt)."""
        backend_file = self._server_dir() / "backend.txt"
        if backend_file.is_file():
            try:
                # utf-8-sig strips BOM left by PowerShell 5.1 Out-File -Encoding UTF8
                value = backend_file.read_text(encoding="utf-8-sig").strip().lower()
                if value in self._VALID_BACKENDS:
                    return value
                logger.warning(
                    "backend.txt contains invalid value '%s', using fallback: %s",
                    value, self._gpu_info.backend,
                )
            except Exception:
                pass
        # Fallback: use detected GPU backend (pre-v2.0 installs)
        return self._gpu_info.backend

    # ── Server process management ────────────────────────────────

    def _stop_server(self) -> None:
        proc = self._server_process
        if proc is None:
            return
        logger.info("Stopping llama-server (PID %s)...", proc.pid)
        try:
            if sys.platform == "win32":
                # On Windows, terminate() doesn't propagate to children.
                # Use taskkill /T to kill the entire process tree.
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=0x08000000,  # CREATE_NO_WINDOW
                    timeout=10,
                )
            else:
                proc.terminate()
            proc.wait(timeout=10)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        self._server_process = None

    def _wait_for_server_health(self) -> bool:
        deadline = time.monotonic() + self._SERVER_STARTUP_TIMEOUT
        while time.monotonic() < deadline:
            if self._server_process and self._server_process.poll() is not None:
                return False
            try:
                r = self._client.get(f"{self._server_url}/health", timeout=5)
                data = r.json()
                status = data.get("status", "")
                if status == "ok":
                    return True
                if status == "error":
                    return False
            except Exception:
                pass
            time.sleep(1)
        return False

    def _query_props(self) -> None:
        """Fetch /props to learn the actual context size the server allocated."""
        try:
            r = self._client.get(f"{self._server_url}/props", timeout=10)
            r.raise_for_status()
            data = r.json()
            n_ctx = data.get("default_generation_settings", {}).get("n_ctx", 0)
            if n_ctx > 0:
                self._actual_n_ctx = n_ctx
                logger.info("Actual context allocated: %d tokens", n_ctx)
        except Exception as exc:
            logger.warning("Could not query /props: %s", exc)

    def _warmup(self) -> None:
        """Send a tiny completion request to pre-compile CUDA graphs / warm caches."""
        try:
            logger.info("Sending warmup request...")
            t0 = time.monotonic()
            r = self._client.post(
                f"{self._server_url}/v1/chat/completions",
                json={
                    "messages": [{"role": "user", "content": "hi"}],
                    "max_tokens": 1,
                },
                timeout=120,
            )
            r.raise_for_status()
            elapsed = time.monotonic() - t0
            logger.info("Warmup completed in %.1fs", elapsed)
        except Exception as exc:
            logger.warning("Warmup failed (non-fatal): %s", exc)

    # Minimum llama-server build for native audio (Gemma 4 conformer, PR #21421)
    _MIN_AUDIO_BUILD = 8827

    def _check_audio_support(self) -> None:
        """Disable native audio if the server build predates audio support."""
        if not self._has_audio:
            return
        version_file = self._server_dir() / "version.txt"
        try:
            version = version_file.read_text(encoding="utf-8-sig").strip()
            match = re.match(r"b(\d+)", version)
            if match:
                build = int(match.group(1))
                if build < self._MIN_AUDIO_BUILD:
                    logger.warning(
                        "llama-server %s does not support native audio (requires >= b%d) — using Whisper transcription.",
                        version, self._MIN_AUDIO_BUILD,
                    )
                    self._has_audio = False
                    return
                logger.info("Native audio support: OK (build %s)", version)
                return
        except Exception:
            pass
        # version.txt missing or unparseable — assume audio is supported
        # (custom/source builds that include the conformer code)
        logger.info("Native audio support: OK (unknown version)")

    @property
    def context_size(self) -> int:
        """Return the actual context size or the profile's n_ctx as fallback."""
        if self._actual_n_ctx > 0:
            return self._actual_n_ctx
        profile = self._profiles.get(self._active_model_key)
        if profile:
            return self._settings.n_ctx or profile.n_ctx
        return 32768

    def estimate_tokens(self, text: str) -> int:
        """Use /tokenize to count tokens. Falls back to char/4 heuristic."""
        if not self.is_loaded:
            return len(text) // 4
        try:
            r = self._client.post(
                f"{self._server_url}/tokenize",
                json={"content": text},
                timeout=10,
            )
            r.raise_for_status()
            tokens = r.json().get("tokens", [])
            return len(tokens)
        except Exception:
            return len(text) // 4

    def _start_server(self, model_key: str) -> None:
        binary = self._find_server_binary()
        if binary is None:
            raise RuntimeError(
                "llama-server not found in data/system/llama-server/. "
                "Run install.cmd to download the binaries."
            )

        profile = self._profiles[model_key]
        model_path = self._download_gguf(profile.gguf_repo, profile.gguf_file)

        base_cmd = [
            str(binary),
            "-m", model_path,
            "-ngl", str(self._settings.n_gpu_layers),
            "--host", self._settings.llama_server_host,
            "--port", str(self._server_port),
            "--fit", "on",
            "--jinja",
            "--parallel", "1",
        ]

        # Flash attention is only supported on certain backends (CUDA, Metal, HIP, ROCm)
        server_backend = self.server_backend
        if self._settings.flash_attn and server_backend in ("cuda", "metal", "hip", "rocm"):
            base_cmd.extend(["--flash-attn", "on"])

        has_vision = False
        if profile.mmproj_file:
            try:
                mmproj_path = self._download_gguf(profile.gguf_repo, profile.mmproj_file)
                base_cmd.extend(["--mmproj", mmproj_path])
                base_cmd.extend(["--image-min-tokens", str(self._settings.image_min_tokens)])
                base_cmd.extend(["--image-max-tokens", str(self._settings.image_max_tokens)])
                has_vision = True
            except Exception as exc:
                logger.warning("mmproj not found for %s, vision disabled: %s", model_key, exc)

        if profile.kv_cache_quant:
            base_cmd.extend(["--cache-type-k", "q8_0", "--cache-type-v", "q8_0"])

        env = os.environ.copy()
        env["PATH"] = str(binary.parent) + os.pathsep + env.get("PATH", "")
        creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

        # Try with configured n_ctx first, then fall back to auto (model default)
        effective_n_ctx = self._settings.n_ctx or profile.n_ctx
        ctx_attempts = [str(effective_n_ctx)]
        if effective_n_ctx > 0:
            ctx_attempts.append("0")  # fallback: -c 0 = model default

        for ctx_value in ctx_attempts:
            cmd = base_cmd + ["-c", ctx_value]
            logger.info("Starting llama-server: %s", " ".join(cmd))

            self._open_log()
            logger.info("llama-server log: %s", self._log_path)

            self._server_process = subprocess.Popen(
                cmd,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                creationflags=creationflags,
            )
            # Pipe stdout through a thread that prepends timestamps to each line
            Thread(
                target=self._start_log_timestamper,
                args=(self._server_process.stdout,),
                daemon=True,
            ).start()
            self._has_vision = has_vision
            self._has_audio = has_vision and profile.audio_capable

            if self._wait_for_server_health():
                if ctx_value != ctx_attempts[0]:
                    logger.warning(
                        "Failed with n_ctx=%s, started with n_ctx=%s (fallback)",
                        ctx_attempts[0], ctx_value,
                    )
                self._query_props()
                self._warmup()
                self._check_audio_support()
                return

            tail = self._read_log_tail()
            self._stop_server()
            if ctx_value == ctx_attempts[-1]:
                error_detail = f"llama-server failed to start (log: {self._log_path})"
                if tail:
                    error_detail += f"\n\nLast log lines:\n{tail}"
                raise RuntimeError(error_detail)
            logger.warning(
                "llama-server failed to start with -c %s, trying fallback...", ctx_value
            )

    # ── Model download ───────────────────────────────────────────

    def _download_gguf(self, repo_id: str, filename: str) -> str:
        if hf_hub_download is None:
            raise RuntimeError("huggingface_hub is not installed.")
        path = hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            cache_dir=str(self._settings.resolved_model_cache_dir),
        )
        # hf_hub_download returns a symlink under snapshots/ on Windows;
        # llama-server's fopen() cannot follow Windows symlinks, and
        # Path.resolve() raises WinError 448 on Python 3.13+ due to
        # "untrusted mount point" security checks.  Use os.readlink()
        # + normpath (pure string ops) to dereference without touching
        # the filesystem security layer.
        p = Path(path)
        if p.is_symlink():
            import os
            target = os.readlink(p)
            return os.path.normpath(os.path.join(str(p.parent), target))
        return str(p)

    def _is_model_cached(self, profile: ModelProfile) -> bool:
        """Check if the GGUF file exists in any snapshot of the HF cache.

        Uses a direct filesystem check instead of ``try_to_load_from_cache``
        because the latter can return ``None`` on Windows machines where
        Developer Mode is off and symlinks are replaced with copies.
        """
        cache_dir = self._settings.resolved_model_cache_dir
        repo_folder = f"models--{profile.gguf_repo.replace('/', '--')}"
        snapshots_dir = cache_dir / repo_folder / "snapshots"
        try:
            if not snapshots_dir.is_dir():
                return False
            for sha_dir in snapshots_dir.iterdir():
                if (sha_dir / profile.gguf_file).exists():
                    return True
        except OSError:
            pass
        return False

    def is_model_cached(self, model_key: str) -> bool:
        profile = self._profiles.get(model_key)
        if profile is None:
            return False
        return self._is_model_cached(profile)

    # ── Public properties ────────────────────────────────────────

    @property
    def active_model_key(self) -> str:
        return self._active_model_key

    @property
    def active_model_id(self) -> str:
        profile = self._profiles[self._active_model_key]
        return f"{profile.gguf_repo}/{profile.gguf_file}"

    @property
    def model_status(self) -> str:
        return self._model_status

    @property
    def is_loaded(self) -> bool:
        if self._server_process is None:
            return False
        if self._server_process.poll() is not None:
            tail = self._read_log_tail()
            self._server_process = None
            self._model_status = "error"
            msg = "llama-server terminated unexpectedly."
            if tail:
                msg += f"\n\nLast log lines ({self._log_path}):\n{tail}"
            self._last_error = msg
            logger.error(msg)
            return False
        return self._model_status == "loaded"

    @property
    def supports_vision(self) -> bool:
        return self._has_vision

    @property
    def supports_audio(self) -> bool:
        return self._has_audio

    # ── GPU detection ────────────────────────────────────────────

    @staticmethod
    def _detect_gpu() -> GpuInfo:
        """Detect the best available GPU: Apple Metal > NVIDIA > AMD > none."""
        system = platform.system()

        # 1. macOS Apple Silicon → Metal (always available on arm64)
        if system == "Darwin" and platform.machine() == "arm64":
            chip_name = "Apple Silicon"
            try:
                result = subprocess.run(
                    ["sysctl", "-n", "machdep.cpu.brand_string"],
                    capture_output=True, text=True, timeout=5,
                )
                if result.returncode == 0 and result.stdout.strip():
                    chip_name = result.stdout.strip()
            except Exception:
                pass
            return GpuInfo(available=True, vendor="apple",
                           backend="metal", display_name=chip_name)

        # 2. NVIDIA → CUDA
        nvidia_smi = shutil.which("nvidia-smi")
        if not nvidia_smi and system == "Windows":
            # nvidia-smi may not be on PATH in packaged/installer environments
            for candidate in (
                os.path.join(os.environ.get("SystemRoot", r"C:\Windows"),
                             "System32", "nvidia-smi.exe"),
                os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"),
                             "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe"),
            ):
                if os.path.isfile(candidate):
                    nvidia_smi = candidate
                    break
        if nvidia_smi:
            try:
                result = subprocess.run(
                    [nvidia_smi, "--query-gpu=name",
                     "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=5, check=True,
                )
                name = result.stdout.strip().split("\n")[0].strip()
                return GpuInfo(available=True, vendor="nvidia",
                               backend="cuda", display_name=name or "NVIDIA GPU")
            except Exception:
                pass

        # 3. AMD → ROCm (Linux) or HIP (Windows)
        if system == "Linux":
            # Try rocminfo first (installed with ROCm stack)
            try:
                result = subprocess.run(
                    ["rocminfo"], capture_output=True, text=True, timeout=10,
                )
                if result.returncode == 0 and "gfx" in result.stdout.lower():
                    match = re.search(r'Marketing Name:\s*(.+)', result.stdout)
                    name = match.group(1).strip() if match else "AMD GPU"
                    return GpuInfo(available=True, vendor="amd",
                                   backend="rocm", display_name=name)
            except Exception:
                pass
            # Fallback: lspci
            try:
                result = subprocess.run(
                    ["lspci"], capture_output=True, text=True, timeout=5,
                )
                for line in result.stdout.splitlines():
                    if re.search(r'VGA.*(?:AMD|Radeon)', line, re.IGNORECASE):
                        return GpuInfo(available=True, vendor="amd",
                                       backend="vulkan",
                                       display_name="AMD GPU (Vulkan)")
            except Exception:
                pass
        elif system == "Windows":
            try:
                result = subprocess.run(
                    ["powershell", "-NoProfile", "-Command",
                     "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"],
                    capture_output=True, text=True, timeout=10,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
                for line in result.stdout.splitlines():
                    name = line.strip()
                    if name and re.search(r'AMD|Radeon', name, re.IGNORECASE) \
                            and not re.search(r'Microsoft', name, re.IGNORECASE):
                        return GpuInfo(available=True, vendor="amd",
                                       backend="hip",
                                       display_name=name)
            except Exception:
                pass

        # 4. No GPU detected
        return GpuInfo(available=False, vendor="none",
                       backend="cpu", display_name="CPU only")

    @property
    def gpu_info(self) -> GpuInfo:
        """Return detected GPU information."""
        return self._gpu_info

    @property
    def cuda_available(self) -> bool:
        """Backward-compatible: True only when an NVIDIA/CUDA GPU is detected."""
        return self._gpu_info.vendor == "nvidia"

    def available_models(self) -> list[ModelOption]:
        return [
            ModelOption(
                key=profile.key,
                label=profile.label,
                summary=profile.summary,
                model_id=f"{profile.gguf_repo}/{profile.gguf_file}",
                cached=self._is_model_cached(profile),
            )
            for profile in self._profiles.values()
        ]

    @property
    def setup_status(self) -> dict:
        if not self._settings.enable_model_loading:
            return {"key": "disabled"}
        if self._find_server_binary() is None:
            return {"key": "server_not_found"}
        if self._model_status == "loading":
            profile = self._profiles[self._active_model_key]
            return {"key": "loading", "label": profile.label}
        if self._last_error:
            return {"key": "error", "detail": self._last_error}
        if not self.is_loaded:
            if self._load_attempted:
                return {"key": "incomplete"}
            return {"key": "not_loaded"}
        profile = self._profiles[self._active_model_key]
        return {"key": "ready", "label": profile.label}

    # ── Loading / switching ──────────────────────────────────────

    def _set_failed(self, error: str) -> None:
        self._stop_server()
        self._model_status = "error"
        self._last_error = error

    def _load_selected_model(self, model_key: str) -> None:
        self._load_attempted = True
        self._last_error = None
        self._model_status = "loading"
        try:
            self._stop_server()
            self._start_server(model_key)
            self._active_model_key = model_key
            self._model_status = "loaded"
        except Exception as exc:
            self._set_failed(str(exc))

    def load(self) -> None:
        with self._lock:
            if self.is_loaded:
                return
            if self._find_server_binary() is None:
                logger.warning("llama-server not found, skipping loading.")
                return
            self._load_selected_model(self._active_model_key)

    def get_selection_state(self) -> ModelSelectionResponse:
        return ModelSelectionResponse(
            active_model_key=self._active_model_key,
            model_id=self.active_model_id,
            model_status=self._model_status,
            model_loaded=self.is_loaded,
            model_setup_status=self.setup_status,
        )

    def select_model_async(self, model_key: str) -> ModelSelectionResponse:
        if model_key not in self._profiles:
            raise ValueError("Requested model not supported.")

        with self._lock:
            if self._model_status == "loading":
                return self.get_selection_state()

            if model_key == self._active_model_key and self.is_loaded:
                return self.get_selection_state()

            self._active_model_key = model_key
            self._model_status = "loading"
            self._last_error = None
            self._stop_server()

        def worker() -> None:
            with self._lock:
                self._load_selected_model(model_key)

        Thread(target=worker, daemon=True).start()
        return self.get_selection_state()

    # ── Message preparation ──────────────────────────────────────

    def _prepare_messages(self, messages: list[dict[str, Any]], enable_thinking: bool) -> list[dict[str, Any]]:
        """Prepare messages for llama-server /v1/chat/completions (OpenAI format)."""
        prepared: list[dict[str, Any]] = []
        system_updated = False

        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            if not system_updated and role == "system":
                if isinstance(content, str):
                    if enable_thinking and not content.startswith("<|think|>"):
                        content = f"<|think|>\n{content}" if content else "<|think|>"
                    elif not enable_thinking and isinstance(content, str) and content.startswith("<|think|>"):
                        content = content.removeprefix("<|think|>").lstrip()
                system_updated = True

            prepared.append({"role": role, "content": content})

        return prepared

    # ── Text cleaning ────────────────────────────────────────────

    def _clean_text(self, text: str) -> str:
        cleaned = re.sub(r"<\|[^>]+\|>", "", text)
        cleaned = cleaned.replace("<eos>", "").replace("<bos>", "")
        return cleaned.strip()

    def _clean_chunk(self, text: str) -> str:
        cleaned = re.sub(r"<\|[^>]+\|>", "", text)
        return cleaned.replace("<eos>", "").replace("<bos>", "")

    # ── Error extraction ─────────────────────────────────────────

    @staticmethod
    def _extract_server_error(exc: Exception) -> str:
        """Pull the human-readable message from an httpx status error, if possible."""
        if isinstance(exc, httpx.HTTPStatusError):
            try:
                body = exc.response.json()
                msg = body.get("error", {}).get("message", "")
                if msg:
                    return msg
            except Exception:
                pass
            return f"Server returned error {exc.response.status_code}."
        return str(exc)

    @staticmethod
    def _is_context_overflow(exc: Exception) -> bool:
        """Check if the error indicates the prompt exceeded the context window."""
        if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 400:
            try:
                body = exc.response.json()
                msg = body.get("error", {}).get("message", "").lower()
                if "context" in msg or "too long" in msg or "exceeds" in msg:
                    return True
            except Exception:
                pass
            return True  # treat any 400 as potential overflow
        return False

    @staticmethod
    def _drop_oldest_non_system(messages: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
        """Remove the oldest non-system message. Returns None if nothing to drop."""
        first_non_system = next(
            (i for i, m in enumerate(messages) if m.get("role") != "system"), None
        )
        if first_non_system is None or len(messages) - first_non_system <= 1:
            return None
        return messages[:first_non_system] + messages[first_non_system + 1:]

    # ── Generation (HTTP → llama-server) ─────────────────────────

    _MAX_CONTINUATIONS = 5  # safety cap for auto-continue loops
    _MAX_CONTEXT_RETRIES = 3  # max times to retry after context overflow
    _MAX_TOOL_ROUNDS = 3  # max tool-calling rounds per generation

    def generate_reply_stream(
        self,
        messages: list[dict[str, Any]],
        enable_thinking: bool = False,
        tools: list[dict[str, Any]] | None = None,
        tool_executor: Any | None = None,
    ) -> Iterator[str | dict[str, Any]]:
        if not self.is_loaded:
            yield "The model is not loaded yet. Please wait for loading to complete."
            return

        prepared = self._prepare_messages(messages, enable_thinking)
        accumulated: list[str] = []
        tool_rounds = 0
        vision_only_next_round = False

        for _round in range(1 + self._MAX_CONTINUATIONS + self._MAX_TOOL_ROUNDS):
            finish_reason: str | None = None
            tool_calls_data: list[dict[str, Any]] = []

            request_body: dict[str, Any] = {
                "messages": prepared,
                "max_tokens": 4096,
                "temperature": 1.0,
                "top_p": 0.95,
                "top_k": 64,
                "stream": True,
            }
            if tools and tool_executor:
                if vision_only_next_round:
                    vision_tools = [t for t in tools if t.get("function", {}).get("name") == "view_image"]
                    if vision_tools:
                        request_body["tools"] = vision_tools
                else:
                    request_body["tools"] = tools
            vision_only_next_round = False

            try:
                with self._client.stream(
                    "POST",
                    f"{self._server_url}/v1/chat/completions",
                    json=request_body,
                ) as response:
                    response.raise_for_status()
                    for line in response.iter_lines():
                        if not line.startswith("data: "):
                            continue
                        payload = line[6:]
                        if payload.strip() == "[DONE]":
                            break
                        chunk = json.loads(payload)
                        choices = chunk.get("choices", [])
                        if choices:
                            fr = choices[0].get("finish_reason")
                            if fr:
                                finish_reason = fr
                            delta = choices[0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                cleaned = self._clean_chunk(content)
                                if cleaned:
                                    accumulated.append(cleaned)
                                    yield cleaned
                            # Accumulate tool call deltas
                            if "tool_calls" in delta:
                                for tc in delta["tool_calls"]:
                                    idx = tc.get("index", 0)
                                    while len(tool_calls_data) <= idx:
                                        tool_calls_data.append({"id": "", "function": {"name": "", "arguments": ""}})
                                    if "id" in tc and tc["id"]:
                                        tool_calls_data[idx]["id"] = tc["id"]
                                    fn = tc.get("function", {})
                                    if "name" in fn and fn["name"]:
                                        tool_calls_data[idx]["function"]["name"] = fn["name"]
                                    if "arguments" in fn:
                                        tool_calls_data[idx]["function"]["arguments"] += fn["arguments"]
            except Exception as exc:
                if self._is_context_overflow(exc) and not accumulated:
                    reduced = self._drop_oldest_non_system(prepared)
                    if reduced is not None:
                        logger.warning(
                            "Context exceeded, dropping oldest message and retrying (%d → %d msgs).",
                            len(prepared), len(reduced),
                        )
                        prepared = reduced
                        continue
                yield f"Error during generation: {self._extract_server_error(exc)}"
                return

            # Handle tool calls
            if finish_reason == "tool_calls" and tool_calls_data and tool_executor and tool_rounds < self._MAX_TOOL_ROUNDS:
                tool_rounds += 1
                # Add assistant message with tool calls
                assistant_msg: dict[str, Any] = {"role": "assistant", "content": "".join(accumulated)}
                tc_list = []
                for tc in tool_calls_data:
                    tc_list.append({
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["function"]["name"],
                            "arguments": tc["function"]["arguments"],
                        },
                    })
                assistant_msg["tool_calls"] = tc_list
                prepared = prepared + [assistant_msg]

                # Execute each tool call and add results
                for tc in tool_calls_data:
                    fn_name = tc["function"]["name"]
                    try:
                        fn_args = json.loads(tc["function"]["arguments"])
                    except json.JSONDecodeError:
                        fn_args = {}
                    logger.info("Executing tool call: %s(%s)", fn_name, fn_args)
                    yield {"type": "tool_start", "name": fn_name, "arguments": fn_args}
                    tool_result = tool_executor(fn_name, fn_args)
                    yield {"type": "tool_done", "name": fn_name, "arguments": fn_args}

                    # Handle multimodal tool results (e.g., view_image)
                    if isinstance(tool_result, dict) and tool_result.get("__multimodal__"):
                        # Tool message must be text-only for llama-server compatibility.
                        prepared.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": tool_result["text"],
                        })
                        # Inject image as a user message so the vision model can see it.
                        prepared.append({
                            "role": "user",
                            "content": [
                                {"type": "text", "text": tool_result["text"]},
                                {"type": "image_url", "image_url": {"url": tool_result["image_url"]}},
                            ],
                        })
                        # Next round: only allow view_image so the model can
                        # view more images but won't get distracted by other tools.
                        vision_only_next_round = True
                    else:
                        prepared.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": tool_result,
                        })

                accumulated = []
                continue

            # Auto-continue if generation was truncated by max_tokens
            if finish_reason == "length":
                text_so_far = "".join(accumulated)
                prepared = prepared + [{"role": "assistant", "content": text_so_far}]
                accumulated = []
                continue
            break

    def generate_reply(
        self,
        messages: list[dict[str, Any]],
        enable_thinking: bool = False,
        tools: list[dict[str, Any]] | None = None,
        tool_executor: Any | None = None,
    ) -> str:
        if not self.is_loaded:
            return "The model is not loaded yet. Please wait for loading to complete."

        prepared = self._prepare_messages(messages, enable_thinking)
        parts: list[str] = []
        tool_rounds = 0
        vision_only_next_round = False

        for _round in range(1 + self._MAX_CONTINUATIONS + self._MAX_TOOL_ROUNDS):
            request_body: dict[str, Any] = {
                "messages": prepared,
                "max_tokens": 4096,
                "temperature": 1.0,
                "top_p": 0.95,
                "top_k": 64,
                "stream": False,
            }
            if tools and tool_executor:
                if vision_only_next_round:
                    vision_tools = [t for t in tools if t.get("function", {}).get("name") == "view_image"]
                    if vision_tools:
                        request_body["tools"] = vision_tools
                else:
                    request_body["tools"] = tools
            vision_only_next_round = False

            try:
                response = self._client.post(
                    f"{self._server_url}/v1/chat/completions",
                    json=request_body,
                )
                response.raise_for_status()
                data = response.json()
                choices = data.get("choices", [])
                if not choices:
                    break

                choice = choices[0]
                message_data = choice.get("message", {})
                content = message_data.get("content", "")
                finish_reason = choice.get("finish_reason")

                # Handle tool calls
                if finish_reason == "tool_calls" and tool_executor and tool_rounds < self._MAX_TOOL_ROUNDS:
                    tool_calls = message_data.get("tool_calls", [])
                    if tool_calls:
                        tool_rounds += 1
                        cleaned = self._clean_text(content) if content else ""
                        if cleaned:
                            parts.append(cleaned)
                        prepared = prepared + [message_data]
                        for tc in tool_calls:
                            fn = tc.get("function", {})
                            fn_name = fn.get("name", "")
                            try:
                                fn_args = json.loads(fn.get("arguments", "{}"))
                            except json.JSONDecodeError:
                                fn_args = {}
                            logger.info("Executing tool call (sync): %s(%s)", fn_name, fn_args)
                            tool_result = tool_executor(fn_name, fn_args)

                            # Handle multimodal tool results (e.g., view_image)
                            if isinstance(tool_result, dict) and tool_result.get("__multimodal__"):
                                prepared.append({
                                    "role": "tool",
                                    "tool_call_id": tc.get("id", ""),
                                    "content": tool_result["text"],
                                })
                                prepared.append({
                                    "role": "user",
                                    "content": [
                                        {"type": "text", "text": tool_result["text"]},
                                        {"type": "image_url", "image_url": {"url": tool_result["image_url"]}},
                                    ],
                                })
                                vision_only_next_round = True
                            else:
                                prepared.append({
                                    "role": "tool",
                                    "tool_call_id": tc.get("id", ""),
                                    "content": tool_result,
                                })
                        continue

                cleaned = self._clean_text(content)
                parts.append(cleaned)

                if finish_reason == "length":
                    text_so_far = "".join(parts)
                    prepared = prepared + [{"role": "assistant", "content": text_so_far}]
                    continue
                break
            except Exception as exc:
                if self._is_context_overflow(exc) and not parts:
                    reduced = self._drop_oldest_non_system(prepared)
                    if reduced is not None:
                        logger.warning(
                            "Context exceeded (sync), dropping oldest message (%d → %d msgs).",
                            len(prepared), len(reduced),
                        )
                        prepared = reduced
                        continue
                parts.append(f"Error during generation: {self._extract_server_error(exc)}")
                break

        return "".join(parts)


model_service = ModelService()
