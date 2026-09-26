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
READING_A_PLUS_15 = "32.0.2.4.1.2.12.0.0.0.0.0.0.0.0.3.72.0"  # received active energy (grid in), 15 min, kWh
READING_A_MINUS_15 = "32.0.2.4.19.2.12.0.0.0.0.0.0.0.0.3.72.0"  # delivered active energy (grid out), 15 min, kWh


def quarters_url(meter_id: str, today: date, days_back: int = 2) -> str:
    """Request for the 15-minute energy of the last days_back days (the API returns whole days)."""
    return quarters_range_url(meter_id, today - timedelta(days=days_back), today)


def quarters_range_url(meter_id: str, start: date, end: date, reading_type: str = READING_A_PLUS_15) -> str:
    """Request for the 15-minute energy of the days from start up to (not including) end."""
    return (
        f"{API_URL}?usagePoint={meter_id}&startTime={start.isoformat()}&endTime={end.isoformat()}"
        f"&option=ReadingType%3D{reading_type}"
    )


def month_spans(start: date, end: date) -> list[tuple[date, date]]:
    """[start, end] cut into pieces within one calendar month each (Moj Elektro answers about a month per request)."""
    out: list[tuple[date, date]] = []
    cur = start
    while cur <= end:
        next_month = (cur.replace(day=28) + timedelta(days=4)).replace(day=1)
        out.append((cur, min(end, next_month - timedelta(days=1))))
        cur = next_month
    return out


def _estimated(reading: dict) -> bool:
    """True for a quarter hour the meter has not delivered yet (1.5.x) or that Moj Elektro estimated (3.x)."""
    for quality in reading.get("readingQualities") or []:
        code = str((quality or {}).get("readingQualityType", ""))
        if code.startswith(("1.5.", "3.")):
            return True
    return False


def _quarters(payload: dict, today: date, reading_type: str = READING_A_PLUS_15) -> dict[date, list[tuple]]:
    """Past days with at least 92 readings: {date: [(start, kWh, flagged)] sorted by start}.

    Every reading carries the END time of its quarter hour (00:15 ... next day 00:00). A reading whose
    readingQualities include 1.5.x (not received from the meter) or 3.x (estimated) is flagged: Moj
    Elektro sends 0 or an even share of the day for it and replaces it once the meter delivers.
    1.8.0 marks a normal reading.
    """
    blocks = (payload or {}).get("intervalBlocks") or []
    block = next((b for b in blocks if b.get("readingType") == reading_type), None)
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
        per_day.setdefault(start.date(), []).append((start, value, _estimated(item)))
    # only complete past days (92/100 quarters on DST change days)
    return {d: sorted(items) for d, items in per_day.items() if d < today and len(items) >= 92}


def quarters_from_api(payload: dict, today: date, reading_type: str = READING_A_PLUS_15) -> dict[str, list[float]]:
    """Complete past days from a meter-readings response: {date: [kWh per quarter hour from 00:00]}."""
    return {d.isoformat(): [round(v, 4) for _, v, _ in items] for d, items in _quarters(payload, today, reading_type).items()}


def quarters_missing(payload: dict, today: date, reading_type: str = READING_A_PLUS_15) -> dict[str, int]:
    """Per day of quarters_from_api: how many quarter hours Moj Elektro has not published yet (sent as 0)."""
    return {d.isoformat(): sum(1 for *_, flagged in items if flagged) for d, items in _quarters(payload, today, reading_type).items()}


# ---------------------------------------------------------------- Moj Elektro API (daily meter readings)

# Cumulative meter registers (kWh), one reading per day taken at 00:00: total, high tariff (VT), low tariff (MT).
READING_ET = "32.0.4.1.1.2.12.0.0.0.0.0.0.0.0.3.72.0"
READING_VT = "32.0.4.1.1.2.12.0.0.0.0.1.0.0.0.3.72.0"
READING_MT = "32.0.4.1.1.2.12.0.0.0.0.2.0.0.0.3.72.0"
# The same registers for energy sent to the grid (flow direction 19 = reverse).
READING_ET_OUT = "32.0.4.1.19.2.12.0.0.0.0.0.0.0.0.3.72.0"
READING_VT_OUT = "32.0.4.1.19.2.12.0.0.0.0.1.0.0.0.3.72.0"
READING_MT_OUT = "32.0.4.1.19.2.12.0.0.0.0.2.0.0.0.3.72.0"

# Per direction: the 15-minute reading type, the three daily registers and the day-record keys.
GRID_IN = {
    "q15": READING_A_PLUS_15,
    "registers": {"et": READING_ET, "vt": READING_VT, "mt": READING_MT},
    "keys": {"u": "u", "vt": "vt", "mt": "mt", "mo": "mo", "mvt": "mvt", "mmt": "mmt"},
}
GRID_OUT = {
    "q15": READING_A_MINUS_15,
    "registers": {"et": READING_ET_OUT, "vt": READING_VT_OUT, "mt": READING_MT_OUT},
    "keys": {"u": "o", "vt": "ovt", "mt": "omt", "mo": "omo", "mvt": "omvt", "mmt": "ommt"},
}


def keyed(record: dict, direction: dict) -> dict:
    """A totals_from_readings record with the day-record keys of a direction (grid out: o, ovt, omt, ...)."""
    return {direction["keys"][k]: v for k, v in record.items()}


def readings_url(meter_id: str, reading_type: str, start: date, end: date) -> str:
    """Request for one register's daily readings from start up to (not including) end."""
    return (
        f"{API_URL}?usagePoint={meter_id}&startTime={start.isoformat()}&endTime={end.isoformat()}"
        f"&option=ReadingType%3D{reading_type}"
    )


def readings_from_api(payload: dict) -> dict[str, float]:
    """{date: register value} from a meter-readings response (the reading dated D is taken at 00:00 on D)."""
    out: dict[str, float] = {}
    for block in (payload or {}).get("intervalBlocks") or []:
        for item in block.get("intervalReadings") or []:
            try:
                day = datetime.fromisoformat(str(item["timestamp"])).date()
            except (KeyError, ValueError):
                continue
            value = to_float(item.get("value"))
            if value is not None and value >= 0:
                out[day.isoformat()] = value
    return out


def totals_from_readings(et: dict, vt: dict, mt: dict, days: list[date]) -> dict[str, dict]:
    """Day records from daily meter readings: usage of day D = reading(D + 1) - reading(D).

    Month-to-date totals come from the reading on the 1st of D's month. A day is left out when a
    reading is missing or the numbers do not add up (VT + MT must equal the total).
    """
    out: dict[str, dict] = {}
    for day in days:
        d, n, fm = day.isoformat(), (day + timedelta(days=1)).isoformat(), day.replace(day=1).isoformat()
        if any(k not in reg for reg in (et, vt, mt) for k in (d, n, fm)):
            continue
        u, v, m = (round(reg[n] - reg[d], 3) for reg in (et, vt, mt))
        if min(u, v, m) < 0 or abs(u - v - m) >= 0.02:
            continue
        out[d] = {
            "u": u,
            "vt": v,
            "mt": m,
            "mo": round(et[n] - et[fm], 3),
            "mvt": round(vt[n] - vt[fm], 3),
            "mmt": round(mt[n] - mt[fm], 3),
        }
    return out


# ---------------------------------------------------------------- network tariff blocks

# Slovenian public holidays (month, day); Easter Monday is added per year.
HOLIDAYS = {(1, 1), (1, 2), (2, 8), (4, 27), (5, 1), (5, 2), (6, 25), (8, 15), (10, 31), (11, 1), (12, 25), (12, 26)}


def easter_monday(year: int) -> date:
    """Easter Monday (Gregorian calendar)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1) + timedelta(days=1)


def block_of(start: datetime) -> int:
    """Network tariff block (1-5) of the quarter hour starting at this local time.

    Higher season = November to February; weekends and public holidays are one block cheaper.
    """
    h = start.hour
    tier = 0 if (7 <= h < 14 or 16 <= h < 20) else 1 if (h == 6 or 14 <= h < 16 or 20 <= h < 22) else 2
    day = start.date()
    free = day.weekday() >= 5 or (day.month, day.day) in HOLIDAYS or day == easter_monday(day.year)
    return (1 if day.month in (11, 12, 1, 2) else 2) + (1 if free else 0) + tier


def blocks_from_quarters(day: date, values: list[float]) -> list[float] | None:
    """kWh per tariff block for one day of 96 quarter hours (None on clock-change days)."""
    if len(values) != 96:
        return None
    blocks = [0.0] * 5
    start = datetime(day.year, day.month, day.day)
    for i, value in enumerate(values):
        blocks[block_of(start + timedelta(minutes=15 * i)) - 1] += value
    return [round(b, 3) for b in blocks]


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
