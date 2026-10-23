# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Forwarding to porabim.com's /api with the key of one config entry. Nothing is stored or computed here."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import hashlib
import logging
import re
from typing import Any

import aiohttp

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_entry_oauth2_flow, instance_id
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import API_URL, DOMAIN, LONG_PATHS, LONG_TIMEOUT, REVOKE_URL, TIMEOUT, VERSION

_LOGGER = logging.getLogger(__name__)

PATH = re.compile(r"^[a-z0-9-]+(/[a-z0-9-]+)*(\?[A-Za-z0-9=&,._%-]*)?$")
# Never forwarded: porabim's own sign-in routes
BLOCKED = frozenset({"ha", "auth"})
SIGNED_OUT = {"error": "signed_out"}


@dataclass
class PorabimLink:
    """One config entry: its OAuth2 session and its sidebar panel."""

    entry: ConfigEntry
    session: config_entry_oauth2_flow.OAuth2Session
    panel_url: str | None = None
    # sensor.SensorsCoordinator, set when the sensor platform starts
    sensors: Any = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


async def async_instance_hash(hass: HomeAssistant) -> str:
    """This Home Assistant's lasting id for porabim: sha256 of its instance id (made at its first start, kept across
    updates, backups and deleting this integration) and the domain. The instance id itself never leaves Home Assistant."""
    key = f"{DOMAIN}_instance"
    if key not in hass.data:
        uuid = await instance_id.async_get(hass)
        hass.data[key] = hashlib.sha256(f"{uuid}:{DOMAIN}".encode()).hexdigest()
    return hass.data[key]


def valid_path(path: str) -> bool:
    """A path under /api only: lowercase segments and a plain query (URL-encoded, so % only there), no dots, no ha/ or
    auth/."""
    return bool(PATH.match(path)) and path.split("?", 1)[0].split("/", 1)[0] not in BLOCKED


TITLE = "Porabim"
# 2.0.2 and 2.0.3 titled the entry Porabim · <EIMM>
EIMM = re.compile(r"^\d+-\d+$")


def meters(snapshot: Any) -> list[dict[str, str]] | None:
    """[{id, label, eimm}] of the account's meters from /api/snapshot (`meters` lists [{id, name, eimm}]; the id is
    porabim's own, not for people). The label is the meter's name, else its EIMM. None when the list is not there."""
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("meters"), list):
        return None
    found = []
    for meter in snapshot["meters"]:
        if not isinstance(meter, dict) or not isinstance(meter.get("id"), str) or not meter["id"]:
            continue
        eimm = meter.get("eimm") if isinstance(meter.get("eimm"), str) else ""
        name = meter.get("name") if isinstance(meter.get("name"), str) else ""
        found.append({"id": meter["id"], "label": name or eimm or meter["id"], "eimm": eimm})
    return found


def auto_title(title: str, labels: list[str]) -> bool:
    """A title this integration made and may still correct: Porabim, 2.0.x's Porabim · ha:<account>, or 2.0.2/2.0.3's
    Porabim · <one meter> (its EIMM or a meter's name). A name the user gave the entry stays."""
    if title == TITLE or title.startswith(f"{TITLE} · ha:"):
        return True
    rest = title.removeprefix(f"{TITLE} · ")
    return rest != title and (rest in labels or bool(EIMM.match(rest)))


def timeout_for(path: str) -> int:
    """Osveži and Uvozi wait in porabim's queue; everything else answers in seconds."""
    return LONG_TIMEOUT if path.split("?", 1)[0] in LONG_PATHS else TIMEOUT


async def async_revoke(hass: HomeAssistant, access_token: str) -> None:
    """End the porabim link of this key (POST /ha/revoke). Errors are ignored: the key expires on its own."""
    try:
        async with asyncio.timeout(TIMEOUT):
            await async_get_clientsession(hass).post(
                REVOKE_URL, headers={"authorization": f"Bearer {access_token}", "x-porabim-client": f"ha/{VERSION}"}
            )
    except Exception:  # noqa: BLE001
        _LOGGER.debug("porabim.com did not take the revoke; the link ends when its key expires")


async def _async_send(
    hass: HomeAssistant, token: str, method: str, path: str, body: Any, meter: str | None
) -> tuple[int, Any]:
    headers = {
        "authorization": f"Bearer {token}",
        "x-porabim-client": f"ha/{VERSION}",
        "x-ha-instance": await async_instance_hash(hass),
    }
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
