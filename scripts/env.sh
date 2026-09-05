# Source from the repository root on the shared VPS. No global shell changes.
source /home/paseo-agent/remote-ai/env.sh
export PATH="$PWD/.local/toolchain/node_modules/@oven/bun-linux-aarch64/bin:$PATH"
export BUN_INSTALL_CACHE_DIR="$PWD/.local/bun-cache"
