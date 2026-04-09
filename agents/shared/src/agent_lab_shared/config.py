"""环境变量 / 配置。读 .env 然后暴露 settings 单例。"""

from __future__ import annotations

from pathlib import Path

from pydantic import Field
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
    default_user_id: str = Field(default="alex", alias="DEFAULT_USER_ID")

    # Agent service
    radar_agent_port: int = Field(default=8001, alias="RADAR_AGENT_PORT")


settings = Settings()
