#!/usr/bin/env bash
# 一键启动 4 个可观测性栈 (docker/README.md 架构总览).
# 顺序: Langfuse → SigNoz → GlitchTip → OTel Collector (依赖它们的 endpoint)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "▶ 启动 Langfuse 自托管 (http://localhost:3010)..."
(cd langfuse && docker compose up -d)

echo "▶ 启动 SigNoz 自托管 (http://localhost:3301)..."
(cd signoz && docker compose up -d)

echo "▶ 启动 GlitchTip (http://localhost:8002)..."
(cd glitchtip && docker compose up -d)

echo "▶ 等待上述服务 ready (~30s)..."
sleep 30

echo "▶ 启动 OTel Collector (接三端 OTLP :4317/:4318)..."
bash observability/start.sh

echo ""
echo "✅ 全栈启动完成. 访问:"
echo "   Langfuse:  http://127.0.0.1:3010"
echo "   SigNoz:    http://127.0.0.1:3301"
echo "   GlitchTip: http://127.0.0.1:8002"
echo ""
echo "首次启动需要手动注册 admin (详见 docker/README.md 启动顺序章节)."
echo "停止: bash docker/stop-all.sh"
