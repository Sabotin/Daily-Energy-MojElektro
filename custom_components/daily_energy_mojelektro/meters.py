# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Merilna mesta računa kot naprave pod vnosom, iz posnetka porabim."""
from __future__ import annotations

import aiohttp

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, issue_registry as ir

from . import api
from .const import DOMAIN, ISSUE_NO_METER


async def async_sync(hass: HomeAssistant, link: api.PorabimLink) -> None:
    """Ob vsakem zagonu in ko Dodaj integracijo doda merilno mesto: merilna mesta računa iz posnetka porabim."""
    try:
        status, data = await api.async_call(hass, link, "GET", "snapshot")
    except (aiohttp.ClientError, TimeoutError):
        return
    if status == 200:
        async_apply(hass, link, data)


@callback
def device_meters(hass: HomeAssistant, entry_id: str) -> set[str]:
    """Id-ji merilnih mest porabim, ki imajo napravo pod vnosom."""
    return {
        ident[1]
        for device in dr.async_entries_for_config_entry(dr.async_get(hass), entry_id)
        for ident in device.identifiers
        if ident[0] == DOMAIN
    }


@callback
def async_apply(hass: HomeAssistant, link: api.PorabimLink, snapshot: object) -> None:
    """Ena naprava na merilno mesto pod vnosom (ime, sicer EIMM), vnos pa z naslovom Porabim.

    Vnos je račun porabim, ki ima lahko več merilnih mest, zato naslov ne imenuje nobenega. Naslov, ki ga je dal uporabnik,
    ostane. Brez seznama merilnih mest v posnetku se nič ne spremeni. Račun brez merilnega mesta (`onboarded: false`)
    vnos odstrani, razen kadar je zadnje merilno mesto pravkar odstranila plošča.
    """
    if isinstance(snapshot, dict) and snapshot.get("onboarded") is False:
        _async_no_meter(hass, link)
        return
    meters = api.meters(snapshot)
    if meters is None:
        return
    if meters:
        link.emptied = False
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
    # pozneje dodano merilno mesto (Dodaj integracijo, + v plošči): entitete pridejo z naslednjo osvežitvijo senzorjev, zdaj
    if new and link.sensors is not None and link.sensors.data is not None:
        hass.async_create_task(link.sensors.async_request_refresh())


@callback
def _async_no_meter(hass: HomeAssistant, link: api.PorabimLink) -> None:
    """Račun porabim nima več merilnega mesta: vnos se odstrani (plošča, naprave, entitete; async_remove_entry pokliče
    /ha/revoke), v Popravilih pa ostane obvestilo, kako se povezati znova."""
    if link.emptied or link.removing:
        return
    link.removing = True
    ir.async_create_issue(
        hass,
        DOMAIN,
        ISSUE_NO_METER,
        is_fixable=False,
        is_persistent=True,
        severity=ir.IssueSeverity.WARNING,
        translation_key=ISSUE_NO_METER,
    )
    entry_id = link.entry.entry_id
    hass.async_create_task(hass.config_entries.async_remove(entry_id), f"{DOMAIN} remove {entry_id}")
