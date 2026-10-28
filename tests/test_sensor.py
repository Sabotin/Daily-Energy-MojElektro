"""Each meter's numbers from porabim's /api/sensors as entities on its device."""

from datetime import timedelta

import pytest

from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.daily_energy_mojelektro.const import API_URL, DOMAIN
from custom_components.daily_energy_mojelektro.sensor import WAIT_TRIES

pytestmark = pytest.mark.meters

SNAPSHOT = {"meters": [{"id": "m1", "name": "Hiša", "eimm": "4-111111"}, {"id": "m2", "name": None, "eimm": "4-222222"}]}
# porabim's example answer: m1 has grid in and out, blocks, peaks, the bill and a plant; m2 grid in only
FULL = {
    "in_day": 19.991, "in_month": 445.141, "in_last_month": 604.491,
    "out_day": 9.579, "out_month": 201.833, "out_last_month": 274.117,
    "block1_day": 0, "block2_day": 11.163, "block3_day": 3.979, "block4_day": 4.849, "block5_day": 0,
    "peak_day": 3.176, "peak_day_at": "2026-10-22T07:30:00+02:00",
    "peak_block2_month": 3.304, "peak_block3_month": 3.292, "peak_block4_month": 1.664, "peak_block5_month": 1,
    "agreed_block1": 4.2, "agreed_block2": 4.2, "agreed_block3": 4.6, "agreed_block4": 4.6, "agreed_block5": 4.6,
    "cost_month": 117.94, "cost_last_month": 114.03,
    "plant_day": 42.735, "self_use_day": 33.156, "self_use_share_day": 77.6, "autarky_day": 60.6, "plant_month": 930.024,
}
IN_ONLY = {"in_day": 27.274, "in_month": 578.354, "in_last_month": 790.501, "block2_day": 15.323, "peak_day": 4.204,
           "peak_day_at": "2026-10-22T07:30:00+02:00", "cost_month": 7.38, "cost_last_month": 8.59}
CHECK = "2026-10-23T09:32:56+02:00"
# porabim's keys of a meter with grid in only and no plant (23)
BASE = ["in_day", "in_month", "in_last_month", *(f"block{b}_day" for b in range(1, 6)), "peak_day",
        *(f"peak_block{b}_month" for b in range(1, 6)), *(f"agreed_block{b}" for b in range(1, 6)), "cost_month",
        "cost_last_month", "day", "last_check"]
SOON = timedelta(seconds=15)


def answer(m1=FULL, m2=IN_ONLY, off=False):
    meters = [{"id": i, "day": "2026-10-22", "last_check": CHECK, "values": v} for i, v in (("m1", m1), ("m2", m2)) if v is not None]
    return {"v": 1, "off": off, "meters": [] if off else meters}


async def start(hass, entry, aioclient_mock, sensors):
    aioclient_mock.get(f"{API_URL}/snapshot", json=SNAPSHOT)
    aioclient_mock.get(f"{API_URL}/sensors", json=sensors)
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done(wait_background_tasks=True)


async def next_answer(hass, aioclient_mock, after=timedelta(minutes=31), **kw):
    aioclient_mock.clear_requests()
    aioclient_mock.get(f"{API_URL}/sensors", **kw)
    async_fire_time_changed(hass, dt_util.utcnow() + after)
    await hass.async_block_till_done(wait_background_tasks=True)


def entity(hass, meter, key):
    return er.async_get(hass).async_get_entity_id("sensor", DOMAIN, f"{meter}_{key}")


def just_added(keys=BASE, wait=False):
    """porabim's answer for a meter just added: no numbers yet, its keys listed."""
    a = answer(m1={}, m2=None)
    a["meters"][0].update(day=None, last_check=None, keys=keys, wait=wait)
    return a


async def test_entities_per_meter_on_its_device(hass, linked_entry, aioclient_mock):
    await start(hass, linked_entry, aioclient_mock, answer())
    ents = er.async_entries_for_config_entry(er.async_get(hass), linked_entry.entry_id)
    # every key of m1 except peak_day_at (an attribute) and the two diagnostics; m2 only its own keys
    assert len([e for e in ents if e.unique_id.startswith("m1_")]) == len(FULL) - 1 + 2
    assert len([e for e in ents if e.unique_id.startswith("m2_")]) == len(IN_ONLY) - 1 + 2
    assert all(e.disabled_by is None for e in ents)
    assert entity(hass, "m2", "out_day") is None and entity(hass, "m2", "plant_day") is None
    device = er.async_get(hass).async_get(entity(hass, "m1", "in_day")).device_id
    assert (DOMAIN, "m1") in dr.async_get(hass).async_get(device).identifiers

    state = hass.states.get(entity(hass, "m1", "in_day"))
    assert state.state == "19.991" and state.attributes["unit_of_measurement"] == "kWh"
    assert state.attributes["day"] == "2026-10-22" and "state_class" not in state.attributes
    peak = hass.states.get(entity(hass, "m1", "peak_day"))
    assert peak.state == "3.176" and peak.attributes["at"] == "2026-10-22T07:30:00+02:00"
    assert hass.states.get(entity(hass, "m1", "cost_month")).attributes["unit_of_measurement"] == "EUR"
    assert hass.states.get(entity(hass, "m1", "autarky_day")).state == "60.6"
    assert hass.states.get(entity(hass, "m1", "day")).state == "2026-10-22"
    assert hass.states.get(entity(hass, "m1", "last_check")).state == "2026-10-23T07:32:56+00:00"
    assert hass.states.get(entity(hass, "m1", "block3_day")).name == "Hiša Block 3, last day"
    # setup and the sensors call in the background
    calls = [c for c in aioclient_mock.mock_calls if str(c[1]).startswith(API_URL)]
    assert calls and all(c[3]["x-ha-background"] == "1" for c in calls)


async def test_missing_key_unavailable_then_back(hass, linked_entry, aioclient_mock):
    await start(hass, linked_entry, aioclient_mock, answer())
    month = {k: v for k, v in FULL.items() if not k.endswith("_month") or k.endswith("last_month")}
    await next_answer(hass, aioclient_mock, json=answer(m1=month))
    assert hass.states.get(entity(hass, "m1", "in_month")).state == STATE_UNAVAILABLE
    assert hass.states.get(entity(hass, "m1", "in_day")).state == "19.991"
    await next_answer(hass, aioclient_mock, json=answer())
    assert hass.states.get(entity(hass, "m1", "in_month")).state == "445.141"


async def test_switched_off_or_failing_is_unavailable(hass, linked_entry, aioclient_mock):
    await start(hass, linked_entry, aioclient_mock, answer())
    await next_answer(hass, aioclient_mock, json=answer(off=True))
    assert hass.states.get(entity(hass, "m1", "in_day")).state == STATE_UNAVAILABLE
    assert entity(hass, "m1", "in_day") is not None
    await next_answer(hass, aioclient_mock, status=500, json={"error": "x"})
    assert hass.states.get(entity(hass, "m2", "in_day")).state == STATE_UNAVAILABLE
    await next_answer(hass, aioclient_mock, json=answer())
    assert hass.states.get(entity(hass, "m1", "in_day")).state == "19.991"


async def test_new_key_and_unknown_keys(hass, linked_entry, aioclient_mock):
    await start(hass, linked_entry, aioclient_mock, answer())
    assert entity(hass, "m2", "out_day") is None
    await next_answer(hass, aioclient_mock, json=answer(m2={**IN_ONLY, "out_day": 1.5, "something_new": 3}))
    assert hass.states.get(entity(hass, "m2", "out_day")).state == "1.5"
    assert entity(hass, "m2", "something_new") is None


async def test_no_entities_without_a_device(hass, linked_entry, aioclient_mock):
    """A meter porabim lists for sensors but not (yet) in the snapshot gets no device-less entities."""
    extra = answer()
    extra["meters"].append({"id": "m3", "day": "2026-10-22", "last_check": CHECK, "values": {"in_day": 1}})
    await start(hass, linked_entry, aioclient_mock, extra)
    assert entity(hass, "m3", "in_day") is None


async def test_unload_removes_entities_from_states(hass, linked_entry, aioclient_mock):
    await start(hass, linked_entry, aioclient_mock, answer())
    assert await hass.config_entries.async_unload(linked_entry.entry_id)
    assert hass.states.get(entity(hass, "m1", "in_day")).state == STATE_UNAVAILABLE


async def test_listed_keys_make_every_entity_at_once(hass, linked_entry, aioclient_mock):
    """A meter just added: every listed entity at once, unavailable, then its number under the same entity id."""
    await start(hass, linked_entry, aioclient_mock, just_added(keys=[*BASE, "unknown_key", 5]))
    ents = er.async_entries_for_config_entry(er.async_get(hass), linked_entry.entry_id)
    assert sorted(e.unique_id for e in ents) == sorted(f"m1_{k}" for k in BASE)
    assert all(hass.states.get(e.entity_id).state == STATE_UNAVAILABLE for e in ents)
    in_day = entity(hass, "m1", "in_day")
    await next_answer(hass, aioclient_mock, json=answer(m2=None))
    assert entity(hass, "m1", "in_day") == in_day
    assert hass.states.get(in_day).state == "19.991"


async def test_listed_keys_keep_existing_entities(hass, linked_entry, aioclient_mock):
    """An update from 2.0.x: an entity made before keeps its entity id (renamed by the user here); none twice."""
    reg = er.async_get(hass)
    old = reg.async_get_or_create("sensor", DOMAIN, "m1_in_day", config_entry=linked_entry)
    reg.async_update_entity(old.entity_id, new_entity_id="sensor.my_grid_in")
    listed = answer(m2=None)
    listed["meters"][0]["keys"] = BASE
    await start(hass, linked_entry, aioclient_mock, listed)
    assert entity(hass, "m1", "in_day") == "sensor.my_grid_in"
    assert hass.states.get("sensor.my_grid_in").state == "19.991"
    assert [e.unique_id for e in er.async_entries_for_config_entry(reg, linked_entry.entry_id)].count("m1_in_day") == 1


async def test_wait_asks_again_every_10_s_at_most_12_times(hass, linked_entry, aioclient_mock):
    await start(hass, linked_entry, aioclient_mock, just_added(wait=True))
    for _ in range(WAIT_TRIES):
        await next_answer(hass, aioclient_mock, after=SOON, json=just_added(wait=True))
        assert aioclient_mock.call_count == 1
    # still waiting after 12: back to every 30 minutes
    await next_answer(hass, aioclient_mock, after=SOON, json=just_added(wait=True))
    assert aioclient_mock.call_count == 0
    await next_answer(hass, aioclient_mock, json=just_added(wait=True))
    assert aioclient_mock.call_count == 1


async def test_wait_ends_with_odjem_in_oddaja(hass, linked_entry, aioclient_mock):
    await start(hass, linked_entry, aioclient_mock, just_added(wait=True))
    assert entity(hass, "m1", "out_day") is None
    both = [*BASE[:3], "out_day", "out_month", "out_last_month", *BASE[3:]]
    await next_answer(hass, aioclient_mock, after=SOON, json=just_added(keys=both))
    assert hass.states.get(entity(hass, "m1", "out_day")).state == STATE_UNAVAILABLE
    # no longer waiting: the next call in 30 minutes, not 10 s
    await next_answer(hass, aioclient_mock, after=SOON, json=just_added(keys=both))
    assert aioclient_mock.call_count == 0


async def test_wait_never_keeps_asking_while_porabim_fails(hass, linked_entry, aioclient_mock):
    await start(hass, linked_entry, aioclient_mock, just_added(wait=True))
    await next_answer(hass, aioclient_mock, after=SOON, status=500, json={"error": "x"})
    assert aioclient_mock.call_count == 1
    await next_answer(hass, aioclient_mock, after=SOON, status=500, json={"error": "x"})
    assert aioclient_mock.call_count == 0
