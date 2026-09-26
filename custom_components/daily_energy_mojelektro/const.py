"""Constants for Daily Energy for Moj Elektro."""

DOMAIN = "daily_energy_mojelektro"
VERSION = "0.7.3"

# Moj Elektro API access, entered at setup.
CONF_TOKEN = "token"
CONF_METER = "meter_id"
CONF_PIN = "pin"
CONF_SIDEBAR = "sidebar"

STORAGE_VERSION = 1

URL_BASE = "/daily_energy_mojelektro"
CARD_FILE = "daily-energy-card.js"
PANEL_ELEMENT = "daily-energy-panel"
PANEL_ICON = "mdi:lightning-bolt"
PANEL_TITLE = "Daily Energy"

# Every hour at this minute, whatever is still missing is fetched from the Moj Elektro API (yesterday's 15-minute
# curve, meter totals of the last days); nothing is requested when everything is there.
CHECK_MINUTE = 5
# Pause between API requests: Moj Elektro allows 5 requests per second.
API_PAUSE = 0.3
# The 15-minute chart only looks back ten days; imported quarter hours older than this are dropped.
KEEP_Q15_DAYS = 21

SETTINGS_KEYS = ("mult", "tmode", "pVT", "pMT", "cur", "grid")
# Import from Moj Elektro (Settings): the longest range fetched in one call; the card asks month by month.
MAX_IMPORT_DAYS = 400
