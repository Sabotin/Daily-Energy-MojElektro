"""Add integration → porabim.com → back with a key, the reauth of a 1.x entry, and the options."""

from unittest.mock import patch

from yarl import URL

from homeassistant.config_entries import SOURCE_REAUTH, SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.daily_energy_mojelektro.const import API_URL, AUTHORIZE_URL, DOMAIN, REDIRECT_URI, REVOKE_URL, TOKEN_URL
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
    aioclient_mock.get(
        f"{API_URL}/snapshot",
        json={"meter": ACCOUNT, "meters": [{"id": ACCOUNT, "name": None, "eimm": "4-123456", "tg": 0, "denied": False}]},
    )
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    query = await _through_porabim(hass, result, hass_client_no_auth, aioclient_mock)
    assert query["response_type"] == "code"
    assert query["client_id"] == DOMAIN
    assert query["redirect_uri"] == REDIRECT_URI
    assert query["code_challenge_method"] == "S256"
    assert len(query["code_challenge"]) == 43

    with patch("custom_components.daily_energy_mojelektro.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_configure(result["flow_id"])
        await hass.async_block_till_done()

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Porabim · 4-123456"
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


async def test_second_add_points_to_the_panel(hass, aioclient_mock, linked_entry):
    """One entry per Home Assistant: a second Add integration stops before porabim (no link is made there)."""
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "add_in_panel"
    assert not [c for c in aioclient_mock.mock_calls if str(c[1]) == TOKEN_URL]


async def test_reauth_into_another_entrys_account_aborts(hass, hass_client_no_auth, aioclient_mock, linked_entry):
    """A 1.x entry reconnecting with a meter whose account another entry already has: stop, and end the new link."""
    old = MockConfigEntry(domain=DOMAIN, version=3, unique_id="4-999999", data={}, options={"sidebar": True})
    old.add_to_hass(hass)
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_REAUTH, "entry_id": old.entry_id}, data=old.data
    )
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    await _through_porabim(hass, result, hass_client_no_auth, aioclient_mock)
    aioclient_mock.post(REVOKE_URL, json={})
    result = await hass.config_entries.flow.async_configure(result["flow_id"])
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"
    assert old.unique_id == "4-999999"
    assert _revoked(aioclient_mock) == ["Bearer access-1"]  # porabim's new link is ended, not left unused


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
