# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Dnevni zapis iz 1.x: v shrambi Home Assistanta, dokler ga porabim ne prevzame, na merilno mesto, za katero je bil hranjen."""
from __future__ import annotations

import logging
from typing import Any

import aiohttp

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.storage import Store

from . import api
from .const import DOMAIN, ISSUE_OLD_LOG, STORAGE_VERSION, VERSION

_LOGGER = logging.getLogger(__name__)


def store(hass: HomeAssistant, entry: ConfigEntry) -> Store:
    return Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}")


def same_meter(a: str, b: str) -> bool:
    """porabim primerja številke merilnih mest obrezane in z velikimi črkami."""
    return a.strip().upper() == b.strip().upper()


def _backup(old: Any) -> dict[str, Any] | None:
    """Varnostna kopija, ki jo je izvažala stara kartica; None, kadar v zapisu ni česa naložiti."""
    if not isinstance(old, dict):
        return None
    backup = {"app": DOMAIN, "version": VERSION}
    for key in ("days", "manual", "edits", "settings"):
        backup[key] = old.get(key) if isinstance(old.get(key), dict) else {}
    return backup if any(backup[key] for key in ("days", "manual", "edits")) else None


def _failed(status: int) -> str:
    _LOGGER.warning("porabim.com did not take the old day log (HTTP %s); trying again at the next start", status)
    return "signed_out" if status == 401 else "upload_failed"


async def async_upload(
    hass: HomeAssistant, link: api.PorabimLink, entry: ConfigEntry, eimm: str | None, *, must_have: bool = False
) -> str | None:
    """Dnevni zapis iz 1.x za `entry`, enkrat, v račun od `link`. None, kadar ni več česa naložiti, sicer razlog:
    "meter_missing", "upload_failed" ali "signed_out". Shramba se izbriše šele, ko ga porabim prevzame.

    Gre na svoje merilno mesto (`eimm`, merilno mesto vnosa iz 1.x): porabim varnostno kopijo brez x-meter da na prvo
    merilno mesto računa, zato zapis čaka s popravilom, ki to pove, dokler tega merilnega mesta ni v računu. Vnos, povezan
    pred 3.0.0, nima `eimm`: zapis gre na prvo merilno mesto, kot prej. `must_have`: merilno mesto mora biti v računu tudi
    pri praznem zapisu (vnos iz 1.x za drugo merilno mesto, združen v račun).
    """
    old_store = store(hass, entry)
    old = await old_store.async_load()
    backup = _backup(old)
    try:
        meter = None
        if eimm and (backup or must_have):
            status, snapshot = await api.async_call(hass, link, "GET", "snapshot")
            found = api.meters(snapshot) if status == 200 else None
            if found is None:
                return _failed(status)
            meter = next((m["id"] for m in found if same_meter(m["eimm"], eimm)), None)
            if meter is None:
                if not must_have:
                    ir.async_create_issue(
                        hass,
                        DOMAIN,
                        f"{ISSUE_OLD_LOG}_{entry.entry_id}",
                        is_fixable=False,
                        severity=ir.IssueSeverity.WARNING,
                        translation_key=ISSUE_OLD_LOG,
                        translation_placeholders={"meter": eimm},
                    )
                return "meter_missing"
        if backup:
            # pod data, tako kot ga pošlje nadzorna plošča porabim
            status, _ = await api.async_call(hass, link, "POST", "import-backup", {"data": backup}, meter)
            if not 200 <= status < 300:
                return _failed(status)
    except (aiohttp.ClientError, TimeoutError):
        return _failed(0)
    ir.async_delete_issue(hass, DOMAIN, f"{ISSUE_OLD_LOG}_{entry.entry_id}")
    if old is not None:
        await old_store.async_remove()
    return None
