"""环境变量 / 配置。读 .env 然后暴露 settings 单例。

DEPLOY_ENV=production 时触发启动校验，防止用 dev 默认值跑生产。
"""

from __future__ import annotations

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
    llm_mock: bool = Field(default=True, alias="LLM_MOCK")
    llm_provider: str = Field(default="glm", alias="LLM_PROVIDER")
    glm_api_key: str = Field(default="", alias="GLM_API_KEY")
    glm_base_url: str = Field(
        default="https://open.bigmodel.cn/api/paas/v4", alias="GLM_BASE_URL"
    )
    llm_model_push: str = Field(default="glm-4-flash", alias="LLM_MODEL_PUSH")
    llm_model_chat: str = Field(default="glm-4.6", alias="LLM_MODEL_CHAT")
    llm_model_tool: str = Field(default="glm-4.6", alias="LLM_MODEL_TOOL")

    # Platform
    radar_write_token: str = Field(
        default="dev-radar-token-change-me", alias="RADAR_WRITE_TOKEN"
    )
    platform_api_base: str = Field(
        default="http://127.0.0.1:8788", alias="PLATFORM_API_BASE"
    )
    default_user_id: str = Field(default="default_user", alias="DEFAULT_USER_ID")

    # Agent service
    radar_agent_port: int = Field(default=8001, alias="RADAR_AGENT_PORT")

    @model_validator(mode="after")
    def validate_production(self) -> "Settings":
        """DEPLOY_ENV=production 时强制校验关键配置。"""
        if self.deploy_env != "production":
            return self

        errors: list[str] = []

        if self.llm_mock:
            errors.append("LLM_MOCK must be 0 (false) in production")

        if not self.glm_api_key:
            errors.append("GLM_API_KEY is required in production")

        if self.radar_write_token == "dev-radar-token-change-me":
            errors.append("RADAR_WRITE_TOKEN must be changed from default in production")

        if "127.0.0.1" in self.platform_api_base or "localhost" in self.platform_api_base:
            errors.append(
                f"PLATFORM_API_BASE cannot be localhost in production (got: {self.platform_api_base})"
            )

        if errors:
            raise ValueError(
                "Production config validation failed:\n  - " + "\n  - ".join(errors)
            )

        return self


settings = Settings()
