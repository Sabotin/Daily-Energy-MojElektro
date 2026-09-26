"""Storage and daily logger for one Moj Elektro meter."""

from __future__ import annotations

import asyncio

from collections.abc import Callable
from datetime import timedelta
import logging

import aiohttp

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import (
    async_call_later,
    async_track_state_change_event,
    async_track_time_change,
)
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from . import logic
from .const import (
    CONF_LITE_USERS,
    CONF_PIN,
    CONF_SOURCE_ENTRY,
    DOMAIN,
    EARLIEST_HOUR,
    KEEP_Q15_DAYS,
    QUARTER_TIMES,
    REFRESH_TIMES,
    SETTINGS_KEYS,
    SETTLE_SECONDS,
    STORAGE_VERSION,
    VERSION,
)

_LOGGER = logging.getLogger(__name__)

# A change of any of these means Moj Elektro published new data.
WATCH_KEYS = ("daily_input", "monthly_input", "daily_input_blok_2", "daily_input_blok_3")


class DailyEnergyManager:
    """Keeps the day log of one meter and pushes changes to open dashboards."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.panel_url: str | None = None
        self._store: Store = Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}")
        # days: {date: {u, vt, mt, mo, mvt, mmt, b}}, manual: {date: {t, vt, mt}}, q15: {date: [kWh]}
        self.data: dict = {"days": {}, "manual": {}, "settings": {}, "q15": {}}
        self._listeners: set[Callable[[dict], None]] = set()
        self._unsub_watch: CALLBACK_TYPE | None = None
        self._unsub_settle: CALLBACK_TYPE | None = None
        self._fetching = False

    # ------------------------------------------------------------ storage

    async def async_load(self) -> None:
        stored = await self._store.async_load()
        if isinstance(stored, dict):
            for key in self.data:
                if isinstance(stored.get(key), dict):
                    self.data[key] = stored[key]

    @callback
    def _save(self) -> None:
        self._store.async_delay_save(lambda: self.data, 2)

    async def async_flush(self) -> None:
        await self._store.async_save(self.data)

    @staticmethod
    async def async_remove_store(hass: HomeAssistant, entry: ConfigEntry) -> None:
        await Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}").async_remove()

    # ------------------------------------------------------------ options

    @property
    def pin(self) -> str:
        return str(self.entry.options.get(CONF_PIN) or "").strip()

    @property
    def lite_users(self) -> list[str]:
        raw = self.entry.options.get(CONF_LITE_USERS) or ""
        return [u.strip() for u in str(raw).split(",") if u.strip()]

    def check_pin(self, pin: str | None) -> bool:
        return not self.pin or str(pin or "").strip() == self.pin

    # ------------------------------------------------------------ entities

    def entities(self) -> dict[str, str]:
        """Moj Elektro sensors of the linked meter, by measurement name."""
        registry = er.async_get(self.hass)
        found: dict[str, str] = {}
        source = self.entry.data.get(CONF_SOURCE_ENTRY)
        for ent in er.async_entries_for_config_entry(registry, source):
            if ent.domain != "sensor" or ent.disabled:
                continue
            key = logic.measurement_from_unique_id(ent.unique_id) or logic.measurement_from_name(
                ent.original_name
            )
            if key and key not in found:
                found[key] = ent.entity_id
        return found

    def _value(self, entities: dict[str, str], key: str) -> float | None:
        entity_id = entities.get(key)
        state = self.hass.states.get(entity_id) if entity_id else None
        return logic.to_float(state.state) if state else None

    # ------------------------------------------------------------ logger

    @callback
    def async_start(self) -> CALLBACK_TYPE:
        """Start listening; returns a callable that stops everything."""
        unsubs: list[CALLBACK_TYPE] = []
        for hour, minute in REFRESH_TIMES:
            unsubs.append(
                async_track_time_change(self.hass, self._on_time, hour=hour, minute=minute, second=0)
            )
        # Yesterday's whole 15-minute curve: tried every half hour from 05:00 to 09:00 until it is complete.
        for hour, minute in QUARTER_TIMES:
            unsubs.append(
                async_track_time_change(self.hass, self._on_quarters_time, hour=hour, minute=minute, second=0)
            )

        @callback
        def _started(_hass: HomeAssistant) -> None:
            # Moj Elektro's entities exist once Home Assistant has started.
            self._watch()
            self.hass.async_create_task(self.async_update())
            self.hass.async_create_task(self.async_fetch_quarters())

        unsubs.append(async_at_started(self.hass, _started))

        @callback
        def _stop() -> None:
            for unsub in unsubs:
                unsub()
            if self._unsub_watch:
                self._unsub_watch()
                self._unsub_watch = None
            if self._unsub_settle:
                self._unsub_settle()
                self._unsub_settle = None

        return _stop

    @callback
    def _watch(self) -> None:
        if self._unsub_watch:
            self._unsub_watch()
            self._unsub_watch = None
        entities = self.entities()
        watched = [entities[k] for k in WATCH_KEYS if k in entities]
        if watched:
            self._unsub_watch = async_track_state_change_event(self.hass, watched, self._on_change)
        else:
            _LOGGER.warning("No Moj Elektro sensors found for %s", self.entry.title)

    @callback
    def _on_change(self, event: Event) -> None:
        new = event.data.get("new_state")
        if new is None or new.state in ("unknown", "unavailable"):
            return
        # Moj Elektro updates its sensors one after another: log once, after the last change has settled.
        if self._unsub_settle:
            self._unsub_settle()
        self._unsub_settle = async_call_later(self.hass, SETTLE_SECONDS, self._on_settled)

    @callback
    def _on_settled(self, _now) -> None:
        self._unsub_settle = None
        self.hass.async_create_task(self.async_update())

    @callback
    def _on_time(self, _now) -> None:
        if self._unsub_watch is None:
            self._watch()
        self.hass.async_create_task(self.async_update())

    @callback
    def _on_quarters_time(self, _now) -> None:
        self.hass.async_create_task(self.async_fetch_quarters())

    async def async_fetch_quarters(self) -> None:
        """Download yesterday's 96 quarter hours from Moj Elektro in one request.

        The Moj Elektro sensor only reveals one of them every 15 minutes; with the whole day the
        15-minute chart shows all of yesterday shortly after midnight. Uses the API token and meter
        of the linked Moj Elektro entry, so there is nothing extra to set up.
        """
        today = dt_util.now().date()
        yesterday = (today - timedelta(days=1)).isoformat()
        if len(self.data["q15"].get(yesterday, [])) >= 92 or self._fetching:
            return
        source = self.hass.config_entries.async_get_entry(self.entry.data.get(CONF_SOURCE_ENTRY))
        token = source.data.get("token") if source else None
        meter = source.data.get("meter_id") if source else None
        if not token or not meter:
            return
        self._fetching = True
        try:
            session = async_get_clientsession(self.hass)
            async with asyncio.timeout(30):
                response = await session.get(
                    logic.quarters_url(meter, today),
                    headers={"accept": "application/json", "X-API-TOKEN": token},
                )
                if response.status != 200:
                    _LOGGER.debug("Moj Elektro 15-minute request: HTTP %s", response.status)
                    return
                payload = await response.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError, ValueError) as err:
            _LOGGER.debug("Moj Elektro 15-minute request failed: %s", err)
            return
        finally:
            self._fetching = False

        days = logic.quarters_from_api(payload, today)
        if days:
            self.apply_import({"days": {}, "q15": days})
            _LOGGER.debug("Stored 15-minute data for %s", ", ".join(sorted(days)))

    async def async_update(self) -> None:
        """Copy the current Moj Elektro values into the day log (same rules as the original automation)."""
        now = dt_util.now()
        if now.hour < EARLIEST_HOUR:
            return
        entities = self.entities()
        val = lambda key: self._value(entities, key)  # noqa: E731
        changed = False

        u, mo = val("daily_input"), val("monthly_input")
        vt, mt = val("daily_input_peak"), val("daily_input_offpeak")
        mvt, mmt = val("monthly_input_peak"), val("monthly_input_offpeak")
        if (
            u is not None
            and u > 0.1
            and mo is not None
            and mo > 0
            and logic.snapshot_consistent(u, vt, mt, mo, mvt, mmt)
        ):
            day = logic.pick_usage_day(self.data["days"], u, mo, now.date())
            patch = {"u": round(u, 3), "vt": round(vt, 3), "mt": round(mt, 3)}
            patch.update({"mo": round(mo, 3), "mvt": round(mvt, 3), "mmt": round(mmt, 3)})
            changed |= self._merge_day(day, patch)

        blocks = [val(k) for k in logic.BLOCK_KEYS]
        if all(b is not None for b in blocks) and sum(blocks) > 0.1:
            changed |= self._merge_day(logic.blocks_day(now.date()), {"b": [round(b, 3) for b in blocks]})

        if changed:
            self._changed()

    # ------------------------------------------------------------ changes

    def _merge_day(self, day: str, patch: dict) -> bool:
        old = self.data["days"].get(day, {})
        new = {**old, **patch}
        new = {k: v for k, v in new.items() if v is not None}
        if new == old:
            return False
        self.data["days"][day] = new
        return True

    @callback
    def _changed(self) -> None:
        self._save()
        snapshot = self.snapshot()
        for listener in list(self._listeners):
            listener(snapshot)

    @callback
    def async_add_listener(self, listener: Callable[[dict], None]) -> CALLBACK_TYPE:
        self._listeners.add(listener)

        @callback
        def _remove() -> None:
            self._listeners.discard(listener)

        return _remove

    def snapshot(self) -> dict:
        return {
            "version": VERSION,
            "title": self.entry.title,
            "days": self.data["days"],
            "manual": self.data["manual"],
            "settings": self.data["settings"],
            "q15": self.data["q15"],
            "entities": self.entities(),
            "has_pin": bool(self.pin),
            "lite_users": self.lite_users,
        }

    @callback
    def save_settings(self, settings: dict) -> None:
        clean = {k: settings[k] for k in SETTINGS_KEYS if k in settings}
        self.data["settings"] = {**self.data["settings"], **clean}
        self._changed()

    @callback
    def save_manual(self, put: list[dict], delete: list[str]) -> None:
        for day in delete:
            self.data["manual"].pop(day, None)
        for rec in put:
            day = str(rec["d"])
            self.data["manual"][day] = {k: rec[k] for k in ("t", "vt", "mt") if rec.get(k) is not None}
        self._changed()

    @callback
    def clear_manual(self) -> None:
        self.data["manual"] = {}
        self._changed()

    @callback
    def apply_import(self, parsed: dict) -> int:
        """Merge a parsed CSV (see logic.parse_moj_elektro_csv); returns the number of days touched."""
        count = 0
        for day, patch in parsed.get("days", {}).items():
            if self._merge_day(day, patch):
                count += 1
        cutoff = (dt_util.now().date() - timedelta(days=KEEP_Q15_DAYS)).isoformat()
        for day, values in parsed.get("q15", {}).items():
            if day >= cutoff:
                self.data["q15"][day] = values
        self.data["q15"] = {d: v for d, v in self.data["q15"].items() if d >= cutoff}
        self._changed()
        return count

    @callback
    def apply_backup(self, backup: dict) -> int:
        """Merge a JSON export made by the card (days, manual readings and settings)."""
        count = 0
        for day, rec in (backup.get("days") or {}).items():
            if isinstance(rec, dict) and self._merge_day(str(day), rec):
                count += 1
        for day, rec in (backup.get("manual") or {}).items():
            if isinstance(rec, dict):
                self.data["manual"][str(day)] = rec
        if isinstance(backup.get("settings"), dict):
            self.save_settings(backup["settings"])
        self._changed()
        return count
