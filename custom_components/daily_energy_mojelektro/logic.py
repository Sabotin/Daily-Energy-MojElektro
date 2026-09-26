"""Pure logic for Daily Energy (no Home Assistant imports, so it can be unit-tested on its own).

Date convention used everywhere: a record dated D holds the energy used on calendar day D
(00:00-24:00, local time).

* A Moj Elektro meter reading dated D ("Dnevna stanja") is taken at 00:00 on D, so
  reading(D + 1) - reading(D) is the usage of day D. Moj Elektro publishes it about two days later.
* Tariff blocks and 15-minute data for day D arrive the next day.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime, timedelta

# Moj Elektro measurement names (keys of the integration's data dict) that we use.
USAGE_KEYS = (
    "daily_input",
    "daily_input_peak",
    "daily_input_offpeak",
    "monthly_input",
    "monthly_input_peak",
    "monthly_input_offpeak",
)
BLOCK_KEYS = tuple(f"daily_input_blok_{i}" for i in range(1, 6))
QUARTER_KEY = "15min_input"
KNOWN_KEYS = USAGE_KEYS + BLOCK_KEYS + (QUARTER_KEY,)

_UID_MARK = "-sensor.mojelektro_"


def measurement_from_unique_id(unique_id: str | None) -> str | None:
    """Return the Moj Elektro measurement name from an entity unique_id.

    The Moj Elektro integration builds unique ids as "<meter id>-sensor.mojelektro_<measurement>",
    where Home Assistant may have appended "_2", "_3"... to keep the generated id unique.
    """
    if not unique_id or _UID_MARK not in unique_id:
        return None
    name = unique_id.split(_UID_MARK, 1)[1]
    if name in KNOWN_KEYS:
        return name
    base = re.sub(r"_\d+$", "", name)
    return base if base in KNOWN_KEYS else None


def measurement_from_name(original_name: str | None) -> str | None:
    """Fallback: "Moj Elektro daily input peak" -> "daily_input_peak"."""
    if not original_name:
        return None
    name = original_name.strip().lower()
    if name.startswith("moj elektro "):
        name = name[len("moj elektro ") :]
    key = name.replace(" ", "_")
    return key if key in KNOWN_KEYS else None


def to_float(value) -> float | None:
    """Parse a sensor state or CSV cell; None for unknown/unavailable/empty."""
    if value is None:
        return None
    text = str(value).strip().replace(" ", "")
    if text in ("", "unknown", "unavailable", "None", "N/A"):
        return None
    if "," in text and "." not in text:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def snapshot_consistent(
    u: float, vt: float | None, mt: float | None, mo: float, mvt: float | None, mmt: float | None
) -> bool:
    """True when the Moj Elektro sensors agree with each other.

    Moj Elektro updates its sensors one after another, so for a moment the day total can already be
    new while VT, MT or the month totals are still yesterday's. Such a half-updated set must never
    be saved: VT + MT has to equal the day and month VT + month MT the month.
    """
    if None in (vt, mt, mvt, mmt):
        return False
    return abs(u - vt - mt) < 0.02 and abs(mo - mvt - mmt) < 0.05 and mo >= u - 0.01


def pick_usage_day(days: dict, u: float, mo: float, today: date) -> str:
    """Which calendar day the current daily_input value belongs to.

    monthly_input is month-to-date including the newest day, so (mo - u) is the month total of the
    day before it. Only records of the last 45 days that have a usage value are considered:
    * the earliest record whose mo equals (mo - u) is the day before  -> that day + 1
      (earliest, so a record saved with a stale month total can never push the day forward)
    * a record with the same mo and u                                -> the same day again
    * anything else (first run, 1st of the month, a gap)             -> today - 2, when Moj Elektro
      normally has it.
    """
    base = mo - u
    limit = (today - timedelta(days=45)).isoformat()
    recs = [
        (d, rec)
        for d, rec in sorted(days.items())
        if d >= limit and isinstance(rec.get("u"), (int, float)) and isinstance(rec.get("mo"), (int, float))
    ]
    if base > 0.01:
        for d, rec in recs:
            if abs(rec["mo"] - base) < 0.01:
                return (date.fromisoformat(d) + timedelta(days=1)).isoformat()
    for d, rec in recs:
        if abs(rec["mo"] - mo) < 0.01 and abs(rec["u"] - u) < 0.01:
            return d
    return (today - timedelta(days=2)).isoformat()


def blocks_day(today: date) -> str:
    """Tariff blocks from the sensors always cover yesterday 00:00-24:00."""
    return (today - timedelta(days=1)).isoformat()


# ---------------------------------------------------------------- Moj Elektro API (15-minute data)

API_URL = "https://api.informatika.si/mojelektro/v1/meter-readings"
READING_A_PLUS_15 = "32.0.2.4.1.2.12.0.0.0.0.0.0.0.0.3.72.0"  # received active energy, 15 min, kWh


def quarters_url(meter_id: str, today: date, days_back: int = 2) -> str:
    """Request for the 15-minute energy of the last days_back days (the API returns whole days)."""
    start = (today - timedelta(days=days_back)).isoformat()
    return (
        f"{API_URL}?usagePoint={meter_id}&startTime={start}&endTime={today.isoformat()}"
        f"&option=ReadingType%3D{READING_A_PLUS_15}"
    )


def quarters_from_api(payload: dict, today: date) -> dict[str, list[float]]:
    """Complete past days from a meter-readings response: {date: [kWh per quarter hour from 00:00]}.

    Every reading carries the END time of its quarter hour (00:15 ... next day 00:00).
    """
    blocks = (payload or {}).get("intervalBlocks") or []
    block = next((b for b in blocks if b.get("readingType") == READING_A_PLUS_15), None)
    if block is None and len(blocks) == 1:
        block = blocks[0]
    if block is None:
        return {}
    per_day: dict[date, list] = {}
    for item in block.get("intervalReadings") or []:
        try:
            end = datetime.fromisoformat(str(item["timestamp"]))
        except (KeyError, ValueError):
            continue
        value = to_float(item.get("value"))
        if value is None:
            continue
        start = end.replace(tzinfo=None) - timedelta(minutes=15)  # local wall time of the quarter's start
        per_day.setdefault(start.date(), []).append((start, value))
    out: dict[str, list[float]] = {}
    for d, items in per_day.items():
        if d >= today or len(items) < 92:  # only complete past days (92/100 on DST change days)
            continue
        items.sort()
        out[d.isoformat()] = [round(v, 4) for _, v in items]
    return out


# ---------------------------------------------------------------- CSV import


def _rows(text: str) -> list[list[str]]:
    text = text.lstrip("﻿")
    sample = text[:2000]
    delim = ";" if sample.count(";") > sample.count(",") else ","
    return [r for r in csv.reader(io.StringIO(text), delimiter=delim) if any(c.strip() for c in r)]


def _col(header: list[str], *needles: str) -> int | None:
    up = [h.strip().upper() for h in header]
    for i, h in enumerate(up):
        if all(n in h for n in needles):
            return i
    return None


def _date(value: str) -> date | None:
    value = value.strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d. %m. %Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def parse_moj_elektro_csv(text: str, today: date) -> dict:
    """Parse a Moj Elektro portal CSV export.

    Returns {"kind": str, "days": {date: patch}, "q15": {date: [kWh x 96]}}. Supported exports:
    * "Dnevna stanja" (daily meter readings: PREJETA DELOVNA ENERGIJA ET / VT / MT)
    * "Dnevne količine po časovnih blokih" (daily energy per tariff block)
    * "15 minutni podatki" (15-minute energy with the tariff block of every quarter hour)
    """
    rows = _rows(text)
    if not rows:
        raise ValueError("empty file")
    header, body = rows[0], rows[1:]

    et = _col(header, "PREJETA DELOVNA ENERGIJA ET")
    if et is not None:
        return _parse_readings(header, body, et)
    if _col(header, "BLOKU 1") is not None:
        return _parse_block_days(header, body, today)
    if _col(header, "ENERGIJA A+") is not None and (_col(header, "ZNA") is not None or _col(header, "TIMESTAMP") is not None):
        return _parse_quarters(header, body, today)
    raise ValueError("unknown CSV format")


def _parse_readings(header, body, et) -> dict:
    vt = _col(header, "PREJETA DELOVNA ENERGIJA VT")
    mt = _col(header, "PREJETA DELOVNA ENERGIJA MT")
    dc = _col(header, "DATUM")
    dc = 0 if dc is None else dc
    readings: dict[date, tuple] = {}
    for r in body:
        d = _date(r[dc]) if len(r) > dc else None
        t = to_float(r[et]) if len(r) > et else None
        if d is None or t is None:
            continue
        v = to_float(r[vt]) if vt is not None and len(r) > vt else None
        m = to_float(r[mt]) if mt is not None and len(r) > mt else None
        readings[d] = (t, v, m)

    days: dict[str, dict] = {}
    month_run: dict[tuple, list] = {}  # (year, month) -> [mo, mvt, mmt] while complete from day 1
    for d in sorted(readings):
        nxt = d + timedelta(days=1)
        if nxt not in readings:
            continue
        (t0, v0, m0), (t1, v1, m1) = readings[d], readings[nxt]
        u = round(t1 - t0, 3)
        if u < 0:
            continue
        rec = {"u": u}
        if None not in (v0, v1, m0, m1):
            rec["vt"] = round(v1 - v0, 3)
            rec["mt"] = round(m1 - m0, 3)
        key = (d.year, d.month)
        run = month_run.get(key)
        if run is None and d.day == 1:
            run = month_run[key] = [0.0, 0.0, 0.0]
        prev = d - timedelta(days=1)
        if run is not None and (d.day == 1 or prev.isoformat() in days):
            run[0] += u
            run[1] += rec.get("vt", 0.0)
            run[2] += rec.get("mt", 0.0)
            rec["mo"], rec["mvt"], rec["mmt"] = (round(x, 3) for x in run)
        else:
            month_run.pop(key, None)
        days[d.isoformat()] = rec
    return {"kind": "readings", "days": days, "q15": {}}


def _parse_block_days(header, body, today) -> dict:
    dc = _col(header, "DATUM")
    dc = 0 if dc is None else dc
    cols = [_col(header, f"BLOKU {i}") for i in range(1, 6)]
    days: dict[str, dict] = {}
    for r in body:
        d = _date(r[dc]) if len(r) > dc else None
        if d is None or d >= today:  # today's row is only the last quarter hour of yesterday
            continue
        b = [round(to_float(r[c]) or 0.0, 3) if c is not None and len(r) > c else 0.0 for c in cols]
        if sum(b) > 0.1:
            days[d.isoformat()] = {"b": b}
    return {"kind": "blocks", "days": days, "q15": {}}


def _parse_quarters(header, body, today) -> dict:
    tc = _col(header, "ZNA")  # "Časovna značka"
    if tc is None:
        tc = _col(header, "TIMESTAMP")
    ec = _col(header, "ENERGIJA A+")
    bc = _col(header, "BLOK")
    per_day: dict[date, list] = {}
    for r in body:
        if len(r) <= max(tc, ec):
            continue
        try:
            end = datetime.fromisoformat(r[tc].strip().replace(" ", "T"))
        except ValueError:
            continue
        e = to_float(r[ec])
        if e is None:
            continue
        start = end - timedelta(minutes=15)  # the portal stamps each quarter hour with its end time
        blk = int(to_float(r[bc]) or 0) if bc is not None and len(r) > bc else 0
        per_day.setdefault(start.date(), []).append((start, e, blk))

    days: dict[str, dict] = {}
    q15: dict[str, list] = {}
    for d, items in per_day.items():
        if d >= today or len(items) < 92:  # only complete days (92/100 on DST change days)
            continue
        items.sort()
        q15[d.isoformat()] = [round(e, 4) for _, e, _ in items]
        b = [0.0] * 5
        for _, e, blk in items:
            if 1 <= blk <= 5:
                b[blk - 1] += e
        if sum(b) > 0.1:
            days[d.isoformat()] = {"b": [round(x, 3) for x in b]}
    return {"kind": "quarters", "days": days, "q15": q15}
