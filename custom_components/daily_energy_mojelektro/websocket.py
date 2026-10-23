# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Websocket API used by porabim's card: the list of entries and one forwarding command."""
from __future__ import annotations

from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from . import api, meters
from .const import DOMAIN


@callback
def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_entries)
    websocket_api.async_register_command(hass, ws_api)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/entries"})
@callback
def ws_entries(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    connection.send_result(
        msg["id"],
        [
            {"entry_id": entry_id, "title": link.entry.title, "panel": link.panel_url}
            for entry_id, link in hass.data.get(DOMAIN, {}).items()
        ],
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/api",
        vol.Required("entry_id"): str,
        vol.Required("method"): vol.In(["GET", "POST"]),
        vol.Required("path"): vol.All(str, vol.Length(max=500)),
        vol.Optional("body"): vol.Any(None, dict, list),
        vol.Optional("meter"): vol.Any(None, str),
    }
)
@websocket_api.async_response
async def ws_api(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The card's api(method, path, body, meter): porabim's /api/<path> with this entry's key → {status, data}."""
    link = hass.data.get(DOMAIN, {}).get(msg["entry_id"])
    if link is None:
        connection.send_error(msg["id"], "not_found", "Daily Energy entry not found")
        return
    if not api.valid_path(msg["path"]):
        connection.send_error(msg["id"], "invalid_format", "Not a porabim API path")
        return
    try:
        status, data = await api.async_call(hass, link, msg["method"], msg["path"], msg.get("body"), msg.get("meter"))
    except TimeoutError:
        connection.send_error(msg["id"], "timeout", "porabim.com did not answer in time")
        return
    except aiohttp.ClientError:
        connection.send_error(msg["id"], "cannot_connect", "Could not reach porabim.com")
        return
    if status == 200 and msg["method"] == "GET" and msg["path"].split("?", 1)[0] == "snapshot":
        # Every snapshot the panel loads lists the account's meters: the devices follow it without another request
        meters.async_apply(hass, link, data)
    connection.send_result(msg["id"], {"status": status, "data": data})
