"""Constants for Daily Energy for Moj Elektro."""

DOMAIN = "daily_energy_mojelektro"
VERSION = "0.3.0"

MOJ_ELEKTRO_DOMAIN = "mojelektro"

CONF_SOURCE_ENTRY = "mojelektro_entry_id"
CONF_PIN = "pin"
CONF_LITE_USERS = "lite_users"
CONF_SIDEBAR = "sidebar"

STORAGE_VERSION = 1

URL_BASE = "/daily_energy_mojelektro"
CARD_FILE = "daily-energy-card.js"
PANEL_ELEMENT = "daily-energy-panel"
PANEL_ICON = "mdi:lightning-bolt"
PANEL_TITLE = "Daily Energy"

# Sensor values change a few times a day; these runs are a safety net if a change was missed.
REFRESH_TIMES = ((6, 30), (12, 0), (20, 0))
# Every hour at this minute, whatever is still missing is fetched from the Moj Elektro API (yesterday's 15-minute
# curve, meter totals of the last days); nothing is requested when everything is there.
CHECK_MINUTE = 5
# Pause between API requests: Moj Elektro allows 5 requests per second.
API_PAUSE = 0.3
# Moj Elektro updates its sensors one after another; wait until they have all settled before logging.
SETTLE_SECONDS = 30
# Moj Elektro data between midnight and 06:00 can be incomplete.
EARLIEST_HOUR = 6
# The 15-minute chart only looks back ten days; imported quarter hours older than this are dropped.
KEEP_Q15_DAYS = 21

SETTINGS_KEYS = ("mult", "tmode", "pVT", "pMT", "cur")
