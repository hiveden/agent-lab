"""Shared fixtures for Radar agent tests."""

import os

import pytest

# Force mock mode for all tests
os.environ["LLM_MOCK"] = "1"
os.environ["PLATFORM_API_BASE"] = "http://127.0.0.1:8788"
os.environ["RADAR_WRITE_TOKEN"] = "test-token"


@pytest.fixture
def mock_settings():
    """Ensure settings use mock mode."""
    from agent_lab_shared.config import settings
    original = settings.llm_mock
    settings.llm_mock = True
    yield settings
    settings.llm_mock = original
