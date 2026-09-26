"""Tests for the pure logic module (no Home Assistant needed)."""

from datetime import date, datetime, timedelta
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "custom_components" / "daily_energy_mojelektro"))

import logic  # noqa: E402

TODAY = date(2026, 9, 25)


def test_measurement_from_unique_id():
    assert logic.measurement_from_unique_id("1000000000001-sensor.mojelektro_daily_input") == "daily_input"
    assert logic.measurement_from_unique_id("x-sensor.mojelektro_daily_input_blok_2") == "daily_input_blok_2"
    assert logic.measurement_from_unique_id("x-sensor.mojelektro_15min_input_2") == "15min_input"
    assert logic.measurement_from_unique_id("x-sensor.mojelektro_daily_output") is None
    assert logic.measurement_from_unique_id("something-else") is None
    assert logic.measurement_from_name("Moj Elektro daily input peak") == "daily_input_peak"


def test_pick_usage_day_first_run_and_repeats():
    # first run: the meter-reading total is two days behind
    assert logic.pick_usage_day({}, 30.5, 500.0, TODAY) == "2026-09-23"
    days = {"2026-09-23": {"u": 30.5, "mo": 500.0}}
    # the same values again stay on the same day
    assert logic.pick_usage_day(days, 30.5, 500.0, TODAY) == "2026-09-23"
    # the next day: month total before it equals the previous month-to-date
    assert logic.pick_usage_day(days, 28.25, 528.25, date(2026, 9, 26)) == "2026-09-24"


def test_pick_usage_day_new_month_falls_back():
    days = {"2026-09-29": {"u": 30.0, "mo": 900.0}}
    assert logic.pick_usage_day(days, 25.0, 25.0, date(2026, 10, 3)) == "2026-10-01"


def test_pick_usage_day_ignores_blocks_only_days():
    days = {"2026-09-23": {"u": 30.5, "mo": 500.0}, "2026-09-24": {"b": [0, 10.0, 5.0, 4.0, 0]}}
    assert logic.pick_usage_day(days, 28.25, 528.25, date(2026, 9, 26)) == "2026-09-24"


def test_stale_record_cannot_push_the_next_day_forward():
    # A half-updated save put the new day total under 24 Sep with 23 Sep's month total. The complete
    # values that follow must still land on 24 Sep, not 25 Sep.
    days = {
        "2026-09-23": {"u": 30.5, "mo": 500.0},
        "2026-09-24": {"u": 28.25, "mo": 500.0},
    }
    assert logic.pick_usage_day(days, 28.25, 528.25, date(2026, 9, 26)) == "2026-09-24"


def test_snapshot_consistent_rejects_half_updated_sensors():
    # everything new: VT + MT = day, month VT + month MT = month
    assert logic.snapshot_consistent(28.25, 20.0, 8.25, 528.25, 300.0, 228.25)
    # the day total is new, VT is still yesterday's
    assert not logic.snapshot_consistent(28.25, 15.5, 8.25, 528.25, 300.0, 228.25)
    # the month totals are still yesterday's while month VT is new
    assert not logic.snapshot_consistent(28.25, 20.0, 8.25, 500.0, 300.0, 220.0)
    # a missing sensor
    assert not logic.snapshot_consistent(28.25, None, 8.25, 528.25, 300.0, 228.25)


READINGS = """Datum,Merilno mesto,PREJETA DELOVNA ENERGIJA ET,PREJETA DELOVNA ENERGIJA VT,PREJETA DELOVNA ENERGIJA MT,ODDANA DELOVNA ENERGIJA ET,ODDANA DELOVNA ENERGIJA VT,ODDANA DELOVNA ENERGIJA MT,VRSTA STANJA
2026-09-01,1-1,100000.0000,60000.0000,40000.0000,0,0,0,Stanje iz MC
2026-09-02,1-1,100030.0000,60020.0000,40010.0000,0,0,0,Stanje iz MC
2026-09-03,1-1,100070.5000,60050.0000,40020.5000,0,0,0,Stanje iz MC
"""


def test_readings_csv_dates_usage_by_the_day_it_was_used():
    parsed = logic.parse_moj_elektro_csv(READINGS, TODAY)
    assert parsed["kind"] == "readings"
    assert parsed["days"]["2026-09-01"] == {"u": 30.0, "vt": 20.0, "mt": 10.0, "mo": 30.0, "mvt": 20.0, "mmt": 10.0}
    assert parsed["days"]["2026-09-02"]["u"] == 40.5
    assert parsed["days"]["2026-09-02"]["mo"] == 70.5
    assert "2026-09-03" not in parsed["days"]  # needs the 4 Sep reading


def test_readings_csv_partial_month_has_no_month_total():
    text = READINGS.replace("2026-09-01", "2026-09-10").replace("2026-09-02", "2026-09-11").replace("2026-09-03", "2026-09-12")
    parsed = logic.parse_moj_elektro_csv(text, TODAY)
    assert "mo" not in parsed["days"]["2026-09-10"]


BLOCKS = """Datum,Prejeta delovna energija v časovnem bloku 1 [kWh],Prejeta delovna energija v časovnem bloku 2 [kWh],Prejeta delovna energija v časovnem bloku 3 [kWh],Prejeta delovna energija v časovnem bloku 4 [kWh],Prejeta delovna energija v časovnem bloku 5 [kWh],Skupaj
2026-09-23,0.00,10.0000,5.0000,15.0000,0.00,30.0000
2026-09-24,0.00,12.5000,6.2500,8.2500,0.00,27.0000
2026-09-25,0.00,0.00,0.00,0.5000,0.00,0.5000
"""


def test_blocks_csv_skips_today():
    parsed = logic.parse_moj_elektro_csv(BLOCKS, TODAY)
    assert parsed["kind"] == "blocks"
    assert parsed["days"]["2026-09-24"]["b"] == [0.0, 12.5, 6.25, 8.25, 0.0]
    assert "2026-09-25" not in parsed["days"]


def _quarter_csv(day: str, value: float, blok: int) -> str:
    head = "Merilno mesto,GSRN MM,Časovna značka,Leto,Mesec,Energija A+,Energija A-,Energija R+,Energija R-,P+ Prejeta delovna moč,P- Oddana delovna moč,Q+ Prejeta jalova moč,Q- Oddana jalova moč,Blok,Dogovorjena moč\n"
    rows = []
    from datetime import datetime, timedelta

    start = datetime.fromisoformat(day + "T00:00")
    for i in range(96):
        end = start + timedelta(minutes=15 * (i + 1))
        rows.append(f"1-1,383,{end.strftime('%Y-%m-%dT%H:%M')},2026,9,{value:.4f},,,,{value * 4:.4f},,,,{blok},0.0")
    return head + "\n".join(rows) + "\n"


def test_quarter_csv_uses_interval_start_and_blocks():
    parsed = logic.parse_moj_elektro_csv(_quarter_csv("2026-09-23", 0.25, 4), TODAY)
    assert parsed["kind"] == "quarters"
    assert len(parsed["q15"]["2026-09-23"]) == 96
    assert parsed["days"]["2026-09-23"]["b"] == [0.0, 0.0, 0.0, 24.0, 0.0]
    assert "2026-09-24" not in parsed["q15"]  # the 00:00 stamp of the next day belongs to 23 Sep


def test_unknown_csv_raises():
    try:
        logic.parse_moj_elektro_csv("a,b\n1,2\n", TODAY)
    except ValueError:
        return
    raise AssertionError("expected ValueError")


def test_quarters_url():
    url = logic.quarters_url("1-000001", TODAY)
    assert url.startswith(logic.API_URL + "?usagePoint=1-000001&startTime=2026-09-23&endTime=2026-09-25")
    assert url.endswith("ReadingType%3D" + logic.READING_A_PLUS_15)


def _api_day(day: str, values: list[float]) -> list[dict]:
    """API readings of one day: each stamped with the END of its quarter hour."""
    from datetime import datetime, timedelta

    start = datetime.fromisoformat(day + "T00:00:00+02:00")
    return [
        {"timestamp": (start + timedelta(minutes=15 * (i + 1))).isoformat(), "value": str(v)}
        for i, v in enumerate(values)
    ]


def test_quarters_from_api_whole_days_only():
    full = [round(0.05 + i / 1000, 3) for i in range(96)]
    readings = _api_day("2026-09-24", full)
    readings.reverse()  # order must not matter
    readings.append({"timestamp": "2026-09-25T00:15:00+02:00", "value": "9"})  # today: incomplete, ignored
    readings.append({"timestamp": "2026-09-23T12:00:00+02:00", "value": "9"})  # lone quarter: ignored
    payload = {"intervalBlocks": [{"readingType": logic.READING_A_PLUS_15, "intervalReadings": readings}]}
    out = logic.quarters_from_api(payload, TODAY)
    assert list(out) == ["2026-09-24"]
    assert out["2026-09-24"] == full  # first value is 00:00-00:15, last 23:45-24:00


def test_quarters_from_api_empty_or_other_type():
    assert logic.quarters_from_api({}, TODAY) == {}
    other = {"intervalBlocks": [{"readingType": "x", "intervalReadings": []}, {"readingType": "y"}]}
    assert logic.quarters_from_api(other, TODAY) == {}


def test_quarters_missing_counts_flagged_quarters():
    # Moj Elektro publishes the day before every reading has arrived from the meter; those quarter
    # hours come as 0 with readingQualities and are replaced later.
    readings = _api_day("2026-09-24", [0.5] * 96)
    for r in readings[-8:]:
        r["value"] = "0.0000"
        r["readingQualities"] = [{"readingQualityType": "1.5.259"}]
    payload = {"intervalBlocks": [{"readingType": logic.READING_A_PLUS_15, "intervalReadings": readings}]}
    assert logic.quarters_missing(payload, TODAY) == {"2026-09-24": 8}
    assert logic.quarters_from_api(payload, TODAY)["2026-09-24"][-8:] == [0.0] * 8
    complete = {"intervalBlocks": [{"readingType": logic.READING_A_PLUS_15, "intervalReadings": _api_day("2026-09-24", [0.5] * 96)}]}
    assert logic.quarters_missing(complete, TODAY) == {"2026-09-24": 0}


def test_normal_reading_code_is_not_missing():
    # 1.8.0 marks a normal reading (older days carry it on every quarter); 3.x marks an estimate.
    readings = _api_day("2026-09-24", [0.5] * 96)
    for r in readings:
        r["readingQualities"] = [{"readingQualityType": "1.8.0"}]
    readings[10]["readingQualities"] = [{"readingQualityType": "1.5.259"}, {"readingQualityType": "3.8.0"}]
    readings[11]["readingQualities"] = [{"readingQualityType": "3.8.0"}]
    payload = {"intervalBlocks": [{"readingType": logic.READING_A_PLUS_15, "intervalReadings": readings}]}
    assert logic.quarters_missing(payload, TODAY) == {"2026-09-24": 2}


def _register(values: dict[str, float]) -> dict:
    return {"intervalBlocks": [{"readingType": logic.READING_ET, "intervalReadings": [
        {"timestamp": d + "T00:00:00+02:00", "value": f"{v:.4f}", "readingQualities": []} for d, v in values.items()
    ]}]}


def test_totals_from_meter_readings():
    # readings are taken at 00:00: usage of 24 Sep = reading of 25 Sep - reading of 24 Sep (invented numbers)
    et = logic.readings_from_api(_register({"2026-09-01": 1000.0, "2026-09-24": 1600.5, "2026-09-25": 1638.0}))
    vt = logic.readings_from_api(_register({"2026-09-01": 600.0, "2026-09-24": 950.0, "2026-09-25": 980.0}))
    mt = logic.readings_from_api(_register({"2026-09-01": 400.0, "2026-09-24": 650.5, "2026-09-25": 658.0}))
    out = logic.totals_from_readings(et, vt, mt, [date(2026, 9, 23), date(2026, 9, 24)])
    assert list(out) == ["2026-09-24"]  # 23 Sep needs the reading of 23 Sep
    assert out["2026-09-24"] == {"u": 37.5, "vt": 30.0, "mt": 7.5, "mo": 638.0, "mvt": 380.0, "mmt": 258.0}


def test_totals_skip_numbers_that_do_not_add_up():
    et = {"2026-09-01": 0.0, "2026-09-24": 10.0, "2026-09-25": 20.0}
    vt = {"2026-09-01": 0.0, "2026-09-24": 5.0, "2026-09-25": 9.0}
    mt = {"2026-09-01": 0.0, "2026-09-24": 5.0, "2026-09-25": 6.0}  # VT + MT = 5, total = 10
    assert logic.totals_from_readings(et, vt, mt, [date(2026, 9, 24)]) == {}


def test_easter_monday_and_blocks():
    assert logic.easter_monday(2026) == date(2026, 4, 6)
    assert logic.easter_monday(2027) == date(2027, 3, 29)
    assert logic.easter_monday(2025) == date(2025, 4, 21)
    from datetime import datetime
    assert logic.block_of(datetime(2026, 1, 5, 10)) == 1  # winter working day, peak
    assert logic.block_of(datetime(2026, 1, 3, 10)) == 2  # winter Saturday
    assert logic.block_of(datetime(2026, 9, 24, 10)) == 2  # summer working day, peak
    assert logic.block_of(datetime(2026, 9, 24, 23)) == 4  # summer night
    assert logic.block_of(datetime(2026, 9, 26, 23)) == 5  # summer weekend night
    assert logic.block_of(datetime(2026, 4, 6, 10)) == 3  # Easter Monday
    assert logic.block_of(datetime(2026, 12, 25, 6)) == 3  # Christmas, shoulder hour


def test_blocks_from_quarters():
    b = logic.blocks_from_quarters(date(2026, 9, 24), [0.25] * 96)  # Thursday, lower season
    # 11 h in block 2 (07-14, 16-20), 5 h in block 3 (06-07, 14-16, 20-22), 8 h in block 4 (night)
    assert b == [0.0, 11.0, 5.0, 8.0, 0.0]
    assert round(sum(b), 3) == 24.0
    assert logic.blocks_from_quarters(date(2026, 3, 29), [0.25] * 92) is None  # clock change day


def test_month_spans():
    assert logic.month_spans(date(2026, 1, 15), date(2026, 3, 2)) == [
        (date(2026, 1, 15), date(2026, 1, 31)),
        (date(2026, 2, 1), date(2026, 2, 28)),
        (date(2026, 3, 1), date(2026, 3, 2)),
    ]
    assert logic.month_spans(date(2025, 12, 1), date(2025, 12, 31)) == [(date(2025, 12, 1), date(2025, 12, 31))]
    assert logic.month_spans(date(2026, 5, 3), date(2026, 5, 2)) == []
    assert logic.quarters_range_url("4-1", date(2026, 1, 1), date(2026, 2, 1)).endswith(
        "startTime=2026-01-01&endTime=2026-02-01&option=ReadingType%3D" + logic.READING_A_PLUS_15
    )


def test_grid_out_quarters_and_totals():
    # Moj Elektro's answer for grid out: the same format with the A- reading type and empty readingQualities
    start = datetime(2026, 9, 25, 0, 15)
    readings = [
        {"readingQualities": [], "timestamp": (start + timedelta(minutes=15 * i)).isoformat() + "+02:00",
         "value": "1.2500" if 40 <= i < 60 else "0.0000"}
        for i in range(96)
    ]
    payload = {"intervalBlocks": [{"readingType": logic.READING_A_MINUS_15, "intervalReadings": readings}]}
    days = logic.quarters_from_api(payload, date(2026, 9, 26), logic.READING_A_MINUS_15)
    assert list(days) == ["2026-09-25"] and len(days["2026-09-25"]) == 96
    assert round(sum(days["2026-09-25"]), 3) == 25.0
    assert logic.quarters_missing(payload, date(2026, 9, 26), logic.READING_A_MINUS_15) == {"2026-09-25": 0}

    et = {"2026-09-01": 45100.0, "2026-09-23": 46002.103, "2026-09-24": 46044.616}
    vt = {"2026-09-01": 30539.0, "2026-09-23": 31441.16, "2026-09-24": 31483.673}
    mt = {"2026-09-01": 14560.943, "2026-09-23": 14560.943, "2026-09-24": 14560.943}
    rec = logic.totals_from_readings(et, vt, mt, [date(2026, 9, 23)])["2026-09-23"]
    out = logic.keyed(rec, logic.GRID_OUT)
    assert out == {"o": 42.513, "ovt": 42.513, "omt": 0.0, "omo": 944.616, "omvt": 944.673, "ommt": 0.0}
    assert logic.keyed(rec, logic.GRID_IN)["u"] == 42.513
    assert logic.GRID_OUT["registers"]["et"] == "32.0.4.1.19.2.12.0.0.0.0.0.0.0.0.3.72.0"
