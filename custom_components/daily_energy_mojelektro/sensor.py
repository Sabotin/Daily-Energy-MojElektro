# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Številke vsakega merilnega mesta iz /api/sensors na porabim kot entitete na njegovi napravi. Izračuna jih porabim (isti
logic.js kot nadzorna plošča); tukaj se nič ne računa.

Vsaka entiteta, ki jo porabim navede med ključi merilnega mesta, nastane takoj, ko je merilno mesto dodano; ključ, ki
pride med vrednostmi, nastane takrat (starejši porabim ne navede nobenega). Nastala entiteta ostane: ključ brez številke
(prve minute novega merilnega mesta, mesečni ključi 1. v mesecu, račun v prvih dneh meseca, blok 1 poleti) ali API,
izklopljen v Skrbniku na porabim, jo pusti nedosegljivo. Entitete gredo z napravo svojega merilnega mesta (meters.py)."""
from __future__ import annotations

from datetime import date, timedelta
import logging
from typing import Any

import aiohttp

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE, EntityCategory, UnitOfEnergy, UnitOfPower
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity, DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from . import api, meters
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

# podatki na porabim se spremenijo približno enkrat na dan (Moj Elektro jih pošlje dan pozneje); en klic zajame vsa merilna mesta
SCAN_INTERVAL = timedelta(minutes=30)
# prvo preverjanje Moj Elektro novega merilnega mesta (sekunde po dodajanju) odloči o Odjem in oddaja: dokler porabim pravi "wait",
# vprašamo tako pogosto, največ tolikokrat na merilno mesto
WAIT_INTERVAL = timedelta(seconds=10)
WAIT_TRIES = 12
BLOCKS = range(1, 6)
# polja merilnega mesta, prikazana kot diagnostične entitete
DAY, LAST_CHECK = "day", "last_check"


def _energy(key: str, tkey: str | None = None, block: int | None = None) -> SensorEntityDescription:
    # brez state_class: podatki pridejo dan pozneje, zato bi jih plošča Energija štela na napačen dan
    return SensorEntityDescription(
        key=key, translation_key=tkey or key, device_class=SensorDeviceClass.ENERGY,
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR, suggested_display_precision=2,
        translation_placeholders={"block": str(block)} if block else None,
    )


def _power(key: str, tkey: str | None = None, block: int | None = None, measured: bool = True) -> SensorEntityDescription:
    return SensorEntityDescription(
        key=key, translation_key=tkey or key, device_class=SensorDeviceClass.POWER,
        native_unit_of_measurement=UnitOfPower.KILO_WATT, suggested_display_precision=2,
        state_class=SensorStateClass.MEASUREMENT if measured else None,
        translation_placeholders={"block": str(block)} if block else None,
    )


def _money(key: str) -> SensorEntityDescription:
    return SensorEntityDescription(
        key=key, translation_key=key, device_class=SensorDeviceClass.MONETARY, native_unit_of_measurement="EUR",
        suggested_display_precision=2,
    )


def _share(key: str) -> SensorEntityDescription:
    return SensorEntityDescription(
        key=key, translation_key=key, native_unit_of_measurement=PERCENTAGE, state_class=SensorStateClass.MEASUREMENT,
        suggested_display_precision=1,
    )


DESCRIPTIONS: dict[str, SensorEntityDescription] = {
    d.key: d
    for d in (
        *(_energy(f"{way}_{span}") for way in ("in", "out") for span in ("day", "month", "last_month")),
        *(_energy(f"block{b}_day", "block_day", b) for b in BLOCKS),
        _power("peak_day"),
        *(_power(f"peak_block{b}_month", "peak_block_month", b) for b in BLOCKS),
        *(_power(f"agreed_block{b}", "agreed_block", b, measured=False) for b in BLOCKS),
        _money("cost_month"),
        _money("cost_last_month"),
        _energy("plant_day"),
        _energy("plant_month"),
        _energy("self_use_day"),
        _share("self_use_share_day"),
        _share("autarky_day"),
        SensorEntityDescription(key=DAY, translation_key=DAY, device_class=SensorDeviceClass.DATE,
                                entity_category=EntityCategory.DIAGNOSTIC),
        SensorEntityDescription(key=LAST_CHECK, translation_key=LAST_CHECK, device_class=SensorDeviceClass.TIMESTAMP,
                                entity_category=EntityCategory.DIAGNOSTIC),
    )
}


class SensorsCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """GET /api/sensors: {"off": bool, "meters": [{"id", "day", "last_check", "values", "keys", "wait"}]}."""

    def __init__(self, hass: HomeAssistant, link: api.PorabimLink) -> None:
        super().__init__(hass, _LOGGER, config_entry=link.entry, name=f"{DOMAIN} sensors", update_interval=SCAN_INTERVAL)
        self.link = link
        # id merilnega mesta → koliko odgovorov zapored je reklo "wait"
        self._waits: dict[str, int] = {}

    async def _async_update_data(self) -> dict[str, Any]:
        # neuspešen klic nikoli ne obdrži kratkega intervala
        self.update_interval = SCAN_INTERVAL
        try:
            status, data = await api.async_call(self.hass, self.link, "GET", "sensors")
        except (aiohttp.ClientError, TimeoutError) as err:
            raise UpdateFailed(f"porabim.com did not answer: {err}") from err
        if status != 200 or not isinstance(data, dict):
            raise UpdateFailed(f"porabim.com answered HTTP {status}")
        found, keys, soon = {}, {}, False
        for meter in data.get("meters") if isinstance(data.get("meters"), list) else []:
            if isinstance(meter, dict) and isinstance(meter.get("id"), str) and meter["id"]:
                values = meter.get("values") if isinstance(meter.get("values"), dict) else {}
                found[meter["id"]] = {**values, DAY: meter.get(DAY), LAST_CHECK: meter.get(LAST_CHECK)}
                # vsaka entiteta, ki jo merilno mesto lahko ima, nastane takoj (starejši porabim ne pošlje nobene)
                listed = meter.get("keys")
                keys[meter["id"]] = [k for k in listed if isinstance(k, str)] if isinstance(listed, list) else []
                if meter.get("wait") is True:
                    self._waits[meter["id"]] = self._waits.get(meter["id"], 0) + 1
                    soon = soon or self._waits[meter["id"]] <= WAIT_TRIES
                else:
                    self._waits.pop(meter["id"], None)
        if soon:
            self.update_interval = WAIT_INTERVAL
        return {"off": data.get("off") is True, "meters": found, "keys": keys}


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    """Entitete se dodajo, ko jih porabim navede ali ko pridejo njihove številke; prva osvežitev steče po uskladitvi
    merilnih mest (__init__)."""
    link: api.PorabimLink = hass.data[DOMAIN][entry.entry_id]
    coordinator = link.sensors = SensorsCoordinator(hass, link)
    added: set[str] = set()

    @callback
    def _add_new() -> None:
        if not coordinator.data:
            return
        devices = meters.device_meters(hass, entry.entry_id)
        new = []
        for meter, values in coordinator.data["meters"].items():
            # samo na napravi, ki jo je naredil meters.py (ta ji da ime); naslednja osvežitev poskusi znova
            if meter not in devices:
                continue
            # ključi porabim (vsaka entiteta, ki jo merilno mesto lahko ima), nato vsak ključ s številko
            listed = coordinator.data.get("keys", {}).get(meter, [])
            for key in [*listed, *(k for k, v in values.items() if v is not None)]:
                if key in DESCRIPTIONS and f"{meter}_{key}" not in added:
                    added.add(f"{meter}_{key}")
                    new.append(PorabimSensor(coordinator, meter, DESCRIPTIONS[key], added))
        if new:
            async_add_entities(new)

    entry.async_on_unload(coordinator.async_add_listener(_add_new))


class PorabimSensor(CoordinatorEntity[SensorsCoordinator], SensorEntity):
    _attr_has_entity_name = True

    def __init__(self, coordinator: SensorsCoordinator, meter: str, description: SensorEntityDescription, added: set[str]) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._meter = meter
        self._added = added
        self._attr_unique_id = f"{meter}_{description.key}"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, meter)})

    async def async_will_remove_from_hass(self) -> None:
        # njegova naprava je odstranjena: če se merilno mesto vrne, entiteta spet nastane
        self._added.discard(self._attr_unique_id)

    def _values(self) -> dict[str, Any]:
        data = self.coordinator.data or {}
        return {} if data.get("off") else data.get("meters", {}).get(self._meter, {})

    @property
    def available(self) -> bool:
        return super().available and self._values().get(self.entity_description.key) is not None

    @property
    def native_value(self) -> Any:
        value = self._values().get(self.entity_description.key)
        if value is None:
            return None
        if self.entity_description.device_class == SensorDeviceClass.DATE:
            try:
                return date.fromisoformat(value)
            except (TypeError, ValueError):
                return None
        if self.entity_description.device_class == SensorDeviceClass.TIMESTAMP:
            return dt_util.parse_datetime(value) if isinstance(value, str) else None
        return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        key = self.entity_description.key
        values = self._values()
        attrs = {}
        if key.endswith("_day") and values.get(DAY):
            attrs["day"] = values[DAY]
        if key == "peak_day" and values.get("peak_day_at"):
            attrs["at"] = values["peak_day_at"]
        return attrs or None
