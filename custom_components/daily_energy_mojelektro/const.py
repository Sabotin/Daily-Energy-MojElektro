# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Constants for Daily Energy for Moj Elektro."""

DOMAIN = "daily_energy_mojelektro"
VERSION = "0.9.31"

# Moj Elektro API access, entered at setup.
CONF_TOKEN = "token"
CONF_METER = "meter_id"
CONF_PIN = "pin"
CONF_SIDEBAR = "sidebar"
# the meter's name, given with the dashboard's meter button (the entry title follows it)
CONF_NAME = "name"

STORAGE_VERSION = 1

URL_BASE = "/daily_energy_mojelektro"
CARD_FILE = "daily-energy-card.js"
PANEL_ELEMENT = "daily-energy-panel"
PANEL_ICON = "mdi:lightning-bolt"
PANEL_TITLE = "Daily Energy"

# Mornings at these hours (local time), at this minute, whatever is still missing is fetched from the Moj Elektro API
# (yesterday's 15-minute curve, meter totals of the last days); nothing is requested when everything is there.
# The same as porabim.com: 06:05 to 11:05.
CHECK_HOURS = (6, 7, 8, 9, 10, 11)
CHECK_MINUTE = 5
# Fetches a person starts (the Update button): at most this many a day per meter.
REFRESHES_PER_DAY = 5
# Pause between API requests: Moj Elektro allows 5 requests per second.
API_PAUSE = 0.3
# The card gets this many days of 15-minute data with every update; older days are kept in the month archive.
KEEP_Q15_DAYS = 35

SETTINGS_KEYS = ("mult", "tmode", "pVT", "pMT", "cur", "grid")
# Import from Moj Elektro (Settings): the longest range fetched in one call; the card asks month by month.
MAX_IMPORT_DAYS = 400
