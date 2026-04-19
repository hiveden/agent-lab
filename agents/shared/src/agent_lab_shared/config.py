"""环境变量 / 配置。读 .env 然后暴露 settings 单例。

DEPLOY_ENV=production 时触发启动校验，防止用 dev 默认值跑生产。
"""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _candidate_env_files() -> list[Path]:
    """按优先级返回可能的 .env 位置。先 cwd,后 agents/radar,后 agents/shared。"""
    here = Path(__file__).resolve()
    # agents/shared/src/agent_lab_shared/config.py -> agents/
    agents_dir = here.parents[3]
    repo_root = agents_dir.parent
    return [
        Path.cwd() / ".env",
        agents_dir / "radar" / ".env",
        agents_dir / "shared" / ".env",
        repo_root / ".env",
    ]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=[str(p) for p in _candidate_env_files()],
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Deploy
    deploy_env: str = Field(default="development", alias="DEPLOY_ENV")

    # LLM
    llm_provider: str = Field(default="glm", alias="LLM_PROVIDER")
    glm_api_key: str = Field(default="", alias="GLM_API_KEY")
    glm_base_url: str = Field(default="https://open.bigmodel.cn/api/paas/v4", alias="GLM_BASE_URL")
    llm_model_push: str = Field(default="glm-4-flash", alias="LLM_MODEL_PUSH")
    llm_model_chat: str = Field(default="glm-4.6", alias="LLM_MODEL_CHAT")
    llm_model_tool: str = Field(default="glm-4.6", alias="LLM_MODEL_TOOL")

    # Platform
    radar_write_token: str = Field(default="dev-radar-token-change-me", alias="RADAR_WRITE_TOKEN")
    platform_api_base: str = Field(default="http://127.0.0.1:8788", alias="PLATFORM_API_BASE")
    default_user_id: str = Field(default="default_user", alias="DEFAULT_USER_ID")

    # Grok
    grok_api_key: str = Field(default="", alias="GROK_API_KEY")

    # Tavily (web search)
    tavily_api_key: str = Field(default="", alias="TAVILY_API_KEY")

    # Agent service
    radar_agent_port: int = Field(default=8001, alias="RADAR_AGENT_PORT")

    # CORS: 默认 dev origins; prod 设 ALLOWED_ORIGINS (CSV, 例:
    # "https://agent-lab.pages.dev,https://www.agent-lab.dev")
    allowed_origins: str = Field(
        default="http://localhost:8788,http://127.0.0.1:8788",
        alias="ALLOWED_ORIGINS",
    )

    # LangSmith (LLM observability — zero-code tracing via env vars)
    langsmith_api_key: str = Field(default="", alias="LANGSMITH_API_KEY")
    langsmith_project: str = Field(default="radar", alias="LANGSMITH_PROJECT")
    langsmith_tracing: bool = Field(default=False, alias="LANGSMITH_TRACING")

    # Langfuse (LLM-specific trace + eval — Phase 2 of docs/22)
    langfuse_public_key: str = Field(default="", alias="LANGFUSE_PUBLIC_KEY")
    langfuse_secret_key: str = Field(default="", alias="LANGFUSE_SECRET_KEY")
    langfuse_host: str = Field(default="https://cloud.langfuse.com", alias="LANGFUSE_HOST")

    # GlitchTip / Sentry (Phase 4 #3 of docs/22) — 错误聚合
    sentry_dsn: str = Field(default="", alias="SENTRY_DSN")

    # Proxy (local dev needs proxy, production does not)
    https_proxy: str = Field(default="", alias="HTTPS_PROXY")
    http_proxy: str = Field(default="", alias="HTTP_PROXY")

    @model_validator(mode="after")
    def validate_production(self) -> Settings:
        """DEPLOY_ENV=production 时强制校验关键配置。"""
        if self.deploy_env != "production":
            return self

        errors: list[str] = []

        if not self.glm_api_key:
            errors.append("GLM_API_KEY is required in production")

        if self.radar_write_token == "dev-radar-token-change-me":
            errors.append("RADAR_WRITE_TOKEN must be changed from default in production")

        if "127.0.0.1" in self.platform_api_base or "localhost" in self.platform_api_base:
            errors.append(
                f"PLATFORM_API_BASE cannot be localhost in production (got: {self.platform_api_base})"
            )

        # CORS 收紧: 生产不能是 "*" 或含 localhost
        origins = [o.strip() for o in self.allowed_origins.split(",") if o.strip()]
        if "*" in origins or any("localhost" in o or "127.0.0.1" in o for o in origins):
            errors.append(
                f"ALLOWED_ORIGINS must be prod domain(s) only in production "
                f"(got: {self.allowed_origins}). Example: "
                "'https://agent-lab.pages.dev,https://www.agent-lab.dev'"
            )

        if errors:
            raise ValueError("Production config validation failed:\n  - " + "\n  - ".join(errors))

        return self


settings = Settings()


def _sync_langsmith_env(s: Settings) -> None:
    """将 Settings 中的 LangSmith 配置同步到 os.environ。

    LangChain/langsmith SDK 直接读 os.environ，而 pydantic-settings
    读 .env 文件后不会回写 os.environ，需要手动桥接。
    """
    if s.langsmith_api_key:
        os.environ.setdefault("LANGSMITH_API_KEY", s.langsmith_api_key)
    if s.langsmith_project:
        os.environ.setdefault("LANGSMITH_PROJECT", s.langsmith_project)
    # langsmith 检查 LANGSMITH_TRACING=true (字符串)
    if s.langsmith_tracing:
        os.environ.setdefault("LANGSMITH_TRACING", "true")


def _sync_langfuse_env(s: Settings) -> None:
    """同步 Langfuse 配置到 os.environ (langfuse SDK 直接读)。"""
    if s.langfuse_public_key:
        os.environ.setdefault("LANGFUSE_PUBLIC_KEY", s.langfuse_public_key)
    if s.langfuse_secret_key:
        os.environ.setdefault("LANGFUSE_SECRET_KEY", s.langfuse_secret_key)
    if s.langfuse_host:
        os.environ.setdefault("LANGFUSE_HOST", s.langfuse_host)


_sync_langsmith_env(settings)
_sync_langfuse_env(settings)


def langfuse_enabled() -> bool:
    """Langfuse 是否已配置 (PUBLIC_KEY + SECRET_KEY 都填)。"""
    return bool(settings.langfuse_public_key and settings.langfuse_secret_key)
