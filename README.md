<p align="center"><img src="assets/logo.webp" alt="Daily Energy" width="420"></p>

<p align="center"><b>Slovenščina</b> · <a href="#daily-energy-for-moj-elektro">English</a></p>

# Dnevni pregled porabe za Moj Elektro

![Daily Energy](assets/dashboard.webp)

Pregled porabe energije za Home Assistant, neposredno iz API-ja Moj Elektro. Vnesete ID merilnega mesta in API-žeton – in to je to.

## Funkcije

- Včerajšnja poraba v primerjavi s 30-dnevnim povprečjem
- Grafi dnevne, tedenske, mesečne in letne porabe
- Ločen prikaz VT / MT
- Tarifni bloki 1–5
- Moč v 15-minutnih intervalih z najvišjo vrednostjo za posamezen blok
- Toplotni zemljevid vzorca porabe
- Celotna zgodovina podatkov iz Moj Elektro za poljubno časovno obdobje
- Oddaja energije v omrežje za sončne elektrarne (izbirno)
- Slovenščina ali angleščina
- Lahek način za tablice na steni

## Zahteve

- Home Assistant 2024.12+
- API-žeton Moj Elektro: [mojelektro.si](https://mojelektro.si) → Moj profil → **Kreiraj žeton** (neomejena veljavnost)
- ID merilnega mesta (EIMM): Merilna mesta / merilne točke, npr. `4-123456`

## Namestitev

[![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Sabotin&repository=Daily-Energy-MojElektro&category=integration)

1. Kliknite zgornji gumb → **Download** → ponovno zaženite Home Assistant
2. Dodajte integracijo in vnesite ID merilnega mesta ter API-žeton – **Daily Energy** se nato prikaže v stranski vrstici

   [![Add integration](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=daily_energy_mojelektro)

<details><summary>Brez gumba</summary>

HACS → ⋮ → **Custom repositories** → `https://github.com/Sabotin/Daily-Energy-MojElektro` (Integration) → download →
restart → Settings → Devices & services → **Add integration** → **Daily Energy for Moj Elektro**.

</details>

Kot kartico na poljubni nadzorni plošči:

```yaml
type: custom:daily-energy-card
```

## Nastavitve

**Integracija** (Settings → Devices & services → Daily Energy → Configure): PIN, prikaz v stranski vrstici, ID merilnega mesta, nov API-žeton.

**Nadzorna plošča** (⚙):

| | |
|---|---|
| Jezik | Samodejno, English ali Slovenščina (za vsako napravo posebej) |
| Omrežje | Odjem, ali Odjem in oddaja |
| Ta naprava | Samodejno, Lahek ali Poln (za vsako napravo posebej) |
| Zgodovina Moj Elektro | Uvoz poljubnega časovnega obdobja |
| Cene | Cena VT / MT za oceno stroškov |
| Vaši podatki | Izvoz, uvoz CSV / JSON, brisanje vseh podatkov |

## Dobro je vedeti

- Novi podatki se preverjajo vsako uro. Včerajšnji 15-minutni podatki so običajno na voljo okoli 06:00, skupna poraba števca (z VT / MT) pa šele naslednji dan. Do takrat se včerajšnja poraba prikazuje na podlagi 15-minutnih podatkov.
- Vse se shranjuje v Home Assistant in je vključeno v njegove varnostne kopije. API-žeton nikoli ne pride do brskalnika.

## Licenca

MIT – glejte [LICENSE](LICENSE). Projekt ni povezan z Elektro Slovenije ali katerim koli distribucijskim podjetjem.

---

<p align="center"><a href="#dnevni-pregled-porabe-za-moj-elektro">Slovenščina</a> · <b>English</b></p>

# Daily Energy for Moj Elektro

Energy dashboard for Home Assistant, straight from the Moj Elektro API. Enter your meter ID and API token – done.

## Features

- Yesterday's usage vs. your 30-day average
- Daily, weekly, monthly and yearly charts
- VT / MT split
- Tariff blocks 1–5
- 15-minute power with the peak per block
- Energy rhythm heat map
- Full history from Moj Elektro, any date range
- Grid out for solar panels (optional)
- English or Slovenian
- Light mode for wall tablets

## Requirements

- Home Assistant 2024.12+
- Moj Elektro **API token**: [mojelektro.si](https://mojelektro.si) → Moj profil → **Kreiraj žeton** (unlimited expiration)
- **Meter ID** (EIMM): Merilna mesta / merilne točke, e.g. `4-123456`

## Install

[![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Sabotin&repository=Daily-Energy-MojElektro&category=integration)

1. Click the button above → **Download** → restart Home Assistant
2. Add the integration and enter your meter ID and API token – **Daily Energy** appears in the sidebar

   [![Add integration](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=daily_energy_mojelektro)

<details><summary>Without the button</summary>

HACS → ⋮ → **Custom repositories** → `https://github.com/Sabotin/Daily-Energy-MojElektro` (Integration) → download →
restart → Settings → Devices & services → **Add integration** → **Daily Energy for Moj Elektro**.

</details>

As a card on any dashboard:

```yaml
type: custom:daily-energy-card
```

## Settings

**Integration** (Settings → Devices & services → Daily Energy → Configure): PIN, sidebar, meter ID, new API token.

**Dashboard** (⚙):

| | |
|---|---|
| Language | Automatic, English or Slovenščina (per device) |
| Grid | Grid in, or Grid in & Grid out |
| This device | Automatic, Light or Full (per device) |
| Moj Elektro history | Import any date range |
| Prices | VT / MT price for cost estimates |
| Your data | Export, import CSV / JSON, delete all data |

## Good to know

- New data is checked every hour. Yesterday's 15-minute data arrives at about 06:00, the meter total (with VT / MT) a day later – until then yesterday is shown from the 15-minute data.
- Everything is stored in Home Assistant and included in its backups. The token never reaches the browser.

## Licence

MIT – see [LICENSE](LICENSE). Not affiliated with Elektro Slovenije or any distribution company.
