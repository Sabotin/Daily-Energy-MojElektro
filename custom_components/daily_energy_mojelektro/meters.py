# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""The account's meters as devices under the entry, from porabim's snapshot."""
from __future__ import annotations

import aiohttp

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr

from . import api
from .const import DOMAIN


async def async_sync(hass: HomeAssistant, link: api.PorabimLink) -> None:
    """At every start and after Add integration adds a meter: the account's meters from porabim's snapshot."""
    try:
        status, data = await api.async_call(hass, link, "GET", "snapshot")
    except (aiohttp.ClientError, TimeoutError):
        return
    if status == 200:
        async_apply(hass, link, data)


@callback
def device_meters(hass: HomeAssistant, entry_id: str) -> set[str]:
    """The porabim meter ids that have a device under the entry."""
    return {
        ident[1]
        for device in dr.async_entries_for_config_entry(dr.async_get(hass), entry_id)
        for ident in device.identifiers
        if ident[0] == DOMAIN
    }


@callback
def async_apply(hass: HomeAssistant, link: api.PorabimLink, snapshot: object) -> None:
    """One device per meter under the entry (its name, else its EIMM), and the entry titled Porabim.

    The entry is the porabim account, which can hold several meters, so its title names none of them. A title the
    user gave stays. Nothing changes when the snapshot has no meter list.
    """
    meters = api.meters(snapshot)
    if meters is None:
        return
    entry = link.entry
    if entry.title != api.TITLE and api.auto_title(entry.title, [m["label"] for m in meters]):
        hass.config_entries.async_update_entry(entry, title=api.TITLE)
    registry = dr.async_get(hass)
    kept = set()
    new = bool({m["id"] for m in meters} - device_meters(hass, entry.entry_id))
    for meter in meters:
        device = registry.async_get_or_create(
            config_entry_id=entry.entry_id,
            identifiers={(DOMAIN, meter["id"])},
            name=meter["label"],
            manufacturer="porabim.com",
            model="Moj Elektro meter",
            serial_number=meter["eimm"] or None,
            entry_type=dr.DeviceEntryType.SERVICE,
        )
        kept.add(device.id)
    for device in dr.async_entries_for_config_entry(registry, entry.entry_id):
        if device.id not in kept:
            registry.async_remove_device(device.id)
    # a meter added later (Add integration, + in the panel): its entities come with the next sensor refresh, now
    if new and link.sensors is not None and link.sensors.data is not None:
        hass.async_create_task(link.sensors.async_request_refresh())
