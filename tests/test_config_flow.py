"""Add integration → porabim.com → back with a key, the reauth of a 1.x entry, and the options."""

from unittest.mock import patch

import pytest

from yarl import URL

from homeassistant.config_entries import SOURCE_REAUTH, SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr, issue_registry as ir
from homeassistant.helpers.storage import Store
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMockResponse

from custom_components.daily_energy_mojelektro.const import API_URL, AUTHORIZE_URL, DOMAIN, REDIRECT_URI, REVOKE_URL, TOKEN_URL
from custom_components.daily_energy_mojelektro import api
from custom_components.daily_energy_mojelektro.oauth import code_challenge

from .conftest import ACCOUNT, token

TOKEN_ANSWER = {
    "access_token": "access-1",
    "refresh_token": "refresh-1",
    "token_type": "Bearer",
    "expires_in": 3600,
    "account": ACCOUNT,
}


async def _through_porabim(hass: HomeAssistant, result, hass_client_no_auth, aioclient_mock):
    """The browser goes to porabim, comes back on HA's callback, HA swaps the code. Returns the authorize query."""
    if result["type"] is FlowResultType.FORM and result["step_id"] == "pick_implementation":
        # Skipped in a browser; tests have no request, so HA shows the choice even for one implementation
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"implementation": DOMAIN})
    assert result["type"] is FlowResultType.EXTERNAL_STEP
    url = URL(result["url"])
    assert str(url.with_query(None)) == AUTHORIZE_URL
    client = await hass_client_no_auth()
    resp = await client.get(f"/auth/external/callback?code=the-code&state={url.query['state']}")
    assert resp.status == 200
    aioclient_mock.post(TOKEN_URL, json=TOKEN_ANSWER)
    return url.query


def _revoked(aioclient_mock):
    return [c[3]["authorization"] for c in aioclient_mock.mock_calls if str(c[1]) == REVOKE_URL]


async def test_user_flow_creates_entry(hass, hass_client_no_auth, aioclient_mock):
    assert await async_setup_component(hass, DOMAIN, {})
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    query = await _through_porabim(hass, result, hass_client_no_auth, aioclient_mock)
    assert query["response_type"] == "code"
    assert query["client_id"] == DOMAIN
    assert query["redirect_uri"] == REDIRECT_URI
    assert query["code_challenge_method"] == "S256"
    assert len(query["code_challenge"]) == 43
    # the same lasting id for this Home Assistant on every connect: sha256, the instance id itself never sent
    assert query["ha_instance"] == await api.async_instance_hash(hass)
    assert len(query["ha_instance"]) == 64

    with patch("custom_components.daily_energy_mojelektro.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_configure(result["flow_id"])
        await hass.async_block_till_done()

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Porabim"
    entry = result["result"]
    assert entry.unique_id == ACCOUNT
    assert entry.version == 3
    assert entry.data["auth_implementation"] == DOMAIN
    assert entry.data["token"]["access_token"] == "access-1"
    assert entry.options == {"sidebar": True}

    sent = next(c[2] for c in aioclient_mock.mock_calls if str(c[1]) == TOKEN_URL)
    assert sent["grant_type"] == "authorization_code"
    assert sent["code"] == "the-code"
    assert sent["client_id"] == DOMAIN
    assert sent["redirect_uri"] == REDIRECT_URI
    assert code_challenge(sent["code_verifier"]) == query["code_challenge"]
    assert _revoked(aioclient_mock) == []


async def test_second_add_adds_the_meter_to_the_same_account(hass, aioclient_mock, linked_entry):
    """Add integration again: the meter goes into the account this Home Assistant has (porabim's + route), no second
    entry and no trip to porabim's connect page."""
    assert await hass.config_entries.async_setup(linked_entry.entry_id)
    await hass.async_block_till_done()
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "add_meter"

    aioclient_mock.post(f"{API_URL}/meters/add", json={"ok": True, "id": "ha:abc123#0a0b0c0d0e0f"})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"meter": " 4-67936 ", "token": " moj-elektro-token "}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "meter_added"
    assert result["description_placeholders"] == {"meter": "4-67936"}
    method, url, body, headers = next(c for c in aioclient_mock.mock_calls if str(c[1]) == f"{API_URL}/meters/add")
    assert body == {"meter": "4-67936", "token": "moj-elektro-token"}
    assert headers["authorization"] == "Bearer access-1"
    assert len(hass.config_entries.async_entries(DOMAIN)) == 1
    assert not [c for c in aioclient_mock.mock_calls if str(c[1]) == TOKEN_URL]


@pytest.mark.meters
async def test_added_meter_shows_as_a_device(hass, aioclient_mock, linked_entry):
    aioclient_mock.get(f"{API_URL}/sensors", json={"v": 1, "off": False, "meters": []})
    aioclient_mock.get(f"{API_URL}/snapshot", json={"meters": [{"id": "m1", "eimm": "4-123456"}]})
    assert await hass.config_entries.async_setup(linked_entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API_URL}/sensors", json={"v": 1, "off": False, "meters": []})
    aioclient_mock.get(
        f"{API_URL}/snapshot", json={"meters": [{"id": "m1", "eimm": "4-123456"}, {"id": "m2", "eimm": "4-67936"}]}
    )
    aioclient_mock.post(f"{API_URL}/meters/add", json={"ok": True, "id": "m2"})
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"meter": "4-67936", "token": "t"})
    await hass.async_block_till_done(wait_background_tasks=True)
    assert result["reason"] == "meter_added"
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), linked_entry.entry_id)
    assert sorted(d.name for d in devices) == ["4-123456", "4-67936"]
    assert any(str(c[1]) == f"{API_URL}/sensors" for c in aioclient_mock.mock_calls)


async def test_second_add_shows_porabims_error(hass, aioclient_mock, linked_entry):
    assert await hass.config_entries.async_setup(linked_entry.entry_id)
    await hass.async_block_till_done()
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    aioclient_mock.post(f"{API_URL}/meters/add", status=400, json={"ok": False, "error": "duplicate_meter"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"meter": "4-123456", "token": "t"})
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "duplicate_meter"}


async def test_second_add_before_connecting(hass):
    """A 1.x entry still waiting to be connected: connect it first."""
    entry = MockConfigEntry(domain=DOMAIN, version=3, unique_id="4-123456", data={}, options={"sidebar": True})
    entry.add_to_hass(hass)
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "connect_first"


async def test_reauth_links_a_1x_entry(hass, hass_client_no_auth, aioclient_mock):
    """Migration left a 1.x entry without a key; reauth gives it one and the porabim account as unique id."""
    entry = MockConfigEntry(domain=DOMAIN, version=3, unique_id="4-123456", data={}, options={"sidebar": True})
    entry.add_to_hass(hass)
    assert await async_setup_component(hass, DOMAIN, {})
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_REAUTH, "entry_id": entry.entry_id}, data=entry.data
    )
    assert result["step_id"] == "reauth_confirm"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    await _through_porabim(hass, result, hass_client_no_auth, aioclient_mock)
    with patch("custom_components.daily_energy_mojelektro.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_configure(result["flow_id"])
        await hass.async_block_till_done()
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reauth_successful"
    assert entry.unique_id == ACCOUNT
    assert entry.data["token"]["account"] == ACCOUNT
    assert entry.data["old_meter"] == "4-123456"  # its day log goes onto this meter


SNAPSHOT = {
    "meter": "m1",
    "meters": [{"id": "m1", "name": None, "eimm": "4-123456"}, {"id": "m2", "name": None, "eimm": "4-999999"}],
}
OLD_LOG = {"days": {"2026-10-01": {"u": 12.5}}, "manual": {}, "edits": {}, "settings": {}}


def _old_store(hass, entry):
    return Store(hass, 1, f"{DOMAIN}.{entry.entry_id}")


async def _second_1x_meter(hass, aioclient_mock):
    """Home Assistant is linked (linked_entry), and 1.x's entry of another meter asks to be connected."""
    old = MockConfigEntry(domain=DOMAIN, version=3, unique_id="4-999999", data={}, options={"sidebar": True})
    old.add_to_hass(hass)
    await _old_store(hass, old).async_save(OLD_LOG)
    aioclient_mock.post(f"{API_URL}/import-backup", json={"kind": "backup", "days": 1})
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_REAUTH, "entry_id": old.entry_id}, data=old.data
    )
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "merge"  # no second connect: Home Assistant has its one account
    assert result["description_placeholders"]["meter"] == "4-999999"
    return old, result


def _backups(aioclient_mock):
    return [c for c in aioclient_mock.mock_calls if str(c[1]) == f"{API_URL}/import-backup"]


async def test_second_1x_meter_merges_into_the_account(hass, aioclient_mock, linked_entry):
    """1.x had one entry per meter; the second one's meter is in the account: its log goes onto it, the entry goes."""
    aioclient_mock.get(f"{API_URL}/snapshot", json=SNAPSHOT)
    old, result = await _second_1x_meter(hass, aioclient_mock)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "merged"
    assert [c[3]["x-meter"] for c in _backups(aioclient_mock)] == ["m2"]
    assert hass.config_entries.async_get_entry(old.entry_id) is None
    assert hass.config_entries.async_get_entry(linked_entry.entry_id) is not None
    assert await _old_store(hass, old).async_load() is None
    assert ir.async_get(hass).async_get_issue(DOMAIN, f"connect_porabim_{old.entry_id}") is None


async def test_merge_adds_a_missing_meter_with_its_token(hass, aioclient_mock, linked_entry):
    aioclient_mock.get(f"{API_URL}/snapshot", json=SNAPSHOT)
    aioclient_mock.post(f"{API_URL}/meters/add", json={"ok": True})
    old, result = await _second_1x_meter(hass, aioclient_mock)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"token": " moj-token "})
    await hass.async_block_till_done()
    assert result["reason"] == "merged"
    adds = [c[2] for c in aioclient_mock.mock_calls if str(c[1]) == f"{API_URL}/meters/add"]
    assert adds == [{"meter": "4-999999", "token": "moj-token"}]
    assert [c[3]["x-meter"] for c in _backups(aioclient_mock)] == ["m2"]
    assert hass.config_entries.async_get_entry(old.entry_id) is None


async def test_merge_asks_for_the_token_of_a_missing_meter(hass, aioclient_mock, linked_entry):
    """The meter is not in the account and no token: nothing goes to another meter, the entry and its log stay."""
    aioclient_mock.get(f"{API_URL}/snapshot", json={**SNAPSHOT, "meters": SNAPSHOT["meters"][:1]})
    old, result = await _second_1x_meter(hass, aioclient_mock)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "meter_missing"}
    assert not _backups(aioclient_mock)
    assert hass.config_entries.async_get_entry(old.entry_id) is not None
    assert await _old_store(hass, old).async_load() == OLD_LOG


async def test_reauth_with_another_account_aborts(hass, hass_client_no_auth, aioclient_mock):
    entry = MockConfigEntry(
        domain=DOMAIN,
        version=3,
        unique_id="ha:someone-else",
        data={"auth_implementation": DOMAIN, "token": token(account="ha:someone-else")},
    )
    entry.add_to_hass(hass)
    assert await async_setup_component(hass, DOMAIN, {})
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_REAUTH, "entry_id": entry.entry_id}, data=entry.data
    )
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    await _through_porabim(hass, result, hass_client_no_auth, aioclient_mock)
    aioclient_mock.post(REVOKE_URL, json={})
    result = await hass.config_entries.flow.async_configure(result["flow_id"])
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "wrong_account"
    assert entry.unique_id == "ha:someone-else"
    assert _revoked(aioclient_mock) == ["Bearer access-1"]


async def test_reauth_after_the_account_was_deleted_takes_the_new_one(hass, hass_client_no_auth, aioclient_mock):
    """Izbriši račun on porabim: the old key is refused, porabim makes a new account; the entry moves to it."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        version=3,
        unique_id="ha:deleted",
        data={"auth_implementation": DOMAIN, "token": token(access="old-access", refresh="old-refresh", account="ha:deleted")},
    )
    entry.add_to_hass(hass)
    assert await async_setup_component(hass, DOMAIN, {})
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_REAUTH, "entry_id": entry.entry_id}, data=entry.data
    )
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    await _through_porabim(hass, result, hass_client_no_auth, aioclient_mock)
    aioclient_mock.clear_requests()

    async def token_answer(method, url, data):
        if data["grant_type"] == "refresh_token":
            return AiohttpClientMockResponse(method, url, status=400, json={"error": "invalid_grant"})
        return AiohttpClientMockResponse(method, url, json=TOKEN_ANSWER)

    aioclient_mock.post(TOKEN_URL, side_effect=token_answer)
    aioclient_mock.post(REVOKE_URL, json={})
    with patch("custom_components.daily_energy_mojelektro.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_configure(result["flow_id"])
        await hass.async_block_till_done()
    assert result["reason"] == "reauth_successful"
    assert entry.unique_id == ACCOUNT
    assert entry.data["token"]["access_token"] == "access-1"
    assert _revoked(aioclient_mock) == ["Bearer old-access"]


async def test_reauth_same_account_ends_the_old_link(hass, hass_client_no_auth, aioclient_mock):
    entry = MockConfigEntry(
        domain=DOMAIN,
        version=3,
        unique_id=ACCOUNT,
        title="Porabim · 4-123456",
        data={"auth_implementation": DOMAIN, "token": token(access="old-access", refresh="old-refresh")},
    )
    entry.add_to_hass(hass)
    assert await async_setup_component(hass, DOMAIN, {})
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_REAUTH, "entry_id": entry.entry_id}, data=entry.data
    )
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    await _through_porabim(hass, result, hass_client_no_auth, aioclient_mock)
    aioclient_mock.post(REVOKE_URL, json={})
    with patch("custom_components.daily_energy_mojelektro.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_configure(result["flow_id"])
        await hass.async_block_till_done()
    assert result["reason"] == "reauth_successful"
    assert entry.data["token"]["access_token"] == "access-1"
    assert _revoked(aioclient_mock) == ["Bearer old-access"]


async def test_options_sidebar_only(hass, linked_entry):
    with patch("custom_components.daily_energy_mojelektro.async_setup_entry", return_value=True):
        result = await hass.config_entries.options.async_init(linked_entry.entry_id)
        assert result["type"] is FlowResultType.FORM
        assert list(result["data_schema"].schema) == ["sidebar"]
        result = await hass.config_entries.options.async_configure(result["flow_id"], {"sidebar": False})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert linked_entry.options == {"sidebar": False}
