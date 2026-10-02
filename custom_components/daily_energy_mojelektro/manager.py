# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
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
    CHECK_HOURS,
    CHECK_MINUTE,
    CONF_METER,
    CONF_NAME,
    CONF_PIN,
    CONF_TOKEN,
    DOMAIN,
    KEEP_Q15_DAYS,
    MAX_IMPORT_DAYS,
    REFRESHES_PER_DAY,
    SETTINGS_KEYS,
    STORAGE_VERSION,
    VERSION,
)

_LOGGER = logging.getLogger(__name__)


def entry_state(entry: ConfigEntry) -> tuple[dict, dict]:
    """What a running meter depends on: its data (meter, token) and options other than the name."""
    return dict(entry.data), {k: v for k, v in entry.options.items() if k != CONF_NAME}


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
        # entry_state() when set up; a change of anything else (the name) needs no reload
        self.entry_state: tuple[dict, dict] | None = None
        self._store: Store = Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}")
        # days: {date: {u, vt, mt, mo, mvt, mmt, b} + grid out {o, ovt, omt, omo, omvt, ommt}},
        # manual: {date: {t, vt, mt}}, edits: {date: {vt, mt} or {u}, and/or {b: [5 blocks]}, and/or {o}} manual values that fetching never
        # overwrites, q15 / q15o: {date: [kWh]} grid in / grid out,
        # q15_miss / q15o_miss: {date: quarter hours Moj Elektro had not published yet when the day was fetched},
        # refresh: {"day": date, "count": fetches a person started that day},
        # meta: {"grid_out_tried": 1 once "Grid in & Grid out" was switched on the first time (the only switch that fetches)},
        # agreed: {"v": 3, "day": date it was last fetched, "periods": logic.agreed_powers() the agreed power per
        # tariff block, "contract": logic.contract_info() how the metering point is billed}
        self.data: dict = {
            "days": {}, "manual": {}, "edits": {}, "settings": {}, "q15": {}, "q15_miss": {}, "q15o": {}, "q15o_miss": {},
            "refresh": {}, "meta": {}, "agreed": {},
        }
        # 15-minute days older than KEEP_Q15_DAYS, kept for good in a file of their own:
        # {"q15"|"q15o": {"YYYY-MM": {date: [kWh]}}}; the card gets only their dates and loads a month when needed
        self._arch_store: Store = Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}.q15")
        self.archive: dict = {"q15": {}, "q15o": {}}
        self._listeners: set[Callable[[dict], None]] = set()
        self._fetching = False

    # ------------------------------------------------------------ storage

    async def async_load(self) -> None:
        stored = await self._store.async_load()
        if isinstance(stored, dict):
            for key in self.data:
                if isinstance(stored.get(key), dict):
                    self.data[key] = stored[key]
        if "grid_out_tried" not in self.data["meta"]:
            self.data["meta"]["grid_out_tried"] = logic.grid_out_tried_start(self.grid_out, self.data["days"])
            self._save()
        stored = await self._arch_store.async_load()
        if isinstance(stored, dict):
            for key in self.archive:
                if isinstance(stored.get(key), dict):
                    self.archive[key] = stored[key]

    @callback
    def _save(self) -> None:
        self._store.async_delay_save(lambda: self.data, 2)

    @callback
    def _save_archive(self) -> None:
        self._arch_store.async_delay_save(lambda: self.archive, 10)

    async def async_flush(self) -> None:
        await self._store.async_save(self.data)
        await self._arch_store.async_save(self.archive)

    @staticmethod
    async def async_remove_store(hass: HomeAssistant, entry: ConfigEntry) -> None:
        await Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}").async_remove()
        await Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}.q15").async_remove()

    def _archive_days(self, q_key: str, days: dict) -> set[str]:
        """Put 15-minute days into the archive (per month). Returns the days that changed."""
        changed = set()
        for d, values in days.items():
            month = self.archive[q_key].setdefault(d[:7], {})
            if month.get(d) != values:
                month[d] = values
                changed.add(d)
        if changed:
            self._save_archive()
        return changed

    def _trim_quarters(self, q_key: str, miss_key: str, cutoff: str) -> set[str]:
        """Days older than cutoff leave the last-days data and go to the archive. Returns the archived days."""
        old = {d: v for d, v in self.data[q_key].items() if d < cutoff}
        self.data[q_key] = {d: v for d, v in self.data[q_key].items() if d >= cutoff}
        self.data[miss_key] = {d: n for d, n in self.data[miss_key].items() if d in self.data[q_key]}
        return self._archive_days(q_key, old)

    def archive_month(self, month: str) -> dict:
        """One archived month of both grids, for the card: {"q15": {date: [kWh]}, "q15o": {...}}."""
        return {key: dict(self.archive[key].get(month, {})) for key in ("q15", "q15o")}

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
        """Mornings every hour from 06:05 to 11:05 (and once Home Assistant has started, or the meter was added):
        fetch whatever is still missing from the Moj Elektro API. Returns a callable that stops it."""
        unsubs: list[CALLBACK_TYPE] = [
            async_track_time_change(
                self.hass, self._on_check_time, hour=list(CHECK_HOURS), minute=CHECK_MINUTE, second=0
            ),
            async_at_started(self.hass, lambda _hass: self._on_check_time(None)),
        ]

        @callback
        def _stop() -> None:
            for unsub in unsubs:
                unsub()

        return _stop

    @callback
    def _on_check_time(self, _now) -> None:
        self.hass.async_create_task(self.async_check_updates(force=False))

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
        """What the API should still deliver: yesterday's full 15-minute curve and the real meter totals of
        the last three days. Moj Elektro publishes a day's meter total one or two days later; until it is there
        the day is shown from its 15-minute data, so the morning checks keep asking for it."""
        d1, d2, d3 = ((today - timedelta(days=n)).isoformat() for n in (1, 2, 3))
        out = []
        for direction, q_key, miss_key in self._directions():
            name = "" if direction is logic.GRID_IN else " out"
            if len(self.data[q_key].get(d1, [])) < 92 or self.data[miss_key].get(d1):
                out.append(f"15-min{name} {d1}")
            if self.data[miss_key].get(d2):
                out.append(f"15-min{name} {d2}")
            total = direction["keys"]["u"]
            out += [f"total{name} {d}" for d in (d3, d2, d1) if total not in self.data["days"].get(d, {})]
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

    def _agreed_due(self, today) -> bool:
        """The agreed power is fetched at most once a day (it changes rarely), and at once when it is stored in an
        older form."""
        return self.data["agreed"].get("day") != today.isoformat() or self.data["agreed"].get("v") != 3

    async def _fetch_agreed(self, session, meter: str, token: str, today) -> bool:
        """The agreed power per tariff block of every period, from the metering point's grid-in point (two
        requests). Returns whether it changed."""
        await asyncio.sleep(API_PAUSE)
        point = await self._get_json(session, logic.POINT_URL + meter, token)
        if point is None:
            return False
        gsrn = logic.omto_gsrn(point)
        if not gsrn:
            # Moj Elektro answered without a grid-in point: try again tomorrow, not at every check
            self.data["agreed"] = {
                "v": 3, "day": today.isoformat(), "periods": [], "contract": logic.contract_info(point, {}),
            }
            self._save()
            return False
        await asyncio.sleep(API_PAUSE)
        payload = await self._get_json(session, logic.GSRN_URL + gsrn, token)
        if payload is None:
            return False
        periods = logic.agreed_powers(payload)
        contract = logic.contract_info(point, payload)
        changed = periods != self.data["agreed"].get("periods", []) or contract != self.data["agreed"].get("contract", {})
        self.data["agreed"] = {"v": 3, "day": today.isoformat(), "periods": periods, "contract": contract}
        self._save()
        return changed

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
        least as complete. Older days go to the archive (only complete ones when they arrive). Returns the days
        that changed."""
        changed = set()
        for d, values in days.items():
            flagged = missing.get(d, 0)
            if d >= cutoff and (d not in self.data[q_key] or flagged <= self.data[miss_key].get(d, 0)):
                if self.data[q_key].get(d) != values:
                    changed.add(d)
                self.data[q_key][d] = values
                self.data[miss_key][d] = flagged
        changed |= self._archive_days(q_key, {d: v for d, v in days.items() if d < cutoff and not missing.get(d, 0)})
        return changed | self._trim_quarters(q_key, miss_key, cutoff)

    async def async_check_updates(self, force: bool = True) -> dict:
        """Fetch everything the dashboard shows straight from the Moj Elektro API and save what is new.

        * daily meter readings (total, VT, MT): usage, VT, MT and month totals of the last three days
        * 15-minute data of the last two days: the 15-minute chart, and the tariff blocks once a day
          is complete; a day is only replaced by data that is at least as complete
        * with Settings > Grid "Grid in & Grid out": the same for the energy sent to the grid
        Uses the meter ID and API token entered at setup.
        * once a day: the agreed power per tariff block
        force = False (the morning checks) does not contact Moj Elektro when nothing is missing.
        Returns {"changed": bool, ...}.
        """
        today = dt_util.now().date()
        if self._fetching:
            return {"changed": False, "busy": True}
        if not force and not self.missing(today) and not self._agreed_due(today):
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
        agreed_changed = False
        self._fetching = True
        try:
            session = async_get_clientsession(self.hass)
            if self._agreed_due(today):
                agreed_changed = await self._fetch_agreed(session, meter, token, today)
            for direction, q_key, miss_key in directions:
                # the 1st of the month (for month totals) and the last days
                result = await self._fetch(
                    session, meter, token, direction, (today - 2 * day, today), ((first, first + day), (d3, today + day))
                )
                fetched.append((direction, q_key, miss_key, *result))
        finally:
            self._fetching = False
        if not any(answered for *_, answered in fetched):
            return {"changed": False, "error": "Moj Elektro did not answer"}

        cutoff = (today - timedelta(days=KEEP_Q15_DAYS)).isoformat()
        for direction, q_key, miss_key, quarters, registers, _answered in fetched:
            if quarters is not None:
                self._store_quarters(
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

        changed = snap() != before or agreed_changed
        if changed:
            self._changed()
        return {"changed": changed, "missing": self.missing(today)}

    async def async_import_range(self, start: date, end: date) -> dict:
        """Fetch past days from the Moj Elektro API and fill them in (Settings > Moj Elektro history).

        Month by month: daily meter readings (usage, VT, MT, month totals) and 15-minute data (tariff
        blocks of every complete day; the 15-minute chart, older days in the archive), and with
        Settings > Grid "Grid in & Grid out" the same for the energy sent to the grid; once a day also the
        agreed power per tariff block (every period, so older months get theirs). Moj Elektro's
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
        answered = agreed_changed = False
        self._fetching = True
        try:
            session = async_get_clientsession(self.hass)
            if self._agreed_due(today):
                agreed_changed = await self._fetch_agreed(session, meter, token, today)
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
        if touched or agreed_changed:
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
        self.push()

    @callback
    def push(self) -> None:
        """Send the current state to open dashboards."""
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
            "name": self.entry.options.get(CONF_NAME, ""),
            "days": self.data["days"],
            "manual": self.data["manual"],
            "edits": self.data["edits"],
            "settings": self.data["settings"],
            "q15": self.data["q15"],
            "q15o": self.data["q15o"],
            # the archived 15-minute days, dates only: {"q15"|"q15o": {"YYYY-MM": [day numbers]}}
            "q15_days": {
                key: {m: sorted(int(d[8:]) for d in days) for m, days in sorted(self.archive[key].items()) if days}
                for key in ("q15", "q15o")
            },
            "meter": self.entry.entry_id,
            "api": all(self.credentials()),
            "has_pin": bool(self.pin),
            "agreed": self.data["agreed"].get("periods", []),
            "contract": self.data["agreed"].get("contract", {}),
        }

    @callback
    def save_settings(self, settings: dict) -> bool:
        """Save the dashboard settings. Returns whether a fetch started: only the meter's first switch to
        "Grid in & Grid out" fetches (its last 3 days, not counted as a refresh), and only without grid-out data."""
        clean = {k: settings[k] for k in SETTINGS_KEYS if k in settings}
        was_out = self.grid_out
        self.data["settings"] = {**self.data["settings"], **clean}
        mark, fetch = logic.grid_out_switch(
            was_out, self.grid_out, self.data["meta"].get("grid_out_tried", 0), self.data["days"]
        )
        if mark:
            self.data["meta"]["grid_out_tried"] = 1
        self._changed()
        if fetch:
            self.hass.async_create_task(self.async_check_updates(force=True))
        return fetch

    def refresh_allowed(self) -> bool:
        """A fetch a person starts (the Update button): at most REFRESHES_PER_DAY a day for
        this meter; the count starts again at midnight. The morning checks are not counted."""
        today = dt_util.now().date().isoformat()
        if self.data["refresh"].get("day") != today:
            self.data["refresh"] = {"day": today, "count": 0}
        if self.data["refresh"]["count"] >= REFRESHES_PER_DAY:
            return False
        self.data["refresh"]["count"] += 1
        self._save()
        return True

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
        for key in ("days", "manual", "edits", "q15", "q15_miss", "q15o", "q15o_miss", "agreed"):
            self.data[key] = {}
        self.archive = {"q15": {}, "q15o": {}}
        self._save_archive()
        self._changed()

    @callback
    def delete_day(self, day: str, grid_out: bool = False) -> bool:
        """Log > delete one day: its grid-in data (usage, VT / MT, month totals, tariff blocks, 15-minute data and
        manual edit) or its grid-out data and edit; the other direction and manual readings stay. Returns whether
        anything was removed."""
        direction = logic.GRID_OUT if grid_out else logic.GRID_IN
        keys = set(direction["keys"].values()) | (set() if grid_out else {"b"})
        q_key, miss_key = ("q15o", "q15o_miss") if grid_out else ("q15", "q15_miss")
        rec = self.data["days"].get(day, {})
        rest = {k: v for k, v in rec.items() if k not in keys}
        dropped = self._drop_edit(day, grid_out)
        month = self.archive[q_key].get(day[:7], {})
        archived = month.pop(day, None) is not None
        if archived:
            if not month:
                self.archive[q_key].pop(day[:7], None)
            self._save_archive()
        found = dropped or archived or rest != rec or day in self.data[q_key]
        if rest:
            self.data["days"][day] = rest
        else:
            self.data["days"].pop(day, None)
        self.data[q_key].pop(day, None)
        self.data[miss_key].pop(day, None)
        if found:
            self._changed()
        return found

    def _drop_edit(self, day: str, grid_out: bool) -> bool:
        edit = self.data["edits"].get(day)
        if not edit:
            return False
        rest = {k: v for k, v in edit.items() if (k != "o") == grid_out}
        if rest:
            self.data["edits"][day] = rest
        else:
            self.data["edits"].pop(day)
        return rest != edit

    @callback
    def save_edit(self, day: str, grid_out: bool, values: dict) -> None:
        """Log > Edit or Add (grid out): a manual value for one day. It is kept apart from Moj Elektro's data, so
        fetching never overwrites it; only deleting the day removes it. Grid in: {vt, mt} (the day total is their
        sum), {u} for a day with only 15-minute data, or {b} (the five tariff blocks); grid out: {o}."""
        edit = dict(self.data["edits"].get(day, {}))
        if grid_out:
            edit["o"] = round(float(values["o"]), 3)
        elif values.get("b") is not None:
            # Časovni bloki > Edit: the five tariff blocks of the day, next to any edited day total
            edit["b"] = [round(float(x), 3) for x in values["b"]]
        else:
            for key in ("u", "vt", "mt"):
                edit.pop(key, None)
            if values.get("vt") is not None and values.get("mt") is not None:
                edit.update(vt=round(float(values["vt"]), 3), mt=round(float(values["mt"]), 3))
            else:
                edit["u"] = round(float(values["u"]), 3)
        self.data["edits"][day] = edit
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
        # older complete days go to the archive, as do days that just left the last KEEP_Q15_DAYS
        self._archive_days(
            "q15", {d: v for d, v in parsed.get("q15", {}).items() if d < cutoff and not (missing or {}).get(d, 0)}
        )
        self._trim_quarters("q15", "q15_miss", cutoff)
        self._changed()
        return count

    @callback
    def apply_backup(self, backup: dict) -> int:
        """Merge a JSON export made by the card (days, manual readings, manual edits and settings)."""
        count = 0
        for day, rec in (backup.get("days") or {}).items():
            if isinstance(rec, dict) and self._merge_day(str(day), rec):
                count += 1
        for day, rec in (backup.get("manual") or {}).items():
            if isinstance(rec, dict):
                self.data["manual"][str(day)] = rec
        for day, rec in (backup.get("edits") or {}).items():
            if isinstance(rec, dict):
                self.data["edits"][str(day)] = rec
        if isinstance(backup.get("settings"), dict):
            self.save_settings(backup["settings"])
        self._changed()
        return count
