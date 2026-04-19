"""Shared fixtures for Radar agent tests."""

import os

# Force test defaults
os.environ["PLATFORM_API_BASE"] = "http://127.0.0.1:8788"
os.environ["RADAR_WRITE_TOKEN"] = "test-token"
# 单元测试不经过 LiteLLM Proxy (通常未起, 且 provider 名可能不在 config.yaml 里);
# 降级直连让 ChatOpenAI 直接用 settings.glm_base_url. 端到端 / smoke / e2e 时
# 显式 unset 或设具体 URL 走 LiteLLM.
os.environ.setdefault("LITELLM_PROXY_URL", "disabled")
# LangSmith 默认关 (测试机无 token, 避免 401 背景 thread 污染 log)
os.environ.setdefault("LANGSMITH_TRACING", "false")
os.environ.setdefault("LANGCHAIN_TRACING_V2", "false")
