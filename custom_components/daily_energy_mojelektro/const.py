# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Constants for Daily Energy for Moj Elektro."""

DOMAIN = "daily_energy_mojelektro"
VERSION = "2.0.9"

PORABIM = "https://porabim.com"
CLIENT_ID = DOMAIN
AUTHORIZE_URL = f"{PORABIM}/ha/connect"
TOKEN_URL = f"{PORABIM}/ha/token"
REVOKE_URL = f"{PORABIM}/ha/revoke"
API_URL = f"{PORABIM}/api"
CARD_URL = f"{PORABIM}/ha/card.js?v={VERSION}"
# The only redirect porabim accepts; it works whether or not the "my" integration is loaded
REDIRECT_URI = "https://my.home-assistant.io/redirect/oauth"

CONF_SIDEBAR = "sidebar"

# Our panel around porabim's (frontend/panel.js): it gives Home Assistant's page back as it was when it is left
PANEL_ELEMENT = "daily-energy-panel"
PANEL_URL = f"/{DOMAIN}/panel.js?v={VERSION}"
PANEL_ICON = "mdi:lightning-bolt"
PANEL_TITLE = "Daily Energy"

TIMEOUT = 30
# Osveži and Uvozi can wait in porabim's queue for up to 20 minutes
LONG_TIMEOUT = 25 * 60
LONG_PATHS = frozenset({"refresh", "import-range"})

# The 1.x day log, kept until it has been uploaded to porabim once
STORAGE_VERSION = 1
ISSUE_CONNECT = "connect_porabim"
