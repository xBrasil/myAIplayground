#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pre-commit / pre-release validation for My AI Playground.

Runs:
  1. Locale JSON key parity check (all locale files must share the same keys)
  2. Frontend TypeScript type-check  (tsc -b)
  3. Frontend production build        (vite build)
  4. Backend Python syntax check       (py_compile on all .py files)

Exit code 0 = all passed, 1 = failure.

Usage:
    python scripts/test.py
"""

import json
import os
import py_compile
import shutil
import subprocess
import sys
from pathlib import Path

# Ensure UTF-8 output even on Windows terminals with narrow encodings
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = REPO_ROOT / "frontend"
BACKEND_DIR = REPO_ROOT / "backend"
LOCALES_DIR = FRONTEND_DIR / "src" / "locales"

RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RESET = "\033[0m"
CHECK = f"{GREEN}\u2713{RESET}"
CROSS = f"{RED}\u2717{RESET}"

failures: list[str] = []


def section(title: str) -> None:
    print(f"\n{YELLOW}--- {title} ---{RESET}")


def ok(msg: str) -> None:
    print(f"  {CHECK} {msg}")


def fail(msg: str) -> None:
    print(f"  {CROSS} {msg}")
    failures.append(msg)


# ── 1. Locale key parity ────────────────────────────────────────────

def collect_keys(obj: object, prefix: str = "") -> set[str]:
    """Recursively collect all keys from a JSON object (ignoring array contents)."""
    keys: set[str] = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            full = f"{prefix}.{k}" if prefix else k
            keys.add(full)
            if isinstance(v, dict):
                keys |= collect_keys(v, full)
    return keys


def check_locales() -> None:
    section("Locale key parity")
    locale_files = sorted(LOCALES_DIR.glob("*.json"))
    if len(locale_files) < 2:
        fail("Less than 2 locale files found")
        return

    locale_keys: dict[str, set[str]] = {}
    for lf in locale_files:
        try:
            data = json.loads(lf.read_text("utf-8"))
        except Exception as e:
            fail(f"{lf.name}: invalid JSON — {e}")
            continue
        locale_keys[lf.name] = collect_keys(data)

    reference_name = "en-US.json"
    if reference_name not in locale_keys:
        reference_name = next(iter(locale_keys))

    reference = locale_keys[reference_name]
    all_ok = True

    for name, keys in locale_keys.items():
        missing = reference - keys
        extra = keys - reference
        if missing:
            fail(f"{name}: missing keys vs {reference_name}: {sorted(missing)}")
            all_ok = False
        if extra:
            fail(f"{name}: extra keys vs {reference_name}: {sorted(extra)}")
            all_ok = False

    if all_ok:
        ok(f"All {len(locale_files)} locale files have identical keys ({len(reference)} keys)")


# ── 2. Frontend TypeScript check ────────────────────────────────────

def check_typescript() -> None:
    section("Frontend TypeScript type-check")
    result = subprocess.run(
        ["npx", "tsc", "-b"],
        cwd=FRONTEND_DIR,
        capture_output=True, text=True,
        shell=True,
    )
    if result.returncode != 0:
        fail("TypeScript type-check failed")
        # Print first 30 lines of errors
        for line in (result.stdout + result.stderr).splitlines()[:30]:
            print(f"    {line}")
    else:
        ok("tsc -b passed")


# ── 3. Frontend Vite build ──────────────────────────────────────────

def check_vite_build() -> None:
    section("Frontend Vite build")
    result = subprocess.run(
        ["npx", "vite", "build"],
        cwd=FRONTEND_DIR,
        capture_output=True, text=True,
        shell=True,
    )
    if result.returncode != 0:
        fail("Vite build failed")
        for line in (result.stdout + result.stderr).splitlines()[:30]:
            print(f"    {line}")
    else:
        ok("vite build passed")


# ── 4. Backend Python syntax ────────────────────────────────────────

def check_python_syntax() -> None:
    section("Backend Python syntax check")
    py_files = list(BACKEND_DIR.rglob("*.py"))
    errors = 0
    for py_file in py_files:
        try:
            py_compile.compile(str(py_file), doraise=True)
        except py_compile.PyCompileError as e:
            fail(str(e))
            errors += 1
    if errors == 0:
        ok(f"All {len(py_files)} Python files compile OK")


# ── 5. Inno Setup compiler available ────────────────────────────────

INNO_SEARCH_PATHS = [
    Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Inno Setup 6" / "ISCC.exe",
    Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Inno Setup 6" / "ISCC.exe",
    Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Inno Setup 6" / "ISCC.exe",
]


def find_iscc() -> Path | None:
    iscc = shutil.which("iscc") or shutil.which("ISCC")
    if iscc:
        return Path(iscc)
    for p in INNO_SEARCH_PATHS:
        if p.exists():
            return p
    return None


def check_inno_setup() -> None:
    section("Inno Setup compiler")
    if sys.platform != "win32":
        ok("Skipped (not Windows)")
        return
    iss_file = REPO_ROOT / "scripts" / "installer.iss"
    if not iss_file.exists():
        fail("scripts/installer.iss not found")
        return
    iscc = find_iscc()
    if not iscc:
        fail("Inno Setup 6 (ISCC.exe) not found — install via: winget install JRSoftware.InnoSetup")
        return
    # Dry-run compile check (no output file)
    result = subprocess.run(
        [str(iscc), "/Qp", f"/DRepoDir={REPO_ROOT}", "/DAppVer=0.0.0",
         "/O-",  # discard output — just check compilation
         str(iss_file)],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    if result.returncode != 0:
        fail("Inno Setup compilation check failed")
        for line in (result.stdout + result.stderr).splitlines()[:15]:
            print(f"    {line}")
    else:
        ok(f"installer.iss compiles OK (ISCC: {iscc})")


# ── Main ────────────────────────────────────────────────────────────

def main() -> int:
    print(f"{YELLOW}Running pre-commit/pre-release checks...{RESET}")
    check_locales()
    # Generate app-info.ts before TS/Vite checks
    subprocess.run(
        ["node", "scripts/generate-app-info.mjs"],
        cwd=FRONTEND_DIR, capture_output=True, shell=True,
    )
    check_typescript()
    check_vite_build()
    check_python_syntax()
    check_inno_setup()

    print()
    if failures:
        print(f"{RED}FAILED — {len(failures)} issue(s):{RESET}")
        for f in failures:
            print(f"  {CROSS} {f}")
        return 1

    print(f"{GREEN}ALL CHECKS PASSED{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
