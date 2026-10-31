# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Konstante za Daily Energy za Moj Elektro."""

DOMAIN = "daily_energy_mojelektro"
VERSION = "3.0.8"

PORABIM = "https://porabim.com"
CLIENT_ID = DOMAIN
AUTHORIZE_URL = f"{PORABIM}/ha/connect"
TOKEN_URL = f"{PORABIM}/ha/token"
REVOKE_URL = f"{PORABIM}/ha/revoke"
API_URL = f"{PORABIM}/api"
CARD_URL = f"{PORABIM}/ha/card.js?v={VERSION}"
# Edina preusmeritev, ki jo porabim sprejme; deluje ne glede na to, ali je integracija "my" naložena
REDIRECT_URI = "https://my.home-assistant.io/redirect/oauth"

CONF_SIDEBAR = "sidebar"

# Naša plošča okoli plošče porabim (frontend/panel.js): ob izhodu vrne stran Home Assistanta v prejšnje stanje
PANEL_ELEMENT = "daily-energy-panel"
PANEL_URL = f"/{DOMAIN}/panel.js?v={VERSION}"
PANEL_ICON = "mdi:lightning-bolt"
PANEL_TITLE = "Daily Energy"

TIMEOUT = 30
# Osveži in Uvozi lahko v vrsti na porabim čakata do 20 minut
LONG_TIMEOUT = 25 * 60
LONG_PATHS = frozenset({"refresh", "import-range"})

# Dnevni zapis iz 1.x, hranjen, dokler ni enkrat naložen na porabim (oldlog.py)
STORAGE_VERSION = 1
ISSUE_CONNECT = "connect_porabim"
# njegovega merilnega mesta (še) ni v računu porabim
ISSUE_OLD_LOG = "old_log_meter"
# merilno mesto vnosa iz 1.x (njegov unique id do povezave): dnevni zapis gre nanj
CONF_OLD_METER = "old_meter"
