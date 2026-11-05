# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Posredovanje na /api porabim.com s ključem enega vnosa. Tukaj se nič ne shranjuje in nič ne računa."""
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
# Nikoli ne posredujemo: poti za prijavo v porabim
BLOCKED = frozenset({"ha", "auth"})
SIGNED_OUT = {"error": "signed_out"}


@dataclass
class PorabimLink:
    """En vnos: njegova seja OAuth2 in plošča v stranski vrstici."""

    entry: ConfigEntry
    session: config_entry_oauth2_flow.OAuth2Session
    panel_url: str | None = None
    # sensor.SensorsCoordinator, nastavi se ob zagonu platforme senzorjev
    sensors: Any = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # porabim je zavrnil ključ za osvežitev: brez osvežitev, dokler se uporabnik znova ne poveže (ponovna prijava vnos
    # naloži znova, zato nova povezava začne s False)
    refused: bool = False
    # možnosti ob nastavitvi: vnos se znova naloži samo ob njihovi spremembi (__init__._async_reload)
    options: dict[str, Any] = field(default_factory=dict)
    # zadnje merilno mesto je odstranila plošča (meters/remove → last): prazen račun je namenski, vnos ostane, dokler
    # se ne naloži znova ali dokler posnetek spet ne navede merilnega mesta
    emptied: bool = False
    # vnos se že odstranjuje, ker račun nima merilnega mesta
    removing: bool = False


async def async_instance_hash(hass: HomeAssistant) -> str:
    """Trajni id tega Home Assistanta za porabim: sha256 iz id-ja instance (nastane ob prvem zagonu, ostane čez posodobitve,
    varnostne kopije in izbris integracije) in domene. Sam id instance nikoli ne zapusti Home Assistanta."""
    key = f"{DOMAIN}_instance"
    if key not in hass.data:
        uuid = await instance_id.async_get(hass)
        hass.data[key] = hashlib.sha256(f"{uuid}:{DOMAIN}".encode()).hexdigest()
    return hass.data[key]


def valid_path(path: str) -> bool:
    """Samo pot pod /api: segmenti z malimi črkami in navadna poizvedba (URL-kodirana, zato % samo tam), brez pik, ha/ in
    auth/."""
    return bool(PATH.match(path)) and path.split("?", 1)[0].split("/", 1)[0] not in BLOCKED


TITLE = "Porabim"
# 2.0.2 in 2.0.3 sta vnos naslovila Porabim · <EIMM>
EIMM = re.compile(r"^\d+-\d+$")


def meters(snapshot: Any) -> list[dict[str, str]] | None:
    """[{id, label, eimm}] merilnih mest računa iz /api/snapshot (`meters` navaja [{id, name, eimm}]; id je od porabim, ni
    za ljudi). Oznaka je ime merilnega mesta, sicer EIMM. None, kadar seznama ni."""
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
    """Naslov, ki ga je naredila ta integracija in ga še sme popraviti: Porabim, Porabim · ha:<račun> iz 2.0.x ali
    Porabim · <merilno mesto> iz 2.0.2/2.0.3 (EIMM ali ime). Naslov, ki ga je dal uporabnik, ostane."""
    if title == TITLE or title.startswith(f"{TITLE} · ha:"):
        return True
    rest = title.removeprefix(f"{TITLE} · ")
    return rest != title and (rest in labels or bool(EIMM.match(rest)))


def timeout_for(path: str) -> int:
    """Osveži in Uvozi čakata v vrsti na porabim; vse drugo odgovori v nekaj sekundah."""
    return LONG_TIMEOUT if path.split("?", 1)[0] in LONG_PATHS else TIMEOUT


async def async_revoke(hass: HomeAssistant, access_token: str) -> None:
    """Konča povezavo tega ključa na porabim (POST /ha/revoke). Napake prezremo: ključ sam poteče."""
    try:
        async with asyncio.timeout(TIMEOUT):
            await async_get_clientsession(hass).post(
                REVOKE_URL, headers={"authorization": f"Bearer {access_token}", "x-porabim-client": f"ha/{VERSION}"}
            )
    except Exception:  # noqa: BLE001
        _LOGGER.debug("porabim.com did not take the revoke; the link ends when its key expires")


async def _async_send(
    hass: HomeAssistant, token: str, method: str, path: str, body: Any, meter: str | None, panel: bool
) -> tuple[int, Any]:
    headers = {
        "authorization": f"Bearer {token}",
        "x-porabim-client": f"ha/{VERSION}",
        "x-ha-instance": await async_instance_hash(hass),
    }
    if meter:
        headers["x-meter"] = meter
    # klic v ozadju (senzorji, nastavitev, stari zapis), ne klic odprte plošče
    if not panel:
        headers["x-ha-background"] = "1"
    # porabim sprejme POST samo kot JSON (sicer 415 json_only): {}, kadar telesa ni
    payload = ({} if body is None else body) if method == "POST" else None
    async with asyncio.timeout(timeout_for(path)):
        resp = await async_get_clientsession(hass).request(method, f"{API_URL}/{path}", headers=headers, json=payload)
        try:
            data = await resp.json(content_type=None)
        except ValueError:
            data = None
        return resp.status, data


async def _async_valid_token(hass: HomeAssistant, link: PorabimLink, stale: str | None = None) -> str | None:
    """Dostopni žeton, osvežen, ko je potekel (ali ko ga je porabim zavrnil kot `stale`).

    None, kadar porabim zavrne tudi osvežitev: Home Assistant takrat enkrat prosi za novo povezavo, vsak nadaljnji klic
    pa je odjavljen, brez vprašanja na porabim (mrtev ključ bi bil le znova zavrnjen).
    Po ena osvežitev naenkrat, ker porabim ob vsaki uporabi zamenja žeton za osvežitev.
    """
    session = link.session
    async with link.lock:
        if link.refused:
            return None
        try:
            if stale is not None and session.token["access_token"] == stale:
                token = await session.implementation.async_refresh_token(session.token)
                hass.config_entries.async_update_entry(link.entry, data={**link.entry.data, "token": token})
            else:
                await session.async_ensure_token_valid()
        except aiohttp.ClientResponseError as err:
            if 400 <= err.status < 500:
                link.refused = True
                link.entry.async_start_reauth(hass)
                return None
            raise
        return session.token["access_token"]


async def async_call(
    hass: HomeAssistant,
    link: PorabimLink,
    method: str,
    path: str,
    body: Any = None,
    meter: str | None = None,
    panel: bool = False,
) -> tuple[int, Any]:
    """(status, razčlenjen JSON ali None). Pri 401 ena osvežitev in en ponovni poskus, nato ponovna prijava. `panel`: klic
    odprte plošče; vsak drug klic gre kot klic v ozadju."""
    token = await _async_valid_token(hass, link)
    if token is None:
        return 401, SIGNED_OUT
    status, data = await _async_send(hass, token, method, path, body, meter, panel)
    if status != 401:
        return status, data
    token = await _async_valid_token(hass, link, stale=token)
    if token is None:
        return 401, data
    status, data = await _async_send(hass, token, method, path, body, meter, panel)
    if status == 401:
        # porabim zavrne tudi nov ključ: kot pri zavrnjeni osvežitvi uporabnika vprašamo enkrat, porabim pa nič več
        link.refused = True
        link.entry.async_start_reauth(hass)
    return status, data
