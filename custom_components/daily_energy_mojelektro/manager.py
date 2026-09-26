"""Storage and Moj Elektro API fetching for one meter."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import date, timedelta
import json
import logging

import aiohttp

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from . import logic
from .const import (
    API_PAUSE,
    CHECK_MINUTE,
    CONF_METER,
    CONF_PIN,
    CONF_TOKEN,
    DOMAIN,
    KEEP_Q15_DAYS,
    MAX_IMPORT_DAYS,
    SETTINGS_KEYS,
    STORAGE_VERSION,
    VERSION,
)

_LOGGER = logging.getLogger(__name__)


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
        # days: {date: {u, vt, mt, mo, mvt, mmt, b} + grid out {o, ovt, omt, omo, omvt, ommt}},
        # manual: {date: {t, vt, mt}}, q15 / q15o: {date: [kWh]} grid in / grid out,
        # q15_miss / q15o_miss: {date: quarter hours Moj Elektro had not published yet when the day was fetched}
        # meta: {history_filled: True} once the first history fill has run
        self.data: dict = {
            "days": {}, "manual": {}, "settings": {}, "q15": {}, "q15_miss": {}, "q15o": {}, "q15o_miss": {}, "meta": {}
        }
        self._listeners: set[Callable[[dict], None]] = set()
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

    def check_pin(self, pin: str | None) -> bool:
        return not self.pin or str(pin or "").strip() == self.pin

    def credentials(self) -> tuple[str | None, str | None]:
        """(meter ID, API token) entered at setup."""
        return self.entry.data.get(CONF_METER), self.entry.data.get(CONF_TOKEN)

    # ------------------------------------------------------------ schedule

    @callback
    def async_start(self) -> CALLBACK_TYPE:
        """Every hour (and once Home Assistant has started): fetch whatever is still missing from the
        Moj Elektro API. Returns a callable that stops it."""
        unsubs: list[CALLBACK_TYPE] = [
            async_track_time_change(self.hass, self._on_check_time, minute=CHECK_MINUTE, second=0),
            async_at_started(self.hass, lambda _hass: self.hass.async_create_task(self._async_first_run())),
        ]

        @callback
        def _stop() -> None:
            for unsub in unsubs:
                unsub()

        return _stop

    @callback
    def _on_check_time(self, _now) -> None:
        self.hass.async_create_task(self.async_check_updates(force=False))

    async def _async_first_run(self) -> None:
        """Once Home Assistant has started: fill in the history on a fresh install, then check as every hour."""
        if not self.data["meta"].get("history_filled"):
            await self.async_fill_history()
        await self.async_check_updates(force=False)

    async def async_fill_history(self) -> None:
        """A fresh install fetches its history once, from 1 January of last year, month by month (about a minute
        per year). An install that already has days, or one whose data was deleted, is never filled again."""
        today = dt_util.now().date()
        if not self.data["days"]:
            yesterday = today - timedelta(days=1)
            for start, end in ((date(today.year - 1, 1, 1), date(today.year - 1, 12, 31)), (date(today.year, 1, 1), yesterday)):
                if start > end:
                    continue
                result = await self.async_import_range(start, end)
                if result.get("error"):
                    # try again at the next start
                    _LOGGER.warning("Filling in the Moj Elektro history stopped: %s", result["error"])
                    return
        self.data["meta"]["history_filled"] = True
        self._save()

    # ------------------------------------------------------------ Moj Elektro API

    @property
    def grid_out(self) -> bool:
        """Settings > Grid: "Grid in & Grid out" also fetches the energy sent to the grid."""
        return self.data["settings"].get("grid") == "both"

    def _directions(self) -> list[tuple[dict, str, str]]:
        """(direction, 15-minute store key, its missing-quarters key) for every direction that is fetched."""
        out = [(logic.GRID_IN, "q15", "q15_miss")]
        if self.grid_out:
            out.append((logic.GRID_OUT, "q15o", "q15o_miss"))
        return out

    def missing(self, today) -> list[str]:
        """What the API should still deliver: yesterday's full 15-minute curve and the meter totals
        of the two days before yesterday (Moj Elektro publishes a day's meter total up to two days later)."""
        d1, d2, d3 = ((today - timedelta(days=n)).isoformat() for n in (1, 2, 3))
        out = []
        for direction, q_key, miss_key in self._directions():
            name = "" if direction is logic.GRID_IN else " out"
            if len(self.data[q_key].get(d1, [])) < 92 or self.data[miss_key].get(d1):
                out.append(f"15-min{name} {d1}")
            if self.data[miss_key].get(d2):
                out.append(f"15-min{name} {d2}")
            total = direction["keys"]["u"]
            out += [f"total{name} {d}" for d in (d3, d2) if total not in self.data["days"].get(d, {})]
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

    async def _fetch(self, session, meter: str, token: str, direction: dict, q_range, r_ranges) -> tuple:
        """One direction: the 15-minute data of q_range and the three daily registers of every r_range.

        Returns (15-minute payload or None, {"et"|"vt"|"mt": {date: reading}}, whether Moj Elektro answered).
        Moj Elektro allows 5 requests a second, so every request waits API_PAUSE first.
        """
        await asyncio.sleep(API_PAUSE)
        quarters = await self._get_json(session, logic.quarters_range_url(meter, *q_range, direction["q15"]), token)
        answered = quarters is not None
        registers: dict[str, dict] = {}
        for key, reading_type in direction["registers"].items():
            registers[key] = {}
            for start, end in r_ranges:
                await asyncio.sleep(API_PAUSE)
                payload = await self._get_json(session, logic.readings_url(meter, reading_type, start, end), token)
                answered |= payload is not None
                registers[key].update(logic.readings_from_api(payload))
        return quarters, registers, answered

    def _store_quarters(self, q_key: str, miss_key: str, days: dict, missing: dict, cutoff: str) -> set[str]:
        """Keep the 15-minute days of the last KEEP_Q15_DAYS days; a day is only replaced by data that is at
        least as complete. Returns the days that changed."""
        changed = set()
        for d, values in days.items():
            flagged = missing.get(d, 0)
            if d >= cutoff and (d not in self.data[q_key] or flagged <= self.data[miss_key].get(d, 0)):
                if self.data[q_key].get(d) != values:
                    changed.add(d)
                self.data[q_key][d] = values
                self.data[miss_key][d] = flagged
        self.data[q_key] = {d: v for d, v in self.data[q_key].items() if d >= cutoff}
        self.data[miss_key] = {d: n for d, n in self.data[miss_key].items() if d in self.data[q_key]}
        return changed

    async def async_check_updates(self, force: bool = True) -> dict:
        """Fetch everything the dashboard shows straight from the Moj Elektro API and save what is new.

        * daily meter readings (total, VT, MT): usage, VT, MT and month totals of the last three days
        * 15-minute data of the last two days: the 15-minute chart, and the tariff blocks once a day
          is complete; a day is only replaced by data that is at least as complete
        * with Settings > Grid "Grid in & Grid out": the same for the energy sent to the grid
        Uses the meter ID and API token entered at setup.
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

        day = timedelta(days=1)
        d3, first = today - 3 * day, (today - 3 * day).replace(day=1)
        watched = [(today - timedelta(days=n)).isoformat() for n in (1, 2, 3)]
        directions = self._directions()
        snap = lambda: json.dumps(  # noqa: E731
            [self.data["days"].get(d) for d in watched]
            + [self.data[q].get(d) for _, q, _ in directions for d in watched[:2]],
            sort_keys=True,
        )
        before = snap()
        fetched = []
        self._fetching = True
        try:
            session = async_get_clientsession(self.hass)
            for direction, q_key, miss_key in directions:
                # 15-minute data: the last 2 days, or the last 10 while fewer than 7 whole days are stored (the
                # per-block peaks look back over them); readings: the 1st of the month (month totals) and the last days
                recent = [d for d, v in self.data[q_key].items() if d >= (today - 10 * day).isoformat() and len(v) >= 92]
                back = 2 if len(recent) >= 7 else 10
                result = await self._fetch(
                    session, meter, token, direction, (today - back * day, today), ((first, first + day), (d3, today + day))
                )
                fetched.append((direction, q_key, miss_key, *result))
        finally:
            self._fetching = False
        if not any(answered for *_, answered in fetched):
            return {"changed": False, "error": "Moj Elektro did not answer"}

        cutoff = (today - timedelta(days=KEEP_Q15_DAYS)).isoformat()
        stored: set[str] = set()
        for direction, q_key, miss_key, quarters, registers, _answered in fetched:
            if quarters is not None:
                stored |= self._store_quarters(
                    q_key,
                    miss_key,
                    logic.quarters_from_api(quarters, today, direction["q15"]),
                    logic.quarters_missing(quarters, today, direction["q15"]),
                    cutoff,
                )
            if direction is logic.GRID_IN:
                # blocks follow the best 15-minute data there is: a day with quarter hours Moj Elektro has not
                # received yet still gets blocks (and so a provisional day total); they are updated once it has them
                for d in watched[:2]:
                    values = self.data["q15"].get(d)
                    if values:
                        blocks = logic.blocks_from_quarters(date.fromisoformat(d), values)
                        old = self.data["days"].get(d, {}).get("b")
                        if blocks and (not old or len(old) != 5 or any(abs(a - b) > 0.0015 for a, b in zip(old, blocks))):
                            self._merge_day(d, {"b": blocks})
            totals = logic.totals_from_readings(
                registers["et"], registers["vt"], registers["mt"], [date.fromisoformat(d) for d in reversed(watched)]
            )
            for d, rec in totals.items():
                rec = logic.keyed(rec, direction)
                old = self.data["days"].get(d, {})
                if any(not isinstance(old.get(k), (int, float)) or abs(old[k] - v) > 0.0015 for k, v in rec.items()):
                    self._merge_day(d, rec)

        changed = snap() != before or bool(stored)
        if changed:
            self._changed()
        return {"changed": changed, "missing": self.missing(today)}

    async def async_import_range(self, start: date, end: date) -> dict:
        """Fetch past days from the Moj Elektro API and fill them in (Settings > Moj Elektro history).

        Month by month: daily meter readings (usage, VT, MT, month totals) and 15-minute data (tariff
        blocks of every complete day; the 15-minute chart for the last KEEP_Q15_DAYS days), and with
        Settings > Grid "Grid in & Grid out" the same for the energy sent to the grid. Moj Elektro's
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
        directions = self._directions()
        collected = {id(dr): {"q": {}, "miss": {}, "reg": {"et": {}, "vt": {}, "mt": {}}} for dr, _, _ in directions}
        answered = False
        self._fetching = True
        try:
            session = async_get_clientsession(self.hass)
            for span_start, span_end in logic.month_spans(start, end):
                # readings from the 1st of the month (month totals) up to the day after the last day, in two
                # requests so that none is longer than a month
                first = span_start.replace(day=1)
                r_ranges = ((first, span_end + day), (span_end + day, span_end + 2 * day))
                for direction, _q, _m in directions:
                    quarters, registers, ok = await self._fetch(
                        session, meter, token, direction, (span_start, span_end + day), r_ranges
                    )
                    answered |= ok
                    bucket = collected[id(direction)]
                    if quarters is not None:
                        bucket["q"].update(logic.quarters_from_api(quarters, today, direction["q15"]))
                        bucket["miss"].update(logic.quarters_missing(quarters, today, direction["q15"]))
                    for key, values in registers.items():
                        bucket["reg"][key].update(values)
        finally:
            self._fetching = False
        if not answered:
            return {"days": 0, "error": "Moj Elektro did not answer"}

        wanted = [start + timedelta(days=n) for n in range((end - start).days + 1)]
        first_day, last_day = start.isoformat(), end.isoformat()
        cutoff = (today - timedelta(days=KEEP_Q15_DAYS)).isoformat()
        touched: set[str] = set()
        result = {"first": first_day, "last": last_day}
        for direction, q_key, miss_key in directions:
            bucket = collected[id(direction)]
            reg = bucket["reg"]
            totals = logic.totals_from_readings(reg["et"], reg["vt"], reg["mt"], wanted)
            for d, rec in totals.items():
                if self._merge_day(d, logic.keyed(rec, direction)):
                    touched.add(d)
            quarters = {d: v for d, v in bucket["q"].items() if first_day <= d <= last_day}
            if direction is logic.GRID_IN:
                blocks_days = 0
                for d, values in quarters.items():
                    flagged = bucket["miss"].get(d, 0)
                    blocks = logic.blocks_from_quarters(date.fromisoformat(d), values)
                    # quarter hours Moj Elektro has not received are sent as 0 or an even share: only use such
                    # a day's blocks when there are none yet
                    if blocks and (not flagged or not self.data["days"].get(d, {}).get("b")):
                        blocks_days += 1
                        if self._merge_day(d, {"b": blocks}):
                            touched.add(d)
                result.update(totals=len(totals), blocks=blocks_days, no_total=len(wanted) - len(totals))
            else:
                result.update(totals_out=len(totals))
            touched |= self._store_quarters(q_key, miss_key, quarters, bucket["miss"], cutoff)
        if touched:
            self._changed()
        return {"days": len(touched), **result}

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
            "q15o": self.data["q15o"],
            "api": all(self.credentials()),
            "has_pin": bool(self.pin),
        }

    @callback
    def save_settings(self, settings: dict) -> None:
        clean = {k: settings[k] for k in SETTINGS_KEYS if k in settings}
        was_out = self.grid_out
        self.data["settings"] = {**self.data["settings"], **clean}
        self._changed()
        if self.grid_out and not was_out:
            # grid out was just switched on: fetch the last days of it right away
            self.hass.async_create_task(self.async_check_updates(force=True))

    @callback
    def save_manual(self, put: list[dict], delete: list[str]) -> None:
        for day in delete:
            self.data["manual"].pop(day, None)
        for rec in put:
            day = str(rec["d"])
            self.data["manual"][day] = {k: rec[k] for k in ("t", "vt", "mt") if rec.get(k) is not None}
        self._changed()

    @callback
    def clear_all(self) -> None:
        """Settings > Delete all data: every Moj Elektro day, 15-minute day and manual reading. Settings stay."""
        for key in ("days", "manual", "q15", "q15_miss", "q15o", "q15o_miss"):
            self.data[key] = {}
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
