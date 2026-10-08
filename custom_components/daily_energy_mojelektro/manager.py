# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
'Storage and Moj Elektro API fetching for one meter.'
from __future__ import annotations
_S='Moj Elektro did not answer'
_R='application/json'
_Q='X-API-TOKEN'
_P='accept'
_O='q15o_miss'
_N='q15o'
_M='mt'
_L='vt'
_K='error'
_J='q15_miss'
_I='b'
_H=True
_G='settings'
_F='manual'
_E='edits'
_D=False
_C='q15'
_B=None
_A='days'
import asyncio
from collections.abc import Callable
from datetime import date,timedelta
import json,logging,aiohttp
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE,HomeAssistant,callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from.import logic
from.const import API_PAUSE,CHECK_MINUTE,CONF_METER,CONF_PIN,CONF_TOKEN,DOMAIN,KEEP_Q15_DAYS,MAX_IMPORT_DAYS,SETTINGS_KEYS,STORAGE_VERSION,VERSION
_LOGGER=logging.getLogger(__name__)
async def async_test_access(hass,meter,token):
	'One small Moj Elektro request to check a meter ID and token. Returns an error key, or None if fine.';C='cannot_connect';B=dt_util.now().date();D=logic.readings_url(meter,logic.READING_ET,B-timedelta(days=7),B)
	try:
		async with asyncio.timeout(30):A=await async_get_clientsession(hass).get(D,headers={_P:_R,_Q:token})
	except(aiohttp.ClientError,TimeoutError):return C
	if A.status==401:return'invalid_auth'
	if 400<=A.status<500:return'invalid_meter'
	if A.status!=200:return C
class DailyEnergyManager:
	'Keeps the day log of one meter and pushes changes to open dashboards.'
	def __init__(A,hass,entry):B=entry;A.hass=hass;A.entry=B;A.panel_url=_B;A._store=Store(hass,STORAGE_VERSION,f"{DOMAIN}.{B.entry_id}");A.data={_A:{},_F:{},_E:{},_G:{},_C:{},_J:{},_N:{},_O:{}};A._listeners=set();A._fetching=_D
	async def async_load(A):
		B=await A._store.async_load()
		if isinstance(B,dict):
			for C in A.data:
				if isinstance(B.get(C),dict):A.data[C]=B[C]
	@callback
	def _save(self):self._store.async_delay_save(lambda:self.data,2)
	async def async_flush(A):await A._store.async_save(A.data)
	@staticmethod
	async def async_remove_store(hass,entry):await Store(hass,STORAGE_VERSION,f"{DOMAIN}.{entry.entry_id}").async_remove()
	@property
	def pin(self):return str(self.entry.options.get(CONF_PIN)or'').strip()
	def check_pin(A,pin):return not A.pin or str(pin or'').strip()==A.pin
	def credentials(A):'(meter ID, API token) entered at setup.';return A.entry.data.get(CONF_METER),A.entry.data.get(CONF_TOKEN)
	@callback
	def async_start(self):
		'Every hour (and once Home Assistant has started): fetch whatever is still missing from the\n        Moj Elektro API. Returns a callable that stops it.';A=self;B=[async_track_time_change(A.hass,A._on_check_time,minute=CHECK_MINUTE,second=0),async_at_started(A.hass,lambda _hass:A._on_check_time(_B))]
		@callback
		def C():
			for A in B:A()
		return C
	@callback
	def _on_check_time(self,_now):self.hass.async_create_task(self.async_check_updates(force=_D))
	@property
	def grid_out(self):'Settings > Grid: "Grid in & Grid out" also fetches the energy sent to the grid.';return self.data[_G].get('grid')=='both'
	def _directions(B):
		'(direction, 15-minute store key, its missing-quarters key) for every direction that is fetched.';A=[(logic.GRID_IN,_C,_J)]
		if B.grid_out:A.append((logic.GRID_OUT,_N,_O))
		return A
	def missing(A,today):
		"What the API should still deliver: yesterday's full 15-minute curve and the real meter totals of\n        the last three days. Moj Elektro publishes a day's meter total one or two days later; until it is there\n        the day is shown from its 15-minute data, so the check keeps asking for it every hour.";B,D,H=((today-timedelta(days=A)).isoformat()for A in(1,2,3));C=[]
		for(F,I,G)in A._directions():
			E=''if F is logic.GRID_IN else' out'
			if len(A.data[I].get(B,[]))<92 or A.data[G].get(B):C.append(f"15-min{E} {B}")
			if A.data[G].get(D):C.append(f"15-min{E} {D}")
			J=F['keys']['u'];C+=[f"total{E} {B}"for B in(H,D,B)if J not in A.data[_A].get(B,{})]
		return C
	async def _get_json(C,session,url,token):
		try:
			async with asyncio.timeout(30):
				A=await session.get(url,headers={_P:_R,_Q:token})
				if A.status!=200:_LOGGER.debug('Moj Elektro request: HTTP %s',A.status);return
				return await A.json(content_type=_B)
		except(aiohttp.ClientError,TimeoutError,ValueError)as B:_LOGGER.debug('Moj Elektro request failed: %s',B);return
	async def _fetch(B,session,meter,token,direction,q_range,r_ranges):
		'One direction: the 15-minute data of q_range and the three daily registers of every r_range.\n\n        Returns (15-minute payload or None, {"et"|"vt"|"mt": {date: reading}}, whether Moj Elektro answered).\n        Moj Elektro allows 5 requests a second, so every request waits API_PAUSE first.\n        ';F=direction;E=token;D=meter;C=session;await asyncio.sleep(API_PAUSE);G=await B._get_json(C,logic.quarters_range_url(D,*q_range,F[_C]),E);H=G is not _B;A={}
		for(I,K)in F['registers'].items():
			A[I]={}
			for(L,M)in r_ranges:await asyncio.sleep(API_PAUSE);J=await B._get_json(C,logic.readings_url(D,K,L,M),E);H|=J is not _B;A[I].update(logic.readings_from_api(J))
		return G,A,H
	def _store_quarters(A,q_key,miss_key,days,missing,cutoff):
		'Keep the 15-minute days of the last KEEP_Q15_DAYS days; a day is only replaced by data that is at\n        least as complete. Returns the days that changed.';E=cutoff;D=miss_key;C=q_key;F=set()
		for(B,G)in days.items():
			H=missing.get(B,0)
			if B>=E and(B not in A.data[C]or H<=A.data[D].get(B,0)):
				if A.data[C].get(B)!=G:F.add(B)
				A.data[C][B]=G;A.data[D][B]=H
		A.data[C]={A:B for(A,B)in A.data[C].items()if A>=E};A.data[D]={B:D for(B,D)in A.data[D].items()if B in A.data[C]};return F
	async def async_check_updates(A,force=_H):
		'Fetch everything the dashboard shows straight from the Moj Elektro API and save what is new.\n\n        * daily meter readings (total, VT, MT): usage, VT, MT and month totals of the last three days\n        * 15-minute data of the last two days: the 15-minute chart, and the tariff blocks once a day\n          is complete; a day is only replaced by data that is at least as complete\n        * with Settings > Grid "Grid in & Grid out": the same for the energy sent to the grid\n        Uses the meter ID and API token entered at setup.\n        force = False (the hourly run) does not contact Moj Elektro when nothing is missing.\n        Returns {"changed": bool, ...}.\n        ';G='changed';B=dt_util.now().date()
		if A._fetching:return{G:_D,'busy':_H}
		if not force and not A.missing(B):return{G:_D,'skipped':_H}
		P,Q=A.credentials()
		if not Q or not P:return{G:_D,_K:'no Moj Elektro token'}
		F=timedelta(days=1);W,R=B-3*F,(B-3*F).replace(day=1);H=[(B-timedelta(days=A)).isoformat()for A in(1,2,3)];S=A._directions();T=lambda:json.dumps([A.data[_A].get(B)for B in H]+[A.data[C].get(D)for(B,C,B)in S for D in H[:2]],sort_keys=_H);X=T();J=[];A._fetching=_H
		try:
			Y=async_get_clientsession(A.hass)
			for(C,K,L)in S:Z=await A._fetch(Y,P,Q,C,(B-2*F,B),((R,R+F),(W,B+F)));J.append((C,K,L,*Z))
		finally:A._fetching=_D
		if not any(A for(*B,A)in J):return{G:_D,_K:_S}
		a=(B-timedelta(days=KEEP_Q15_DAYS)).isoformat()
		for(C,K,L,M,N,c)in J:
			if M is not _B:A._store_quarters(K,L,logic.quarters_from_api(M,B,C[_C]),logic.quarters_missing(M,B,C[_C]),a)
			if C is logic.GRID_IN:
				for D in H[:2]:
					U=A.data[_C].get(D)
					if U:
						O=logic.blocks_from_quarters(date.fromisoformat(D),U);E=A.data[_A].get(D,{}).get(_I)
						if O and(not E or len(E)!=5 or any(abs(A-B)>.0015 for(A,B)in zip(E,O))):A._merge_day(D,{_I:O})
			b=logic.totals_from_readings(N['et'],N[_L],N[_M],[date.fromisoformat(A)for A in reversed(H)])
			for(D,I)in b.items():
				I=logic.keyed(I,C);E=A.data[_A].get(D,{})
				if any(not isinstance(E.get(A),(int,float))or abs(E[A]-B)>.0015 for(A,B)in I.items()):A._merge_day(D,I)
		V=T()!=X
		if V:A._changed()
		return{G:V,'missing':A.missing(B)}
	async def async_import_range(A,start,end):
		'Fetch past days from the Moj Elektro API and fill them in (Settings > Moj Elektro history).\n\n        Month by month: daily meter readings (usage, VT, MT, month totals) and 15-minute data (tariff\n        blocks of every complete day; the 15-minute chart for the last KEEP_Q15_DAYS days), and with\n        Settings > Grid "Grid in & Grid out" the same for the energy sent to the grid. Moj Elektro\'s\n        numbers replace what is stored for those days. Returns {"days": days changed, ...} or {"error": ...}.\n        ';S='reg';R='q';M='miss';F=start;E=end;I=dt_util.now().date();E=min(E,I-timedelta(days=1))
		if F>E:return{_A:0,_K:'Pick days before today'}
		if(E-F).days>MAX_IMPORT_DAYS:return{_A:0,_K:f"At most {MAX_IMPORT_DAYS} days at a time"}
		T,U=A.credentials()
		if not U or not T:return{_A:0,_K:'No Moj Elektro meter ID and token'}
		if A._fetching:return{_A:0,_K:'Daily Energy is already fetching, try again in a moment'}
		J=timedelta(days=1);N=A._directions();V={id(A):{R:{},M:{},S:{'et':{},_L:{},_M:{}}}for(A,B,B)in N};W=_D;A._fetching=_H
		try:
			d=async_get_clientsession(A.hass)
			for(X,K)in logic.month_spans(F,E):
				e=X.replace(day=1);f=(e,K+J),(K+J,K+2*J)
				for(B,o,p)in N:
					G,g,h=await A._fetch(d,T,U,B,(X,K+J),f);W|=h;C=V[id(B)]
					if G is not _B:C[R].update(logic.quarters_from_api(G,I,B[_C]));C[M].update(logic.quarters_missing(G,I,B[_C]))
					for(i,O)in g.items():C[S][i].update(O)
		finally:A._fetching=_D
		if not W:return{_A:0,_K:_S}
		Y=[F+timedelta(days=A)for A in range((E-F).days+1)];Z,a=F.isoformat(),E.isoformat();j=(I-timedelta(days=KEEP_Q15_DAYS)).isoformat();H=set();P={'first':Z,'last':a}
		for(B,k,l)in N:
			C=V[id(B)];Q=C[S];L=logic.totals_from_readings(Q['et'],Q[_L],Q[_M],Y)
			for(D,m)in L.items():
				if A._merge_day(D,logic.keyed(m,B)):H.add(D)
			G={A:B for(A,B)in C[R].items()if Z<=A<=a}
			if B is logic.GRID_IN:
				b=0
				for(D,O)in G.items():
					n=C[M].get(D,0);c=logic.blocks_from_quarters(date.fromisoformat(D),O)
					if c and(not n or not A.data[_A].get(D,{}).get(_I)):
						b+=1
						if A._merge_day(D,{_I:c}):H.add(D)
				P.update(totals=len(L),blocks=b,no_total=len(Y)-len(L))
			else:P.update(totals_out=len(L))
			H|=A._store_quarters(k,l,G,C[M],j)
		if H:A._changed()
		return{_A:len(H),**P}
	def _merge_day(B,day,patch):
		C=B.data[_A].get(day,{});A={**C,**patch};A={B:A for(B,A)in A.items()if A is not _B}
		if A==C:return _D
		B.data[_A][day]=A;return _H
	@callback
	def _changed(self):
		A=self;A._save();B=A.snapshot()
		for C in list(A._listeners):C(B)
	@callback
	def async_add_listener(self,listener):
		A=listener;self._listeners.add(A)
		@callback
		def B():self._listeners.discard(A)
		return B
	def snapshot(A):return{'version':VERSION,'title':A.entry.title,_A:A.data[_A],_F:A.data[_F],_E:A.data[_E],_G:A.data[_G],_C:A.data[_C],_N:A.data[_N],'api':all(A.credentials()),'has_pin':bool(A.pin)}
	@callback
	def save_settings(self,settings):
		B=settings;A=self;C={A:B[A]for A in SETTINGS_KEYS if A in B};D=A.grid_out;A.data[_G]={**A.data[_G],**C};A._changed()
		if A.grid_out and not D:A.hass.async_create_task(A.async_check_updates(force=_H))
	@callback
	def save_manual(self,put,delete):
		A=self
		for B in delete:A.data[_F].pop(B,_B)
		for C in put:B=str(C['d']);A.data[_F][B]={A:C[A]for A in('t',_L,_M)if C.get(A)is not _B}
		A._changed()
	@callback
	def clear_all(self):
		'Settings > Delete all data: every Moj Elektro day, 15-minute day and manual reading. Settings stay.'
		for A in(_A,_F,_E,_C,_J,_N,_O):self.data[A]={}
		self._changed()
	@callback
	def delete_day(self,day,grid_out=_D):
		'Log > delete one day: its grid-in data (usage, VT / MT, month totals, tariff blocks, 15-minute data and\n        manual edit) or its grid-out data and edit; the other direction and manual readings stay. Returns whether\n        anything was removed.';C=grid_out;B=day;A=self;H=logic.GRID_OUT if C else logic.GRID_IN;I=set(H['keys'].values())|(set()if C else{_I});E,J=(_N,_O)if C else(_C,_J);F=A.data[_A].get(B,{});D={A:B for(A,B)in F.items()if A not in I};K=A._drop_edit(B,C);G=K or D!=F or B in A.data[E]
		if D:A.data[_A][B]=D
		else:A.data[_A].pop(B,_B)
		A.data[E].pop(B,_B);A.data[J].pop(B,_B)
		if G:A._changed()
		return G
	def _drop_edit(A,day,grid_out):
		B=day;C=A.data[_E].get(B)
		if not C:return _D
		D={A:B for(A,B)in C.items()if(A!='o')==grid_out}
		if D:A.data[_E][B]=D
		else:A.data[_E].pop(B)
		return D!=C
	@callback
	def save_edit(self,day,grid_out,values):
		"Log > Edit or Add (grid out): a manual value for one day. It is kept apart from Moj Elektro's data, so\n        fetching never overwrites it; only deleting the day removes it. Grid in: {vt, mt} (the day total is their\n        sum), {u} for a day with only 15-minute data, or {b} (the five tariff blocks); grid out: {o}.";C=self;A=values;B=dict(C.data[_E].get(day,{}))
		if grid_out:B['o']=round(float(A['o']),3)
		elif A.get(_I)is not _B:B[_I]=[round(float(A),3)for A in A[_I]]
		else:
			for D in('u',_L,_M):B.pop(D,_B)
			if A.get(_L)is not _B and A.get(_M)is not _B:B.update(vt=round(float(A[_L]),3),mt=round(float(A[_M]),3))
			else:B['u']=round(float(A['u']),3)
		C.data[_E][day]=B;C._changed()
	@callback
	def apply_import(self,parsed,missing=_B):
		'Merge a parsed CSV (see logic.parse_moj_elektro_csv) or fetched 15-minute days.\n\n        missing: quarter hours per day that Moj Elektro had not published yet (none for a CSV export).\n        Returns the number of days touched.\n        ';C=parsed;A=self;D=0
		for(B,F)in C.get(_A,{}).items():
			if A._merge_day(B,F):D+=1
		E=(dt_util.now().date()-timedelta(days=KEEP_Q15_DAYS)).isoformat()
		for(B,G)in C.get(_C,{}).items():
			if B>=E:A.data[_C][B]=G;A.data[_J][B]=(missing or{}).get(B,0)
		A.data[_C]={A:B for(A,B)in A.data[_C].items()if A>=E};A.data[_J]={B:C for(B,C)in A.data[_J].items()if B in A.data[_C]};A._changed();return D
	@callback
	def apply_backup(self,backup):
		'Merge a JSON export made by the card (days, manual readings, manual edits and settings).';C=backup;B=self;E=0
		for(D,A)in(C.get(_A)or{}).items():
			if isinstance(A,dict)and B._merge_day(str(D),A):E+=1
		for(D,A)in(C.get(_F)or{}).items():
			if isinstance(A,dict):B.data[_F][str(D)]=A
		for(D,A)in(C.get(_E)or{}).items():
			if isinstance(A,dict):B.data[_E][str(D)]=A
		if isinstance(C.get(_G),dict):B.save_settings(C[_G])
		B._changed();return E