"""Websocket API used by the Daily Energy card."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.util import dt as dt_util

from . import logic
from .const import DOMAIN

ENTRY = vol.Required("entry_id")


@callback
def async_register(hass: HomeAssistant) -> None:
    for command in (
        ws_entries,
        ws_subscribe,
        ws_verify_pin,
        ws_save_settings,
        ws_save_manual,
        ws_clear_manual,
        ws_import_csv,
        ws_import_backup,
        ws_check_updates,
        ws_import_api,
    ):
        websocket_api.async_register_command(hass, command)


def _manager(hass: HomeAssistant, connection, msg):
    manager = hass.data.get(DOMAIN, {}).get(msg["entry_id"])
    if manager is None:
        connection.send_error(msg["id"], "not_found", "Daily Energy entry not found")
    return manager


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/entries"})
@callback
def ws_entries(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    connection.send_result(
        msg["id"],
        [
            {"entry_id": entry_id, "title": m.entry.title, "panel": m.panel_url}
            for entry_id, m in hass.data.get(DOMAIN, {}).items()
        ],
    )


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
    {vol.Required("type"): f"{DOMAIN}/clear_manual", ENTRY: str, vol.Optional("pin", default=""): str}
)
@callback
def ws_clear_manual(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    if not manager.check_pin(msg["pin"]):
        connection.send_error(msg["id"], "wrong_pin", "Wrong PIN")
        return
    manager.clear_manual()
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


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/check_updates", ENTRY: str})
@websocket_api.async_response
async def ws_check_updates(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Update button: ask the Moj Elektro API for new data now and report whether anything changed."""
    manager = _manager(hass, connection, msg)
    if manager is not None:
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
