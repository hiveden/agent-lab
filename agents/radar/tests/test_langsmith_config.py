"""Tests for LangSmith configuration integration."""

import os

import pytest


class TestLangSmithSettings:
    """Verify Settings correctly reads LangSmith env vars."""

    def test_defaults_tracing_off(self):
        """Default: tracing disabled, project='radar', no API key."""
        from agent_lab_shared.config import Settings

        s = Settings(_env_file=None)
        assert s.langsmith_tracing is False
        assert s.langsmith_project == "radar"
        assert s.langsmith_api_key == ""

    def test_reads_langsmith_env_vars(self):
        """Settings should correctly parse LangSmith env vars."""
        from agent_lab_shared.config import Settings

        s = Settings(
            _env_file=None,
            LANGSMITH_API_KEY="lsv2_test_key_123",
            LANGSMITH_PROJECT="my-project",
            LANGSMITH_TRACING=True,
        )
        assert s.langsmith_api_key == "lsv2_test_key_123"
        assert s.langsmith_project == "my-project"
        assert s.langsmith_tracing is True

    def test_tracing_off_does_not_pollute_environ(self, monkeypatch):
        """When tracing is off, LANGSMITH_TRACING should not be set in os.environ."""
        from agent_lab_shared.config import Settings, _sync_langsmith_env

        # Ensure clean state
        monkeypatch.delenv("LANGSMITH_TRACING", raising=False)
        monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)

        s = Settings(_env_file=None, LANGSMITH_TRACING=False)
        _sync_langsmith_env(s)

        assert os.environ.get("LANGSMITH_TRACING") is None

    def test_tracing_on_syncs_to_environ(self, monkeypatch):
        """When tracing is on, env vars should be synced to os.environ."""
        from agent_lab_shared.config import Settings, _sync_langsmith_env

        # Ensure clean state
        monkeypatch.delenv("LANGSMITH_TRACING", raising=False)
        monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
        monkeypatch.delenv("LANGSMITH_PROJECT", raising=False)

        s = Settings(
            _env_file=None,
            LANGSMITH_API_KEY="lsv2_test_key",
            LANGSMITH_PROJECT="test-proj",
            LANGSMITH_TRACING=True,
        )
        _sync_langsmith_env(s)

        assert os.environ["LANGSMITH_TRACING"] == "true"
        assert os.environ["LANGSMITH_API_KEY"] == "lsv2_test_key"
        assert os.environ["LANGSMITH_PROJECT"] == "test-proj"

    def test_sync_uses_setdefault(self, monkeypatch):
        """_sync_langsmith_env uses setdefault — does not overwrite existing env vars."""
        from agent_lab_shared.config import Settings, _sync_langsmith_env

        monkeypatch.setenv("LANGSMITH_PROJECT", "already-set")

        s = Settings(
            _env_file=None,
            LANGSMITH_PROJECT="from-settings",
            LANGSMITH_TRACING=True,
        )
        _sync_langsmith_env(s)

        # Existing env var should not be overwritten
        assert os.environ["LANGSMITH_PROJECT"] == "already-set"
