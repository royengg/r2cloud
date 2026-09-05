# Source from the repository root on the shared VPS. No global shell changes.
source /home/paseo-agent/remote-ai/env.sh
export PATH="$PWD/.local/toolchain/node_modules/@oven/bun-linux-aarch64/bin:$PATH"
export BUN_INSTALL_CACHE_DIR="$PWD/.local/bun-cache"

# Avoid the shared runtime transpiler cache; generated Prisma clients change during development.
export BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
