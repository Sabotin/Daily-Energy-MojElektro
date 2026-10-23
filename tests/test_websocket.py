"""The one forwarding command: path check, headers, timeouts and 401 → reauth."""

import pytest
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMockResponse

from homeassistant.config_entries import SOURCE_REAUTH
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from custom_components.daily_energy_mojelektro import api
from custom_components.daily_energy_mojelektro.const import API_URL, DOMAIN, LONG_TIMEOUT, TIMEOUT, TOKEN_URL, VERSION


@pytest.mark.parametrize(
    "path",
    ["snapshot", "refresh", "import-range", "day/2026-10-01", "days?from=2026-01-01&to=2026-02-01", "import-backup"],
)
def test_valid_paths(path):
    assert api.valid_path(path)


@pytest.mark.parametrize(
    "path",
    [
        "../ha/revoke",
        "snapshot/../../ha/token",
        "./snapshot",
        "ha/revoke",
        "ha/token",
        "auth/logout",
        "auth",
        "/snapshot",
        "Snapshot",
        "snapshot?x=<script>",
        "https://evil.example/api",
        "",
    ],
)
def test_rejected_paths(path):
    assert not api.valid_path(path)


@pytest.mark.parametrize(
    ("snapshot", "found"),
    [
        (
            {"meter": "ha:x", "meters": [{"id": "ha:x", "name": None, "eimm": "4-123456"}]},
            [{"id": "ha:x", "label": "4-123456", "eimm": "4-123456"}],
        ),
        (
            {"meter": "m2", "meters": [{"id": "m1", "name": "Hiša", "eimm": "4-1"}, {"id": "m2", "eimm": "4-2"}]},
            [{"id": "m1", "label": "Hiša", "eimm": "4-1"}, {"id": "m2", "label": "4-2", "eimm": "4-2"}],
        ),
        ({"meters": [{"id": "m1"}, {"name": "no id"}, "x", {"id": ""}]}, [{"id": "m1", "label": "m1", "eimm": ""}]),
        ({"meter": "ha:x", "meters": []}, []),
        ({"meter": "ha:x"}, None),
        ({"onboarded": False}, None),
        (None, None),
    ],
)
def test_meters(snapshot, found):
    assert api.meters(snapshot) == found


@pytest.mark.parametrize(
    ("title", "auto"),
    [
        ("Porabim", True),
        ("Porabim · ha:CVRQ=", True),
        ("Porabim · 4-123456", True),
        ("Porabim · 4-999999", True),
        ("Porabim · Hiša", True),
        ("Porabim · Vikend", False),
        ("Hiša", False),
        ("Daily Energy · 4-123456", False),
    ],
)
def test_auto_title(title, auto):
    assert api.auto_title(title, ["4-123456", "Hiša"]) is auto


def test_timeouts():
    assert api.timeout_for("refresh") == LONG_TIMEOUT
    assert api.timeout_for("import-range?from=2025-01-01&to=2025-02-01") == LONG_TIMEOUT
    assert api.timeout_for("snapshot") == TIMEOUT
    assert api.timeout_for("refresh-x") == TIMEOUT


async def _setup(hass: HomeAssistant, entry) -> None:
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


async def test_forwards_with_key_and_meter(hass, linked_entry, hass_ws_client, aioclient_mock):
    aioclient_mock.post(f"{API_URL}/settings", json={"ok": True})
    await _setup(hass, linked_entry)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": f"{DOMAIN}/api",
            "entry_id": linked_entry.entry_id,
            "method": "POST",
            "path": "settings",
            "body": {"grid": "both"},
            "meter": "4-123456",
        }
    )
    msg = await client.receive_json()
    assert msg["success"], msg
    assert msg["result"] == {"status": 200, "data": {"ok": True}}
    method, url, body, headers = aioclient_mock.mock_calls[-1]
    assert method == "POST"
    assert str(url) == f"{API_URL}/settings"
    assert body == {"grid": "both"}
    assert headers["authorization"] == "Bearer access-1"
    assert headers["x-meter"] == "4-123456"
    assert headers["x-porabim-client"] == f"ha/{VERSION}"
    assert headers["x-ha-instance"] == await api.async_instance_hash(hass)


async def test_no_meter_header_without_meter(hass, linked_entry, hass_ws_client, aioclient_mock):
    aioclient_mock.get(f"{API_URL}/snapshot", json={"days": {}})
    await _setup(hass, linked_entry)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": f"{DOMAIN}/api", "entry_id": linked_entry.entry_id, "method": "GET", "path": "snapshot"}
    )
    msg = await client.receive_json()
    assert msg["result"] == {"status": 200, "data": {"days": {}}}
    assert "x-meter" not in aioclient_mock.mock_calls[-1][3]


async def test_non_json_answer_is_null(hass, linked_entry, hass_ws_client, aioclient_mock):
    aioclient_mock.get(f"{API_URL}/snapshot", status=502, text="Bad gateway")
    await _setup(hass, linked_entry)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": f"{DOMAIN}/api", "entry_id": linked_entry.entry_id, "method": "GET", "path": "snapshot"}
    )
    msg = await client.receive_json()
    assert msg["result"] == {"status": 502, "data": None}


@pytest.mark.parametrize("path", ["../ha/revoke", "ha/revoke", "auth/logout"])
async def test_command_rejects_bad_paths(hass, linked_entry, hass_ws_client, aioclient_mock, path):
    await _setup(hass, linked_entry)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": f"{DOMAIN}/api", "entry_id": linked_entry.entry_id, "method": "POST", "path": path}
    )
    msg = await client.receive_json()
    assert not msg["success"]
    assert msg["error"]["code"] == "invalid_format"
    assert aioclient_mock.call_count == 0


async def test_401_after_failed_refresh_starts_reauth(hass, linked_entry, hass_ws_client, aioclient_mock):
    aioclient_mock.get(f"{API_URL}/snapshot", status=401, json={"error": "token_expired"})
    aioclient_mock.post(TOKEN_URL, status=400, json={"error": "invalid_grant"})
    await _setup(hass, linked_entry)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": f"{DOMAIN}/api", "entry_id": linked_entry.entry_id, "method": "GET", "path": "snapshot"}
    )
    msg = await client.receive_json()
    assert msg["result"]["status"] == 401
    await hass.async_block_till_done()
    flows = hass.config_entries.flow.async_progress_by_handler(DOMAIN)
    assert [f["context"]["source"] for f in flows] == [SOURCE_REAUTH]


async def test_401_refreshes_once_and_retries(hass, linked_entry, hass_ws_client, aioclient_mock):
    calls = []

    async def snapshot(method, url, data):
        calls.append(1)
        status = 401 if len(calls) == 1 else 200
        return AiohttpClientMockResponse(method, url, status=status, json={"n": len(calls)})

    aioclient_mock.get(f"{API_URL}/snapshot", side_effect=snapshot)
    aioclient_mock.post(
        TOKEN_URL,
        json={"access_token": "access-2", "refresh_token": "refresh-2", "token_type": "Bearer", "expires_in": 3600},
    )
    await _setup(hass, linked_entry)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": f"{DOMAIN}/api", "entry_id": linked_entry.entry_id, "method": "GET", "path": "snapshot"}
    )
    msg = await client.receive_json()
    assert msg["result"] == {"status": 200, "data": {"n": 2}}
    token = linked_entry.data["token"]
    assert token["access_token"] == "access-2"
    assert token["refresh_token"] == "refresh-2"
    assert token["account"] == "ha:abc123"
    assert aioclient_mock.mock_calls[-1][3]["authorization"] == "Bearer access-2"


async def test_entries(hass, linked_entry, hass_ws_client, aioclient_mock):
    await _setup(hass, linked_entry)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": f"{DOMAIN}/entries"})
    msg = await client.receive_json()
    assert msg["result"] == [{"entry_id": linked_entry.entry_id, "title": linked_entry.title, "panel": "daily-energy"}]


@pytest.mark.meters
async def test_panel_snapshot_updates_the_devices(hass, linked_entry, hass_ws_client, aioclient_mock):
    """The meter list in every snapshot the panel loads: a meter added on porabim shows up without a restart."""
    aioclient_mock.get(f"{API_URL}/snapshot", json={"meters": [{"id": "m1", "eimm": "4-1"}]})
    await _setup(hass, linked_entry)
    await hass.async_block_till_done(wait_background_tasks=True)
    aioclient_mock.clear_requests()
    aioclient_mock.get(
        f"{API_URL}/snapshot", json={"meters": [{"id": "m1", "eimm": "4-1"}, {"id": "m2", "name": "Vikend", "eimm": "4-2"}]}
    )
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {"type": f"{DOMAIN}/api", "entry_id": linked_entry.entry_id, "method": "GET", "path": "snapshot", "meter": "m1"}
    )
    assert (await client.receive_json())["success"]
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), linked_entry.entry_id)
    assert sorted(d.name for d in devices) == ["4-1", "Vikend"]
