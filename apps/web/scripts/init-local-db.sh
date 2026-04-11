#!/usr/bin/env bash
# Initialize local D1 database for agent-lab dev.
# Usage: bash apps/web/scripts/init-local-db.sh
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WEB_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

cd "$WEB_DIR"

echo "[init-local-db] applying migrations/0001_init.sql ..."
pnpm exec wrangler d1 execute agent-lab-dev --local --file=./migrations/0001_init.sql

echo "[init-local-db] applying migrations/0002_sources_raw_items_runs.sql ..."
pnpm exec wrangler d1 execute agent-lab-dev --local --file=./migrations/0002_sources_raw_items_runs.sql

echo "[init-local-db] done. Local state at: $WEB_DIR/.wrangler/state"
