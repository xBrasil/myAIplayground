import atexit
import json
import logging
import os
import re
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
    from huggingface_hub import hf_hub_download, try_to_load_from_cache
except ImportError:  # pragma: no cover
    hf_hub_download = None
    try_to_load_from_cache = None


@dataclass(frozen=True)
class ModelProfile:
    key: str
    label: str
    summary: str
    gguf_repo: str
    gguf_file: str
    mmproj_file: str = ""
    kv_cache_quant: bool = False


class ModelService:
    _SERVER_STARTUP_TIMEOUT = 300  # seconds to wait for model load
    _HTTP_TIMEOUT = 300.0  # seconds for generation requests

    def __init__(self) -> None:
        self._settings = get_settings()
        self._profiles = {
            "e2b": ModelProfile(
                key="e2b",
                label="Gemma 4 E2B",
                summary="Mais rápido",
                gguf_repo=self._settings.gguf_repo_e2b,
                gguf_file=self._settings.gguf_file_e2b,
                mmproj_file=self._settings.mmproj_file_e2b,
            ),
            "e4b": ModelProfile(
                key="e4b",
                label="Gemma 4 E4B",
                summary="Mais inteligente",
                gguf_repo=self._settings.gguf_repo_e4b,
                gguf_file=self._settings.gguf_file_e4b,
                mmproj_file=self._settings.mmproj_file_e4b,
            ),
            "26b": ModelProfile(
                key="26b",
                label="Gemma 4 26B A4B",
                summary="Mais capaz (MoE)",
                gguf_repo=self._settings.gguf_repo_26b,
                gguf_file=self._settings.gguf_file_26b,
                mmproj_file=self._settings.mmproj_file_26b,
                kv_cache_quant=True,
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
        self._cuda_detected: bool | None = None
        self._log_file_handle = None
        atexit.register(self._shutdown)

    # ── Log file ─────────────────────────────────────────────────

    @property
    def _log_path(self) -> Path:
        return self._settings.resolved_model_cache_dir.parent / "llama-server.log"

    def _open_log(self):
        self._close_log()
        self._log_file_handle = open(self._log_path, "w", encoding="utf-8", buffering=1)
        return self._log_file_handle

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
        return None

    # ── Server process management ────────────────────────────────

    def _stop_server(self) -> None:
        proc = self._server_process
        if proc is None:
            return
        logger.info("Parando llama-server (PID %s)...", proc.pid)
        try:
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

    def _start_server(self, model_key: str) -> None:
        binary = self._find_server_binary()
        if binary is None:
            raise RuntimeError(
                "llama-server não encontrado em data/llama-server/. "
                "Execute install.cmd para baixar os binários."
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

        if self._settings.flash_attn:
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
                logger.warning("mmproj não encontrado para %s, visão desabilitada: %s", model_key, exc)

        if profile.kv_cache_quant:
            base_cmd.extend(["--cache-type-k", "q8_0", "--cache-type-v", "q8_0"])

        env = os.environ.copy()
        env["PATH"] = str(binary.parent) + os.pathsep + env.get("PATH", "")
        creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

        # Try with configured n_ctx first, then fall back to auto (model default)
        ctx_attempts = [str(self._settings.n_ctx)]
        if self._settings.n_ctx > 0:
            ctx_attempts.append("0")  # fallback: -c 0 = model default

        for ctx_value in ctx_attempts:
            cmd = base_cmd + ["-c", ctx_value]
            logger.info("Iniciando llama-server: %s", " ".join(cmd))

            log_handle = self._open_log()
            logger.info("Log do llama-server: %s", self._log_path)

            self._server_process = subprocess.Popen(
                cmd,
                env=env,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                creationflags=creationflags,
            )
            self._has_vision = has_vision

            if self._wait_for_server_health():
                if ctx_value != ctx_attempts[0]:
                    logger.warning(
                        "Falha com n_ctx=%s, iniciou com n_ctx=%s (fallback)",
                        ctx_attempts[0], ctx_value,
                    )
                return

            tail = self._read_log_tail()
            self._stop_server()
            if ctx_value == ctx_attempts[-1]:
                error_detail = f"llama-server não iniciou (log: {self._log_path})"
                if tail:
                    error_detail += f"\n\nÚltimas linhas do log:\n{tail}"
                raise RuntimeError(error_detail)
            logger.warning(
                "llama-server não iniciou com -c %s, tentando fallback...", ctx_value
            )

    # ── Model download ───────────────────────────────────────────

    def _download_gguf(self, repo_id: str, filename: str) -> str:
        if hf_hub_download is None:
            raise RuntimeError("huggingface_hub não está instalado.")
        return hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            cache_dir=str(self._settings.resolved_model_cache_dir),
        )

    def _is_model_cached(self, profile: ModelProfile) -> bool:
        if try_to_load_from_cache is None:
            return False
        try:
            result = try_to_load_from_cache(
                repo_id=profile.gguf_repo,
                filename=profile.gguf_file,
                cache_dir=str(self._settings.resolved_model_cache_dir),
            )
            return result is not None and isinstance(result, str)
        except Exception:
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
            msg = "llama-server encerrou inesperadamente."
            if tail:
                msg += f"\n\nÚltimas linhas do log ({self._log_path}):\n{tail}"
            self._last_error = msg
            logger.error(msg)
            return False
        return self._model_status == "loaded"

    @property
    def supports_vision(self) -> bool:
        return self._has_vision

    @property
    def cuda_available(self) -> bool:
        if self._cuda_detected is None:
            try:
                subprocess.run(["nvidia-smi"], capture_output=True, timeout=5, check=True)
                self._cuda_detected = True
            except Exception:
                self._cuda_detected = False
        return self._cuda_detected

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
    def setup_status(self) -> str:
        if not self._settings.enable_model_loading:
            return "Carregamento do modelo desativado no backend/.env (ENABLE_MODEL_LOADING=false)."
        if self._find_server_binary() is None:
            return "llama-server não encontrado. Execute install.cmd para baixar os binários."
        if self._model_status == "loading":
            profile = self._profiles[self._active_model_key]
            return f"Carregando {profile.label} ({profile.summary.lower()})..."
        if self._last_error:
            return f"Falha ao carregar o modelo: {self._last_error}"
        if not self.is_loaded:
            if self._load_attempted:
                return "O carregamento do modelo foi tentado, mas não foi concluído."
            return "O modelo ainda não foi carregado. Reinicie o backend para iniciar o carregamento."
        profile = self._profiles[self._active_model_key]
        return f"{profile.label} pronto para inferência local."

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
                logger.warning("llama-server não encontrado, pulando carregamento.")
                return
            self._load_selected_model(self._active_model_key)

    def ensure_default_models_cached_async(self) -> None:
        if hf_hub_download is None:
            return

        def worker() -> None:
            for profile in self._profiles.values():
                try:
                    self._download_gguf(profile.gguf_repo, profile.gguf_file)
                    if profile.mmproj_file:
                        self._download_gguf(profile.gguf_repo, profile.mmproj_file)
                except Exception:
                    continue

        Thread(target=worker, daemon=True).start()

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
            raise ValueError("Modelo solicitado não suportado.")

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
            return f"Servidor retornou erro {exc.response.status_code}."
        return str(exc)

    # ── Generation (HTTP → llama-server) ─────────────────────────

    _MAX_CONTINUATIONS = 5  # safety cap for auto-continue loops

    def generate_reply_stream(self, messages: list[dict[str, Any]], enable_thinking: bool = False) -> Iterator[str]:
        if not self.is_loaded:
            yield f"Setup pendente do modelo: {self.setup_status}"
            return

        prepared = self._prepare_messages(messages, enable_thinking)
        accumulated: list[str] = []

        for _round in range(1 + self._MAX_CONTINUATIONS):
            finish_reason: str | None = None
            try:
                with self._client.stream(
                    "POST",
                    f"{self._server_url}/v1/chat/completions",
                    json={
                        "messages": prepared,
                        "max_tokens": 4096,
                        "temperature": 1.0,
                        "top_p": 0.95,
                        "top_k": 64,
                        "stream": True,
                    },
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
            except Exception as exc:
                yield f"Erro durante geração: {self._extract_server_error(exc)}"
                return

            # Auto-continue if generation was truncated by max_tokens
            if finish_reason == "length":
                text_so_far = "".join(accumulated)
                prepared = prepared + [{"role": "assistant", "content": text_so_far}]
                accumulated = []
                continue
            break

    def generate_reply(self, messages: list[dict[str, Any]], enable_thinking: bool = False) -> str:
        if not self.is_loaded:
            return f"Setup pendente do modelo: {self.setup_status}"

        prepared = self._prepare_messages(messages, enable_thinking)
        parts: list[str] = []

        for _round in range(1 + self._MAX_CONTINUATIONS):
            try:
                response = self._client.post(
                    f"{self._server_url}/v1/chat/completions",
                    json={
                        "messages": prepared,
                        "max_tokens": 4096,
                        "temperature": 1.0,
                        "top_p": 0.95,
                        "top_k": 64,
                        "stream": False,
                    },
                )
                response.raise_for_status()
                data = response.json()
                choices = data.get("choices", [])
                if not choices:
                    break
                content = choices[0].get("message", {}).get("content", "")
                finish_reason = choices[0].get("finish_reason")
                cleaned = self._clean_text(content)
                parts.append(cleaned)

                if finish_reason == "length":
                    text_so_far = "".join(parts)
                    prepared = prepared + [{"role": "assistant", "content": text_so_far}]
                    continue
                break
            except Exception as exc:
                parts.append(f"Erro durante geração: {self._extract_server_error(exc)}")
                break

        return "".join(parts)


model_service = ModelService()
