# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
'Config and options flow for Daily Energy for Moj Elektro.'
from __future__ import annotations
_A=None
from typing import Any
import voluptuous as vol
from homeassistant.config_entries import ConfigEntry,ConfigFlow,ConfigFlowResult,OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import TextSelector,TextSelectorConfig,TextSelectorType
from.const import CONF_METER,CONF_PIN,CONF_SIDEBAR,CONF_TOKEN,DOMAIN
from.manager import async_test_access
PASSWORD=TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))
class DailyEnergyConfigFlow(ConfigFlow,domain=DOMAIN):
	'Set up a meter: its Moj Elektro meter ID and API token.';VERSION=2
	async def async_step_user(B,user_input=_A):
		'Meter ID and API token from the Moj Elektro portal, checked with one request before saving.';A=user_input;D={}
		if A is not _A:
			C=str(A[CONF_METER]).strip();E=str(A[CONF_TOKEN]).strip();await B.async_set_unique_id(C);B._abort_if_unique_id_configured();F=await async_test_access(B.hass,C,E)
			if F:D['base']=F
			else:return B.async_create_entry(title=f"Daily Energy · {C}",data={CONF_METER:C,CONF_TOKEN:E},options={CONF_PIN:A.get(CONF_PIN,''),CONF_SIDEBAR:True})
		G=vol.Schema({vol.Required(CONF_METER,default=(A or{}).get(CONF_METER,'')):str,vol.Required(CONF_TOKEN):PASSWORD,vol.Optional(CONF_PIN,default=(A or{}).get(CONF_PIN,'')):str});return B.async_show_form(step_id='user',data_schema=G,errors=D)
	@staticmethod
	@callback
	def async_get_options_flow(config_entry):return DailyEnergyOptionsFlow()
class DailyEnergyOptionsFlow(OptionsFlow):
	'PIN, sidebar panel, and the meter ID or a new API token (checked before they are saved).'
	async def async_step_init(B,user_input=_A):
		G=user_input;A=B.config_entry;E={}
		if G is not _A:
			F=dict(G);C=str(F.pop(CONF_METER,'')or'').strip()or A.data.get(CONF_METER,'');D=str(F.pop(CONF_TOKEN,'')or'').strip()or A.data.get(CONF_TOKEN,'')
			if(C,D)!=(A.data.get(CONF_METER),A.data.get(CONF_TOKEN)):
				H=await async_test_access(B.hass,C,D)if C and D else'invalid_auth'
				if H:E['base']=H
				else:B.hass.config_entries.async_update_entry(A,data={**A.data,CONF_METER:C,CONF_TOKEN:D})
			if not E:return B.async_create_entry(data=F)
		I=A.options;J=vol.Schema({vol.Optional(CONF_PIN,default=I.get(CONF_PIN,'')):str,vol.Optional(CONF_SIDEBAR,default=I.get(CONF_SIDEBAR,True)):bool,vol.Optional(CONF_METER,default=A.data.get(CONF_METER,'')):str,vol.Optional(CONF_TOKEN,default=''):PASSWORD});return B.async_show_form(step_id='init',data_schema=J,errors=E)