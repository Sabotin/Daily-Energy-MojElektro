# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
'Websocket API used by the Daily Energy card.'
from __future__ import annotations
_P='invalid_format'
_O='values'
_N='delete'
_M='settings'
_L='kind'
_K='days'
_J='entry_id'
_I='out'
_H='grid'
_G='day'
_F='Wrong PIN'
_E='wrong_pin'
_D='pin'
_C='type'
_B=None
_A='id'
from typing import Any
import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant,callback
from homeassistant.helpers import config_validation as cv
from homeassistant.util import dt as dt_util
from.import logic
from.const import DOMAIN
ENTRY=vol.Required(_J)
@callback
def async_register(hass):
	for A in(ws_entries,ws_subscribe,ws_verify_pin,ws_save_settings,ws_save_manual,ws_clear_all,ws_delete_day,ws_save_edit,ws_import_csv,ws_import_backup,ws_check_updates,ws_import_api):websocket_api.async_register_command(hass,A)
def _manager(hass,connection,msg):
	A=hass.data.get(DOMAIN,{}).get(msg[_J])
	if A is _B:connection.send_error(msg[_A],'not_found','Daily Energy entry not found')
	return A
@websocket_api.websocket_command({vol.Required(_C):f"{DOMAIN}/entries"})
@callback
def ws_entries(hass,connection,msg):connection.send_result(msg[_A],[{_J:B,'title':A.entry.title,'panel':A.panel_url}for(B,A)in hass.data.get(DOMAIN,{}).items()])
@websocket_api.websocket_command({vol.Required(_C):f"{DOMAIN}/subscribe",ENTRY:str})
@callback
def ws_subscribe(hass,connection,msg):
	B=msg;A=connection;C=_manager(hass,A,B)
	if C is _B:return
	@callback
	def D(snapshot):A.send_message(websocket_api.event_message(B[_A],snapshot))
	A.subscriptions[B[_A]]=C.async_add_listener(D);A.send_result(B[_A]);D(C.snapshot())
@websocket_api.websocket_command({vol.Required(_C):f"{DOMAIN}/verify_pin",ENTRY:str,vol.Optional(_D,default=''):str})
@callback
def ws_verify_pin(hass,connection,msg):
	B=connection;A=msg;C=_manager(hass,B,A)
	if C is not _B:B.send_result(A[_A],{'ok':C.check_pin(A[_D])})
@websocket_api.websocket_command({vol.Required(_C):f"{DOMAIN}/save_settings",ENTRY:str,vol.Required(_M):dict})
@callback
def ws_save_settings(hass,connection,msg):
	B=connection;A=msg;C=_manager(hass,B,A)
	if C is not _B:C.save_settings(A[_M]);B.send_result(A[_A])
MANUAL_RECORD=vol.Schema({vol.Required('d'):vol.Match('^\\d{4}-\\d{2}-\\d{2}$'),vol.Required('t'):vol.Coerce(float),vol.Optional('vt'):vol.Any(_B,vol.Coerce(float)),vol.Optional('mt'):vol.Any(_B,vol.Coerce(float))},extra=vol.REMOVE_EXTRA)
@websocket_api.websocket_command({vol.Required(_C):f"{DOMAIN}/save_manual",ENTRY:str,vol.Optional(_D,default=''):str,vol.Optional('put',default=[]):[MANUAL_RECORD],vol.Optional(_N,default=[]):[str]})
@callback
def ws_save_manual(hass,connection,msg):
	B=connection;A=msg;C=_manager(hass,B,A)
	if C is _B:return
	if not C.check_pin(A[_D]):B.send_error(A[_A],_E,_F);return
	C.save_manual(A['put'],A[_N]);B.send_result(A[_A])
@websocket_api.websocket_command({vol.Required(_C):f"{DOMAIN}/clear_all",ENTRY:str,vol.Optional(_D,default=''):str})
@websocket_api.require_admin
@callback
def ws_clear_all(hass,connection,msg):
	'Settings > Delete all data (administrators only, and the PIN when one is set).';B=connection;A=msg;C=_manager(hass,B,A)
	if C is _B:return
	if not C.check_pin(A[_D]):B.send_error(A[_A],_E,_F);return
	C.clear_all();B.send_result(A[_A])
@websocket_api.websocket_command({vol.Required(_C):f"{DOMAIN}/delete_day",ENTRY:str,vol.Required(_G):cv.date,vol.Required(_H):vol.In(['in',_I]),vol.Optional(_D,default=''):str})
@callback
def ws_delete_day(hass,connection,msg):
	'Log > delete one day, grid in or grid out only (the PIN when one is set).';B=connection;A=msg;C=_manager(hass,B,A)
	if C is _B:return
	if not C.check_pin(A[_D]):B.send_error(A[_A],_E,_F);return
	D=C.delete_day(A[_G].isoformat(),A[_H]==_I);B.send_result(A[_A],{'deleted':D})
KWH=vol.All(vol.Coerce(float),vol.Range(min=0,max=100000))
@websocket_api.websocket_command({vol.Required(_C):f"{DOMAIN}/save_edit",ENTRY:str,vol.Required(_G):cv.date,vol.Required(_H):vol.In(['in',_I]),vol.Required(_O):{vol.Optional('u'):KWH,vol.Optional('vt'):KWH,vol.Optional('mt'):KWH,vol.Optional('o'):KWH,vol.Optional('b'):vol.All([KWH],vol.Length(min=5,max=5))},vol.Optional(_D,default=''):str})
@callback
def ws_save_edit(hass,connection,msg):
	'Log > Edit, or Add on grid out: a manual day value that fetching never overwrites (the PIN when one is set).';C=connection;A=msg;D=_manager(hass,C,A)
	if D is _B:return
	if not D.check_pin(A[_D]):C.send_error(A[_A],_E,_F);return
	B,E=A[_O],A[_H]==_I;F='o'in B if E else'vt'in B and'mt'in B or'u'in B or'b'in B
	if not F:C.send_error(A[_A],_P,'Grid out needs o; grid in needs vt and mt, u, or b');return
	D.save_edit(A[_G].isoformat(),E,B);C.send_result(A[_A])
@websocket_api.websocket_command({vol.Required(_C):f"{DOMAIN}/import_csv",ENTRY:str,vol.Required('text'):str})
@websocket_api.require_admin
@callback
def ws_import_csv(hass,connection,msg):
	D=connection;A=msg;E=_manager(hass,D,A)
	if E is _B:return
	try:B=logic.parse_moj_elektro_csv(A['text'],dt_util.now().date())
	except(ValueError,IndexError)as F:D.send_error(A[_A],_P,str(F));return
	C=sorted(set(B[_K])|set(B['q15']));G=E.apply_import(B);D.send_result(A[_A],{_L:B[_L],_K:G,'first':C[0]if C else _B,'last':C[-1]if C else _B})
@websocket_api.websocket_command({vol.Required(_C):f"{DOMAIN}/import_backup",ENTRY:str,vol.Required('data'):dict})
@websocket_api.require_admin
@callback
def ws_import_backup(hass,connection,msg):
	B=connection;A=msg;C=_manager(hass,B,A)
	if C is not _B:B.send_result(A[_A],{_L:'backup',_K:C.apply_backup(A['data'])})
@websocket_api.websocket_command({vol.Required(_C):f"{DOMAIN}/check_updates",ENTRY:str})
@websocket_api.async_response
async def ws_check_updates(hass,connection,msg):
	'Update button: ask the Moj Elektro API for new data now and report whether anything changed.';A=connection;B=_manager(hass,A,msg)
	if B is not _B:A.send_result(msg[_A],await B.async_check_updates(force=True))
@websocket_api.websocket_command({vol.Required(_C):f"{DOMAIN}/import_api",ENTRY:str,vol.Required('start'):cv.date,vol.Required('end'):cv.date})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_import_api(hass,connection,msg):
	'Settings > Import from Moj Elektro: fetch the days from start to end (the card sends a month at a time).';B=connection;A=msg;C=_manager(hass,B,A)
	if C is not _B:B.send_result(A[_A],await C.async_import_range(A['start'],A['end']))