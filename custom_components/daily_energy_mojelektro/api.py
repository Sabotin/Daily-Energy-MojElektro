# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Forwarding to porabim.com's /api with the key of one config entry. Nothing is stored or computed here."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import logging
import re
from typing import Any

import aiohttp

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_entry_oauth2_flow
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import API_URL, LONG_PATHS, LONG_TIMEOUT, TIMEOUT, VERSION

_LOGGER = logging.getLogger(__name__)

PATH = re.compile(r"^[a-z0-9-]+(/[a-z0-9-]+)*(\?[A-Za-z0-9=&,._-]*)?$")
# Never forwarded: porabim's own sign-in routes
BLOCKED = frozenset({"ha", "auth"})
SIGNED_OUT = {"error": "signed_out"}


@dataclass
class PorabimLink:
    """One config entry: its OAuth2 session and its sidebar panel."""

    entry: ConfigEntry
    session: config_entry_oauth2_flow.OAuth2Session
    panel_url: str | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


def valid_path(path: str) -> bool:
    """A path under /api only: lowercase segments and a plain query, no dots, no ha/ or auth/."""
    return bool(PATH.match(path)) and path.split("?", 1)[0].split("/", 1)[0] not in BLOCKED


def meter_title(snapshot: Any) -> str:
    """Porabim · <meter name, else its EIMM>, from /api/snapshot: `meter` is porabim's own meter id (not for
    people), `meters` lists [{id, name, eimm}]. Just Porabim when neither is there."""
    label = None
    if isinstance(snapshot, dict) and isinstance(snapshot.get("meters"), list):
        meters = [m for m in snapshot["meters"] if isinstance(m, dict)]
        shown = next((m for m in meters if m.get("id") == snapshot.get("meter")), meters[0] if meters else {})
        label = shown.get("name") or shown.get("eimm")
    return f"Porabim · {label}" if isinstance(label, str) and label else "Porabim"


def auto_title(title: str) -> bool:
    """A title this integration made and may still correct: plain Porabim, or 2.0.x's Porabim · ha:<account>."""
    return title == "Porabim" or title.startswith("Porabim · ha:")


def timeout_for(path: str) -> int:
    """Osveži and Uvozi wait in porabim's queue; everything else answers in seconds."""
    return LONG_TIMEOUT if path.split("?", 1)[0] in LONG_PATHS else TIMEOUT


async def _async_send(
    hass: HomeAssistant, token: str, method: str, path: str, body: Any, meter: str | None
) -> tuple[int, Any]:
    headers = {"authorization": f"Bearer {token}", "x-porabim-client": f"ha/{VERSION}"}
    if meter:
        headers["x-meter"] = meter
    async with asyncio.timeout(timeout_for(path)):
        resp = await async_get_clientsession(hass).request(
            method, f"{API_URL}/{path}", headers=headers, json=body if method == "POST" else None
        )
        try:
            data = await resp.json(content_type=None)
        except ValueError:
            data = None
        return resp.status, data


async def _async_valid_token(hass: HomeAssistant, link: PorabimLink, stale: str | None = None) -> str | None:
    """The access token, refreshed when it expired (or when porabim refused `stale`).

    None when porabim refused the refresh too: then Home Assistant asks the user to connect again.
    One refresh at a time, because porabim rotates the refresh token on every use.
    """
    session = link.session
    async with link.lock:
        try:
            if stale is not None and session.token["access_token"] == stale:
                token = await session.implementation.async_refresh_token(session.token)
                hass.config_entries.async_update_entry(link.entry, data={**link.entry.data, "token": token})
            else:
                await session.async_ensure_token_valid()
        except aiohttp.ClientResponseError as err:
            if 400 <= err.status < 500:
                link.entry.async_start_reauth(hass)
                return None
            raise
        return session.token["access_token"]


async def async_call(
    hass: HomeAssistant, link: PorabimLink, method: str, path: str, body: Any = None, meter: str | None = None
) -> tuple[int, Any]:
    """(status, parsed JSON or None). A 401 gets one refresh and one retry, then reauth."""
    token = await _async_valid_token(hass, link)
    if token is None:
        return 401, SIGNED_OUT
    status, data = await _async_send(hass, token, method, path, body, meter)
    if status != 401:
        return status, data
    token = await _async_valid_token(hass, link, stale=token)
    if token is None:
        return 401, data
    status, data = await _async_send(hass, token, method, path, body, meter)
    if status == 401:
        link.entry.async_start_reauth(hass)
    return status, data
