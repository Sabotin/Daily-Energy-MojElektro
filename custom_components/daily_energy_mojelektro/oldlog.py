# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""The 1.x day log: kept in Home Assistant's store until porabim took it, onto the meter it was kept for."""
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
    """porabim compares meter numbers trimmed and in capitals."""
    return a.strip().upper() == b.strip().upper()


def _backup(old: Any) -> dict[str, Any] | None:
    """The backup the old card exported, None when the log holds nothing to upload."""
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
    """The 1.x day log of `entry`, once, into the account of `link`. None when nothing is left to upload, else why not:
    "meter_missing", "upload_failed" or "signed_out". The store is deleted only when porabim took it.

    It goes onto its own meter (`eimm`, the 1.x entry's meter): porabim puts a backup without x-meter on the account's
    first meter, so while that meter is not in the account the log waits, with a repair that says so. An entry linked
    before 3.0.0 has no `eimm`: its log goes to the first meter, as before. `must_have`: the meter must be in the account
    even when the log is empty (a 1.x entry of a second meter, merged into the account).
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
            # under data, as porabim's dashboard sends it
            status, _ = await api.async_call(hass, link, "POST", "import-backup", {"data": backup}, meter)
            if not 200 <= status < 300:
                return _failed(status)
    except (aiohttp.ClientError, TimeoutError):
        return _failed(0)
    ir.async_delete_issue(hass, DOMAIN, f"{ISSUE_OLD_LOG}_{entry.entry_id}")
    if old is not None:
        await old_store.async_remove()
    return None
