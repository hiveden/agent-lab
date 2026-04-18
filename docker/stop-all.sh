#!/usr/bin/env bash
# 停止 4 个可观测性栈 (数据保留, 下次 up 接续).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

for d in observability glitchtip signoz langfuse; do
  echo "▶ 停止 $d..."
  (cd "$d" && docker compose down) || true
done

echo ""
echo "✅ 全栈已停止 (数据卷保留). 清理数据用 'docker compose down -v'."
