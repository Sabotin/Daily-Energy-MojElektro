# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
'Daily Energy for Moj Elektro: an energy dashboard and day log, fed straight from the Moj Elektro API.'
from __future__ import annotations
_A=True
import logging
from pathlib import Path
from homeassistant.components import frontend,panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from.import websocket
from.const import CARD_FILE,CONF_METER,CONF_SIDEBAR,CONF_TOKEN,DOMAIN,PANEL_ELEMENT,PANEL_ICON,PANEL_TITLE,URL_BASE,VERSION
from.manager import DailyEnergyManager
CONFIG_SCHEMA=cv.config_entry_only_config_schema(DOMAIN)
MODULE_URL=f"{URL_BASE}/{CARD_FILE}?v={VERSION}"
_LOGGER=logging.getLogger(__name__)
LEGACY_SOURCE='mojelektro_entry_id'
async def async_setup(hass,config):'Serve the card once and make it available to every dashboard.';A=hass;A.data.setdefault(DOMAIN,{});await A.http.async_register_static_paths([StaticPathConfig(URL_BASE,str(Path(__file__).parent/'frontend'),False)]);frontend.add_extra_js_url(A,MODULE_URL);websocket.async_register(A);return _A
async def async_setup_entry(hass,entry):
	'Set up one meter: storage, the hourly Moj Elektro check and the sidebar panel.';C=hass;A=entry;B=DailyEnergyManager(C,A);await B.async_load();C.data[DOMAIN][A.entry_id]=B;A.async_on_unload(B.async_start())
	if A.options.get(CONF_SIDEBAR,_A):B.panel_url=_panel_url(C,A);await panel_custom.async_register_panel(C,frontend_url_path=B.panel_url,webcomponent_name=PANEL_ELEMENT,sidebar_title=PANEL_TITLE,sidebar_icon=PANEL_ICON,module_url=MODULE_URL,config={'entry_id':A.entry_id},require_admin=False)
	A.async_on_unload(A.add_update_listener(_async_reload));return _A
async def async_unload_entry(hass,entry):
	'Remove the panel and stop the hourly check; the stored data stays.';A=hass.data[DOMAIN].pop(entry.entry_id)
	if A.panel_url:frontend.async_remove_panel(hass,A.panel_url)
	await A.async_flush();return _A
async def async_remove_entry(hass,entry):'Deleting the integration entry also deletes its stored log.';await DailyEnergyManager.async_remove_store(hass,entry)
async def _async_reload(hass,entry):await hass.config_entries.async_reload(entry.entry_id)
def _panel_url(hass,entry):'"daily-energy" for the first meter, "daily-energy-2" and so on for more.';B=hass.config_entries.async_entries(DOMAIN);A=next((A for(A,B)in enumerate(B)if B.entry_id==entry.entry_id),0);return'daily-energy'if A==0 else f"daily-energy-{A+1}"
async def async_migrate_entry(hass,entry):
	'Version 1 -> 2: copy the meter ID and token of a linked Moj Elektro integration into this entry.';D=None;B=entry
	if B.version==1:
		A=dict(B.data);E=A.pop(LEGACY_SOURCE,D);C=hass.config_entries.async_get_entry(E)if E else D
		if C is not D and not(A.get(CONF_METER)and A.get(CONF_TOKEN)):A[CONF_METER]=C.data.get(CONF_METER);A[CONF_TOKEN]=C.data.get(CONF_TOKEN)
		if not(A.get(CONF_METER)and A.get(CONF_TOKEN)):_LOGGER.warning('%s has no Moj Elektro meter ID and API token: enter them under Configure',B.title)
		hass.config_entries.async_update_entry(B,data=A,version=2)
	return _A