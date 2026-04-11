#!/usr/bin/env python3
"""Build a release zip for My AI Playground.

Usage:
    python scripts/release.py          # output → releases/my-ai-playground-<date>-<hash>.zip
    python scripts/release.py -o out.zip
"""

import argparse
import datetime
import os
import subprocess
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Patterns to INCLUDE (relative to repo root)
INCLUDE = [
    "install.cmd",
    "run.cmd",
    "README.md",
    "LICENSE",
    "LICENÇA",
    "VERSION",
    "backend/",
    "frontend/",
    "scripts/i18n.ps1",
    "scripts/install.ps1",
    "scripts/run.ps1",
]

# Patterns to EXCLUDE (checked against relative path parts)
EXCLUDE_DIRS = {
    "__pycache__",
    ".venv",
    "venv",
    "node_modules",
    "dist",
    ".vite",
    ".git",
    "releases",
    ".mypy_cache",
    ".ruff_cache",
    ".pytest_cache",
}

EXCLUDE_FILES = {
    ".env",
    ".env.local",
    ".gitignore",
}

# File extensions / names to exclude (build artifacts, dev-only)
EXCLUDE_EXTENSIONS = {
    ".tsbuildinfo",
}

EXCLUDE_NAMES = {
    "og-social-preview.png",
}


def read_version() -> str:
    version_file = REPO_ROOT / "VERSION"
    if version_file.exists():
        return version_file.read_text().strip()
    return "0.0.0"


def git_short_hash() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, cwd=REPO_ROOT,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except FileNotFoundError:
        pass
    return "nogit"


def should_exclude(rel: Path) -> bool:
    parts = rel.parts
    for part in parts:
        if part in EXCLUDE_DIRS:
            return True
    if rel.name in EXCLUDE_FILES:
        return True
    if rel.name in EXCLUDE_NAMES:
        return True
    if rel.suffix in EXCLUDE_EXTENSIONS:
        return True
    return False


def collect_files() -> list[Path]:
    files: list[Path] = []
    for entry in INCLUDE:
        full = REPO_ROOT / entry
        if full.is_file():
            files.append(Path(entry))
        elif full.is_dir():
            for root, dirs, filenames in os.walk(full):
                root_path = Path(root)
                rel_root = root_path.relative_to(REPO_ROOT)
                # Prune excluded dirs in-place
                dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
                for fname in filenames:
                    rel = rel_root / fname
                    if not should_exclude(rel):
                        files.append(rel)
    return sorted(set(files))


def build_zip(output: Path) -> None:
    files = collect_files()
    if not files:
        print("ERROR: No files collected!", file=sys.stderr)
        sys.exit(1)

    output.parent.mkdir(parents=True, exist_ok=True)

    # Add empty data/ scaffold directories
    data_scaffold = [
        "data/",
        "data/model-cache/",
        "data/uploads/",
    ]

    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zf:
        prefix = "myAIplayground/"
        for rel in files:
            arcname = prefix + str(rel).replace("\\", "/")
            zf.write(REPO_ROOT / rel, arcname)

        # Add empty dirs via directory entries
        for d in data_scaffold:
            zf.writestr(prefix + d, "")

    size_mb = output.stat().st_size / (1024 * 1024)
    print(f"Created {output} ({size_mb:.1f} MB, {len(files)} files)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Package My AI Playground release")
    parser.add_argument("-o", "--output", type=Path, default=None,
                        help="Output zip path (default: releases/my-ai-playground-<date>-<hash>.zip)")
    args = parser.parse_args()

    if args.output is None:
        version = read_version()
        git_hash = git_short_hash()
        name = f"my-ai-playground-v{version}-{git_hash}"
        args.output = REPO_ROOT / "releases" / f"{name}.zip"

    build_zip(args.output)


if __name__ == "__main__":
    main()
