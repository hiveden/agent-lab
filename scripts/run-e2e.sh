#!/usr/bin/env bash
# E2E 全流程闭环测试（带录屏）
#
# 用法: bash scripts/run-e2e.sh
#
# 自动执行:
#   1. 初始化 D1 数据库（含 seed）
#   2. 启动 Next.js dev server (:8788)
#   3. 启动 Python Agent server (:8001)
#   4. 等待两个服务就绪
#   5. 运行 Playwright E2E 测试（录屏 + trace）
#   6. 停止所有服务
#
# 产出:
#   apps/web/e2e/test-results/   — 录屏、截图、trace
#   apps/web/playwright-report/  — HTML 报告

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
WEB_DIR="$ROOT_DIR/apps/web"
RADAR_DIR="$ROOT_DIR/agents/radar"

# PID 文件
NEXTJS_PID=""
PYTHON_PID=""

cleanup() {
  echo ""
  echo "🧹 Cleaning up..."
  [ -n "$NEXTJS_PID" ] && kill "$NEXTJS_PID" 2>/dev/null && echo "   Stopped Next.js (PID $NEXTJS_PID)"
  [ -n "$PYTHON_PID" ] && kill "$PYTHON_PID" 2>/dev/null && echo "   Stopped Python Agent (PID $PYTHON_PID)"
  wait 2>/dev/null
}
trap cleanup EXIT

echo "═══════════════════════════════════════════════════"
echo "  agent-lab E2E Full Loop Test"
echo "═══════════════════════════════════════════════════"

# ── Step 1: Init DB ──
echo ""
echo "📦 Step 1: Initializing D1 database..."
cd "$WEB_DIR"
bash scripts/init-local-db.sh 2>&1 | grep -E "^\[|done"

echo "📦 Step 1b: Clearing test data (keep schema + seed)..."
pnpm exec wrangler d1 execute agent-lab-dev --local --command \
  "DELETE FROM chat_messages; DELETE FROM chat_sessions; DELETE FROM user_states; DELETE FROM items; DELETE FROM raw_items; DELETE FROM runs; DELETE FROM sources WHERE id != 'src_hn_top'; UPDATE sources SET attention_weight = 1.0 WHERE id = 'src_hn_top';" 2>/dev/null || true
echo "   Done — clean state"

# ── Step 2: Start Next.js ──
echo ""
echo "🌐 Step 2: Starting Next.js dev server on :8788..."
cd "$WEB_DIR"
pnpm dev > /tmp/agent-lab-nextjs.log 2>&1 &
NEXTJS_PID=$!
echo "   PID: $NEXTJS_PID"

# ── Step 3: Start Python Agent ──
echo ""
echo "🐍 Step 3: Starting Python Agent on :8001..."
cd "$ROOT_DIR"
uv run radar-serve > /tmp/agent-lab-python.log 2>&1 &
PYTHON_PID=$!
echo "   PID: $PYTHON_PID"

# ── Step 4: Wait for services ──
echo ""
echo "⏳ Step 4: Waiting for services to be ready..."

wait_for_service() {
  local url=$1
  local name=$2
  local max_wait=30
  local waited=0
  while [ $waited -lt $max_wait ]; do
    if curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null | grep -qE "^(200|302|308)"; then
      echo "   ✓ $name ready (${waited}s)"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "   ✗ $name failed to start after ${max_wait}s"
  echo "   Check logs: /tmp/agent-lab-${name,,}.log"
  return 1
}

wait_for_service "http://127.0.0.1:8788" "Next.js"
wait_for_service "http://127.0.0.1:8001/health" "Python Agent"

# ── Step 5: Run E2E ──
echo ""
echo "🎬 Step 5: Running Playwright E2E tests (with recording)..."
echo ""
cd "$WEB_DIR"

# 清理旧结果
rm -rf e2e/test-results playwright-report

if [ -n "${E2E_FILTER:-}" ]; then
  npx playwright test -g "$E2E_FILTER" --reporter=list 2>&1
else
  npx playwright test --reporter=list 2>&1
fi
E2E_EXIT=$?

# ── Step 6: Results ──
echo ""
echo "═══════════════════════════════════════════════════"
if [ $E2E_EXIT -eq 0 ]; then
  echo "  ✅ E2E PASSED"
else
  echo "  ❌ E2E FAILED (exit code: $E2E_EXIT)"
fi
echo "═══════════════════════════════════════════════════"
echo ""
echo "📁 Results:"
echo "   Videos:      $WEB_DIR/e2e/test-results/"
echo "   Screenshots: $WEB_DIR/e2e/test-results/*.png"
echo "   HTML Report: npx playwright show-report"
echo "   Trace:       npx playwright show-trace e2e/test-results/*/trace.zip"
echo ""

exit $E2E_EXIT
