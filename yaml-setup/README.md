# YAML setup (without the integration)

The HACS integration does all of this by itself — **if you installed it, you don't need anything in this folder.**
This is the manual way: the same dashboard built from a card file, two API requests, a script and an automation (plus an optional backup automation).

| File | Where it goes |
|---|---|
| [`secrets.yaml`](secrets.yaml) | One line in your `secrets.yaml`: your Moj Elektro API token |
| [`configuration.yaml`](configuration.yaml) | The two Moj Elektro API requests (`rest_command`) for your `configuration.yaml` |
| [`script-check-updates.yaml`](script-check-updates.yaml) | Script `script.daily_energy_check_updates`: fetches everything from the API (also run by the Update button) |
| [`automation-api.yaml`](automation-api.yaml) | Automation: runs that script every hour at :05 |
| [`automation-logger.yaml`](automation-logger.yaml) | Optional backup automation, only with the Moj Elektro integration: logs the same values from its sensors |
| [`daily-energy-card.js`](daily-energy-card.js) | The dashboard card |
| [`dashboard-view.yaml`](dashboard-view.yaml) | The dashboard view |

## Before you start

- Your Moj Elektro **API token** and **meter ID**: log in to [mojelektro.si](https://mojelektro.si), under
  **Moj profil** choose **Kreiraj žeton** (unlimited expiration); the meter ID is the **EIMM** number under
  **Merilna mesta / merilne točke** (for example `4-123456`).
- Optional: the [Moj Elektro integration](https://github.com/frlequ/homeassistant-mojelektro) by frlequ. Only the
  backup logger automation uses it; everything else runs on the API.

## Steps

1. **Log storage** – Settings → Devices & services → Add integration → **Local To-do**, name it `Daily Energy Log`
   (this creates `todo.daily_energy_log`; the name must match).
2. **API token** – add the line from [`secrets.yaml`](secrets.yaml) to your `secrets.yaml` (same folder as
   `configuration.yaml`) with your own token:
   ```yaml
   mojelektro_token: PASTE_YOUR_TOKEN_HERE
   ```
3. **API requests** – add the `rest_command:` block from [`configuration.yaml`](configuration.yaml) to your
   `configuration.yaml` (if `rest_command:` already exists, add only the two entries under it).
   Both requests use the Moj Elektro API `https://api.informatika.si/mojelektro/v1/meter-readings`:
   - `mojelektro_15min` – 15-minute energy (reading type `32.0.2.4.1.2.12.0.0.0.0.0.0.0.0.3.72.0`)
   - `mojelektro_readings` – daily meter readings: total, VT and MT (the reading type is passed by the script)

   The token is read with `!secret mojelektro_token`, so it never appears in `configuration.yaml`.
   **Restart Home Assistant.**
4. **Script** – Settings → Automations & scenes → Scripts → Add script → Create new script → ⋮ → Edit in YAML,
   paste [`script-check-updates.yaml`](script-check-updates.yaml), replace `YOUR-METER-ID` with your meter ID, save.
   It must end up as `script.daily_energy_check_updates` (the Update button looks for that name).
5. **Automation** – Settings → Automations & scenes → Create automation → ⋮ → Edit in YAML, paste
   [`automation-api.yaml`](automation-api.yaml), save. Only if you have the Moj Elektro integration, do the same with
   [`automation-logger.yaml`](automation-logger.yaml) as a backup.
6. **Card** – copy [`daily-energy-card.js`](daily-energy-card.js) to `/config/www/`, then Settings → Dashboards →
   ⋮ → Resources → Add resource: URL `/local/daily-energy-card.js`, type **JavaScript module**.
7. **Dashboard** – add a dashboard, open the raw configuration editor and paste
   [`dashboard-view.yaml`](dashboard-view.yaml) under `views:`. Hard-refresh the browser (Ctrl+F5).

## How it runs

- **Every hour** the API automation runs the script. It asks Moj Elektro only when something is still missing
  (yesterday's 15-minute data, or the meter totals of the last days) and saves only what is new or different.
- The **Update button** (next to Settings) runs the same script right away and shows
  "Updated the cards!" or "Nothing has been updated yet".
- The optional **logger** automation is a backup: it saves the values from the Moj Elektro sensors when they change.
- The manual meter reading and "Delete all readings" ask for a PIN; change `const DEL_PIN = '4085';` near the top of
  the card file.

Never share `secrets.yaml` or a screenshot of it, and never commit it anywhere.
