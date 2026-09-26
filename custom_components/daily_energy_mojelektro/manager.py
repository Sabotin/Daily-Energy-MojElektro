"""Storage, Moj Elektro API fetching and the optional sensor logger for one meter."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import date, timedelta
import json
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
    API_PAUSE,
    CHECK_MINUTE,
    CONF_LITE_USERS,
    CONF_METER,
    CONF_PIN,
    CONF_SOURCE_ENTRY,
    CONF_TOKEN,
    DOMAIN,
    EARLIEST_HOUR,
    KEEP_Q15_DAYS,
    MAX_IMPORT_DAYS,
    REFRESH_TIMES,
    SETTINGS_KEYS,
    SETTLE_SECONDS,
    STORAGE_VERSION,
    VERSION,
)

_LOGGER = logging.getLogger(__name__)

# A change of any of these means Moj Elektro published new data.
WATCH_KEYS = ("daily_input", "monthly_input", "daily_input_blok_2", "daily_input_blok_3")


async def async_test_access(hass: HomeAssistant, meter: str, token: str) -> str | None:
    """One small Moj Elektro request to check a meter ID and token. Returns an error key, or None if fine."""
    today = dt_util.now().date()
    url = logic.readings_url(meter, logic.READING_ET, today - timedelta(days=7), today)
    try:
        async with asyncio.timeout(30):
            response = await async_get_clientsession(hass).get(
                url, headers={"accept": "application/json", "X-API-TOKEN": token}
            )
    except (aiohttp.ClientError, TimeoutError):
        return "cannot_connect"
    if response.status == 401:
        return "invalid_auth"
    if 400 <= response.status < 500:
        return "invalid_meter"
    if response.status != 200:
        return "cannot_connect"
    return None


class DailyEnergyManager:
    """Keeps the day log of one meter and pushes changes to open dashboards."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.panel_url: str | None = None
        self._store: Store = Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}")
        # days: {date: {u, vt, mt, mo, mvt, mmt, b}}, manual: {date: {t, vt, mt}}, q15: {date: [kWh]},
        # q15_miss: {date: quarter hours Moj Elektro had not published yet when the day was fetched}
        self.data: dict = {"days": {}, "manual": {}, "settings": {}, "q15": {}, "q15_miss": {}}
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

    def credentials(self) -> tuple[str | None, str | None]:
        """(meter ID, API token): entered at setup, or those of the linked Moj Elektro integration."""
        if self.entry.data.get(CONF_TOKEN) and self.entry.data.get(CONF_METER):
            return self.entry.data[CONF_METER], self.entry.data[CONF_TOKEN]
        source_id = self.entry.data.get(CONF_SOURCE_ENTRY)
        source = self.hass.config_entries.async_get_entry(source_id) if source_id else None
        if source is None:
            return None, None
        return source.data.get(CONF_METER), source.data.get(CONF_TOKEN)

    # ------------------------------------------------------------ entities

    def entities(self) -> dict[str, str]:
        """Sensors of the linked Moj Elektro integration (optional), by measurement name."""
        registry = er.async_get(self.hass)
        found: dict[str, str] = {}
        source = self.entry.data.get(CONF_SOURCE_ENTRY)
        if not source:
            return found
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
        # Every hour: fetch whatever is still missing straight from the Moj Elektro API.
        unsubs.append(async_track_time_change(self.hass, self._on_check_time, minute=CHECK_MINUTE, second=0))

        @callback
        def _started(_hass: HomeAssistant) -> None:
            # Moj Elektro's entities exist once Home Assistant has started.
            self._watch()
            self.hass.async_create_task(self.async_update())
            self.hass.async_create_task(self.async_check_updates(force=False))

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
        elif self.entry.data.get(CONF_SOURCE_ENTRY):
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
        if not self.entry.data.get(CONF_SOURCE_ENTRY):
            return
        if self._unsub_watch is None:
            self._watch()
        self.hass.async_create_task(self.async_update())

    @callback
    def _on_check_time(self, _now) -> None:
        self.hass.async_create_task(self.async_check_updates(force=False))

    # ------------------------------------------------------------ Moj Elektro API

    def missing(self, today) -> list[str]:
        """What the API should still deliver: yesterday's full 15-minute curve and the meter totals
        of the two days before yesterday (Moj Elektro publishes a day's meter total two days later)."""
        d1, d2, d3 = ((today - timedelta(days=n)).isoformat() for n in (1, 2, 3))
        out = []
        if len(self.data["q15"].get(d1, [])) < 92 or self.data["q15_miss"].get(d1):
            out.append(f"15-min {d1}")
        if self.data["q15_miss"].get(d2):
            out.append(f"15-min {d2}")
        out += [f"total {d}" for d in (d3, d2) if "u" not in self.data["days"].get(d, {})]
        return out

    async def _get_json(self, session, url: str, token: str) -> dict | None:
        try:
            async with asyncio.timeout(30):
                response = await session.get(url, headers={"accept": "application/json", "X-API-TOKEN": token})
                if response.status != 200:
                    _LOGGER.debug("Moj Elektro request: HTTP %s", response.status)
                    return None
                return await response.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError, ValueError) as err:
            _LOGGER.debug("Moj Elektro request failed: %s", err)
            return None

    async def async_check_updates(self, force: bool = True) -> dict:
        """Fetch everything the dashboard shows straight from the Moj Elektro API and save what is new.

        * daily meter readings (total, VT, MT): usage, VT, MT and month totals of the last three days
        * 15-minute data of the last two days: the 15-minute chart, and the tariff blocks once a day
          is complete; a day is only replaced by data that is at least as complete
        Uses the meter ID and API token entered at setup (or those of the linked Moj Elektro integration).
        force = False (the hourly run) does not contact Moj Elektro when nothing is missing.
        Returns {"changed": bool, ...}.
        """
        today = dt_util.now().date()
        if self._fetching:
            return {"changed": False, "busy": True}
        if not force and not self.missing(today):
            return {"changed": False, "skipped": True}
        meter, token = self.credentials()
        if not token or not meter:
            return {"changed": False, "error": "no Moj Elektro token"}

        d3, first = today - timedelta(days=3), (today - timedelta(days=3)).replace(day=1)
        watched = [(today - timedelta(days=n)).isoformat() for n in (1, 2, 3)]
        before = json.dumps(
            [self.data["days"].get(d) for d in watched] + [self.data["q15"].get(d) for d in watched[:2]],
            sort_keys=True,
        )
        self._fetching = True
        try:
            session = async_get_clientsession(self.hass)
            quarters = await self._get_json(session, logic.quarters_url(meter, today), token)
            registers: dict[str, dict] = {}
            for key, reading_type in (("et", logic.READING_ET), ("vt", logic.READING_VT), ("mt", logic.READING_MT)):
                registers[key] = {}
                # the 1st of the month (for month totals) and the last days; Moj Elektro allows 5 requests a second
                for start, end in ((first, first + timedelta(days=1)), (d3, today + timedelta(days=1))):
                    await asyncio.sleep(API_PAUSE)
                    payload = await self._get_json(session, logic.readings_url(meter, reading_type, start, end), token)
                    registers[key].update(logic.readings_from_api(payload))
        finally:
            self._fetching = False
        if quarters is None and not registers["et"]:
            return {"changed": False, "error": "Moj Elektro did not answer"}

        cutoff = (today - timedelta(days=KEEP_Q15_DAYS)).isoformat()
        if quarters is not None:
            missing = logic.quarters_missing(quarters, today)
            for d, values in logic.quarters_from_api(quarters, today).items():
                stored_miss = self.data["q15_miss"].get(d, 0)
                if d >= cutoff and (d not in self.data["q15"] or missing.get(d, 0) <= stored_miss):
                    self.data["q15"][d] = values
                    self.data["q15_miss"][d] = missing.get(d, 0)
        for d in watched[:2]:
            values = self.data["q15"].get(d)
            if values and not self.data["q15_miss"].get(d):
                blocks = logic.blocks_from_quarters(date.fromisoformat(d), values)
                old = self.data["days"].get(d, {}).get("b")
                if blocks and (not old or len(old) != 5 or any(abs(a - b) > 0.0015 for a, b in zip(old, blocks))):
                    self._merge_day(d, {"b": blocks})
        totals = logic.totals_from_readings(
            registers["et"], registers["vt"], registers["mt"], [date.fromisoformat(d) for d in reversed(watched)]
        )
        for d, rec in totals.items():
            old = self.data["days"].get(d, {})
            if any(not isinstance(old.get(k), (int, float)) or abs(old[k] - v) > 0.0015 for k, v in rec.items()):
                self._merge_day(d, rec)

        after = json.dumps(
            [self.data["days"].get(d) for d in watched] + [self.data["q15"].get(d) for d in watched[:2]],
            sort_keys=True,
        )
        changed = after != before
        if changed:
            self._changed()
        return {"changed": changed, "missing": self.missing(today)}

    async def async_import_range(self, start: date, end: date) -> dict:
        """Fetch past days from the Moj Elektro API and fill them in (Settings > Import from Moj Elektro).

        Month by month: daily meter readings (usage, VT, MT, month totals) and 15-minute data (tariff
        blocks of every complete day; the 15-minute chart for the last KEEP_Q15_DAYS days). Moj Elektro's
        numbers replace what is stored for those days. Returns {"days": days changed, ...} or {"error": ...}.
        """
        today = dt_util.now().date()
        end = min(end, today - timedelta(days=1))
        if start > end:
            return {"days": 0, "error": "Pick days before today"}
        if (end - start).days > MAX_IMPORT_DAYS:
            return {"days": 0, "error": f"At most {MAX_IMPORT_DAYS} days at a time"}
        meter, token = self.credentials()
        if not token or not meter:
            return {"days": 0, "error": "No Moj Elektro meter ID and token"}
        if self._fetching:
            return {"days": 0, "error": "Daily Energy is already fetching, try again in a moment"}

        day = timedelta(days=1)
        registers: dict[str, dict] = {"et": {}, "vt": {}, "mt": {}}
        quarters: dict[str, list[float]] = {}
        missing: dict[str, int] = {}
        answered = False
        self._fetching = True
        try:
            session = async_get_clientsession(self.hass)
            for span_start, span_end in logic.month_spans(start, end):
                await asyncio.sleep(API_PAUSE)
                payload = await self._get_json(
                    session, logic.quarters_range_url(meter, span_start, span_end + day), token
                )
                if payload is not None:
                    answered = True
                    quarters.update(logic.quarters_from_api(payload, today))
                    missing.update(logic.quarters_missing(payload, today))
                # readings from the 1st of the month (month totals) up to the day after the last day, in two
                # requests so that none is longer than a month
                first = span_start.replace(day=1)
                for key, reading_type in (("et", logic.READING_ET), ("vt", logic.READING_VT), ("mt", logic.READING_MT)):
                    for req_start, req_end in ((first, span_end + day), (span_end + day, span_end + 2 * day)):
                        await asyncio.sleep(API_PAUSE)
                        payload = await self._get_json(
                            session, logic.readings_url(meter, reading_type, req_start, req_end), token
                        )
                        if payload is not None:
                            answered = True
                            registers[key].update(logic.readings_from_api(payload))
        finally:
            self._fetching = False
        if not answered:
            return {"days": 0, "error": "Moj Elektro did not answer"}

        wanted = [start + timedelta(days=n) for n in range((end - start).days + 1)]
        touched: set[str] = set()
        totals = logic.totals_from_readings(registers["et"], registers["vt"], registers["mt"], wanted)
        for d, rec in totals.items():
            if self._merge_day(d, rec):
                touched.add(d)
        blocks_days = 0
        cutoff = (today - timedelta(days=KEEP_Q15_DAYS)).isoformat()
        for d, values in quarters.items():
            if not start.isoformat() <= d <= end.isoformat():
                continue
            flagged = missing.get(d, 0)
            blocks = logic.blocks_from_quarters(date.fromisoformat(d), values)
            # quarter hours Moj Elektro has not received are sent as 0 or an even share: only use such a
            # day's blocks when there are none yet
            if blocks and (not flagged or not self.data["days"].get(d, {}).get("b")):
                blocks_days += 1
                if self._merge_day(d, {"b": blocks}):
                    touched.add(d)
            if d >= cutoff and (d not in self.data["q15"] or flagged <= self.data["q15_miss"].get(d, 0)):
                if self.data["q15"].get(d) != values:
                    touched.add(d)
                self.data["q15"][d] = values
                self.data["q15_miss"][d] = flagged
        if touched:
            self._changed()
        return {
            "days": len(touched),
            "totals": len(totals),
            "blocks": blocks_days,
            "no_total": len(wanted) - len(totals),
            "first": start.isoformat(),
            "last": end.isoformat(),
        }

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
            "api": all(self.credentials()),
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
    def apply_import(self, parsed: dict, missing: dict[str, int] | None = None) -> int:
        """Merge a parsed CSV (see logic.parse_moj_elektro_csv) or fetched 15-minute days.

        missing: quarter hours per day that Moj Elektro had not published yet (none for a CSV export).
        Returns the number of days touched.
        """
        count = 0
        for day, patch in parsed.get("days", {}).items():
            if self._merge_day(day, patch):
                count += 1
        cutoff = (dt_util.now().date() - timedelta(days=KEEP_Q15_DAYS)).isoformat()
        for day, values in parsed.get("q15", {}).items():
            if day >= cutoff:
                self.data["q15"][day] = values
                self.data["q15_miss"][day] = (missing or {}).get(day, 0)
        self.data["q15"] = {d: v for d, v in self.data["q15"].items() if d >= cutoff}
        self.data["q15_miss"] = {d: n for d, n in self.data["q15_miss"].items() if d in self.data["q15"]}
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
