"""The refresh key: refused once → reauth once and no more refreshes; a reauth links again; a 5xx retries."""

from unittest.mock import patch

import aiohttp
import pytest

from homeassistant.config_entries import SOURCE_REAUTH
from homeassistant.core import HomeAssistant

from custom_components.daily_energy_mojelektro import api
from custom_components.daily_energy_mojelektro.const import API_URL, DOMAIN, REVOKE_URL, TOKEN_URL

from .test_config_flow import _through_porabim

pytestmark = pytest.mark.meters

SNAPSHOT = {"meters": [{"id": "m1", "name": "Hiša", "eimm": "4-111111"}]}
SENSORS = {"v": 1, "off": False, "meters": [{"id": "m1", "day": "2026-10-22", "last_check": None, "values": {"in_day": 1}}]}
NEW_TOKEN = {"access_token": "access-2", "refresh_token": "refresh-2", "token_type": "Bearer", "expires_in": 3600}


async def _start(hass: HomeAssistant, entry, aioclient_mock) -> api.PorabimLink:
    aioclient_mock.get(f"{API_URL}/snapshot", json=SNAPSHOT)
    aioclient_mock.get(f"{API_URL}/sensors", json=SENSORS)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)
    return hass.data[DOMAIN][entry.entry_id]


def _expire(entry) -> None:
    """The access token runs out (in place: an entry update would reload the entry)."""
    entry.data["token"]["expires_at"] = 0


def _token_posts(aioclient_mock) -> int:
    return sum(1 for c in aioclient_mock.mock_calls if str(c[1]) == TOKEN_URL)


def _reauth_flows(hass: HomeAssistant) -> list:
    return [f for f in hass.config_entries.flow.async_progress_by_handler(DOMAIN) if f["context"]["source"] == SOURCE_REAUTH]


async def test_refused_key_asks_porabim_once(hass, linked_entry, aioclient_mock):
    link = await _start(hass, linked_entry, aioclient_mock)
    aioclient_mock.post(TOKEN_URL, status=400, json={"error": "invalid_grant"})
    _expire(linked_entry)
    with patch.object(linked_entry, "async_start_reauth", wraps=linked_entry.async_start_reauth) as reauth:
        answers = [await api.async_call(hass, link, "GET", "snapshot") for _ in range(11)]
        await link.sensors.async_refresh()
        await hass.async_block_till_done()
    assert answers == [(401, api.SIGNED_OUT)] * 11
    assert not link.sensors.last_update_success
    assert _token_posts(aioclient_mock) == 1
    assert link.refused
    assert reauth.call_count == 1
    assert len(_reauth_flows(hass)) == 1


async def test_refused_new_key_asks_porabim_once(hass, linked_entry, aioclient_mock):
    """The refresh works, but porabim refuses the new key too: reauth once, then signed out without asking porabim
    (before, every call refreshed the key again and started the reauth again)."""
    link = await _start(hass, linked_entry, aioclient_mock)
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API_URL}/snapshot", status=401, json={"error": "unauthorized"})
    aioclient_mock.post(TOKEN_URL, json=NEW_TOKEN)
    with patch.object(linked_entry, "async_start_reauth", wraps=linked_entry.async_start_reauth) as reauth:
        answers = [await api.async_call(hass, link, "GET", "snapshot") for _ in range(5)]
        await hass.async_block_till_done()
    assert answers[0] == (401, {"error": "unauthorized"})
    assert answers[1:] == [(401, api.SIGNED_OUT)] * 4
    assert _token_posts(aioclient_mock) == 1
    assert sum(1 for c in aioclient_mock.mock_calls if str(c[1]) == f"{API_URL}/snapshot") == 2
    assert link.refused
    assert reauth.call_count == 1
    assert len(_reauth_flows(hass)) == 1


async def test_reauth_after_a_refused_key_works_again(hass, linked_entry, hass_client_no_auth, aioclient_mock):
    link = await _start(hass, linked_entry, aioclient_mock)
    aioclient_mock.post(TOKEN_URL, status=400, json={"error": "invalid_grant"})
    _expire(linked_entry)
    assert await api.async_call(hass, link, "GET", "snapshot") == (401, api.SIGNED_OUT)
    await hass.async_block_till_done()
    [flow] = _reauth_flows(hass)
    # the user connects again: porabim gives a new key, the entry reloads with a new link
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API_URL}/snapshot", json=SNAPSHOT)
    aioclient_mock.get(f"{API_URL}/sensors", json=SENSORS)
    aioclient_mock.post(REVOKE_URL, json={})
    result = await hass.config_entries.flow.async_configure(flow["flow_id"], {})
    await _through_porabim(hass, result, hass_client_no_auth, aioclient_mock)
    result = await hass.config_entries.flow.async_configure(result["flow_id"])
    await hass.async_block_till_done(wait_background_tasks=True)
    assert result["reason"] == "reauth_successful"
    new = hass.data[DOMAIN][linked_entry.entry_id]
    assert new is not link
    assert not new.refused
    assert await api.async_call(hass, new, "GET", "snapshot") == (200, SNAPSHOT)
    assert aioclient_mock.mock_calls[-1][3]["authorization"] == "Bearer access-1"
    # and it refreshes normally when that key runs out
    aioclient_mock.clear_requests()
    aioclient_mock.post(TOKEN_URL, json=NEW_TOKEN)
    aioclient_mock.get(f"{API_URL}/snapshot", json=SNAPSHOT)
    _expire(linked_entry)
    new = hass.data[DOMAIN][linked_entry.entry_id]
    assert await api.async_call(hass, new, "GET", "snapshot") == (200, SNAPSHOT)
    assert _token_posts(aioclient_mock) == 1
    assert aioclient_mock.mock_calls[-1][3]["authorization"] == "Bearer access-2"


async def test_key_refresh_keeps_the_entry_loaded(hass, linked_entry, aioclient_mock):
    """The new key is saved in the entry about every hour; that is no reason to reload it (the panel and every entity
    went away and came back each time)."""
    link = await _start(hass, linked_entry, aioclient_mock)
    aioclient_mock.clear_requests()
    aioclient_mock.post(TOKEN_URL, json=NEW_TOKEN)
    aioclient_mock.get(f"{API_URL}/snapshot", json=SNAPSHOT)
    aioclient_mock.get(f"{API_URL}/sensors", json=SENSORS)
    _expire(linked_entry)
    assert await api.async_call(hass, link, "GET", "snapshot") == (200, SNAPSHOT)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert linked_entry.data["token"]["access_token"] == "access-2"
    assert hass.data[DOMAIN][linked_entry.entry_id] is link
    # a reload would have asked for the meters and the sensors again
    assert [str(c[1]) for c in aioclient_mock.mock_calls] == [TOKEN_URL, f"{API_URL}/snapshot"]


async def test_title_change_keeps_the_entry_loaded(hass, linked_entry, aioclient_mock):
    link = await _start(hass, linked_entry, aioclient_mock)
    hass.config_entries.async_update_entry(linked_entry, title="Doma")
    await hass.async_block_till_done(wait_background_tasks=True)
    assert hass.data[DOMAIN][linked_entry.entry_id] is link


async def test_sidebar_option_still_reloads(hass, linked_entry, aioclient_mock):
    link = await _start(hass, linked_entry, aioclient_mock)
    assert link.panel_url == "daily-energy"
    hass.config_entries.async_update_entry(linked_entry, options={"sidebar": False})
    await hass.async_block_till_done(wait_background_tasks=True)
    new = hass.data[DOMAIN][linked_entry.entry_id]
    assert new is not link
    assert new.panel_url is None
    assert "daily-energy" not in hass.data.get("frontend_panels", {})


async def test_porabim_down_retries_the_refresh(hass, linked_entry, aioclient_mock):
    link = await _start(hass, linked_entry, aioclient_mock)
    aioclient_mock.post(TOKEN_URL, status=500, text="down")
    _expire(linked_entry)
    for _ in range(3):
        with pytest.raises(aiohttp.ClientResponseError):
            await api.async_call(hass, link, "GET", "snapshot")
    assert _token_posts(aioclient_mock) == 3
    assert not link.refused
    await hass.async_block_till_done()
    assert _reauth_flows(hass) == []
