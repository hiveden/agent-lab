#!/usr/bin/env bash
# 启动本地 OTel Collector — Phase 3 of docs/22
# 自动从 agents/radar/.env 读 LANGFUSE_PUBLIC_KEY/SECRET_KEY 算 base64,
# 然后 docker compose up.

set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE="../../agents/radar/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE 不存在，先填好 LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY"
  exit 1
fi

# 从 .env 读 key (兼容引号包裹 / KEY=VALUE)
PK=$(grep -E '^LANGFUSE_PUBLIC_KEY=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'" | tr -d ' ')
SK=$(grep -E '^LANGFUSE_SECRET_KEY=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'" | tr -d ' ')
HOST=$(grep -E '^LANGFUSE_HOST=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'" | tr -d ' ')

if [ -z "$PK" ] || [ -z "$SK" ]; then
  echo "ERROR: LANGFUSE_PUBLIC_KEY 或 LANGFUSE_SECRET_KEY 为空"
  exit 1
fi

# Langfuse OTel endpoint = HOST + /api/public/otel
# 自托管场景 (HOST 含 localhost) 需替换为 host.docker.internal, 让 collector
# container 通过 docker gateway 访问 host 上的 Langfuse
HOST=${HOST:-https://us.cloud.langfuse.com}
CONTAINER_HOST=$(echo "$HOST" | sed -e 's|localhost|host.docker.internal|' -e 's|127.0.0.1|host.docker.internal|')
LANGFUSE_OTEL_ENDPOINT="${CONTAINER_HOST%/}/api/public/otel"

# Basic Auth = base64(public:secret) — macOS base64 默认会换行, -i 不读 stdin? 用 tr 去换行兜底
LANGFUSE_AUTH_BASE64=$(printf '%s:%s' "$PK" "$SK" | base64 | tr -d '\n')

# 写 .env 给 docker compose 自动 load (同目录的 .env, 已 gitignore)
cat > .env <<EOF
LANGFUSE_OTEL_ENDPOINT=$LANGFUSE_OTEL_ENDPOINT
LANGFUSE_AUTH_BASE64=$LANGFUSE_AUTH_BASE64
OTEL_HTTPS_PROXY=http://host.docker.internal:7890
OTEL_HTTP_PROXY=http://host.docker.internal:7890
EOF

echo "Starting OTel Collector..."
echo "  endpoint: $LANGFUSE_OTEL_ENDPOINT"
echo "  auth:     Basic ${LANGFUSE_AUTH_BASE64:0:12}..."

docker compose up -d "$@"
sleep 3
docker compose ps
echo ""
echo "Logs: docker compose -f docker/observability/docker-compose.yml logs -f"
echo "Stop: docker compose -f docker/observability/docker-compose.yml down"
