"""
My AI Playground — System tray launcher.

Spawns the supervisor script (run.ps1 on Windows, run.sh on Linux/macOS)
with its console hidden, and exposes a tray icon with basic controls.
Shows a splash screen while services are loading.

Dependencies: pystray, Pillow (both already in backend/requirements.txt).
              tkinter (Python stdlib — used for the splash screen).
"""

import json
import locale
import os
import platform
import signal
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

# Ensure cleanup runs even on unexpected exit
import atexit

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
BACKEND_LOG = DATA_DIR / "system" / "logs" / "backend.log"
FRONTEND_LOG = DATA_DIR / "system" / "logs" / "frontend.log"
PORTS_FILE = DATA_DIR / "system" / ".ports"

IS_WINDOWS = platform.system() == "Windows"

# Default ports (used for stale-process cleanup before run.ps1 writes .ports)
_DEFAULT_BACKEND_PORT = 8000
_DEFAULT_FRONTEND_PORT = 5173

# Ports used by the application (for initial stale-process cleanup).
# Covers default ports and the fallback range used by run.ps1/run.sh.
_PORTS = list(range(8000, 8010)) + list(range(5173, 5183))


def _read_ports() -> tuple[int, int]:
    """Read dynamic port assignments from .ports file, with defaults."""
    try:
        import json
        with open(PORTS_FILE) as f:
            data = json.load(f)
        return data.get("backend", _DEFAULT_BACKEND_PORT), data.get("frontend", _DEFAULT_FRONTEND_PORT)
    except Exception:
        return _DEFAULT_BACKEND_PORT, _DEFAULT_FRONTEND_PORT


def _get_frontend_url() -> str:
    _, fp = _read_ports()
    return f"http://127.0.0.1:{fp}"


def _get_backend_health_url() -> str:
    bp, _ = _read_ports()
    return f"http://127.0.0.1:{bp}/api/health"


def _get_backend_shutdown_url() -> str:
    bp, _ = _read_ports()
    return f"http://127.0.0.1:{bp}/api/shutdown"


# ---------------------------------------------------------------------------
# Single-instance guard
# ---------------------------------------------------------------------------
_instance_mutex = None  # prevent GC on Windows


def _acquire_instance_lock() -> bool:
    """Try to acquire an OS-level single-instance lock.

    Windows: named mutex (auto-released if the process crashes).
    Unix:    flock on a lock file (auto-released if the process crashes).

    Returns True if lock acquired (we are the first instance).
    Returns False if another instance already holds the lock.
    """
    global _instance_mutex

    if IS_WINDOWS:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.restype = wintypes.HANDLE
        kernel32.CreateMutexW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR]
        kernel32.CloseHandle.restype = wintypes.BOOL
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

        ERROR_ALREADY_EXISTS = 183
        # Backslash-prefixed name lives in the Win32 named-object namespace
        name = "Global\\MyAIPlayground_SingleInstance"
        handle = kernel32.CreateMutexW(None, wintypes.BOOL(False), name)
        if not handle:
            return False
        if ctypes.get_last_error() == ERROR_ALREADY_EXISTS:
            kernel32.CloseHandle(handle)
            return False
        _instance_mutex = handle  # prevent GC
        return True
    else:
        import fcntl

        lock_path = DATA_DIR / "system" / ".tray.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        # Open (create if missing) and keep the fd alive for the process lifetime
        fd = os.open(str(lock_path), os.O_CREAT | os.O_RDWR, 0o644)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            # Write our PID for debugging
            os.ftruncate(fd, 0)
            os.write(fd, str(os.getpid()).encode())
            # Keep fd open (and thus locked) for the process lifetime
            _acquire_instance_lock._fd = fd  # type: ignore[attr-defined]
            return True
        except OSError:
            os.close(fd)
            return False


# ---------------------------------------------------------------------------
# Stale-process cleanup — kill anything already occupying our ports
# ---------------------------------------------------------------------------
def _is_our_process(pid: int) -> bool:
    """Check if a PID belongs to our app (uvicorn/app.main or vite/node)."""
    try:
        if IS_WINDOWS:
            _NO_WIN = 0x08000000
            result = subprocess.run(
                ["wmic", "process", "where", f"ProcessId={pid}",
                 "get", "CommandLine", "/VALUE"],
                capture_output=True, text=True, timeout=5,
                creationflags=_NO_WIN,
            )
            cmdline = result.stdout.lower()
        else:
            cmdline_path = f"/proc/{pid}/cmdline"
            if os.path.exists(cmdline_path):
                with open(cmdline_path, "rb") as f:
                    cmdline = f.read().replace(b"\x00", b" ").decode(errors="replace").lower()
            else:
                return False
        # Only kill if command line matches our app signatures
        repo_lower = str(REPO_ROOT).lower()
        # Require repo path in cmdline to avoid killing unrelated processes
        if repo_lower not in cmdline:
            return False
        return any(sig in cmdline for sig in [
            "app.main", "uvicorn", "vite",
        ])
    except Exception:
        return False


def _kill_stale_processes() -> None:
    """Find and kill any processes still listening on our ports from a
    previous run that wasn't shut down cleanly.
    Only kills processes whose command line matches our app signatures."""
    pids_to_kill: set[int] = set()
    my_pid = os.getpid()

    if IS_WINDOWS:
        _NO_WIN = 0x08000000  # CREATE_NO_WINDOW
        for port in _PORTS:
            try:
                result = subprocess.run(
                    ["netstat", "-ano", "-p", "TCP"],
                    capture_output=True, text=True, timeout=5,
                    creationflags=_NO_WIN,
                )
                for line in result.stdout.splitlines():
                    # Match lines like  TCP  127.0.0.1:8000  ...  LISTENING  1234
                    parts = line.split()
                    if len(parts) >= 5 and f"127.0.0.1:{port}" in parts[1]:
                        if "LISTENING" in parts or "ESTABLISHED" in parts:
                            try:
                                pid = int(parts[-1])
                                if pid > 0 and pid != my_pid and _is_our_process(pid):
                                    pids_to_kill.add(pid)
                            except ValueError:
                                pass
            except Exception:
                pass

        for pid in pids_to_kill:
            try:
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(pid)],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    creationflags=_NO_WIN, timeout=5,
                )
            except Exception:
                pass
    else:
        # Unix: use lsof to find PIDs on our ports
        for port in _PORTS:
            try:
                result = subprocess.run(
                    ["lsof", "-ti", f"TCP:{port}", "-sTCP:LISTEN"],
                    capture_output=True, text=True, timeout=5,
                )
                for line in result.stdout.strip().splitlines():
                    try:
                        pid = int(line.strip())
                        if pid > 0 and pid != my_pid and _is_our_process(pid):
                            pids_to_kill.add(pid)
                    except ValueError:
                        pass
            except Exception:
                pass

        for pid in pids_to_kill:
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass

    if pids_to_kill:
        # Brief pause to let ports be released
        time.sleep(1)


# ---------------------------------------------------------------------------
# i18n — reuses the same locale JSONs as the frontend / PowerShell scripts
# ---------------------------------------------------------------------------
_strings: dict[str, str] = {}


def _load_i18n() -> None:
    global _strings
    locales_dir = REPO_ROOT / "frontend" / "src" / "locales"
    # Determine system locale (e.g. "pt_BR", "en_US")
    # locale.getdefaultlocale() is deprecated; use getlocale with fallback
    try:
        sys_locale = locale.getlocale()[0] or "en_US"
    except Exception:
        sys_locale = os.environ.get("LANG", os.environ.get("LC_ALL", "en_US")).split(".")[0]
    culture = sys_locale.replace("_", "-")  # "pt-BR"
    lang = culture.split("-")[0]  # "pt"

    candidate = locales_dir / f"{culture}.json"
    if not candidate.exists():
        # Try language prefix match
        matches = list(locales_dir.glob(f"{lang}-*.json"))
        candidate = matches[0] if matches else locales_dir / "en-US.json"

    with open(candidate, encoding="utf-8") as f:
        _strings.update(json.load(f))


def T(key: str, params: dict[str, str] | None = None) -> str:
    value = _strings.get(key, key)
    if params:
        for k, v in params.items():
            value = value.replace("{{" + k + "}}", v)
    return value


# ---------------------------------------------------------------------------
# Splash screen (tkinter, runs in its own thread)
# ---------------------------------------------------------------------------
class SplashScreen:
    """A minimal loading window shown while services start up."""

    def __init__(self) -> None:
        self._status_text = ""
        self._should_close = False
        self.cancelled = False
        self._root = None
        self._thread: threading.Thread | None = None

    def show(self) -> None:
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def update_status(self, text: str) -> None:
        self._status_text = text

    def close(self) -> None:
        self._should_close = True

    # noinspection PyBroadException
    def _run(self) -> None:
        try:
            import tkinter as tk
        except ImportError:
            return  # tkinter not available — skip splash silently

        BG = "#1e1e1e"
        FG = "#e0e0e0"
        ACCENT = "#b87333"  # copper/bronze matching app logo

        root = tk.Tk()
        self._root = root
        root.title("My AI Playground")
        root.configure(bg=BG)
        root.resizable(False, False)

        # DPI scaling — tkinter already scales font *point* sizes when
        # DPI awareness is enabled, so we only scale *pixel* values
        # (geometry, padding, logo size, border width).
        dpi = root.winfo_fpixels('1i')  # actual DPI
        scale = dpi / 96.0
        def S(val: int | float) -> int:
            """Scale a pixel value by the DPI factor."""
            return round(val * scale)

        W, H = S(420), S(300)
        sx = root.winfo_screenwidth() // 2 - W // 2
        sy = root.winfo_screenheight() // 2 - H // 2
        root.geometry(f"{W}x{H}+{sx}+{sy}")

        # Disable the close button but keep the title bar so the window
        # appears in the taskbar.  Minimize/maximize remain functional.
        root.protocol("WM_DELETE_WINDOW", lambda: None)

        # Set window icon (favicon.ico)
        try:
            ico = str(REPO_ROOT / "frontend" / "public" / "favicon.ico")
            root.iconbitmap(ico)
        except Exception:
            pass

        # Start on top so the user sees it, then drop topmost after a moment
        # so other windows can cover it when the user clicks away.
        root.attributes("-topmost", True)
        root.after(800, lambda: root.attributes("-topmost", False))

        # Rounded-corner border effect via a frame
        bw = max(S(2), 2)
        border = tk.Frame(root, bg=ACCENT, padx=bw, pady=bw)
        border.pack(fill="both", expand=True)
        inner = tk.Frame(border, bg=BG)
        inner.pack(fill="both", expand=True)

        # --- Logo ---
        logo_path = REPO_ROOT / "frontend" / "public" / "android-chrome-192x192.png"
        photo = None
        logo_size = S(80)
        if logo_path.exists():
            try:
                from PIL import Image, ImageTk
                img = Image.open(logo_path).resize((logo_size, logo_size), Image.LANCZOS)
                photo = ImageTk.PhotoImage(img)
                logo_label = tk.Label(inner, image=photo, bg=BG)
                logo_label.image = photo  # prevent GC
                logo_label.pack(pady=(S(24), S(8)))
            except Exception:
                pass

        # --- Title ---
        tk.Label(
            inner, text="My AI Playground", font=("Segoe UI", 16, "bold"),
            fg=FG, bg=BG,
        ).pack(pady=(S(8) if photo else S(24), S(4)))

        # --- "Loading, please wait..." ---
        tk.Label(
            inner, text=T("script.tray.splash.loading"),
            font=("Segoe UI", 10), fg="#aaaaaa", bg=BG,
        ).pack(pady=(0, S(2)))

        tk.Label(
            inner, text=T("script.tray.splash.doNotClose"),
            font=("Segoe UI", 9, "italic"), fg="#777777", bg=BG,
        ).pack(pady=(0, S(12)))

        # --- Status line ---
        status_var = tk.StringVar(value="")
        tk.Label(
            inner, textvariable=status_var, font=("Segoe UI", 9),
            fg=ACCENT, bg=BG,
        ).pack(pady=(0, S(12)))

        # --- Cancel button ---
        def on_cancel():
            self.cancelled = True
            self._should_close = True

        cancel_btn = tk.Button(
            inner, text=T("script.tray.splash.cancel"),
            font=("Segoe UI", 9), fg=FG, bg="#333333",
            activeforeground=FG, activebackground="#444444",
            relief="flat", padx=S(16), pady=S(4), cursor="hand2",
            command=on_cancel,
        )
        cancel_btn.pack(pady=(0, S(16)))

        # --- Poll loop: update status / close ---
        def poll():
            if self._should_close:
                try:
                    root.destroy()
                except Exception:
                    pass
                return
            status_var.set(self._status_text)
            root.after(150, poll)

        root.after(150, poll)

        try:
            root.mainloop()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Supervisor process management
# ---------------------------------------------------------------------------
_supervisor: subprocess.Popen | None = None
_supervisor_lock = threading.Lock()


def _start_supervisor() -> subprocess.Popen:
    if IS_WINDOWS:
        # Run run.ps1 with --NoBrowser (tray handles the browser opening)
        # CREATE_NO_WINDOW hides the PowerShell console entirely.
        CREATE_NO_WINDOW = 0x08000000
        proc = subprocess.Popen(
            [
                "powershell.exe",
                "-ExecutionPolicy", "Bypass",
                "-File", str(REPO_ROOT / "scripts" / "run.ps1"),
                "-NoBrowser",
            ],
            cwd=str(REPO_ROOT),
            creationflags=CREATE_NO_WINDOW,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        # Unix: use bash explicitly to avoid PermissionError if execute bit is missing.
        proc = subprocess.Popen(
            ["bash", str(REPO_ROOT / "run.sh"), "--no-browser"],
            cwd=str(REPO_ROOT),
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    return proc


def _kill_supervisor_tree(proc: subprocess.Popen) -> None:
    """Kill the supervisor and all its descendant processes."""
    if proc.poll() is not None:
        return
    if IS_WINDOWS:
        # taskkill /T kills the entire process tree
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=0x08000000,
        )
    else:
        # Kill the whole process group
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except OSError:
            pass
        time.sleep(1)
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except OSError:
            pass


def _graceful_shutdown() -> None:
    """POST /api/shutdown then kill the supervisor tree as fallback."""
    try:
        import urllib.request
        _, fp = _read_ports()
        req = urllib.request.Request(
            _get_backend_shutdown_url(),
            data=b"",
            method="POST",
            headers={"Origin": f"http://127.0.0.1:{fp}"},
        )
        urllib.request.urlopen(req, timeout=3)
    except Exception:
        pass

    time.sleep(2)

    with _supervisor_lock:
        if _supervisor and _supervisor.poll() is None:
            _kill_supervisor_tree(_supervisor)


def _atexit_cleanup() -> None:
    """Last-resort cleanup: kill the supervisor tree if still alive."""
    with _supervisor_lock:
        if _supervisor and _supervisor.poll() is None:
            _kill_supervisor_tree(_supervisor)


atexit.register(_atexit_cleanup)


def _check_health() -> bool:
    try:
        import urllib.request
        resp = urllib.request.urlopen(_get_backend_health_url(), timeout=3)
        if not (200 <= resp.status < 300):
            return False
        # Validate the response is actually our backend (not an unrelated service)
        body = json.loads(resp.read().decode("utf-8", errors="replace"))
        return isinstance(body.get("app_name"), str) and "model_status" in body
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Tray actions
# ---------------------------------------------------------------------------
def _on_open_browser(icon, item) -> None:  # noqa: ARG001
    webbrowser.open(_get_frontend_url())


def _on_view_logs(icon, item) -> None:  # noqa: ARG001
    logs = [BACKEND_LOG, FRONTEND_LOG]
    for log_path in logs:
        if log_path.exists():
            if IS_WINDOWS:
                os.startfile(str(log_path))  # noqa: S606
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", str(log_path)])
            else:
                subprocess.Popen(["xdg-open", str(log_path)])


def _on_restart(icon, item) -> None:  # noqa: ARG001
    global _supervisor
    with _supervisor_lock:
        if _supervisor and _supervisor.poll() is None:
            _kill_supervisor_tree(_supervisor)
            try:
                _supervisor.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass  # tree kill already issued; proceed with restart
            except OSError:
                pass
        _supervisor = _start_supervisor()
    icon.title = T("script.tray.tooltip.running")


def _on_quit(icon, item) -> None:  # noqa: ARG001
    icon.title = T("script.tray.tooltip.stopping")
    _graceful_shutdown()
    icon.stop()


# ---------------------------------------------------------------------------
# Monitor thread — updates tooltip based on health, drives splash screen
# ---------------------------------------------------------------------------
_splash: SplashScreen | None = None


def _check_frontend_ready() -> bool:
    try:
        import urllib.request
        resp = urllib.request.urlopen(_get_frontend_url(), timeout=3)
        return 200 <= resp.status < 400
    except Exception:
        return False


def _monitor_health(icon) -> None:
    """Background thread: show splash, wait for services, open browser, then
    monitor health and auto-close tray when services stop."""
    global _splash

    # Wait for readiness (up to 120 s)
    deadline = time.time() + 120
    ready = False
    backend_ready = False
    frontend_ready = False

    if _splash:
        _splash.update_status(T("script.tray.splash.initServices"))

    while time.time() < deadline:
        # Check if splash was cancelled
        if _splash and _splash.cancelled:
            _graceful_shutdown()
            icon.stop()
            return

        with _supervisor_lock:
            if _supervisor and _supervisor.poll() is not None:
                break

        if not backend_ready:
            if _splash:
                _splash.update_status(T("script.tray.splash.loadingBackend"))
            if _check_health():
                backend_ready = True

        if backend_ready and not frontend_ready:
            if _splash:
                _splash.update_status(T("script.tray.splash.loadingFrontend"))
            if _check_frontend_ready():
                frontend_ready = True

        if backend_ready and frontend_ready:
            ready = True
            break

        time.sleep(2)

    if ready:
        if _splash:
            _splash.update_status(T("script.tray.splash.openingBrowser"))
        icon.title = T("script.tray.tooltip.running")
        webbrowser.open(_get_frontend_url())
        # Show a tray notification so the user knows where to find the icon
        try:
            icon.notify(T("script.tray.notification.trayInfo"), "My AI Playground")
        except Exception:
            pass
        # Close splash after browser starts so the user sees it until the
        # browser window appears on screen.
        if _splash:
            time.sleep(1.5)
            _splash.close()
    else:
        if _splash:
            _splash.close()
        icon.title = T("script.tray.tooltip.stopped")
        time.sleep(3)
        icon.stop()
        return

    # Continuous monitoring — auto-close tray when services stop
    while icon.visible:
        time.sleep(5)
        with _supervisor_lock:
            proc = _supervisor
        if proc and proc.poll() is not None:
            icon.title = T("script.tray.tooltip.stopped")
            try:
                icon.notify(T("script.tray.notification.crashed"), "My AI Playground")
            except Exception:
                pass
            time.sleep(5)
            icon.stop()
            return
        if not _check_health():
            # Backend stopped (e.g. user clicked "Parar" in UI)
            icon.title = T("script.tray.tooltip.stopped")
            # Give supervisor a moment to detect the exit and clean up
            time.sleep(3)
            _graceful_shutdown()
            time.sleep(2)
            icon.stop()
            return


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    # --- DPI awareness (Windows) — must be called before any UI ---
    if IS_WINDOWS:
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)  # PROCESS_SYSTEM_DPI_AWARE
        except Exception:
            try:
                import ctypes
                ctypes.windll.user32.SetProcessDPIAware()
            except Exception:
                pass

    _load_i18n()

    # --- Single-instance guard ---
    if not _acquire_instance_lock():
        # Another instance is already running — open browser and exit quietly
        webbrowser.open(_get_frontend_url())
        return

    # --- Kill stale processes from a previous unclean shutdown ---
    _kill_stale_processes()

    # --- Show splash screen immediately ---
    global _splash
    _splash = SplashScreen()
    _splash.show()

    # --- Load icon ---
    from PIL import Image
    icon_path = REPO_ROOT / "frontend" / "public" / "android-chrome-512x512.png"
    if IS_WINDOWS:
        ico_path = REPO_ROOT / "frontend" / "public" / "favicon.ico"
        if ico_path.exists():
            icon_path = ico_path
    image = Image.open(icon_path)

    # --- Build menu ---
    import pystray
    menu = pystray.Menu(
        pystray.MenuItem(T("script.tray.openBrowser"), _on_open_browser, default=True),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(T("script.tray.viewLogs"), _on_view_logs),
        pystray.MenuItem(T("script.tray.restart"), _on_restart),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(T("script.tray.quit"), _on_quit),
    )

    icon = pystray.Icon("myaiplayground", image, T("script.tray.tooltip.starting"), menu)

    # --- Start supervisor ---
    global _supervisor
    _supervisor = _start_supervisor()

    # --- Health monitor in background ---
    monitor = threading.Thread(target=_monitor_health, args=(icon,), daemon=True)
    monitor.start()

    # --- Run tray (blocks until icon.stop()) ---
    icon.run()

    # --- Cleanup ---
    _graceful_shutdown()


if __name__ == "__main__":
    try:
        main()
    except ImportError as e:
        # pystray not installed or not supported — fall back to run.sh / run.cmd
        print(f"Tray not available ({e}). Falling back to console launcher.")
        if IS_WINDOWS:
            os.execv(
                sys.executable,
                [sys.executable, "-c",
                 f"import subprocess; subprocess.run(['powershell.exe', '-ExecutionPolicy', 'Bypass', '-File', r'{REPO_ROOT / 'scripts' / 'run.ps1'}'])"],
            )
        else:
            os.execvp(str(REPO_ROOT / "run.sh"), [str(REPO_ROOT / "run.sh")])
