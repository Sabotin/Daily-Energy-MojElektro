"""Shared fixtures: a linked config entry with a key that is still valid."""

import time
from unittest.mock import AsyncMock, patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.daily_energy_mojelektro.const import DOMAIN

ACCOUNT = "ha:abc123"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


@pytest.fixture(autouse=True)
def no_meter_sync(request):
    """Every start asks porabim for the account's meters and their sensor values; only tests marked `meters` answer
    those requests."""
    if request.node.get_closest_marker("meters"):
        yield
        return
    with (
        patch("custom_components.daily_energy_mojelektro.meters.async_sync", AsyncMock()),
        patch(
            "custom_components.daily_energy_mojelektro.sensor.SensorsCoordinator._async_update_data",
            AsyncMock(return_value={"off": False, "meters": {}}),
        ),
    ):
        yield


def token(access="access-1", refresh="refresh-1", expires_at=None, account=ACCOUNT):
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "Bearer",
        "expires_in": 3600,
        "expires_at": time.time() + 3600 if expires_at is None else expires_at,
        "account": account,
    }


@pytest.fixture
def linked_entry(hass):
    entry = MockConfigEntry(
        domain=DOMAIN,
        version=3,
        unique_id=ACCOUNT,
        title="Porabim · 4-123456",
        data={"auth_implementation": DOMAIN, "token": token()},
        options={"sidebar": True},
    )
    entry.add_to_hass(hass)
    return entry
