"""Shared fixtures for Radar agent tests."""

import os

# Force test defaults
os.environ["PLATFORM_API_BASE"] = "http://127.0.0.1:8788"
os.environ["RADAR_WRITE_TOKEN"] = "test-token"
