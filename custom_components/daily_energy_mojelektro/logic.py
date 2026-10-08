# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
'Pure logic for Daily Energy (no Home Assistant imports, so it can be unit-tested on its own).\n\nDate convention used everywhere: a record dated D holds the energy used on calendar day D\n(00:00-24:00, local time).\n\n* A Moj Elektro meter reading dated D ("Dnevna stanja") is taken at 00:00 on D, so\n  reading(D + 1) - reading(D) is the usage of day D. Moj Elektro publishes it about two days later.\n* Tariff blocks and 15-minute data for day D arrive the next day.\n'
from __future__ import annotations
_Q='TIMESTAMP'
_P='ENERGIJA A+'
_O='registers'
_N='timestamp'
_M='intervalReadings'
_L='intervalBlocks'
_K='days'
_J='kind'
_I='keys'
_H='mmt'
_G='mvt'
_F='mo'
_E='q15'
_D='mt'
_C='vt'
_B=.0
_A=None
import csv,io
from datetime import date,datetime,timedelta
def to_float(value):
	'Parse an API value or CSV cell; None for empty or unknown.';B=value
	if B is _A:return
	A=str(B).strip().replace(' ','')
	if A in('','unknown','unavailable','None','N/A'):return
	if','in A and'.'not in A:A=A.replace(',','.')
	try:return float(A)
	except ValueError:return
API_URL='https://api.informatika.si/mojelektro/v1/meter-readings'
READING_A_PLUS_15='32.0.2.4.1.2.12.0.0.0.0.0.0.0.0.3.72.0'
READING_A_MINUS_15='32.0.2.4.19.2.12.0.0.0.0.0.0.0.0.3.72.0'
def quarters_url(meter_id,today,days_back=2):'Request for the 15-minute energy of the last days_back days (the API returns whole days).';A=today;return quarters_range_url(meter_id,A-timedelta(days=days_back),A)
def quarters_range_url(meter_id,start,end,reading_type=READING_A_PLUS_15):'Request for the 15-minute energy of the days from start up to (not including) end.';return f"{API_URL}?usagePoint={meter_id}&startTime={start.isoformat()}&endTime={end.isoformat()}&option=ReadingType%3D{reading_type}"
def month_spans(start,end):
	'[start, end] cut into pieces within one calendar month each (Moj Elektro answers about a month per request).';B=[];A=start
	while A<=end:C=(A.replace(day=28)+timedelta(days=4)).replace(day=1);B.append((A,min(end,C-timedelta(days=1))));A=C
	return B
def _estimated(reading):
	'True for a quarter hour the meter has not delivered yet (1.5.x) or that Moj Elektro estimated (3.x).'
	for A in reading.get('readingQualities')or[]:
		B=str((A or{}).get('readingQualityType',''))
		if B.startswith(('1.5.','3.')):return True
	return False
def _quarters(payload,today,reading_type=READING_A_PLUS_15):
	'Past days with at least 92 readings: {date: [(start, kWh, flagged)] sorted by start}.\n\n    Every reading carries the END time of its quarter hour (00:15 ... next day 00:00). A reading whose\n    readingQualities include 1.5.x (not received from the meter) or 3.x (estimated) is flagged: Moj\n    Elektro sends 0 or an even share of the day for it and replaces it once the meter delivers.\n    1.8.0 marks a normal reading.\n    ';B=(payload or{}).get(_L)or[];A=next((A for A in B if A.get('readingType')==reading_type),_A)
	if A is _A and len(B)==1:A=B[0]
	if A is _A:return{}
	D={}
	for C in A.get(_M)or[]:
		try:G=datetime.fromisoformat(str(C[_N]))
		except(KeyError,ValueError):continue
		E=to_float(C.get('value'))
		if E is _A:continue
		F=G.replace(tzinfo=_A)-timedelta(minutes=15);D.setdefault(F.date(),[]).append((F,E,_estimated(C)))
	return{A:sorted(B)for(A,B)in D.items()if A<today and len(B)>=92}
def quarters_from_api(payload,today,reading_type=READING_A_PLUS_15):'Complete past days from a meter-readings response: {date: [kWh per quarter hour from 00:00]}.';return{A.isoformat():[round(B,4)for(A,B,A)in B]for(A,B)in _quarters(payload,today,reading_type).items()}
def quarters_missing(payload,today,reading_type=READING_A_PLUS_15):'Per day of quarters_from_api: how many quarter hours Moj Elektro has not published yet (sent as 0).';return{A.isoformat():sum(1 for(*B,A)in B if A)for(A,B)in _quarters(payload,today,reading_type).items()}
READING_ET='32.0.4.1.1.2.12.0.0.0.0.0.0.0.0.3.72.0'
READING_VT='32.0.4.1.1.2.12.0.0.0.0.1.0.0.0.3.72.0'
READING_MT='32.0.4.1.1.2.12.0.0.0.0.2.0.0.0.3.72.0'
READING_ET_OUT='32.0.4.1.19.2.12.0.0.0.0.0.0.0.0.3.72.0'
READING_VT_OUT='32.0.4.1.19.2.12.0.0.0.0.1.0.0.0.3.72.0'
READING_MT_OUT='32.0.4.1.19.2.12.0.0.0.0.2.0.0.0.3.72.0'
GRID_IN={_E:READING_A_PLUS_15,_O:{'et':READING_ET,_C:READING_VT,_D:READING_MT},_I:{'u':'u',_C:_C,_D:_D,_F:_F,_G:_G,_H:_H}}
GRID_OUT={_E:READING_A_MINUS_15,_O:{'et':READING_ET_OUT,_C:READING_VT_OUT,_D:READING_MT_OUT},_I:{'u':'o',_C:'ovt',_D:'omt',_F:'omo',_G:'omvt',_H:'ommt'}}
def keyed(record,direction):'A totals_from_readings record with the day-record keys of a direction (grid out: o, ovt, omt, ...).';return{direction[_I][A]:B for(A,B)in record.items()}
def readings_url(meter_id,reading_type,start,end):"Request for one register's daily readings from start up to (not including) end.";return f"{API_URL}?usagePoint={meter_id}&startTime={start.isoformat()}&endTime={end.isoformat()}&option=ReadingType%3D{reading_type}"
def readings_from_api(payload):
	'{date: register value} from a meter-readings response (the reading dated D is taken at 00:00 on D).';B={}
	for D in(payload or{}).get(_L)or[]:
		for C in D.get(_M)or[]:
			try:E=datetime.fromisoformat(str(C[_N])).date()
			except(KeyError,ValueError):continue
			A=to_float(C.get('value'))
			if A is not _A and A>=0:B[E.isoformat()]=A
	return B
def totals_from_readings(et,vt,mt,days):
	"Day records from daily meter readings: usage of day D = reading(D + 1) - reading(D).\n\n    Month-to-date totals come from the reading on the 1st of D's month. A day is left out when a\n    reading is missing or the numbers do not add up (VT + MT must equal the total).\n    ";H={}
	for C in days:
		D,A,B=C.isoformat(),(C+timedelta(days=1)).isoformat(),C.replace(day=1).isoformat()
		if any(E not in C for C in(et,vt,mt)for E in(D,A,B)):continue
		E,F,G=(round(B[A]-B[D],3)for B in(et,vt,mt))
		if min(E,F,G)<0 or abs(E-F-G)>=.02:continue
		H[D]={'u':E,_C:F,_D:G,_F:round(et[A]-et[B],3),_G:round(vt[A]-vt[B],3),_H:round(mt[A]-mt[B],3)}
	return H
HOLIDAYS={(1,1),(1,2),(2,8),(4,27),(5,1),(5,2),(6,25),(8,15),(10,31),(11,1),(12,25),(12,26)}
def easter_monday(year):'Easter Monday (Gregorian calendar).';B=year;D,A,E=B%19,B//100,B%100;G,H=A//4,A%4;I=(A+8)//25;J=(A-I+1)//3;C=(19*D+A-G-J+15)%30;K,L=E//4,E%4;F=(32+2*H+2*K-C-L)%7;M=(D+11*C+22*F)//451;N,O=divmod(C+F-7*M+114,31);return date(B,N,O+1)+timedelta(days=1)
def block_of(start):'Network tariff block (1-5) of the quarter hour starting at this local time.\n\n    Higher season = November to February; weekends and public holidays are one block cheaper.\n    ';C=start;B=C.hour;D=0 if 7<=B<14 or 16<=B<20 else 1 if B==6 or 14<=B<16 or 20<=B<22 else 2;A=C.date();E=A.weekday()>=5 or(A.month,A.day)in HOLIDAYS or A==easter_monday(A.year);return(1 if A.month in(11,12,1,2)else 2)+(1 if E else 0)+D
def blocks_from_quarters(day,values):
	'kWh per tariff block for one day of 96 quarter hours (None on clock-change days).';B=values;A=day
	if len(B)!=96:return
	C=[_B]*5;D=datetime(A.year,A.month,A.day)
	for(E,F)in enumerate(B):C[block_of(D+timedelta(minutes=15*E))-1]+=F
	return[round(A,3)for A in C]
def _rows(text):A=text;A=A.lstrip('\ufeff');B=A[:2000];C=';'if B.count(';')>B.count(',')else',';return[A for A in csv.reader(io.StringIO(A),delimiter=C)if any(A.strip()for A in A)]
def _col(header,*A):
	B=[A.strip().upper()for A in header]
	for(C,D)in enumerate(B):
		if all(A in D for A in A):return C
def _date(value):
	A=value;A=A.strip()
	for B in('%Y-%m-%d','%d.%m.%Y','%d. %m. %Y'):
		try:return datetime.strptime(A,B).date()
		except ValueError:continue
def parse_moj_elektro_csv(text,today):
	'Parse a Moj Elektro portal CSV export.\n\n    Returns {"kind": str, "days": {date: patch}, "q15": {date: [kWh x 96]}}. Supported exports:\n    * "Dnevna stanja" (daily meter readings: PREJETA DELOVNA ENERGIJA ET / VT / MT)\n    * "Dnevne količine po časovnih blokih" (daily energy per tariff block)\n    * "15 minutni podatki" (15-minute energy with the tariff block of every quarter hour)\n    ';D=today;B=_rows(text)
	if not B:raise ValueError('empty file')
	A,C=B[0],B[1:];E=_col(A,'PREJETA DELOVNA ENERGIJA ET')
	if E is not _A:return _parse_readings(A,C,E)
	if _col(A,'BLOKU 1')is not _A:return _parse_block_days(A,C,D)
	if _col(A,_P)is not _A and(_col(A,'ZNA')is not _A or _col(A,_Q)is not _A):return _parse_quarters(A,C,D)
	raise ValueError('unknown CSV format')
def _parse_readings(header,body,et):
	G=header;H=_col(G,'PREJETA DELOVNA ENERGIJA VT');I=_col(G,'PREJETA DELOVNA ENERGIJA MT');E=_col(G,'DATUM');E=0 if E is _A else E;F={}
	for B in body:
		A=_date(B[E])if len(B)>E else _A;N=to_float(B[et])if len(B)>et else _A
		if A is _A or N is _A:continue
		T=to_float(B[H])if H is not _A and len(B)>H else _A;U=to_float(B[I])if I is not _A and len(B)>I else _A;F[A]=N,T,U
	J={};K={}
	for A in sorted(F):
		O=A+timedelta(days=1)
		if O not in F:continue
		(V,P,Q),(W,R,S)=F[A],F[O];L=round(W-V,3)
		if L<0:continue
		C={'u':L}
		if _A not in(P,R,Q,S):C[_C]=round(R-P,3);C[_D]=round(S-Q,3)
		M=A.year,A.month;D=K.get(M)
		if D is _A and A.day==1:D=K[M]=[_B,_B,_B]
		X=A-timedelta(days=1)
		if D is not _A and(A.day==1 or X.isoformat()in J):D[0]+=L;D[1]+=C.get(_C,_B);D[2]+=C.get(_D,_B);C[_F],C[_G],C[_H]=(round(A,3)for A in D)
		else:K.pop(M,_A)
		J[A.isoformat()]=C
	return{_J:'readings',_K:J,_E:{}}
def _parse_block_days(header,body,today):
	D=header;A=_col(D,'DATUM');A=0 if A is _A else A;G=[_col(D,f"BLOKU {A}")for A in range(1,6)];E={}
	for B in body:
		C=_date(B[A])if len(B)>A else _A
		if C is _A or C>=today:continue
		F=[round(to_float(B[A])or _B,3)if A is not _A and len(B)>A else _B for A in G]
		if sum(F)>.1:E[C.isoformat()]={'b':F}
	return{_J:'blocks',_K:E,_E:{}}
def _parse_quarters(header,body,today):
	B=header;C=_col(B,'ZNA')
	if C is _A:C=_col(B,_Q)
	J=_col(B,_P);G=_col(B,'BLOK');K={}
	for A in body:
		if len(A)<=max(C,J):continue
		try:O=datetime.fromisoformat(A[C].strip().replace(' ','T'))
		except ValueError:continue
		D=to_float(A[J])
		if D is _A:continue
		L=O-timedelta(minutes=15);E=int(to_float(A[G])or 0)if G is not _A and len(A)>G else 0;K.setdefault(L.date(),[]).append((L,D,E))
	M={};N={}
	for(H,F)in K.items():
		if H>=today or len(F)<92:continue
		F.sort();N[H.isoformat()]=[round(B,4)for(A,B,A)in F];I=[_B]*5
		for(P,D,E)in F:
			if 1<=E<=5:I[E-1]+=D
		if sum(I)>.1:M[H.isoformat()]={'b':[round(A,3)for A in I]}
	return{_J:'quarters',_K:M,_E:N}