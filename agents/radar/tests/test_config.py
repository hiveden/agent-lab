"""Tests for config validation."""

import os

import pytest
from pydantic import ValidationError


def test_dev_mode_loads_ok():
    """Development mode should load without errors even with dev defaults."""
    from agent_lab_shared.config import Settings

    s = Settings(
        _env_file=None,
        DEPLOY_ENV="development",
        LLM_MOCK="1",
        RADAR_WRITE_TOKEN="dev-radar-token-change-me",
        PLATFORM_API_BASE="http://127.0.0.1:8788",
    )
    assert s.deploy_env == "development"
    assert s.llm_mock is True


def test_production_rejects_mock():
    from agent_lab_shared.config import Settings

    with pytest.raises(ValidationError, match="LLM_MOCK must be 0"):
        Settings(
            _env_file=None,
            DEPLOY_ENV="production",
            LLM_MOCK="1",
            GLM_API_KEY="real-key",
            RADAR_WRITE_TOKEN="prod-token",
            PLATFORM_API_BASE="https://app.example.com",
        )


def test_production_rejects_empty_api_key():
    from agent_lab_shared.config import Settings

    with pytest.raises(ValidationError, match="GLM_API_KEY is required"):
        Settings(
            _env_file=None,
            DEPLOY_ENV="production",
            LLM_MOCK="0",
            GLM_API_KEY="",
            RADAR_WRITE_TOKEN="prod-token",
            PLATFORM_API_BASE="https://app.example.com",
        )


def test_production_rejects_default_token():
    from agent_lab_shared.config import Settings

    with pytest.raises(ValidationError, match="RADAR_WRITE_TOKEN must be changed"):
        Settings(
            _env_file=None,
            DEPLOY_ENV="production",
            LLM_MOCK="0",
            GLM_API_KEY="real-key",
            RADAR_WRITE_TOKEN="dev-radar-token-change-me",
            PLATFORM_API_BASE="https://app.example.com",
        )


def test_production_rejects_localhost():
    from agent_lab_shared.config import Settings

    with pytest.raises(ValidationError, match="cannot be localhost"):
        Settings(
            _env_file=None,
            DEPLOY_ENV="production",
            LLM_MOCK="0",
            GLM_API_KEY="real-key",
            RADAR_WRITE_TOKEN="prod-token",
            PLATFORM_API_BASE="http://127.0.0.1:8788",
        )


def test_production_valid_config():
    from agent_lab_shared.config import Settings

    s = Settings(
        _env_file=None,
        DEPLOY_ENV="production",
        LLM_MOCK="0",
        GLM_API_KEY="real-key",
        RADAR_WRITE_TOKEN="prod-token-xyz",
        PLATFORM_API_BASE="https://app.example.com",
    )
    assert s.deploy_env == "production"
    assert s.llm_mock is False
    assert s.glm_api_key == "real-key"


def test_settings_reads_proxy():
    """Settings should load HTTPS_PROXY / HTTP_PROXY from env."""
    from agent_lab_shared.config import Settings

    s = Settings(
        _env_file=None,
        HTTPS_PROXY="http://127.0.0.1:7890",
        HTTP_PROXY="http://127.0.0.1:7890",
    )
    assert s.https_proxy == "http://127.0.0.1:7890"
    assert s.http_proxy == "http://127.0.0.1:7890"


def test_settings_proxy_defaults_empty():
    """Production without proxy should default to empty (no proxy needed)."""
    from agent_lab_shared.config import Settings

    s = Settings(_env_file=None, HTTPS_PROXY="", HTTP_PROXY="")
    assert s.https_proxy == ""
    assert s.http_proxy == ""


def test_proxy_kwargs_with_proxy(monkeypatch):
    """proxy_kwargs() should return {proxy: ...} when Settings has proxy."""
    from agent_lab_shared import config
    from agent_lab_shared.config import Settings

    mock_settings = Settings(
        _env_file=None,
        HTTPS_PROXY="http://127.0.0.1:7890",
    )
    monkeypatch.setattr(config, "settings", mock_settings)

    from radar.collectors.base import proxy_kwargs
    result = proxy_kwargs()
    assert result == {"proxy": "http://127.0.0.1:7890"}


def test_proxy_kwargs_without_proxy(monkeypatch):
    """proxy_kwargs() should return {} when no proxy configured."""
    from agent_lab_shared import config
    from agent_lab_shared.config import Settings

    mock_settings = Settings(_env_file=None, HTTPS_PROXY="", HTTP_PROXY="")
    monkeypatch.setattr(config, "settings", mock_settings)

    from radar.collectors.base import proxy_kwargs
    result = proxy_kwargs()
    assert result == {}
