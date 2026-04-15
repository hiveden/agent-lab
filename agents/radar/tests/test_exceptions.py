"""Tests for Radar Agent custom exception hierarchy."""

import pytest

from radar.exceptions import (
    CollectorError,
    ConfigurationError,
    EvaluationError,
    PlatformAPIError,
    RadarError,
)


class TestRadarError:
    def test_message_and_context(self):
        err = RadarError("something broke", context={"key": "val"})
        assert str(err) == "something broke"
        assert err.context == {"key": "val"}

    def test_context_defaults_to_empty_dict(self):
        err = RadarError("no context")
        assert err.context == {}

    def test_is_exception(self):
        assert issubclass(RadarError, Exception)


class TestSubclasses:
    @pytest.mark.parametrize(
        "cls",
        [CollectorError, EvaluationError, PlatformAPIError, ConfigurationError],
    )
    def test_is_radar_error_subclass(self, cls):
        assert issubclass(cls, RadarError)

    @pytest.mark.parametrize(
        "cls",
        [CollectorError, EvaluationError, PlatformAPIError, ConfigurationError],
    )
    def test_instance_is_radar_error(self, cls):
        err = cls("fail")
        assert isinstance(err, RadarError)

    @pytest.mark.parametrize(
        "cls",
        [CollectorError, EvaluationError, PlatformAPIError, ConfigurationError],
    )
    def test_inherits_context(self, cls):
        err = cls("fail", context={"source": "hn"})
        assert err.context == {"source": "hn"}

    @pytest.mark.parametrize(
        "cls",
        [CollectorError, EvaluationError, PlatformAPIError, ConfigurationError],
    )
    def test_context_defaults_to_empty_dict(self, cls):
        err = cls("fail")
        assert err.context == {}


class TestCatchHierarchy:
    def test_catch_radar_error_catches_collector_error(self):
        with pytest.raises(RadarError):
            raise CollectorError("timeout")

    def test_catch_radar_error_catches_evaluation_error(self):
        with pytest.raises(RadarError):
            raise EvaluationError("parse failed")

    def test_catch_radar_error_catches_platform_api_error(self):
        with pytest.raises(RadarError):
            raise PlatformAPIError("502")

    def test_catch_radar_error_catches_configuration_error(self):
        with pytest.raises(RadarError):
            raise ConfigurationError("missing key")
