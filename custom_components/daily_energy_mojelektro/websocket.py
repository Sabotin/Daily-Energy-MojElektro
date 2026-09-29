"""Websocket API used by the Daily Energy card."""

from __future__ import annotations

import re
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.util import dt as dt_util

from . import logic
from .const import CONF_METER, CONF_NAME, CONF_TOKEN, DOMAIN
from .manager import async_test_access, entry_state

ENTRY = vol.Required("entry_id")


@callback
def async_register(hass: HomeAssistant) -> None:
    for command in (
        ws_entries,
        ws_subscribe,
        ws_verify_pin,
        ws_save_settings,
        ws_save_manual,
        ws_clear_all,
        ws_delete_day,
        ws_save_edit,
        ws_import_csv,
        ws_import_backup,
        ws_check_updates,
        ws_import_api,
        ws_q15_month,
        ws_meters_list,
        ws_meters_rename,
        ws_meters_token,
        ws_meters_remove,
    ):
        websocket_api.async_register_command(hass, command)


def _manager(hass: HomeAssistant, connection, msg):
    manager = hass.data.get(DOMAIN, {}).get(msg["entry_id"])
    if manager is None:
        connection.send_error(msg["id"], "not_found", "Daily Energy entry not found")
    return manager


def _loaded(hass: HomeAssistant) -> list:
    """The running meters, in the order they were added."""
    managers = hass.data.get(DOMAIN, {})
    return [managers[e.entry_id] for e in hass.config_entries.async_entries(DOMAIN) if e.entry_id in managers]


def _meter(m) -> dict:
    return {"id": m.entry.entry_id, "eimm": m.entry.data.get(CONF_METER, ""), "name": m.entry.options.get(CONF_NAME, "")}


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/entries"})
@callback
def ws_entries(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Every meter, for users who are not administrators (the card's meter button then only switches)."""
    connection.send_result(
        msg["id"],
        [
            {"entry_id": m.entry.entry_id, "title": m.entry.title, "panel": m.panel_url, **_meter(m)}
            for m in _loaded(hass)
        ],
    )


# ---------------------------------------------------------------- the dashboard's meter button (administrators)


def _entry(hass: HomeAssistant, connection, msg):
    entry = hass.config_entries.async_get_entry(msg["meter"])
    if entry is None or entry.domain != DOMAIN:
        connection.send_error(msg["id"], "not_found", "Daily Energy entry not found")
        return None
    return entry


def _update(hass: HomeAssistant, entry, **changes) -> None:
    """Change an entry without restarting its meter: the running meter reads its token from the entry."""
    manager = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    hass.config_entries.async_update_entry(entry, **changes)
    if manager is not None:
        manager.entry_state = entry_state(entry)
        manager.push()


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/meters/list"})
@websocket_api.require_admin
@callback
def ws_meters_list(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    connection.send_result(msg["id"], [_meter(m) for m in _loaded(hass)])


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/meters/rename", vol.Required("meter"): str, vol.Required("name"): str}
)
@websocket_api.require_admin
@callback
def ws_meters_rename(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """A name of at most 30 characters (empty clears it); the entry title follows it, else the EIMM."""
    entry = _entry(hass, connection, msg)
    if entry is None:
        return
    name = " ".join(msg["name"].split())[:30]
    options = {k: v for k, v in entry.options.items() if k != CONF_NAME}
    if name:
        options[CONF_NAME] = name
    _update(hass, entry, options=options, title=name or entry.data.get(CONF_METER, entry.title))
    connection.send_result(msg["id"], {"name": name})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/meters/token", vol.Required("meter"): str, vol.Required("token"): str}
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_meters_token(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """A new API token, checked with Moj Elektro first; it replaces the old one of every meter that shared it."""
    entry = _entry(hass, connection, msg)
    if entry is None:
        return
    token, old = msg["token"].strip(), entry.data.get(CONF_TOKEN)
    if not re.fullmatch(r"\S{8,4096}", token):
        connection.send_error(msg["id"], "invalid_format", "Check the API token")
        return
    if token == old:
        connection.send_result(msg["id"], {"same": True})
        return
    error = await async_test_access(hass, entry.data.get(CONF_METER, ""), token)
    if error:
        connection.send_error(msg["id"], error, error)
        return
    shared = [
        e
        for e in hass.config_entries.async_entries(DOMAIN)
        if e.entry_id != entry.entry_id and old and e.data.get(CONF_TOKEN) == old
    ]
    for e in [entry, *shared]:
        _update(hass, e, data={**e.data, CONF_TOKEN: token})
    connection.send_result(msg["id"], {"ok": True, "shared": len(shared)})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/meters/remove", vol.Required("meter"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_meters_remove(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Remove a meter and all its data for good (not the only one)."""
    entry = _entry(hass, connection, msg)
    if entry is None:
        return
    if len(hass.config_entries.async_entries(DOMAIN)) < 2:
        connection.send_error(msg["id"], "last_meter", "The only meter cannot be removed")
        return
    await hass.config_entries.async_remove(entry.entry_id)
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/subscribe", ENTRY: str})
@callback
def ws_subscribe(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return

    @callback
    def forward(snapshot: dict) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], snapshot))

    connection.subscriptions[msg["id"]] = manager.async_add_listener(forward)
    connection.send_result(msg["id"])
    forward(manager.snapshot())


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/verify_pin", ENTRY: str, vol.Optional("pin", default=""): str}
)
@callback
def ws_verify_pin(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    manager = _manager(hass, connection, msg)
    if manager is not None:
        connection.send_result(msg["id"], {"ok": manager.check_pin(msg["pin"])})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/save_settings", ENTRY: str, vol.Required("settings"): dict}
)
@callback
def ws_save_settings(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    manager = _manager(hass, connection, msg)
    if manager is not None:
        manager.save_settings(msg["settings"])
        connection.send_result(msg["id"])


MANUAL_RECORD = vol.Schema(
    {
        vol.Required("d"): vol.Match(r"^\d{4}-\d{2}-\d{2}$"),
        vol.Required("t"): vol.Coerce(float),
        vol.Optional("vt"): vol.Any(None, vol.Coerce(float)),
        vol.Optional("mt"): vol.Any(None, vol.Coerce(float)),
    },
    extra=vol.REMOVE_EXTRA,
)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/save_manual",
        ENTRY: str,
        vol.Optional("pin", default=""): str,
        vol.Optional("put", default=[]): [MANUAL_RECORD],
        vol.Optional("delete", default=[]): [str],
    }
)
@callback
def ws_save_manual(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    if not manager.check_pin(msg["pin"]):
        connection.send_error(msg["id"], "wrong_pin", "Wrong PIN")
        return
    manager.save_manual(msg["put"], msg["delete"])
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/clear_all", ENTRY: str, vol.Optional("pin", default=""): str}
)
@websocket_api.require_admin
@callback
def ws_clear_all(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Settings > Delete all data (administrators only, and the PIN when one is set)."""
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    if not manager.check_pin(msg["pin"]):
        connection.send_error(msg["id"], "wrong_pin", "Wrong PIN")
        return
    manager.clear_all()
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/delete_day",
        ENTRY: str,
        vol.Required("day"): cv.date,
        vol.Required("grid"): vol.In(["in", "out"]),
        vol.Optional("pin", default=""): str,
    }
)
@callback
def ws_delete_day(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Log > delete one day, grid in or grid out only (the PIN when one is set)."""
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    if not manager.check_pin(msg["pin"]):
        connection.send_error(msg["id"], "wrong_pin", "Wrong PIN")
        return
    deleted = manager.delete_day(msg["day"].isoformat(), msg["grid"] == "out")
    connection.send_result(msg["id"], {"deleted": deleted})


KWH = vol.All(vol.Coerce(float), vol.Range(min=0, max=100000))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/save_edit",
        ENTRY: str,
        vol.Required("day"): cv.date,
        vol.Required("grid"): vol.In(["in", "out"]),
        vol.Required("values"): {
            vol.Optional("u"): KWH,
            vol.Optional("vt"): KWH,
            vol.Optional("mt"): KWH,
            vol.Optional("o"): KWH,
            vol.Optional("b"): vol.All([KWH], vol.Length(min=5, max=5)),
        },
        vol.Optional("pin", default=""): str,
    }
)
@callback
def ws_save_edit(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Log > Edit, or Add on grid out: a manual day value that fetching never overwrites (the PIN when one is set)."""
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    if not manager.check_pin(msg["pin"]):
        connection.send_error(msg["id"], "wrong_pin", "Wrong PIN")
        return
    values, out = msg["values"], msg["grid"] == "out"
    complete = "o" in values if out else ("vt" in values and "mt" in values) or "u" in values or "b" in values
    if not complete:
        connection.send_error(msg["id"], "invalid_format", "Grid out needs o; grid in needs vt and mt, u, or b")
        return
    manager.save_edit(msg["day"].isoformat(), out, values)
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/import_csv", ENTRY: str, vol.Required("text"): str}
)
@websocket_api.require_admin
@callback
def ws_import_csv(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    try:
        parsed = logic.parse_moj_elektro_csv(msg["text"], dt_util.now().date())
    except (ValueError, IndexError) as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    days = sorted(set(parsed["days"]) | set(parsed["q15"]))
    count = manager.apply_import(parsed)
    connection.send_result(
        msg["id"],
        {"kind": parsed["kind"], "days": count, "first": days[0] if days else None, "last": days[-1] if days else None},
    )


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/import_backup", ENTRY: str, vol.Required("data"): dict}
)
@websocket_api.require_admin
@callback
def ws_import_backup(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    manager = _manager(hass, connection, msg)
    if manager is not None:
        connection.send_result(msg["id"], {"kind": "backup", "days": manager.apply_backup(msg["data"])})


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/q15_month", ENTRY: str, vol.Required("month"): vol.Match(r"^\d{4}-\d{2}$")}
)
@callback
def ws_q15_month(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """15-minute chart: one archived month (older than the last days) of both grids, {q15, q15o}."""
    manager = _manager(hass, connection, msg)
    if manager is not None:
        connection.send_result(msg["id"], manager.archive_month(msg["month"]))


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/check_updates", ENTRY: str})
@websocket_api.async_response
async def ws_check_updates(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Update button: ask the Moj Elektro API for new data now and report whether anything changed; at most
    REFRESHES_PER_DAY a day per meter ({"limited": true} after that)."""
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    if not manager.refresh_allowed():
        connection.send_result(msg["id"], {"changed": False, "limited": True})
        return
    connection.send_result(msg["id"], await manager.async_check_updates(force=True))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/import_api",
        ENTRY: str,
        vol.Required("start"): cv.date,
        vol.Required("end"): cv.date,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_import_api(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Settings > Import from Moj Elektro: fetch the days from start to end (the card sends a month at a time)."""
    manager = _manager(hass, connection, msg)
    if manager is not None:
        connection.send_result(msg["id"], await manager.async_import_range(msg["start"], msg["end"]))
