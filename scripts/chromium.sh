#!/usr/bin/env bash
set -euo pipefail
R2_BROWSER_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec env LD_LIBRARY_PATH=/snap/core24/current/lib/aarch64-linux-gnu:/snap/chromium/current/usr/lib/aarch64-linux-gnu:/snap/chromium/current/usr/lib/chromium-browser "$R2_BROWSER_ROOT/.local/browser/chrome" "$@"
