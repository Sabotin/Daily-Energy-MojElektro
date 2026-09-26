# Daily Energy for Moj Elektro

![Daily Energy dashboard](assets/dashboard.webp)

A full-screen energy dashboard for Home Assistant, fed straight from the Moj Elektro API.
Install it, enter your meter ID and API token, and a **Daily Energy** page appears in the sidebar.
No `configuration.yaml` editing and no other integration needed.

## What you get

- **Yesterday's usage** at a glance, compared with your 30-day average.
- **Daily, weekly, monthly and yearly** consumption charts.
- **High / low tariff** split (VT = high tariff, MT = low tariff), per day, week and month.
- **Tariff blocks** – energy per network tariff time block (Block 1–5), per day, week and month.
- **15-minute power** chart with the highest 15-minute power per tariff block (what your billed power is based on).
- **Energy rhythm** heat map and average by weekday.
- A **log** of every day, and your **history fetched straight from Moj Elektro** for any date range.
- Works for every user of your Home Assistant, updates live, and has a **light mode** for slow wall tablets.

Every value is shown on the day the energy was actually used (00:00–24:00).

## Requirements

- Home Assistant 2024.12 or newer
- A Moj Elektro **API token** and your **meter ID**:
  1. Log in to [mojelektro.si](https://mojelektro.si). Under **Moj profil**, choose **Kreiraj žeton** (create token),
     pick unlimited expiration and copy the token.
  2. The meter ID is the **EIMM** number under **Merilna mesta / merilne točke** (for example `4-123456`).

The [Moj Elektro integration](https://github.com/frlequ/homeassistant-mojelektro) by frlequ is **optional**. If you
already have it, setup can reuse its meter and token, and its sensors are then logged too, as a backup.

## Installation (HACS)

1. HACS → ⋮ → **Custom repositories** → add `https://github.com/Sabotin/Daily-Energy-MojElektro`, category **Integration**.
2. Search for **Daily Energy for Moj Elektro** in HACS and download it.
3. Restart Home Assistant.
4. Settings → Devices & services → **Add integration** → **Daily Energy for Moj Elektro**.
5. Enter your **meter ID** and **API token** (and optionally a PIN). Daily Energy checks them with Moj Elektro,
   and **Daily Energy** appears in the sidebar.
   (With the Moj Elektro integration installed you are first asked: enter a meter ID and token, or use the integration's.)

Manual installation: copy `custom_components/daily_energy_mojelektro` into your `config/custom_components` folder and restart.

### Without the integration (YAML setup)

Prefer plain YAML? The [`yaml-setup`](yaml-setup) folder has the same dashboard as a card file, a script and two
automations. It needs two Moj Elektro API requests in `configuration.yaml` and your API token in `secrets.yaml`:

```yaml
# secrets.yaml
mojelektro_token: PASTE_YOUR_TOKEN_HERE
```

```yaml
# configuration.yaml
rest_command:
  mojelektro_15min:
    url: "https://api.informatika.si/mojelektro/v1/meter-readings?usagePoint={{ meter }}&startTime={{ start }}&endTime={{ end }}&option=ReadingType%3D32.0.2.4.1.2.12.0.0.0.0.0.0.0.0.3.72.0"
    method: get
    headers:
      accept: application/json
      X-API-TOKEN: !secret mojelektro_token
    timeout: 30
  mojelektro_readings:
    url: "https://api.informatika.si/mojelektro/v1/meter-readings?usagePoint={{ meter }}&startTime={{ start }}&endTime={{ end }}&option=ReadingType%3D{{ rt }}"
    method: get
    headers:
      accept: application/json
      X-API-TOKEN: !secret mojelektro_token
    timeout: 30
```

Restart Home Assistant after adding them, then follow the steps in [yaml-setup/README.md](yaml-setup/README.md)
(script `script.daily_energy_check_updates` and the hourly API automation).
The HACS integration does not need any of this: it makes the API requests itself.

## Options

Settings → Devices & services → Daily Energy for Moj Elektro → **Configure**:

| Option | What it does |
|---|---|
| PIN | Asked before opening the manual meter reading and before deleting readings. Empty = no PIN. Checked by Home Assistant, never stored in the browser. |
| Show in sidebar | Adds the Daily Energy page to the sidebar. |
| Light mode users | Comma-separated user names (for example `tablet`). Their dashboard skips blur and animations. |
| New API token | Only when you created a new token in Moj Elektro. It is checked before it is saved; empty keeps the current one. |

Energy prices for the cost estimates are set in the dashboard itself (⚙).

## Your history (optional)

New days are logged automatically from the day you install it. To fill in the past:

**Settings (⚙) → Moj Elektro history** – pick a **From** and **To** date and tap **Export & import from Moj Elektro**.
Daily Energy fetches those days straight from the Moj Elektro API, one month at a time (the progress is shown), and
fills in daily usage, the high / low tariff split, month totals and tariff blocks – plus the 15-minute chart for the
last three weeks. A year takes about a minute.

Or download CSV exports from the [Moj Elektro portal](https://mojelektro.si) and use **Import CSV / JSON**:

| Portal export | What it adds |
|---|---|
| Daily meter readings | Daily usage with the high / low tariff split and month totals |
| Daily quantities by tariff block | Energy per tariff block |
| 15-minute data | 15-minute power (last ~3 weeks) and exact tariff blocks |

Importing is safe to repeat; days are updated with Moj Elektro's numbers, never duplicated. Only administrators can
import. Days for which Moj Elektro has no meter reading (for example before your smart meter was installed) stay empty.

## How the data works

- Moj Elektro publishes a day's **meter-reading total** (and the high / low tariff split) about **two days** later, and its
  **15-minute data and tariff blocks** one day later. Until the meter total arrives, yesterday is shown from the
  15-minute data and marked "15-min data".
- A meter reading dated D is taken at 00:00 on D, so reading(D + 1) − reading(D) is the usage of day D.
- **Straight from the Moj Elektro API, every hour:** Daily Energy asks the Moj Elektro API for what is still missing -
  the daily meter readings (usage, high / low tariff and month totals of the last days) and yesterday's **96 quarter
  hours** for the 15-minute chart and the tariff blocks. Nothing is requested when everything is already there.
  Moj Elektro publishes yesterday's 15-minute curve at about 05:45 and a day's meter total a day later.
- **Update button** (next to Settings): checks the Moj Elektro API right away and shows "Updated the cards!" or
  "Nothing has been updated yet".
- Moj Elektro sometimes publishes a day before every quarter hour has arrived from the meter (those come as 0 and are
  flagged); such a day is fetched again until they are filled in. The 15-minute chart always shows one whole day and
  switches to the next day all at once.
- **With the Moj Elektro integration linked**, its sensors are logged as well, as a backup. Half-updated sensors are
  never saved: Daily Energy waits until they have settled and only logs a day when VT + MT equals the day total and
  the month totals agree.
- The log is stored by Home Assistant itself (`.storage/daily_energy_mojelektro.*`) and is part of your backups.
- Your data goes nowhere else: the only requests are those to the Moj Elektro API. The token is stored in Home
  Assistant and never reaches the browser.

You can also add the dashboard to any existing dashboard as a card:

```yaml
type: custom:daily-energy-card
```

## Credits and licence

Inspired by and optionally working with the [Moj Elektro integration](https://github.com/frlequ/homeassistant-mojelektro)
by frlequ (MIT). This project does not include any of its code; when it is linked, Daily Energy reads the sensors it
creates and reuses its meter and API token.

MIT licence – see [LICENSE](LICENSE). Not affiliated with Elektro Slovenije or any distribution company.
