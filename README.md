# Daily Energy for Moj Elektro

A full-screen energy dashboard for Home Assistant, built on top of the
[Moj Elektro integration](https://github.com/frlequ/homeassistant-mojelektro) by frlequ.
Install it, pick your Moj Elektro meter, and a **Daily Energy** page appears in the sidebar.

## What you get

- **Yesterday's usage** at a glance, compared with your 30-day average.
- **Daily, weekly, monthly and yearly** consumption charts.
- **Energija VT / MT** (big and small tariff) split, per day, week and month.
- **Časovni bloki** – energy per network tariff block (Blok 1–5), per day, week and month.
- **15-minute power** chart with the highest 15-minute power per tariff block (what your billed power is based on).
- **Energy rhythm** heat map and average by weekday.
- A **log** of every day, with CSV import of your history from the Moj Elektro portal.
- Works for every user of your Home Assistant, updates live, and has a **light mode** for slow wall tablets.

Every value is shown on the day the energy was actually used (00:00–24:00).

## Requirements

- Home Assistant 2024.12 or newer
- The [Moj Elektro integration](https://github.com/frlequ/homeassistant-mojelektro), set up with your Moj Elektro API token

## Installation (HACS)

1. HACS → ⋮ → **Custom repositories** → add `https://github.com/Sabotin/Daily-Energy-MojElektro`, category **Integration**.
2. Search for **Daily Energy for Moj Elektro** in HACS and download it.
3. Restart Home Assistant.
4. Settings → Devices & services → **Add integration** → **Daily Energy for Moj Elektro**.
5. Pick your Moj Elektro meter (and optionally a PIN). **Daily Energy** appears in the sidebar.

Manual installation: copy `custom_components/daily_energy_mojelektro` into your `config/custom_components` folder and restart.

## Options

Settings → Devices & services → Daily Energy for Moj Elektro → **Configure**:

| Option | What it does |
|---|---|
| PIN | Asked before opening the manual meter reading and before deleting readings. Empty = no PIN. Checked by Home Assistant, never stored in the browser. |
| Show in sidebar | Adds the Daily Energy page to the sidebar. |
| Light mode users | Comma-separated user names (for example `tablet`). Their dashboard skips blur and animations. |

Energy prices for the cost estimates are set in the dashboard itself (⚙).

## Your history (optional)

New days are logged automatically from the day you install it. To fill in the past, download CSV exports from the
[Moj Elektro portal](https://mojelektro.si) and use **Log → Import**:

| Portal page | What it adds |
|---|---|
| Dnevna stanja (daily meter readings) | Daily usage with VT / MT and month totals |
| Dnevne količine po časovnih blokih | Energy per tariff block |
| 15 minutni podatki | 15-minute power (last ~3 weeks) and exact tariff blocks |

Importing is safe to repeat; days are updated, never duplicated. Only administrators can import.

## How the data works

- Moj Elektro publishes a day's **meter-reading total** (and the VT / MT split) about **two days** later, and its
  **15-minute data and tariff blocks** one day later. Until the meter total arrives, yesterday is shown from the
  15-minute data and marked "15-min data".
- A meter reading dated D is taken at 00:00 on D, so reading(D + 1) − reading(D) is the usage of day D.
- The log is stored by Home Assistant itself (`.storage/daily_energy_mojelektro.*`) and is part of your backups.
- Nothing is sent anywhere; the dashboard only reads the sensors the Moj Elektro integration creates.

You can also add the dashboard to any existing dashboard as a card:

```yaml
type: custom:daily-energy-card
```

## Credits and licence

Built on the [Moj Elektro integration](https://github.com/frlequ/homeassistant-mojelektro) by frlequ (MIT).
This project does not include any of its code; it reads the sensors it creates.

MIT licence – see [LICENSE](LICENSE). Not affiliated with Elektro Slovenije or any distribution company.
