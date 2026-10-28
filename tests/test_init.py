"""Migration 1.x → 3, the one-time upload of the old day log, the meters as devices, the panel, and revoke on delete."""

import pytest

from homeassistant.config_entries import SOURCE_REAUTH, ConfigEntryState
from homeassistant.helpers import device_registry as dr, issue_registry as ir
from homeassistant.helpers.storage import Store
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.daily_energy_mojelektro.const import API_URL, DOMAIN, REVOKE_URL, VERSION

# the meter tests answer /api/sensors with no values (tests/test_sensor.py covers them)
NO_SENSORS = {"v": 1, "off": False, "meters": []}

OLD_LOG = {
    "days": {"2026-10-01": {"u": 12.5, "vt": 8.0, "mt": 4.5}},
    "manual": {"2026-09-30": {"t": 100123.4}},
    "edits": {},
    "settings": {"grid": "in", "pVT": 0.15},
    "q15": {"2026-10-01": [0.1] * 96},
}


def _old_store(hass, entry):
    return Store(hass, 1, f"{DOMAIN}.{entry.entry_id}")


async def test_migration_v2_to_v3_asks_to_connect(hass):
    entry = MockConfigEntry(
        domain=DOMAIN,
        version=2,
        unique_id="4-123456",
        title="Daily Energy · 4-123456",
        data={"meter_id": "4-123456", "token": "moj-elektro-token"},
        options={"pin": "1234", "sidebar": False},
    )
    entry.add_to_hass(hass)
    await _old_store(hass, entry).async_save(OLD_LOG)

    assert not await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)

    assert entry.version == 3
    assert entry.data == {}  # the Moj Elektro token is gone from Home Assistant
    assert entry.options == {"sidebar": False}
    assert entry.state is ConfigEntryState.SETUP_ERROR
    issue = ir.async_get(hass).async_get_issue(DOMAIN, f"connect_porabim_{entry.entry_id}")
    assert issue is not None
    assert issue.translation_key == "connect_porabim"
    flows = hass.config_entries.flow.async_progress_by_handler(DOMAIN)
    assert [f["context"]["source"] for f in flows] == [SOURCE_REAUTH]
    assert await _old_store(hass, entry).async_load() == OLD_LOG  # kept until it is uploaded


async def test_first_link_uploads_the_old_log_once(hass, linked_entry, aioclient_mock):
    await _old_store(hass, linked_entry).async_save(OLD_LOG)
    aioclient_mock.post(f"{API_URL}/import-backup", json={"ok": True})

    assert await hass.config_entries.async_setup(linked_entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)

    calls = [c for c in aioclient_mock.mock_calls if str(c[1]) == f"{API_URL}/import-backup"]
    assert len(calls) == 1
    body = calls[0][2]
    # porabim reads the backup under data (porabim's validate.cleanBackup(body.data))
    assert body == {
        "data": {
            "app": DOMAIN,
            "version": VERSION,
            "days": OLD_LOG["days"],
            "manual": OLD_LOG["manual"],
            "edits": {},
            "settings": OLD_LOG["settings"],
        }
    }
    assert calls[0][3]["authorization"] == "Bearer access-1"
    assert "x-meter" not in calls[0][3]  # linked before 3.0.0: no meter kept, the account's first meter
    assert await _old_store(hass, linked_entry).async_load() is None


async def test_old_log_kept_when_porabim_refuses(hass, linked_entry, aioclient_mock):
    await _old_store(hass, linked_entry).async_save(OLD_LOG)
    aioclient_mock.post(f"{API_URL}/import-backup", status=500, json={"error": "x"})

    assert await hass.config_entries.async_setup(linked_entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)

    assert await _old_store(hass, linked_entry).async_load() == OLD_LOG


THREE = {
    "meter": "m2",
    "meters": [
        {"id": "m1", "name": None, "eimm": "4-67936"},
        {"id": "m2", "name": None, "eimm": "4-211708"},
        {"id": "m3", "name": "Vikend", "eimm": "4-138044"},
    ],
}


def _with_old_meter(hass, entry, meter):
    hass.config_entries.async_update_entry(entry, data={**entry.data, "old_meter": meter})


async def test_old_log_goes_onto_its_own_meter(hass, linked_entry, aioclient_mock):
    """The 1.x entry's meter is the account's second: the log goes there, not onto the first meter."""
    _with_old_meter(hass, linked_entry, " 4-211708")
    await _old_store(hass, linked_entry).async_save(OLD_LOG)
    aioclient_mock.get(f"{API_URL}/snapshot", json=THREE)
    aioclient_mock.post(f"{API_URL}/import-backup", json={"kind": "backup", "days": 1})

    await _start(hass, linked_entry)

    calls = [c for c in aioclient_mock.mock_calls if str(c[1]) == f"{API_URL}/import-backup"]
    assert len(calls) == 1
    assert calls[0][3]["x-meter"] == "m2"
    assert await _old_store(hass, linked_entry).async_load() is None
    assert ir.async_get(hass).async_get_issue(DOMAIN, f"old_log_meter_{linked_entry.entry_id}") is None


async def test_old_log_waits_for_its_meter(hass, linked_entry, aioclient_mock):
    """The 1.x meter is not in the account: nothing goes to another meter, the log waits with a repair."""
    _with_old_meter(hass, linked_entry, "4-999999")
    await _old_store(hass, linked_entry).async_save(OLD_LOG)
    aioclient_mock.get(f"{API_URL}/snapshot", json=THREE)
    aioclient_mock.post(f"{API_URL}/import-backup", json={"kind": "backup", "days": 1})

    await _start(hass, linked_entry)

    assert not [c for c in aioclient_mock.mock_calls if str(c[1]) == f"{API_URL}/import-backup"]
    assert await _old_store(hass, linked_entry).async_load() == OLD_LOG
    issue = ir.async_get(hass).async_get_issue(DOMAIN, f"old_log_meter_{linked_entry.entry_id}")
    assert issue is not None
    assert issue.translation_placeholders == {"meter": "4-999999"}


def _devices(hass, entry):
    return sorted(
        (d.name, d.serial_number, next(iter(d.identifiers))[1])
        for d in dr.async_entries_for_config_entry(dr.async_get(hass), entry.entry_id)
    )


async def _start(hass, entry):
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)


@pytest.mark.meters
async def test_every_meter_is_a_device(hass, linked_entry, aioclient_mock):
    """The entry is the account: Porabim, with one device per meter (its name, else its EIMM)."""
    aioclient_mock.get(f"{API_URL}/sensors", json=NO_SENSORS)
    aioclient_mock.get(f"{API_URL}/snapshot", json=THREE)
    await _start(hass, linked_entry)
    assert linked_entry.title == "Porabim"
    assert _devices(hass, linked_entry) == [
        ("4-211708", "4-211708", "m2"),
        ("4-67936", "4-67936", "m1"),
        ("Vikend", "4-138044", "m3"),
    ]
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), linked_entry.entry_id)
    assert {d.manufacturer for d in devices} == {"porabim.com"}
    assert {d.entry_type for d in devices} == {dr.DeviceEntryType.SERVICE}


@pytest.mark.meters
@pytest.mark.parametrize("title", ["Porabim · ha:abc123", "Porabim · 4-67936", "Porabim · 4-555555", "Porabim · Vikend"])
async def test_titles_from_2_0_x_become_porabim(hass, linked_entry, aioclient_mock, title):
    """2.0.0 / 2.0.1 had the account id, 2.0.2 / 2.0.3 one meter's EIMM or name."""
    hass.config_entries.async_update_entry(linked_entry, title=title)
    aioclient_mock.get(f"{API_URL}/sensors", json=NO_SENSORS)
    aioclient_mock.get(f"{API_URL}/snapshot", json=THREE)
    await _start(hass, linked_entry)
    assert linked_entry.title == "Porabim"


@pytest.mark.meters
async def test_renamed_entry_keeps_its_title(hass, linked_entry, aioclient_mock):
    hass.config_entries.async_update_entry(linked_entry, title="Hiša")
    aioclient_mock.get(f"{API_URL}/sensors", json=NO_SENSORS)
    aioclient_mock.get(f"{API_URL}/snapshot", json=THREE)
    await _start(hass, linked_entry)
    assert linked_entry.title == "Hiša"
    assert len(_devices(hass, linked_entry)) == 3


@pytest.mark.meters
async def test_devices_follow_the_account(hass, linked_entry, aioclient_mock):
    """A meter removed on porabim loses its device; a renamed one gets the new name."""
    aioclient_mock.get(f"{API_URL}/sensors", json=NO_SENSORS)
    aioclient_mock.get(f"{API_URL}/snapshot", json=THREE)
    await _start(hass, linked_entry)
    await hass.config_entries.async_unload(linked_entry.entry_id)
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API_URL}/sensors", json=NO_SENSORS)
    aioclient_mock.get(
        f"{API_URL}/snapshot",
        json={"meters": [{"id": "m1", "name": "Hiša", "eimm": "4-67936"}, {"id": "m3", "name": "Vikend", "eimm": "4-138044"}]},
    )
    await _start(hass, linked_entry)
    assert _devices(hass, linked_entry) == [("Hiša", "4-67936", "m1"), ("Vikend", "4-138044", "m3")]


@pytest.mark.meters
@pytest.mark.parametrize("answer", [{"status": 502, "text": "Bad gateway"}, {"json": {"onboarded": False}}])
async def test_devices_kept_without_a_meter_list(hass, linked_entry, aioclient_mock, answer):
    aioclient_mock.get(f"{API_URL}/sensors", json=NO_SENSORS)
    aioclient_mock.get(f"{API_URL}/snapshot", json=THREE)
    await _start(hass, linked_entry)
    await hass.config_entries.async_unload(linked_entry.entry_id)
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API_URL}/sensors", json=NO_SENSORS)
    aioclient_mock.get(f"{API_URL}/snapshot", **answer)
    await _start(hass, linked_entry)
    assert len(_devices(hass, linked_entry)) == 3


async def test_panel_loads_porabims_card(hass, linked_entry, hass_client):
    """Our panel (served by the integration) around porabim's card, which it loads from porabim.com."""
    assert await hass.config_entries.async_setup(linked_entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)
    panel = hass.data["frontend_panels"]["daily-energy"]
    custom = panel.config["_panel_custom"]
    assert custom["name"] == "daily-energy-panel"
    assert custom["module_url"] == f"/{DOMAIN}/panel.js?v={VERSION}"
    assert custom["trust_external"] is True
    assert panel.config["entry_id"] == linked_entry.entry_id
    assert panel.config["card"] == f"https://porabim.com/ha/card.js?v={VERSION}"
    assert panel.require_admin is False

    resp = await (await hass_client()).get(f"/{DOMAIN}/panel.js")
    assert resp.status == 200
    js = await resp.text()
    assert "customElements.define('daily-energy-panel'" in js
    # what porabim's panel colours on the page is put back when the panel is left
    for prop in ("'background', 'colorScheme'", "'margin', 'background', 'color', 'minHeight'", "disconnectedCallback"):
        assert prop in js


async def test_remove_revokes_the_link(hass, linked_entry, aioclient_mock):
    aioclient_mock.post(REVOKE_URL, json={})
    assert await hass.config_entries.async_setup(linked_entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)

    await hass.config_entries.async_remove(linked_entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)

    calls = [c for c in aioclient_mock.mock_calls if str(c[1]) == REVOKE_URL]
    assert len(calls) == 1
    assert calls[0][3]["authorization"] == "Bearer access-1"
    assert "daily-energy" not in hass.data.get("frontend_panels", {})


async def test_remove_ignores_revoke_errors(hass, linked_entry, aioclient_mock):
    aioclient_mock.post(REVOKE_URL, status=500)
    assert await hass.config_entries.async_setup(linked_entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)
    await hass.config_entries.async_remove(linked_entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)
    assert hass.config_entries.async_get_entry(linked_entry.entry_id) is None
