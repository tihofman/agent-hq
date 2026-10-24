#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/apps/agent-hq/build/client"

if [[ ! -d "$CLIENT_DIR" ]]; then
  echo "Error: Client bundle directory '$CLIENT_DIR' does not exist." >&2
  echo "Run 'npx nx build agent-hq' before checking." >&2
  exit 1
fi

FORBIDDEN_PATTERN='process\.version([^a-zA-Z0-9_]|$)|RedisError|bullmq|ioredis'

matches=$(grep -rnE "$FORBIDDEN_PATTERN" "$CLIENT_DIR" 2>/dev/null || true)

if [[ -n "$matches" ]]; then
  echo "Error: Client bundle contains forbidden server/database references:" >&2
  echo "$matches" | head -n 20 >&2
  exit 1
fi

echo "Client bundle check passed: no server/redis/bullmq code detected in $CLIENT_DIR."
