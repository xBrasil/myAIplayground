#!/usr/bin/env bash
# My AI Playground — System tray launcher
# For debug/verbose mode with console output, use run.sh instead.
DIR="$(cd "$(dirname "$0")" && pwd)"
"$DIR/.venv/bin/python" "$DIR/scripts/tray.py" "$@" &
disown
