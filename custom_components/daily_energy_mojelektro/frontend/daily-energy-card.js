/*! Daily Energy for Moj Elektro | Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
 *  Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing any part
 *  of this file without written permission is not allowed. See LICENSE. */
/* Daily Energy for Moj Elektro — dashboard card and sidebar panel.
 * Card: type: custom:daily-energy-card (optional entry_id). Panel: <daily-energy-panel>.
 * All data comes from the daily_energy_mojelektro integration over the websocket API: it logs every
 * Moj Elektro day (dated by the day the energy was used), stores manual readings and settings, and
 * pushes changes to every open dashboard. The card itself only renders. */
(() => {
  const TAG = 'daily-energy-card';
  if (customElements.get(TAG)) return;
  console.info('%c DAILY ENERGY %c © 2026 Sabotin · all rights reserved ', 'color:#061022;background:#3ee6ff;font-weight:700;border-radius:4px 0 0 4px;padding:2px 0', 'color:#9fe9ff;background:#10162e;border-radius:0 4px 4px 0;padding:2px 0');
  const WS = 'daily_energy_mojelektro';
  const DEF = { mult: 1000, tmode: 'reading', pVT: 0, pMT: 0, cur: '€', grid: 'in' };
  // per-device choices (light / full mode, grid in / out view); storage can be blocked, so never rely on it
  const LS = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } }
  };
  const isPhone = () => { const ua = navigator.userAgent || ''; if (/iPhone|iPod|Android.*Mobile|Windows Phone|Mobile Safari/i.test(ua)) return true; try { return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600; } catch (e) { return false; } };
  const isTablet = () => { const ua = navigator.userAgent || ''; return /iPad|Tablet|Android(?!.*Mobile)/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); };
  const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  const loadFonts = () => {
    if (document.querySelector('link[data-de-font]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.dataset.deFont = '1';
    l.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap';
    document.head.appendChild(l);
  };

  /* ---------- helpers ---------- */
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addD = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };
  const diffD = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
  const weekStart = s => { const d = pd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
  const weekNo = s => { const d = pd(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); const w1 = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7); };
  /* ---------- language: English / Slovenian ----------
     Every text is written in English in the code; t() swaps in the Slovenian text from SL when the card is in
     Slovenian. {0}, {1}… are filled in from the extra arguments. The card picks the language before each render
     (Settings > Language: Automatic follows the Home Assistant language). */
  let LANG = 'en';
  const DATES = {
    en: {
      mon: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      monl: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      dowl: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      dowp: ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'],
      dow2: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
    },
    sl: {
      mon: ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'],
      monl: ['januar', 'februar', 'marec', 'april', 'maj', 'junij', 'julij', 'avgust', 'september', 'oktober', 'november', 'december'],
      dow: ['ned', 'pon', 'tor', 'sre', 'čet', 'pet', 'sob'],
      dowl: ['nedelja', 'ponedeljek', 'torek', 'sreda', 'četrtek', 'petek', 'sobota'],
      dowp: ['Nedelje', 'Ponedeljki', 'Torki', 'Srede', 'Četrtki', 'Petki', 'Sobote'],
      dow2: ['Ne', 'Po', 'To', 'Sr', 'Če', 'Pe', 'So']
    }
  };
  let MON, MONL, DOW, DOWL, DOWP, DOW2;
  const setLang = l => { LANG = l === 'sl' ? 'sl' : 'en'; ({ mon: MON, monl: MONL, dow: DOW, dowl: DOWL, dowp: DOWP, dow2: DOW2 } = DATES[LANG]); };
  setLang('en');
  const SL = {
    // header, banners
    'Loading your energy data…': 'Nalagam podatke o energiji…',
    'Demo preview': 'Demo predogled',
    'Daily Energy integration not set up': 'Integracija Daily Energy ni nastavljena',
    'Grid in': 'Odjem',
    'Grid out': 'Oddaja',
    'Check for updates': 'Preveri posodobitve',
    'Settings': 'Nastavitve',
    'Menu': 'Meni',
    'Demo preview.': 'Demo predogled.',
    '150 days of sample readings so you can explore — nothing here is saved.': '150 dni vzorčnih odčitkov za raziskovanje — nič se ne shrani.',
    'Exit demo': 'Zapri demo',
    'Daily Energy is not set up yet.': 'Daily Energy še ni nastavljen.',
    'Add it under Settings → Devices &amp; services → Add integration → “Daily Energy for Moj Elektro”.': 'Dodajte ga pod Nastavitve → Naprave in storitve → Dodaj integracijo → “Daily Energy for Moj Elektro”.',
    'No grid-out data yet.': 'Še ni podatkov o oddaji.',
    "Moj Elektro's grid-out days are fetched from now on. For the past, use ⚙ → Moj Elektro history.": 'Dnevi oddaje iz Moj Elektro se prenašajo od zdaj naprej. Za pretekle dni uporabite ⚙ → Zgodovina Moj Elektro.',
    'Waiting for the first Moj Elektro day.': 'Čakam na prvi dan iz Moj Elektro.',
    'New days are fetched automatically every morning. For your history, use ⚙ → Moj Elektro history.': 'Novi dnevi se samodejno prenesejo vsako jutro. Za zgodovino uporabite ⚙ → Zgodovina Moj Elektro.',
    'One more reading to go.': 'Manjka še en odčitek.',
    'Welcome — log your first meter reading.': 'Dobrodošli — vnesite prvi odčitek števca.',
    'Usage is the difference between two readings, so charts light up after your next entry.': 'Poraba je razlika med dvema odčitkoma, zato se grafi prikažejo po naslednjem vnosu.',
    'Your first reading is the baseline; every reading after it becomes usage.': 'Prvi odčitek je izhodišče; vsak naslednji postane poraba.',
    'Preview with demo data': 'Predogled z demo podatki',
    // hero
    // estimated bill
    'Estimated bill': 'Ocena računa',
    'Previous month': 'Prejšnji mesec',
    'This month': 'Ta mesec',
    'with VAT': 'z DDV',
    'No data for {0} yet.': 'Za {0} še ni podatkov.',
    'The estimate for {0} starts after 3 days.': 'Ocena za {0} bo na voljo po 3 dneh.',
    '{0} · projected from {1} of {2} days': '{0} · projekcija iz {1} od {2} dni',
    '{0} · whole month': '{0} · cel mesec',
    'Network prices for {0} are not confirmed yet: the last known ones are used.': 'Cene omrežnine za {0} še niso potrjene: uporabljene so zadnje znane.',
    'supplier': 'dobavitelj',
    'Network charge': 'Omrežnina',
    'power': 'moč',
    'energy': 'energija',
    'Levies': 'Prispevki',
    'other': 'ostalo',
    'Total without VAT': 'Skupaj brez DDV',
    'VAT 22 %': 'DDV 22 %',
    'Total': 'Skupaj',
    "Without excess power (informative on the bill) and the supplier's monthly fee.": 'Brez presežne moči (na računu je informativna) in mesečnega nadomestila dobavitelja.',
    'Self-supply with yearly settlement: the monthly bill has only the agreed power; energy is netted in December.': 'Samooskrba z letnim obračunom: mesečni račun vsebuje le dogovorjeno moč, energija se poračuna decembra.',
    'No agreed power from Moj Elektro: type it from your bill under the prices.': 'Moj Elektro nima dogovorjene moči: vnesite jo z računa pri cenah.',
    ' (typical ET price)': ' (okvirna cena ET)',
    'supplier · typical prices': 'dobavitelj · okvirne cene',
    'supplier · your prices': 'dobavitelj · vaše cene',
    '≈ typical energy prices': '≈ okvirne cene energije',
    'Enter your exact prices': 'Vpišite svoje cene energije',
    'Edit prices': 'Uredi cene',
    'Your exact prices': 'Vaše cene energije',
    "Your supplier's energy prices without VAT, as on your bill. Empty fields use typical prices (shown in grey).": 'Cene energije vašega dobavitelja brez DDV, kot na računu. Prazna polja uporabijo okvirne cene (v sivem).',
    'If your package has one price for all hours, type it in both fields.': 'Če ima vaš paket eno ceno za ves dan, jo vpišite v obe polji.',
    'taken from the grid': 'prevzeto iz omrežja',
    'Waiting for the meter details from Moj Elektro – press ↻.': 'Čakam na podatke o števcu iz Moj Elektro – pritisnite ↻.',
    'Agreed power (from your bill)': 'Dogovorjena moč (z računa)',
    'Moj Elektro has no agreed power for this meter yet. Empty blocks take the block before.': 'Moj Elektro za ta števec še nima dogovorjene moči. Prazni bloki prevzamejo vrednost prejšnjega bloka.',
    'Use typical prices': 'Uporabi okvirne cene',
    'Enter a price in €/kWh, e.g. 0.125': 'Vnesite ceno v €/kWh, npr. 0,125',
    'Typical prices are used': 'Uporabljene so okvirne cene',
    'Prices saved': 'Cene shranjene',
    'Yearly settlement {0}': 'Letni obračun {0}',
    'Switch on Grid in &amp; Grid out in ⚙ to see the yearly balance.': 'Za letno bilanco v ⚙ vklopite Odjem in oddaja.',
    'So far {0} kWh more sent out than taken: the surplus is not paid out.': 'Do zdaj {0} kWh več oddane kot prevzete energije: presežek se ne izplača.',
    'So far {0} kWh more taken than sent out{1}.': 'Do zdaj {0} kWh več prevzete kot oddane energije{1}.',
    'Today': 'Danes',
    'Used today': 'Porabljena energija danes',
    'Used yesterday': 'Porabljena energija včeraj',
    'Used on': 'Porabljena energija',
    'Sent out today': 'Oddana energija danes',
    'Sent out yesterday': 'Oddana energija včeraj',
    'Sent out on': 'Oddana energija',
    '{0}% vs 30-day avg': '{0}% glede na 30-dnevno povprečje',
    'From 15-min data · VT / MT tomorrow': 'Iz 15-min podatkov · VT / MT jutri',
    '15-min data · VT / MT tomorrow': '15-min podatki · VT / MT jutri',
    '{0} so far · kWh': '{0} do danes · kWh',
    '{0} sent out · kWh': '{0} oddano · kWh',
    'Moj Elektro · through {0}': 'Moj Elektro · do {0}',
    'Energy counter': 'Števec energije',
    'Last read {0}': 'Zadnji odčitek {0}',
    'No readings yet': 'Še ni odčitkov',
    'No grid-out data yet': 'Še ni podatkov o oddaji',
    'Waiting for the first Moj Elektro day': 'Čakam na prvi dan iz Moj Elektro',
    'Log two readings to see daily usage': 'Vnesite dva odčitka za prikaz dnevne porabe',
    'AVG': 'POVPR.',
    'of your average': 'vašega povprečja',
    'avg {0} kWh/day': 'povpr. {0} kWh/dan',
    'kWh/day': 'kWh/dan',
    // manual meter reading
    'Manual meter reading': 'Ročni vnos števca',
    'Optional — Moj Elektro now logs your usage automatically every day': 'Opcijsko - vaša poraba se samodejno beleži vsak dan.',
    'Open': 'Odpri',
    'Cancel': 'Prekliči',
    // adding a manual reading or deleting days from the log
    'To edit, delete or add usage data.': 'Za urejanje, izbris ali dodajanje podatkov o porabi.',
    'Add': 'Dodaj',
    'Remove entry': 'Odstrani vnos',
    'Delete mode: tap the bin next to a day in the Log.': 'Način brisanja: v dnevniku tapnite koš ob dnevu.',
    'Done': 'Končano',
    'Deleted: {0}': 'Izbrisano: {0}',
    'Nothing to delete for {0}': 'Za {0} ni ničesar za izbris',
    'Edit mode: tap the pencil next to a day in the Log.': 'Način urejanja: v dnevniku tapnite svinčnik ob dnevu.',
    'Saved: {0}': 'Shranjeno: {0}',
    'Enter a number of kWh': 'Vpišite število kWh',
    'Save': 'Shrani',
    'Tariff blocks do not match the day total': 'Bloki se ne ujemajo s porabo dneva',
    'Edit tariff blocks': 'Uredi časovne bloke',
    'Used {0} kWh': 'Porabljeno {0} kWh',
    'Blocks total {0} kWh': 'Skupaj bloki {0} kWh',
    'difference {0} kWh': 'razlika {0} kWh',
    'matches the day total': 'se ujema s porabo dneva',
    'Add a day sent to the grid': 'Dodaj dan oddaje',
    'Close': 'Zapri',
    'Log a reading': 'Vnesi odčitek',
    'Type exactly what your energy counter shows': 'Vpišite točno to, kar kaže vaš števec',
    'Logged today ✓': 'Vneseno danes ✓',
    'Editing': 'Urejanje',
    'New entry': 'Nov vnos',
    'Date': 'Datum',
    'Total counter': 'Skupni števec',
    'kWh used': 'porabljeni kWh',
    'big tariff': 'velika tarifa',
    'small tariff': 'mala tarifa',
    'optional': 'neobvezno',
    'Update reading': 'Posodobi odčitek',
    'Save reading': 'Shrani odčitek',
    'Previous reading {0} on {1}': 'Prejšnji odčitek {0}, {1}',
    "Enter today's number and I'll work out the usage instantly.": 'Vpišite današnje stanje in porabo izračunam takoj.',
    'This will be your baseline.': 'To bo vaše izhodišče.',
    'Usage appears from your second reading onward.': 'Poraba se prikaže od drugega odčitka naprej.',
    'Baseline reading': 'Izhodiščni odčitek',
    'earlier than your other readings.': 'starejši od ostalih odčitkov.',
    'the next reading will show usage.': 'naslednji odčitek bo pokazal porabo.',
    'Lower than the previous reading': 'Nižje od prejšnjega odčitka',
    '({0} on {1}).': '({0}, {1}).',
    'Double-check the digits — counters only go up.': 'Preverite številke — števec se samo povečuje.',
    'over {0} since {1}': 'v {0} od {1}',
    'Exit the demo preview to log real readings': 'Za vnos pravih odčitkov zaprite demo predogled',
    'Pick a date': 'Izberite datum',
    'Enter the total counter reading': 'Vpišite stanje skupnega števca',
    'This reading does not fit between your neighbouring readings (counters only go up). Save anyway?': 'Ta odčitek se ne ujema s sosednjima odčitkoma (števec se samo povečuje). Vseeno shranim?',
    'Saved · +{0} kWh since {1}': 'Shranjeno · +{0} kWh od {1}',
    'Reading saved': 'Odčitek shranjen',
    // tiles
    'Daily average · this month': 'Dnevno povprečje · ta mesec',
    'Peak {0} kWh on {1}': 'Konica porabe {0} kWh, {1}',
    'Peak sent out {0} kWh on {1}': 'Konica oddaje {0} kWh, {1}',
    'This week': 'Ta teden',
    'Last week {0} kWh': 'Prejšnji teden {0} kWh',
    'Projected {0} kWh': 'Predvidena poraba {0} kWh',
    'Projected sent out {0} kWh': 'Predvidena oddaja {0} kWh',
    'Year {0}': 'Leto {0}',
    // charts
    'avg {0}': 'povpr. {0}',
    'Total': 'Skupaj',
    'Cost': 'Strošek',
    '{0} of {1} days logged · {2} kWh/day': 'zabeleženih dni: {0} od {1} · {2} kWh/dan',
    'incl. 15-min data · meter total tomorrow': 'vklj. 15-min podatke · stanje števca jutri',
    'No data': 'Ni podatkov',
    '{0} periods': '{0} obdobij',
    'Average': 'Povprečje',
    'per period': 'Na obdobje',
    'Highest': 'Največja poraba',
    'Lowest': 'Najnižja poraba',
    'Highest sent out': 'Največja oddaja',
    'Lowest sent out': 'Najnižja oddaja',
    'W{0}': 'T{0}',
    'Week {0} · {1} – {2}': 'Teden {0} · {1} – {2}',
    'Consumption': 'Poraba',
    'Sent to the grid': 'Oddano v omrežje',
    'Last 30 days': 'Zadnjih 30 dni',
    'Last 12 weeks': 'Zadnjih 12 tednov',
    'Last 12 months': 'Zadnjih 12 mesecev',
    'By year': 'Po letih',
    'Daily': 'Dnevno',
    'Weekly': 'Tedensko',
    'Monthly': 'Mesečno',
    'Yearly': 'Letno',
    // energy rhythm
    'Energy rhythm': 'Energijski ritem',
    'Every day, last {0} weeks': 'Vsak dan, zadnjih {0} tednov',
    'less': 'manj',
    'more': 'več',
    '15-min data · meter total tomorrow': '15-min podatki · stanje števca jutri',
    'Average by weekday': 'Povprečje po dnevih v tednu',
    '{0} kWh avg': 'povpr. {0} kWh',
    'last 12 weeks': 'zadnjih 12 tednov',
    // Energija VT · MT
    'Big (VT) and small (MT) tariff split': 'Razdelitev na veliko (VT) in malo (MT) tarifo',
    'VT · big': 'VT · velika',
    'MT · small': 'MT · mala',
    'No tariff data yet': 'Še ni tarifnih podatkov',
    'Fill in the Energija VT and MT fields when you log a reading{0} to unlock this split.': 'Ob vnosu odčitka izpolnite polji Energija VT in MT{0}, da se prikaže ta razdelitev.',
    ' (both readings are needed on two consecutive entries)': ' (obe stanji sta potrebni pri dveh zaporednih vnosih)',
    'This month': 'Ta mesec',
    '30 days': '30 dni',
    '12 weeks': '12 tednov',
    '12 months': '12 mesecev',
    'MT share': 'Delež MT',
    'of tariff energy': 'tarifne energije',
    'Energy cost': 'Strošek energije',
    'set prices in Ocena računa': 'vpišite cene pri Oceni računa',
    // 15-minute power
    '15-minute power': '15-minutna moč',
    'grid out': 'oddaja',
    'Moj Elektro · 24 h delay': 'Moj Elektro · 24 h zamika',
    'Loading…': 'Nalagam…',
    'Could not read the 15-minute history': '15-minutne zgodovine ni bilo mogoče prebrati',
    'Collecting 15-minute data…': 'Zbiram 15-minutne podatke…',
    'Moj Elektro publishes yesterday’s 15-minute data at about 06:00. It appears here by itself, or tap Update.': 'Moj Elektro objavi včerajšnje 15-minutne podatke okoli 6:00. Prikažejo se samodejno, lahko pa tapnete gumb za posodobitev.',
    'Power': 'Moč',
    'Energy': 'Energija',
    'no data': 'ni podatkov',
    'Excess power in {0}': 'Presežna moč · {0}',
    'none': 'brez',
    'Agreed power: {0}.': 'Dogovorjena moč: {0}.',
    'Moj Elektro has no agreed power set for this day.': 'Moj Elektro za ta dan še nima določene dogovorjene moči.',
    'Moj Elektro has no agreed power set for this day (new user).': 'Moj Elektro za ta dan še nima določene dogovorjene moči (nov uporabnik).',
    'Excess power as on the bill: per block, the square root of the sum of the squared overshoots in the month.': 'Presežna moč kot na računu: po blokih, koren vsote kvadratov vseh presežkov v mesecu.',
    'kW peak': 'kW konica',
    'Highest 15-min power per block · {0}': 'Najvišja 15-min moč po blokih · {0}',
    "Your network bill's billed power (obračunska moč) is based on 15-minute peaks like these, per tariff block. Colours show which block each quarter hour falls in.": 'Obračunska moč na vašem omrežnem računu temelji na 15-minutnih konicah, kot so te, za vsak omrežninski blok. Barve prikazujejo, v kateri blok spada posamezen 15-minutni interval.',
    '{0} · energy sent to the grid': '{0} · energija, oddana v omrežje',
    'No grid-out 15-minute data yet': 'Še ni 15-minutnih podatkov o oddaji',
    'Power out': 'Oddana moč',
    'Energy out': 'Oddana energija',
    'kW peak out': 'kW konica oddaje',
    'nothing sent out': 'nič oddano',
    'Sent out': 'Oddano',
    'Net': 'Neto',
    'Exporting': 'Oddaja',
    'grid in not known yet': 'odjem še ni znan',
    'more out than in': 'več oddaje kot odjema',
    'more in than out': 'več odjema kot oddaje',
    'best {0} kW · {1}': 'največ {0} kW · {1}',
    "Energy sent to the grid (A−). What you produce and use yourself never passes the meter, so it isn't shown here.": 'Energija, oddana v omrežje (A−). Kar proizvedete in sami porabite, ne gre skozi števec, zato tu ni prikazano.',
    // tariff blocks
    'Časovni bloki · tariff blocks': 'Časovni bloki',
    'Energy per network tariff block, from Moj Elektro': 'Poraba energije po omrežninskih blokih',
    'No block data yet': 'Še ni podatkov po blokih',
    'The daily automation adds it every morning.': 'Dnevna samodejna posodobitev jih doda vsako jutro.',
    'Yesterday': 'Včeraj',
    'Previous day': 'Prejšnji dan',
    'Next day': 'Naslednji dan',
    'Previous month': 'Prejšnji mesec',
    'Next month': 'Naslednji mesec',
    'Choose a day': 'Izberite dan',
    'Blok 1 is the most expensive network block and only applies on working days from November to February. Weekends, holidays and the lower season (March–October) fall into the cheaper blocks 2–5.': 'Blok 1 je najdražji omrežninski blok in velja le ob delovnih dneh od novembra do februarja.',
    // log
    'Reading log': 'Dnevnik odčitkov',
    "Every counter reading you've entered": 'Vsi odčitki števca, ki ste jih vnesli',
    'Log': 'Dnevnik',
    '{0} · since {1}': '{0} · od {1}',
    'Source': 'Vir',
    'Counter': 'Števec',
    'Manually edited': 'Ročno urejeno',
    'Manual reading': 'Ročni odčitek',
    'Used': 'Porabljeno',
    'baseline': 'izhodišče',
    'tariff blocks only': 'samo časovni bloki',
    'Show less': 'Pokaži manj',
    'Show all {0}': 'Pokaži vse ({0})',
    'Edit': 'Uredi',
    'Export': 'Izvozi',
    'Import': 'Uvozi',
    // settings
    'Grid': 'Omrežje',
    'Energy you take from the grid.': 'Odjem iz omrežja',
    'Grid in &amp; Grid out': 'Odjem in oddaja',
    'Also the energy you send to the grid (for example from solar panels), with a Grid in / Grid out switch at the top.': 'Energija, ki jo oddajate v omrežje (na primer iz sončnih panelov), s stikalom Odjem / Oddaja na vrhu.',
    'Counter format': 'Oblika števca',
    'MWh with 3 decimals': 'MWh s 3 decimalkami',
    '120.622 on the display = 120 622 kWh. For example 121.334 − 120.622 = 712 kWh.': '120.622 na zaslonu = 120 622 kWh. Na primer 121.334 − 120.622 = 712 kWh.',
    'Plain kWh': 'Navadni kWh',
    'The counter already shows kWh (e.g. 120622 or 12.5).': 'Števec že kaže kWh (npr. 120622 ali 12.5).',
    'Energija VT / MT input': 'Vnos Energija VT / MT',
    'Counter readings': 'Odčitki števca',
    'Type the VT and MT registers from the meter; usage is the difference between readings.': 'Vpišite stanji VT in MT s števca; poraba je razlika med odčitki.',
    'Type how many kWh were used on VT and MT for that day.': 'Vpišite, koliko kWh je bilo tisti dan porabljenih na VT in MT.',
    'Language': 'Jezik',
    'Automatic': 'Samodejno',
    'Follows the Home Assistant language.': 'Sledi jeziku Home Assistanta.',
    'Display mode': 'Način prikaza',
    'Detects the device and adapts to it automatically.': 'Zaznaj napravo in se ji samodejno prilagodi.',
    'Minimal': 'Minimalistično',
    'No animations, blur or shadows, for slower devices.': 'Brez animacij, zameglitev in senc, za počasnejše naprave.',
    'Full': 'Popolno',
    'All animations and visual effects enabled.': 'Omogočene vse animacije in vizualni učinki.',
    'Moj Elektro history': 'Zgodovina Moj Elektro',
    "Fetches the chosen days straight from Moj Elektro and fills them in: daily usage, VT / MT, month totals and tariff blocks (and the 15-minute chart for the last three weeks){0}. Days already in the log are updated with Moj Elektro's numbers.": 'Izbrane dni samodejno uvozi iz Moj Elektro: dnevno porabo, VT/MT, mesečne seštevke, omrežninske bloke in 15-minutne podatke{0}. (Obstoječi podatki se posodobijo.)',
    ', for grid in and grid out': ' za odjem in oddajo',
    'From': 'Od',
    'To': 'Do',
    'Importing…': 'Uvažam…',
    'Export &amp; import from Moj Elektro': 'Uvozi iz Moj Elektro',
    'Your data': 'Vaši podatki',
    'Everything is stored by the Daily Energy integration inside Home Assistant (included in its backups) and shared by every user; changes show up live on every open dashboard. New Moj Elektro days are logged automatically. Import accepts Moj Elektro CSV exports (daily readings, daily per block, 15-minute data) and Daily Energy JSON backups.': 'Vse shrani integracija Daily Energy v Home Assistantu (vključeno v njegove varnostne kopije) in je skupno vsem uporabnikom; spremembe se takoj prikažejo na vseh odprtih nadzornih ploščah. Novi dnevi Moj Elektro se beležijo samodejno. Uvoz sprejme izvoze CSV iz Moj Elektro (dnevna stanja, dnevno po blokih, 15-minutni podatki) in varnostne kopije JSON iz Daily Energy.',
    'The Daily Energy integration is not set up, so nothing can be saved.': 'Integracija Daily Energy ni nastavljena, zato ni mogoče ničesar shraniti.',
    'Export JSON': 'Izvozi JSON',
    'Import CSV / JSON': 'Uvozi CSV / JSON',
    'Delete': 'Izbriši',
    'Delete all data': 'Izbriši vse podatke',
    'Delete all data?': 'Izbrišem vse podatke?',
    // pop-up messages
    'Could not save to Home Assistant — {0}': 'Shranjevanje v Home Assistant ni uspelo — {0}',
    'Checking for updates…': 'Preverjam posodobitve…',
    'Could not reach Moj Elektro — try again later': 'Moj Elektro ni dosegljiv — poskusite pozneje',
    'Updated the cards!': 'Kartice so posodobljene!',
    'Nothing has been updated yet': 'Še ni novih podatkov',
    'Manual refresh is used up': 'Ročno osveževanje je porabljeno',
    'The data will be filled in automatically at the next morning check.': 'Podatki se bodo samodejno vnesli ob naslednjem jutranjem preverjanju.',
    'Could not check for updates — {0}': 'Preverjanje posodobitev ni uspelo — {0}',
    'Pick both dates': 'Izberite oba datuma',
    'Pick days before today': 'Izberite dneve pred današnjim',
    'Importing from Moj Elektro · {0}…': 'Uvažam iz Moj Elektro · {0}…',
    'Only administrators can import': 'Uvoz lahko izvedejo samo skrbniki',
    'Import stopped — {0}': 'Uvoz ustavljen — {0}',
    'Imported from Moj Elektro: {0}': 'Uvoženo iz Moj Elektro: {0}',
    ' · {0} without a meter total': ' · brez stanja števca: {0}',
    'Moj Elektro has no data for those days': 'Moj Elektro za te dni nima podatkov',
    'Nothing new — those days are already up to date': 'Nič novega — ti dnevi so že posodobljeni',
    'Grid out is on, fetching the last 3 days from Moj Elektro.': 'Oddaja je vklopljena, prenašam zadnje 3 dni iz Moj Elektro.',
    'Grid out on': 'Oddaja vklopljena',
    'Demo data loaded — explore away': 'Demo podatki so naloženi — raziskujte',
    'Wrong PIN': 'Napačen PIN',
    'Only administrators can delete data': 'Podatke lahko brišejo samo skrbniki',
    'Could not delete — {0}': 'Brisanje ni uspelo — {0}',
    'Meters': 'Merilna mesta',
    'Rename': 'Preimenuj',
    'Any name': 'Poljubno ime',
    'Remove': 'Odstrani',
    'Remove {0}?': 'Odstranim {0}?',
    'All data of this meter is deleted.': 'Izbrišejo se vsi podatki tega merilnega mesta.',
    'Meter removed': 'Merilno mesto je odstranjeno',
    'Add a meter': 'Dodaj merilno mesto',
    'Change the API token': 'Spremeni API žeton',
    'New API token for {0}': 'Nov API žeton za {0}',
    'New API token': 'Nov API žeton',
    'Create it at mojelektro.si under API storitve › Kreiraj žeton (tick Neomejeno).': 'Ustvarite ga na mojelektro.si pod API storitve › Kreiraj žeton (obkljukajte Neomejeno).',
    'Enter the new API token.': 'Vpišite nov API žeton.',
    'Check the API token.': 'Preverite API žeton.',
    'Token changed': 'Žeton spremenjen',
    'Token changed (also for the meters with the same token)': 'Žeton spremenjen (tudi za merilna mesta z istim žetonom)',
    'This is the token already saved.': 'To je že shranjeni žeton.',
    'Moj Elektro did not accept this API token.': 'Moj Elektro ni sprejel tega API žetona.',
    'Moj Elektro refused the request. Check the meter ID (EIMM) and that the token belongs to it.': 'Moj Elektro je zavrnil zahtevo. Preverite merilno mesto (EIMM) in da žeton pripada njemu.',
    'Could not reach the Moj Elektro API. Try again later.': 'API Moj Elektro ni dosegljiv. Poskusite znova pozneje.',
    'Could not save — {0}': 'Shranjevanje ni uspelo — {0}',
    'All data deleted': 'Vsi podatki so izbrisani',
    'daily meter readings': 'dnevna stanja števca',
    'daily tariff blocks': 'dnevni časovni bloki',
    '15-minute data': '15-minutni podatki',
    'backup': 'varnostna kopija',
    'Imported {0}: {1}': 'Uvoženo ({0}): {1}',
    'Could not import — {0}': 'Uvoz ni uspel — {0}',
    'unknown file': 'neznana datoteka',
    // Net (Neto) view
    'No days with both grid in and grid out yet': 'Še ni dni, ki bi imeli odjem in oddajo',
    'Net appears as soon as Moj Elektro has both for the same day.': 'Neto se pokaže, ko Moj Elektro pošlje oboje za isti dan.',
    'Balance': 'Bilanca',
    'yesterday': 'včeraj',
    'You sent <b>{0} kWh more</b> to the grid than you took from it.': 'V omrežje ste oddali <b>{0} kWh več</b>, kot ste iz njega vzeli.',
    'You took <b>{0} kWh more</b> from the grid than you sent to it.': 'Iz omrežja ste vzeli <b>{0} kWh več</b>, kot ste ga oddali.',
    '{0} kWh vs the day before': '{0} kWh glede na dan prej',
    'Coverage': 'Pokritost',
    'coverage': 'pokritost',
    'grid in': 'odjem',
    'Through the day · net': 'Potek dneva · neto',
    'No 15-minute data for both yet': 'Še ni 15-minutnih podatkov za odjem in oddajo',
    'grid out − grid in, every 15 minutes': 'oddaja − odjem, vsakih 15 minut',
    'GRID OUT': 'ODDAJA',
    'GRID IN': 'ODJEM',
    'In plus': 'V plusu',
    'quarters in plus: {0}': 'četrtur v plusu: {0}',
    'no quarter in plus': 'nobena četrtura v plusu',
    'Most sent': 'Največ oddaje',
    'at {0}': 'ob {0}',
    'Most taken': 'Največ odjema',
    'grid in {0} · grid out {1} kWh': 'odjem {0} · oddaja {1} kWh',
    'Last 7 days': 'Zadnjih 7 dni',
    'week before': 'teden prej',
    'This year': 'Letos',
    'last year': 'lani',
    'Coverage this year': 'Pokritost letos',
    'grid out / grid in since 1 January': 'oddaja / odjem od 1. januarja',
    'This year you sent more than you took.': 'Letos ste oddali več, kot ste vzeli.',
    '{0} kWh more grid out to reach 100 %.': 'Do 100 % manjka še {0} kWh oddaje.',
    'days with data: {0}': 'dni s podatki: {0}',
    'net = grid out − grid in': 'neto = oddaja − odjem',
    'Grid out (up)': 'Oddaja (zgoraj)',
    'Grid in (down)': 'Odjem (spodaj)',
    'Net in plus': 'Neto v plusu',
    'Net in minus': 'Neto v minusu',
    'Sun clock': 'Sončna ura',
    'Average per hour · {0}': 'Povprečje po urah · {0}',
    'Average net': 'Povprečni neto',
    'IN PLUS': 'V PLUSU',
    'outward: grid out': 'navzven: oddaja',
    'inward: grid in': 'navznoter: odjem',
    'Year balance': 'Letna bilanca',
    'Running net total since 1 January': 'Tekoči seštevek neto od 1. januarja',
    'this year against last year': 'letos proti lani',
    'last year on this day {0} kWh': 'lani na ta dan {0} kWh',
    '{0} in plus': '{0} v plusu',
    '{0} in minus': '{0} v minusu',
    'Records this year': 'Rekordi letos',
    'Since 1 January {0}': 'Od 1. januarja {0}',
    'Best day': 'Najboljši dan',
    'Worst day': 'Najslabši dan',
    'Best month': 'Najboljši mesec',
    'Worst month': 'Najslabši mesec',
    'Records {0}': 'Rekordi {0}',
    'Whole year {0}': 'Celo leto {0}',
    '{0} % of days in {1}': '{0} % dni v letu {1}',
    'Previous year': 'Prejšnje leto',
    'Next year': 'Naslednje leto',
    'Longest run in plus': 'Najdaljši niz v plusu',
    'until {0}': 'do {0}',
    'Days in plus': 'Dni v plusu',
    '{0} % of days this year': '{0} % dni letos',
    'Balance calendar': 'Koledar bilance',
    'more grid in': 'več odjema',
    'more grid out': 'več oddaje',
    'Grid in, grid out and net per day · kWh': 'Odjem, oddaja in neto po dnevih · kWh',
    'Day': 'Dan',
    '{0} in a row in plus': '{0} zapored v plusu',
    '{0} in a row in minus': '{0} zapored v minusu',
    'Every day, last 12 months': 'Vsak dan, zadnjih 12 mesecev',
    'Every day, last 6 months': 'Vsak dan, zadnjih 6 mesecev',
  };
  const t = (s, ...a) => (LANG === 'sl' && SL[s] || s).replace(/\{(\d)\}/g, (_, i) => a[i]);
  const tr = t; // for methods where t is a local variable
  // Slovenian counts have four forms: 1 dan, 2 dneva, 3–4 dnevi, 5+ dni
  const slN = (n, f) => { const m = n % 100; return m === 1 ? f[0] : m === 2 ? f[1] : m === 3 || m === 4 ? f[2] : f[3]; };
  const nDays = n => LANG === 'sl' ? `${n} ${slN(n, ['dan', 'dneva', 'dnevi', 'dni'])}` : `${n} day${n === 1 ? '' : 's'}`;
  const lastDays = n => LANG === 'sl' ? slN(n, ['zadnji dan', `zadnja ${n} dneva`, `zadnji ${n} dnevi`, `zadnjih ${n} dni`]) : `last ${nDays(n)}`;
  // "7 days updated", "3 manual readings"…: English label with a count, Slovenian "label: count"
  const count = (n, en1, enN, sl) => LANG === 'sl' ? `${sl}: ${n}` : `${n} ${n === 1 ? en1 : enN}`;
  const fdate = s => { const d = pd(s); return LANG === 'sl' ? `${DOW[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]}` : `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`; };
  const fshort = s => { const d = pd(s); return LANG === 'sl' ? `${d.getDate()}. ${MON[d.getMonth()]}` : `${d.getDate()} ${MON[d.getMonth()]}`; };
  const flong = d => LANG === 'sl' ? `${DOWL[d.getDay()]}, ${d.getDate()}. ${MONL[d.getMonth()]} ${d.getFullYear()}` : `${DOWL[d.getDay()]}, ${d.getDate()} ${MONL[d.getMonth()]} ${d.getFullYear()}`;
  const num = v => { if (v == null) return null; const t = String(v).trim().replace(/\s/g, '').replace(',', '.'); if (t === '') return null; const x = Number(t); return isFinite(x) ? x : null; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const grp = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fk = v => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v); const dec = a === 0 ? 0 : a < 1 ? 2 : a < 100 ? 1 : 0; const [i, f] = Math.abs(v).toFixed(dec).split('.'); return (v < 0 ? '−' : '') + grp(i) + (f ? '.' + f : ''); };
  const fax = v => v >= 100 || v === 0 ? grp(String(Math.round(v))) : String(+v.toFixed(1));
  const nice = x => { if (!(x > 0)) return 10; const p = 10 ** Math.floor(Math.log10(x)); for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= x) return m * p; return 10 * p; };
  const rawStr = (v, mult) => mult === 1000 ? Number(v).toFixed(3) : String(+Number(v).toFixed(2));
  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  /* Slovenian network tariff blocks (časovni bloki, since Oct 2024): block 1 is the most expensive.
     Higher season = Nov–Feb; weekends and public holidays shift everything one block cheaper. */
  const BLK = ['#ff4d6d', '#ff8c42', '#ffd166', '#4cc9f0', '#8f7dff'];
  const HOL = ['01-01', '01-02', '02-08', '04-27', '05-01', '05-02', '06-25', '08-15', '10-31', '11-01', '12-25', '12-26'];
  const easterMonday = y => { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), n = h + l - 7 * m + 114; return iso(new Date(y, Math.floor(n / 31) - 1, (n % 31) + 2)); };
  const isFree = dt => { const w = dt.getDay(), s = iso(dt); return w === 0 || w === 6 || HOL.includes(s.slice(5)) || s === easterMonday(dt.getFullYear()); };
  const blockOf = dt => {
    const h = dt.getHours(), hi = [10, 11, 0, 1].includes(dt.getMonth());
    const tier = (h >= 7 && h < 14) || (h >= 16 && h < 20) ? 0 : (h >= 6 && h < 7) || (h >= 14 && h < 16) || (h >= 20 && h < 22) ? 1 : 2;
    return (hi ? 1 : 2) + (isFree(dt) ? 1 : 0) + tier;
  };

  /* Estimated bill (Ocena računa): Slovenian household rules, user group 0, prices without VAT, checked against bills.
     NET: network charge (omrežnina) from a date on: pw = €/kW a month of agreed power per tariff block (0 = the block
     is not charged), en = €/kWh per block, et = €/kWh for a single-tariff self-supply bill (Omrežnina ET),
     ove = OVE+SPTE €/kW of the agreed power of the season's first block (B1 in the higher, B2 in the lower season).
     Prices change during the year (transitional discounts), so a row applies until the next one. guess: not every
     price of the row is confirmed by a bill; unknown: not published yet, the last known row of the season is used.
     Power charges and OVE+SPTE are for the whole month; excess power (presežna moč) is informative only. */
  const NET = [
    // 2025: B1 of Jan–Feb charged at B2's price, B5 free, OVE+SPTE free until June (yearly settlement 2025)
    { from: '2025-01-01', season: 'hi', pw: [0.91224, 0.91224, 0.16297, 0.00407, 0], en: [0.01998, 0.01833, 0.01809, 0.01855, 0], et: 0.01856, ove: 0, guess: true },
    { from: '2025-03-01', season: 'lo', pw: [0, 0.91224, 0.16297, 0.00407, 0], en: [0, 0.01998, 0.01717, 0.01805, 0.01299], et: 0.01856, ove: 0, guess: true },
    { from: '2025-07-01', season: 'lo', pw: [0, 0.91224, 0.16297, 0.00407, 0], en: [0, 0.01998, 0.01717, 0.01805, 0.01299], et: 0.01856, ove: 0.77562, guess: true },
    { from: '2025-11-01', season: 'hi', pw: [1.71126, 0.91224, 0.16297, 0.00407, 0], en: [0.01998, 0.01833, 0.01809, 0.01855, 0], et: 0.01856, ove: 0.38781 },
    { from: '2026-03-01', season: 'lo', pw: [0, 1.0923, 0.28902, 0.02436, 0.00245], en: [0, 0.01998, 0.01717, 0.01805, 0.01299], et: 0.01864, ove: 0.77562 },
    // Nov 2026: B1 at 70 % of 3.82301 €/kW (AGEN-RS, tariff rates 2026); OVE+SPTE and et as in the last winter
    { from: '2026-11-01', season: 'hi', pw: [2.67611, 1.0923, 0.28902, 0.02436, 0], en: [0.02217, 0.01998, 0.01717, 0.01805, 0], et: 0.01864, ove: 0.38781 }
  ];
  // Typical supplier prices (€/kWh without VAT, regular household offers, Oct 2026) used until the user types their own
  // in the card's price window: the estimate is then marked approximate.
  const DEF_PRICE = { vt: 0.135, mt: 0.105, et: 0.125 };
  // per kWh: market operator, energy efficiency, excise duty
  const LEVY = [0.00013, 0.0008, 0.00153];
  const VAT = 0.22;
  const seasonOf = ym => [11, 12, 1, 2].includes(+ym.slice(5, 7)) ? 'hi' : 'lo';
  const netRow = ym => {
    const se = seasonOf(ym), day = ym + '-01';
    const row = NET.filter(r => r.from <= day).pop();
    if (row && !row.unknown && row.season === se) return { row, guess: !!row.guess };
    const known = NET.filter(r => !r.unknown && r.season === se), past = known.filter(r => r.from <= day);
    return { row: (past.length ? past : known).pop(), guess: true };
  };
  const r2 = x => Math.round(x * 100) / 100;
  // i: { ym, kwh, vt, mt, has (VT/MT known), b: kWh of blocks 1-5, kw: agreed kW of blocks 1-5 or null,
  //      pET or pVT + pMT (supplier €/kWh), yearly (self-supply under EZ-1: the month's bill has only the agreed
  //      power; energy is netted in the yearly settlement) }. The supplier's monthly fee is not included.
  // Every line is rounded to cents, as on the bill.
  const billEstimate = i => {
    const se = seasonOf(i.ym), { row, guess } = netRow(i.ym), kw = i.kw, yearly = !!i.yearly, kwh = yearly ? 0 : i.kwh;
    // days without tariff blocks: their energy is spread like the known blocks (or at the season's average price)
    let b = i.b.slice();
    const bt = b.reduce((a, x) => a + x, 0);
    if (kwh > bt + 0.01) b = bt > 0 ? b.map(x => x * kwh / bt) : null;
    let supplier = null;
    if (yearly) supplier = 0;
    else if (i.pET > 0) supplier = r2(kwh * i.pET);
    else if ((i.pVT > 0 || i.pMT > 0) && i.has && i.vt + i.mt > 0) {
      const f = kwh / (i.vt + i.mt);
      supplier = r2(i.vt * f * i.pVT) + r2(i.mt * f * i.pMT);
    }
    const power = kw ? row.pw.reduce((a, p, k) => a + r2(p * kw[k]), 0) : 0;
    const avgEn = row.en.filter(x => x > 0).reduce((a, x, _, l) => a + x / l.length, 0);
    const energy = yearly ? 0 : b ? row.en.reduce((a, p, k) => a + r2(p * b[k]), 0) : r2(kwh * avgEn);
    const ove = kw && !yearly ? r2(row.ove * kw[se === 'hi' ? 0 : 1]) : 0;
    const other = LEVY.reduce((a, p) => a + r2(p * kwh), 0);
    const g = {
      energy: supplier == null ? null : r2(supplier),
      network: r2(power + energy),
      levies: r2(ove + other)
    };
    const net = r2((g.energy || 0) + g.network + g.levies), vat = r2(net * VAT);
    return { g, supplier, power: r2(power), energy: r2(energy), ove, other: r2(other), net, vat, total: r2(net + vat), guess, noKw: !kw, noPrice: supplier == null, yearly };
  };
  // Yearly settlement of self-supply under EZ-1: energy taken minus energy sent out over the calendar year. A surplus
  // is not paid out or carried over (settlement 2025); energy taken above it is charged per kWh with the single-tariff
  // network price and the levies.
  const yearlyNet = (ym, inKwh, outKwh, pET) => {
    const { row } = netRow(ym), net = inKwh - outKwh;
    if (net <= 0) return { net, cost: 0 };
    const x = r2(net * (pET || 0)) + r2(net * row.et) + LEVY.reduce((a, p) => a + r2(p * net), 0);
    return { net, cost: r2(x * (1 + VAT)), noPrice: !(pET > 0) };
  };

  const I = {
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
    week: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    month: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4M7 13h2M11 13h2M15 13h2M7 17h2M11 17h2"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    chev: '<path d="M6 9l6 6 6-6"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 20 3M15.5 7.5l3 3M18 5l2 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    year: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    avg: '<path d="M3 17l5-5 4 4 8-8"/><path d="M14 8h6v6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    del: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    ok: '<path d="M5 12l5 5L20 7"/>',
    warn: '<path d="M12 3.5 2.5 20.5h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    down: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    up: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
    spark: '<path d="M12 3l1.9 5.8L20 10l-5 3.6L16.8 20 12 16.3 7.2 20 9 13.6 4 10l6.1-1.2z"/>',
    meter: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h10M7 13h4"/>',
    sync: '<path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
    // Net: two overlapping squares with arrows pointing into the overlap (grid in and grid out merged)
    merge: '<rect x="2.5" y="2.5" width="11" height="11" rx="3"/><rect x="10.5" y="10.5" width="11" height="11" rx="3"/><path d="M5.5 5.5l4.5 4.5M10 6.6V10H6.6M18.5 18.5 14 14M14 17.4V14h3.4"/>',
    flame: '<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-9-1 2-2 3-4 4 0-2-1-4-2-6-2 3-4 6-4 11 0 4 3 7 7 7z"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>'
  };
  const ic = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${I[n]}</svg>`;

  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* ---------- styles ---------- */
  const CSS = `
:host{display:block;--bg:#050811;--txt:#eef1ff;--mut:#8f98c2;--dim:#59618c;--line:rgba(150,170,255,.10);
--c1:#3ee6ff;--c2:#7b6bff;--vt1:#ffc857;--vt2:#ff7a3d;--mt1:#a18bff;--mt2:#4f8dff;--ok:#3ef0a8;--bad:#ff5d7a;
font-family:Outfit,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:var(--txt);-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}
.ic{width:16px;height:16px;flex:none}
.root{position:relative;min-height:calc(100vh - var(--header-height,56px));overflow:hidden;overflow:clip;
background:radial-gradient(1100px 620px at 8% -8%,rgba(62,230,255,.12),transparent 60%),radial-gradient(900px 640px at 100% 0%,rgba(123,107,255,.16),transparent 62%),radial-gradient(1000px 700px at 50% 115%,rgba(255,122,61,.08),transparent 60%),var(--bg);
padding:26px clamp(14px,2.6vw,40px) 56px}
.root:before{content:'';position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:46px 46px;-webkit-mask-image:radial-gradient(ellipse 80% 60% at 50% 0%,#000 25%,transparent 75%);mask-image:radial-gradient(ellipse 80% 60% at 50% 0%,#000 25%,transparent 75%);opacity:.55}
.blob{position:absolute;border-radius:50%;filter:blur(90px);pointer-events:none;opacity:.32;animation:drift 26s ease-in-out infinite alternate}
.b1{width:520px;height:520px;background:#1fb6ff;top:-160px;left:-120px}
.b2{width:620px;height:620px;background:#6a4bff;top:10%;right:-220px;animation-duration:32s}
.b3{width:460px;height:460px;background:#ff6a3d;bottom:-200px;left:30%;opacity:.16;animation-duration:38s}
@keyframes drift{0%{transform:translate(0,0) scale(1)}50%{transform:translate(60px,40px) scale(1.1)}100%{transform:translate(-40px,80px) scale(.95)}}
.wrap{position:relative;max-width:1720px;margin:0 auto}
/* header */
.hdr{display:flex;align-items:center;gap:18px;margin-bottom:22px;flex-wrap:wrap}
.logo{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:linear-gradient(135deg,var(--c1),var(--c2));box-shadow:0 10px 40px -8px rgba(62,230,255,.6),inset 0 1px 0 rgba(255,255,255,.4);color:#061022;position:relative}
.logo .ic{width:28px;height:28px;fill:#061022;stroke:none;animation:zap 3.2s ease-in-out infinite}
.logo:after{content:'';position:absolute;inset:-6px;border-radius:20px;border:1px solid rgba(62,230,255,.35);animation:ring 3.2s ease-out infinite}
@keyframes zap{0%,100%{transform:scale(1)}8%{transform:scale(1.18) rotate(-6deg)}14%{transform:scale(.96)}}
@keyframes ring{0%{opacity:.8;transform:scale(.9)}70%,100%{opacity:0;transform:scale(1.25)}}
.hdr h1{margin:0;font-size:clamp(24px,2.4vw,34px);font-weight:700;letter-spacing:-.02em;line-height:1.05}
.hdr h1 span{background:linear-gradient(90deg,#fff,#b9c4ff 60%,var(--c1));-webkit-background-clip:text;background-clip:text;color:transparent}
.hdr .sub{color:var(--mut);font-size:14px;margin-top:4px;letter-spacing:.01em}
.hdr .sp{flex:1}
/* phone: logo, title, update and settings stay on one row; the Grid in / Grid out switch gets its own row below */
@media (max-width:640px){.hdr{gap:12px}.hdr .logo{width:44px;height:44px;border-radius:14px}.hdr .ttl{flex:1;min-width:0}.hdr .sub{font-size:13px}.hdr .sp{display:none}.hdr .ibtn{width:40px;height:40px;flex:none}.hdr .gsw{order:5;flex:1 1 100%;margin-top:16px}.hdr .chips:empty{display:none}.hdr{margin-bottom:18px}.hdr .gsw button{flex:1;justify-content:center}.hdr .chips{order:6}}
.chip{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);font-size:13px;color:var(--mut);white-space:nowrap}
.chip i{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 12px var(--ok)}
.chip.warn i{background:var(--vt1);box-shadow:0 0 12px var(--vt1)}
.ibtn{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);color:var(--txt);cursor:pointer;transition:.25s}
.ibtn:hover{background:rgba(255,255,255,.1);transform:rotate(30deg)}
.ibtn .ic{width:20px;height:20px}
.ibtn.upd:hover{transform:rotate(-30deg)}
.ibtn.busy{pointer-events:none;opacity:.85}.ibtn.busy .ic{animation:spin 1s linear infinite}
/* banner */
.banner{display:flex;align-items:center;gap:16px;padding:16px 20px;margin-bottom:18px;border-radius:20px;border:1px solid rgba(62,230,255,.25);background:linear-gradient(90deg,rgba(62,230,255,.10),rgba(123,107,255,.10));flex-wrap:wrap}
.banner.demo{border-color:rgba(255,200,87,.35);background:linear-gradient(90deg,rgba(255,200,87,.12),rgba(255,122,61,.08))}
.banner .ic{width:22px;height:22px;color:var(--c1)} .banner.demo .ic{color:var(--vt1)}
.banner b{font-weight:600} .banner span{color:var(--mut)} .banner .sp{flex:1}
/* grid + cards */
.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:18px}
.s3{grid-column:span 3}.s4{grid-column:span 4}.s5{grid-column:span 5}.s7{grid-column:span 7}.s8{grid-column:span 8}.s12{grid-column:span 12}
.card{position:relative;border-radius:26px;padding:24px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.018));border:1px solid rgba(255,255,255,.075);backdrop-filter:blur(20px) saturate(140%);-webkit-backdrop-filter:blur(20px) saturate(140%);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 30px 60px -30px rgba(0,0,0,.7);animation:rise .7s cubic-bezier(.2,.8,.2,1) both}
.card:before{content:'';position:absolute;inset:-1px;border-radius:inherit;padding:1px;background:linear-gradient(140deg,rgba(62,230,255,.35),transparent 30%,transparent 70%,rgba(123,107,255,.35));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:0;transition:opacity .4s;pointer-events:none}
.card:hover:before{opacity:1}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.ch-h{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:18px;flex-wrap:wrap}
.h-t{font-size:18px;font-weight:600;letter-spacing:-.01em}
.h-s{font-size:13px;color:var(--mut);margin-top:3px}
.h-n{font-size:11.5px;color:var(--mut);opacity:.7;margin-top:3px}
.seg-tabs{display:inline-flex;padding:4px;border-radius:14px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.06)}
.seg-tabs button{border:0;background:none;color:var(--mut);font:inherit;font-size:13px;font-weight:500;padding:7px 14px;border-radius:10px;cursor:pointer;transition:.25s}
.seg-tabs button:hover{color:var(--txt)}
.seg-tabs button.on{color:#061022;background:linear-gradient(135deg,var(--c1),#8fb6ff);box-shadow:0 6px 20px -6px rgba(62,230,255,.6)}
.tariff .seg-tabs button.on{background:linear-gradient(135deg,var(--vt1),var(--mt1));box-shadow:0 6px 20px -6px rgba(161,139,255,.6)}
/* hero */
.hero{display:grid;grid-template-columns:1fr auto;gap:24px;overflow:hidden;min-height:330px}
.hero:after{content:'';position:absolute;width:380px;height:380px;right:-80px;top:-120px;border-radius:50%;background:radial-gradient(circle,rgba(62,230,255,.20),transparent 65%);pointer-events:none}
.eyebrow{display:inline-flex;align-items:center;gap:10px;font-size:13px;text-transform:uppercase;letter-spacing:.14em;color:var(--mut);font-weight:500}
.pulse{width:9px;height:9px;border-radius:50%;background:var(--c1);box-shadow:0 0 0 0 rgba(62,230,255,.7);animation:pulse 2s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(62,230,255,.6)}70%{box-shadow:0 0 0 12px rgba(62,230,255,0)}100%{box-shadow:0 0 0 0 rgba(62,230,255,0)}}
.big{display:flex;align-items:baseline;gap:12px;margin:10px 0 6px}
.bignum{font-size:clamp(64px,7.4vw,112px);font-weight:700;letter-spacing:-.045em;line-height:.95;background:linear-gradient(180deg,#fff 20%,#9fdfff 70%,#6f8bff);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 6px 30px rgba(62,230,255,.35));font-variant-numeric:tabular-nums;padding-right:.08em;margin-right:-.08em}
.unit{font-size:22px;color:var(--mut);font-weight:500}
.pills{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.pill{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;font-size:13px;font-weight:500;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08)}
.pill.up{color:#ffb2a0;background:rgba(255,93,122,.10);border-color:rgba(255,93,122,.25)}
.pill.down{color:#98ffd6;background:rgba(62,240,168,.08);border-color:rgba(62,240,168,.25)}
.pill .d{width:8px;height:8px;border-radius:3px}
.meter{margin-top:26px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.meter-l{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.meter-s{font-size:12px;color:var(--mut);margin-top:4px}
/* estimated bill */
.bill{margin-top:0;padding:18px 20px;border-radius:18px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);width:clamp(360px,24vw,440px);max-width:100%;box-sizing:border-box}
/* PC: the opened box reaches the bottom of the card; closed it is only as tall as its content */
.bill.open{min-height:100%}
@media (max-width:860px){.bill{width:auto}.bill.open{min-height:0}}
.bill-h{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.bill-h .seg-tabs button{padding:5px 10px;font-size:12px}
.bill-v{display:flex;align-items:baseline;gap:8px;margin-top:10px;cursor:pointer;user-select:none}
.bill-v span{font-size:32px;font-weight:700;letter-spacing:-.01em}
.bill-v small{font-size:12px;color:var(--mut)}
.bill-v svg{width:16px;height:16px;align-self:center;margin-left:auto;transition:transform .25s;opacity:.7}
.bill.open .bill-v svg{transform:rotate(180deg)}
.bill-n{font-size:12px;color:var(--dim);margin-top:6px}
.bl-d{margin-top:12px;border-top:1px solid rgba(255,255,255,.08);padding-top:6px}
.bl-r{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:7px 0}
.bl-r b{display:block;font-size:13px;font-weight:600}
.bl-r span{display:block;font-size:11.5px;color:var(--mut);margin-top:2px}
.bl-r em{font-style:normal;font-family:'JetBrains Mono',monospace;font-size:13px;white-space:nowrap}
.bl-r.sum{border-top:1px solid rgba(255,255,255,.08);margin-top:4px}
.kw5{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.bill-p{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--dim)}
.lnk{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:var(--txt,#e8ecff);font:inherit;font-size:12.5px;font-weight:500;padding:6px 11px;border-radius:999px;cursor:pointer;margin-left:auto}
.lnk svg{width:14px;height:14px}
.lnk:hover{background:rgba(255,255,255,.1)}
.hbill{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:var(--txt,#e8ecff);font:inherit;font-size:14px;font-weight:500;padding:9px 14px;border-radius:999px;cursor:pointer;white-space:nowrap}
.hbill b{font-weight:700}
/* tablets with the Odjem / Oddaja switch: the bill button sits just left of the switch, a little smaller, so the
   header stays on one row */
.hdr #hbill.gs{margin-right:-6px}
.hdr #hbill.gs .hbill{font-size:13px;padding:8px 12px;gap:6px}
/* portrait tablets: no room for the words, only "≈ €X ▾" (the full title is on the button and in the window) */
@media (max-width:900px){.hdr #hbill .hbl{display:none}}
.hbill svg{width:16px;height:16px;opacity:.75}
.hbill:hover{background:rgba(255,255,255,.1)}
.hb-bg{position:fixed;inset:0;z-index:76;background:rgba(2,4,10,.6)}
.hbp{position:fixed;z-index:77;left:50%;top:50%;transform:translate(-50%,-50%);width:min(480px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;border-radius:20px;background:linear-gradient(180deg,#0c1228,#070a16);border:1px solid rgba(255,255,255,.1);box-shadow:0 30px 80px -20px rgba(0,0,0,.8)}
.hbp .bill{width:auto;min-height:0;border:0;background:none;padding:20px 22px}
.hbp .bill-v{cursor:default}
.hbp .bill-v svg{display:none}
.hbp .bill-h{padding-right:44px}
.hb-x{position:absolute;top:14px;right:14px;z-index:1}
/* tablets: the hero card as before the estimated bill */
:host([tablet]) .gwrap{margin:0}
@media (max-width:860px){:host([tablet]) .gwrap{margin:0 auto}}
.bp-bg{position:fixed;inset:0;z-index:80;background:rgba(2,4,10,.6);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.bp{position:fixed;z-index:81;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;padding:20px;border-radius:20px;background:linear-gradient(180deg,#0c1228,#070a16);border:1px solid rgba(255,255,255,.1);box-shadow:0 30px 80px -20px rgba(0,0,0,.8);display:flex;flex-direction:column;gap:12px}
.bp h3{margin:0;font-size:18px}
.bp-t{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-top:6px}
.bp-b{justify-content:flex-end;gap:10px;margin-top:4px}
.bp .iw input.in{padding-right:64px}
.kw5 .fld span{font-size:11px}
.odo{display:inline-flex;align-items:center;padding:8px 10px;gap:3px;border-radius:14px;background:linear-gradient(180deg,#02040a,#0b1124);border:1px solid rgba(255,255,255,.08);box-shadow:inset 0 2px 10px rgba(0,0,0,.8),0 0 0 4px rgba(255,255,255,.02)}
.od{display:inline-block;width:.78em;height:1.25em;overflow:hidden;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:26px;font-weight:700;color:#e9fbff;background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.02) 50%,rgba(255,255,255,.07));border-radius:6px;text-align:center;position:relative;text-shadow:0 0 12px rgba(62,230,255,.6)}
.od.frac{color:#ffd9a8;text-shadow:0 0 12px rgba(255,160,70,.6)}
.od-r{display:flex;flex-direction:column;transition:transform 1.4s cubic-bezier(.2,.9,.1,1)}
.od-r i{font-style:normal;height:1.25em;line-height:1.25em}
.od-sep{font-family:'JetBrains Mono',monospace;font-size:26px;color:var(--vt1);font-weight:700;padding:0 1px}
.hero-r{min-width:0;align-self:stretch}
.hero-r:empty{display:none}
.gwrap{position:relative;width:260px;height:260px;align-self:center;margin:66px 0 0 40px}
.gauge{width:100%;height:100%;overflow:visible}
.g-val{transition:stroke-dasharray 1.6s cubic-bezier(.2,.8,.2,1)}
.g-spin{transform-origin:100px 100px;animation:spin 40s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.g-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.g-v{font-size:44px;font-weight:700;letter-spacing:-.03em}
.g-v small{font-size:20px;color:var(--mut);font-weight:500}
.g-l{font-size:12px;color:var(--mut);letter-spacing:.08em;text-transform:uppercase;margin-top:2px}
.g-a{font-size:13px;color:var(--txt);margin-top:8px;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.06)}
/* form */
.form{display:flex;flex-direction:column;gap:14px}
.badge{font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:5px 10px;border-radius:999px;background:rgba(62,230,255,.12);color:var(--c1);border:1px solid rgba(62,230,255,.25);font-weight:600}
.badge.ed{background:rgba(255,200,87,.12);color:var(--vt1);border-color:rgba(255,200,87,.3)}
.fld{display:flex;flex-direction:column;gap:7px}
.fld>span{font-size:12px;color:var(--mut);letter-spacing:.06em;text-transform:uppercase;font-weight:500;display:flex;align-items:center;gap:8px}
.fld>span small{text-transform:none;letter-spacing:0;color:var(--dim);font-size:12px}
.iw{position:relative;display:flex;align-items:center}
.iw em{position:absolute;right:16px;font-style:normal;font-size:13px;color:var(--dim);pointer-events:none}
input.in{width:100%;font:inherit;color:var(--txt);background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:13px 16px;font-size:16px;outline:none;transition:.25s;color-scheme:dark}
input.in:focus{border-color:rgba(62,230,255,.6);box-shadow:0 0 0 4px rgba(62,230,255,.12);background:rgba(0,0,0,.45)}
input.in.mono{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:28px;font-weight:700;padding:14px 70px 14px 18px;letter-spacing:.02em}
.fld.vt input.in:focus{border-color:rgba(255,200,87,.6);box-shadow:0 0 0 4px rgba(255,200,87,.12)}
.fld.mt input.in:focus{border-color:rgba(161,139,255,.7);box-shadow:0 0 0 4px rgba(161,139,255,.14)}
.fld.vt input.in,.fld.mt input.in{font-family:'JetBrains Mono',monospace;font-size:17px;padding-right:56px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block}
.dot.vt{background:linear-gradient(135deg,var(--vt1),var(--vt2));box-shadow:0 0 10px var(--vt2)}
.dot.mt{background:linear-gradient(135deg,var(--mt1),var(--mt2));box-shadow:0 0 10px var(--mt1)}
.prev{border-radius:16px;padding:14px 16px;background:rgba(0,0,0,.25);border:1px dashed rgba(255,255,255,.1);font-size:13px;color:var(--mut);min-height:64px;display:flex;flex-direction:column;justify-content:center;gap:4px}
.prev .pv{font-size:28px;font-weight:700;letter-spacing:-.02em;background:linear-gradient(90deg,var(--c1),#c8b8ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.prev .pv small{font-size:15px;-webkit-text-fill-color:var(--mut)}
.prev.bad{border-color:rgba(255,93,122,.4);color:#ffb3c0;background:rgba(255,93,122,.06)}
.prev .tr{display:flex;gap:14px;flex-wrap:wrap;margin-top:2px}
.prev .tr span{display:inline-flex;align-items:center;gap:6px;color:var(--txt)}
.acts{display:flex;gap:10px}
.btn{font:inherit;border:0;cursor:pointer;border-radius:14px;padding:14px 20px;font-size:15px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:9px;transition:.25s;color:var(--txt)}
.btn .ic{width:18px;height:18px}
.btn.pri{flex:1;color:#061022;background:linear-gradient(135deg,var(--c1),#8fa8ff 55%,var(--c2));background-size:200% 100%;box-shadow:0 12px 34px -10px rgba(62,230,255,.7),inset 0 1px 0 rgba(255,255,255,.5)}
.btn.pri .ic{fill:#061022;stroke:none}
.btn.pri:hover{background-position:100% 0;transform:translateY(-1px);box-shadow:0 16px 40px -10px rgba(123,107,255,.8)}
.btn.pri:active{transform:translateY(1px) scale(.99)}
.btn.gh{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)}
.btn.gh:hover{background:rgba(255,255,255,.1)}
.btn.sm{padding:9px 14px;font-size:13px;border-radius:12px}
.btn:disabled{opacity:.5;cursor:default;pointer-events:none}
.btn.warn{background:rgba(255,93,122,.12);border:1px solid rgba(255,93,122,.3);color:#ffb3c0}
input.in.pin{width:110px;padding:9px 12px;font-size:16px;letter-spacing:.3em;text-align:center}
/* kpis */
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}
.kpi{overflow:hidden;padding:22px 22px 0;display:flex;flex-direction:column;min-height:196px}
.kpi-t{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--mut);font-weight:500;letter-spacing:.03em}
.kpi-i{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:linear-gradient(135deg,var(--a),var(--b));color:#061022;box-shadow:0 8px 24px -8px var(--a)}
.kpi-i .ic{width:18px;height:18px}
.kpi-v{font-size:40px;font-weight:700;letter-spacing:-.035em;margin-top:14px;line-height:1;font-variant-numeric:tabular-nums}
.kpi-v small{font-size:15px;color:var(--mut);font-weight:500;margin-left:6px;letter-spacing:0}
.kpi-s{font-size:13px;color:var(--mut);margin-top:8px}
.kpi-s b{color:var(--txt);font-weight:600}
.spark{margin:auto -22px 0;width:calc(100% + 44px);height:62px;display:block}
/* chart */
.chart{display:flex;flex-direction:column}
.ch{display:flex;gap:10px;height:300px;padding-bottom:30px}
.ch.sm{height:250px}
.ch-y{display:flex;flex-direction:column;justify-content:space-between;font-size:11px;color:var(--dim);text-align:right;min-width:34px;margin:-6px 0;font-variant-numeric:tabular-nums}
.ch-p{position:relative;flex:1}
.ch-g{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between;pointer-events:none}
.ch-g i{height:1px;background:linear-gradient(90deg,rgba(255,255,255,.08),rgba(255,255,255,.03))}
.ch-g i:last-child{background:rgba(255,255,255,.14)}
.avgck{display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:999px;border:1px solid rgba(255,200,87,.2);background:rgba(255,200,87,.04);color:#e6d3a3;font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;box-shadow:none;text-shadow:none;transition:color .15s,border-color .15s,background-color .15s}
.avgck i{width:13px;height:13px;border-radius:4px;border:1.5px solid rgba(255,200,87,.45);display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-style:normal;line-height:1;color:#e6d3a3}
.avgck.off{border-color:rgba(255,255,255,.1);background:none;color:var(--mut)}
.avgck.off i{border-color:rgba(255,255,255,.25)}
.ch-avg{position:absolute;left:0;right:0;border-top:1px dashed rgba(255,200,87,.55);pointer-events:none;z-index:2}
.ch-avg span{position:absolute;right:0;top:-22px;font-size:11px;color:var(--vt1);background:rgba(5,8,17,.8);padding:2px 8px;border-radius:8px;border:1px solid rgba(255,200,87,.25)}
.ch-b{position:absolute;inset:0;display:flex;align-items:flex-end;gap:clamp(2px,.6%,10px)}
.col{flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center;position:relative;cursor:pointer;border-radius:8px 8px 0 0;transition:background .2s}
.col:hover{background:linear-gradient(180deg,transparent,rgba(255,255,255,.04))}
.bar{width:100%;max-width:46px;border-radius:9px 9px 3px 3px;transform-origin:bottom;animation:grow .9s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i)*22ms);position:relative;transition:filter .2s}
@keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.bar.tot{background:linear-gradient(180deg,var(--c1),rgba(123,107,255,.85) 70%,rgba(123,107,255,.35));box-shadow:0 0 22px -4px rgba(62,230,255,.45)}
.bar.tot:before{content:'';position:absolute;left:0;right:0;top:0;height:3px;border-radius:9px;background:#fff;opacity:.55;filter:blur(1px)}
.bar.none{height:3px;background:rgba(255,255,255,.07);animation:none}
.bar.stk{display:flex;flex-direction:column;overflow:hidden;gap:2px}
.seg.vt{background:linear-gradient(180deg,var(--vt1),var(--vt2));box-shadow:0 0 18px -4px rgba(255,122,61,.6)}
.seg.mt{background:linear-gradient(180deg,var(--mt1),var(--mt2));border-radius:9px 9px 0 0}
.bar.stk .seg:first-child{border-radius:9px 9px 2px 2px}
.col:hover .bar{filter:brightness(1.25) saturate(1.2)}
.col.now .bar.tot{background:linear-gradient(180deg,#fff,var(--c1) 30%,var(--c2));box-shadow:0 0 30px -2px rgba(62,230,255,.8)}
.col.part .bar{opacity:.72}
.xl{position:absolute;bottom:-26px;left:50%;transform:translateX(-50%);font-size:11px;color:var(--dim);white-space:nowrap;text-align:center;line-height:1.1}
.xl small{display:block;font-size:9px;opacity:.7}
/* Časovni bloki: a day whose edited total and blocks differ gets a triangle; in edit mode a pencil under its date */
.btri{position:absolute;left:50%;transform:translateX(-50%);color:var(--vt1);line-height:0;pointer-events:none;z-index:3}
.btri .ic{width:14px;height:14px;filter:drop-shadow(0 0 6px rgba(255,200,87,.6))}
.ch.edb{padding-bottom:62px}
.bed{position:absolute;bottom:-58px;left:50%;transform:translateX(-50%);width:26px;height:26px;border-radius:8px;border:1px solid rgba(255,200,87,.45);background:rgba(255,200,87,.12);color:var(--vt1);cursor:pointer;display:grid;place-items:center;padding:0;z-index:3}
.bed .ic{width:13px;height:13px}
.bed:hover,.bed.on{background:rgba(255,200,87,.28)}
.bedit{margin-top:14px;padding:16px;border-radius:16px;border:1px solid rgba(255,200,87,.3);background:rgba(255,200,87,.05);display:flex;flex-direction:column;gap:12px}
.bedit-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}
.bedit-h b{font-size:14px}.bedit-h span{font-size:13px;color:var(--mut)}
.bedit-g{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.bedit-g .fld span{display:flex;align-items:center;gap:6px}
.bedit-g .fld span i{width:9px;height:9px;border-radius:3px;display:inline-block}
.bedit-g input.in{text-align:right;padding:8px 9px}
.bedit-f{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bedit-f .btn{flex:none;width:auto}
.bedit-f .bsum{flex:1;font-size:13px;color:var(--mut)}.bedit-f .bsum.ok{color:var(--ok)}.bedit-f .bsum.bad{color:var(--vt1)}
@media (max-width:640px){.bedit-g{grid-template-columns:repeat(3,minmax(0,1fr))}}
.col.now .xl{color:var(--c1);font-weight:600}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:22px}
.st{padding:14px 16px;border-radius:16px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.05)}
.st-l{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
.st-v{font-size:22px;font-weight:700;margin-top:4px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.st-v small{font-size:12px;color:var(--mut);font-weight:500;margin-left:4px}
.st-s{font-size:12px;color:var(--mut);margin-top:2px}
/* heat */
.heat{display:flex;flex-direction:column}
.hm-m{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:4px;margin-left:30px;font-size:10px;color:var(--dim);height:14px}
.hm{display:flex;gap:6px}
.hm-d{display:grid;grid-template-rows:repeat(7,1fr);gap:4px;font-size:9px;color:var(--dim);width:24px}
.hm-d span{display:flex;align-items:center}
.hm-g{flex:1;display:grid;grid-template-rows:repeat(7,1fr);grid-auto-flow:column;grid-auto-columns:1fr;gap:4px}
.cell{aspect-ratio:1;border-radius:5px;background:rgba(255,255,255,.04);transition:transform .15s;cursor:pointer}
.cell:hover{transform:scale(1.35);z-index:2;outline:1px solid rgba(255,255,255,.4)}
.cell.f{background:transparent;cursor:default}.cell.f:hover{transform:none;outline:0}
.cell.l1{background:rgba(62,230,255,.16)}.cell.l2{background:rgba(62,230,255,.36)}.cell.l3{background:rgba(90,170,255,.62)}.cell.l4{background:linear-gradient(135deg,#7ff0ff,#8a7bff);box-shadow:0 0 12px -2px rgba(62,230,255,.8)}
.cell.td{outline:2px solid var(--c1);outline-offset:1px}
.hm-leg{display:flex;align-items:center;gap:5px;justify-content:flex-end;font-size:11px;color:var(--dim);margin-top:12px}
.hm-leg .cell{width:12px;cursor:default}.hm-leg .cell:hover{transform:none;outline:0}
.wk{margin-top:22px;padding-top:18px;border-top:1px solid rgba(255,255,255,.06)}
.wk-t{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-bottom:12px}
.wk-b{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;align-items:end;height:96px}
.wk-c{display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end;cursor:pointer}
.wk-c i{width:100%;max-width:30px;border-radius:7px 7px 3px 3px;background:linear-gradient(180deg,#ff7ab8,rgba(192,123,255,.35));transform-origin:bottom;animation:grow .9s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i)*50ms)}
:host([out]) .wk-c i{background:linear-gradient(180deg,#e8ff6a,rgba(62,240,168,.35))}
.wk-c span{font-size:11px;color:var(--dim)}
/* tariff */
.tariff-b{display:grid;grid-template-columns:minmax(260px,340px) 1fr;gap:30px;align-items:center}
.donut-w{display:flex;flex-direction:column;align-items:center;gap:18px}
.dn{position:relative;width:230px;height:230px}
.dn svg{width:100%;height:100%;transform:rotate(-90deg);overflow:visible}
.dn circle{transition:stroke-dasharray 1.3s cubic-bezier(.2,.8,.2,1),stroke-dashoffset 1.3s cubic-bezier(.2,.8,.2,1)}
.dn-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.dn-v{font-size:34px;font-weight:700;letter-spacing:-.03em}
.dn-v small{font-size:14px;color:var(--mut);font-weight:500;margin-left:3px}
.dn-l{font-size:12px;color:var(--mut);margin-top:2px}
.tl{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%}
.tl-i{padding:14px;border-radius:16px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.06);position:relative;overflow:hidden}
.tl-i:after{content:'';position:absolute;left:0;top:0;bottom:0;width:3px}
.tl-i.vt:after{background:linear-gradient(var(--vt1),var(--vt2))}.tl-i.mt:after{background:linear-gradient(var(--mt1),var(--mt2))}
.tl-n{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--mut);font-weight:500}
.tl-n .ic{width:15px;height:15px}
.tl-i.vt .tl-n .ic{color:var(--vt1)}.tl-i.mt .tl-n .ic{color:var(--mt1)}
.tl-v{font-size:24px;font-weight:700;margin-top:6px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.tl-v small{font-size:12px;color:var(--mut);font-weight:500;margin-left:3px}
.tl-s{font-size:12px;color:var(--mut);margin-top:2px}
.legend{display:flex;gap:18px;font-size:13px;color:var(--mut)}
.legend span{display:inline-flex;align-items:center;gap:7px}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;padding:40px 20px;color:var(--mut);min-height:220px}
.empty .ic{width:42px;height:42px;color:var(--dim)}
.empty b{color:var(--txt);font-size:16px;font-weight:600}
/* log */
.tbl{width:100%;border-collapse:separate;border-spacing:0 6px;font-size:14px}
.tbl th{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);font-weight:500;text-align:right;padding:0 14px 4px}
.tbl th:first-child,.tbl td:first-child,.tbl th:nth-child(2),.tbl td:nth-child(2){text-align:left}
.tbl td{padding:12px 14px;background:rgba(255,255,255,.028);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.tbl tr td:first-child{border-radius:12px 0 0 12px}.tbl tr td:last-child{border-radius:0 12px 12px 0}
.tbl tbody tr{transition:.2s}.tbl tbody tr:hover td{background:rgba(255,255,255,.06)}
.tbl .mono{font-family:'JetBrains Mono',monospace;font-size:13px}
.tbl .use{font-weight:700;color:var(--c1)}
.tbl .neg{color:var(--bad)}
.tbl .m{color:var(--dim)}
.tbl .vtc{color:var(--vt1)}.tbl .mtc{color:var(--mt1)}
.rb{width:32px;height:32px;border-radius:10px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--mut);cursor:pointer;display:inline-grid;place-items:center;transition:.2s;margin-left:4px}
.rb .ic{width:15px;height:15px}
.rb:hover{color:var(--txt);background:rgba(255,255,255,.1)}
.rb.d:hover{color:var(--bad);border-color:rgba(255,93,122,.4)}
/* meters: the meter button (pill) in the header and its menu */
.mpill{height:42px;border-radius:14px;display:inline-flex;align-items:center;gap:8px;padding:0 11px;font:inherit;font-size:14px;font-weight:600;color:var(--txt);cursor:pointer;max-width:200px;background:linear-gradient(135deg,rgba(62,230,255,.10),rgba(123,107,255,.10));border:1px solid rgba(62,230,255,.35);transition:.2s;flex:none}
.mpill:hover{border-color:rgba(62,230,255,.7)}
.mpill.open{border-color:rgba(62,230,255,.75);box-shadow:0 0 0 3px rgba(62,230,255,.12)}
.mpill .ic{width:17px;height:17px;color:var(--c1)}.mpill .ic.cv{width:14px;height:14px;color:var(--mut)}
.mpill span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mdd{position:absolute;z-index:40;width:320px;padding:14px;border-radius:18px;background:linear-gradient(180deg,#0e152c,#0a0f22);border:1px solid rgba(255,255,255,.1);box-shadow:0 30px 60px -20px rgba(0,0,0,.85),0 0 0 1px rgba(62,230,255,.06);animation:rise .25s ease-out both}
.mdd[hidden]{display:none}
.mdd:before{content:'';position:absolute;top:-7px;left:var(--ax,50%);width:12px;height:12px;transform:rotate(45deg);background:#0e152c;border-left:1px solid rgba(255,255,255,.1);border-top:1px solid rgba(255,255,255,.1)}
.mlist{max-height:60vh;overflow-y:auto;overscroll-behavior:contain}
.mdd input.in{padding:10px 12px;font-size:15px;border-radius:12px}
.mdd .btn.pri .ic{fill:none;stroke:currentColor;stroke-width:2.4}
.merr{font-size:12.5px;color:#ffb3c0;background:rgba(255,93,122,.08);border:1px solid rgba(255,93,122,.3);border-radius:10px;padding:8px 10px;margin:10px 0 0;line-height:1.4}
.mrow{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border-radius:12px;cursor:pointer;text-align:left}
.mrow+.mrow,.mrow+.mren,.mren+.mrow{margin-top:2px}
.mrow:hover{background:rgba(255,255,255,.04)}
.mrow.cur{background:rgba(62,230,255,.08);box-shadow:inset 0 0 0 1px rgba(62,230,255,.22)}
.mrow .dt{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.18);flex:none}
.mrow.cur .dt{background:var(--c1);box-shadow:0 0 10px var(--c1)}
.mnm{flex:1;min-width:0}
.mnm b{display:block;font-size:14.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mnm small{display:block;font-size:12px;color:var(--dim);margin-top:1px;font-variant-numeric:tabular-nums}
.mren{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;background:rgba(0,0,0,.25);box-shadow:inset 0 0 0 1px rgba(62,230,255,.35)}
.mren.del{box-shadow:inset 0 0 0 1px rgba(255,93,122,.4)}
.mren.key{flex-wrap:wrap}.mren.key .mnm{flex:1 1 100%}.mren.key .mnm b{white-space:normal}
.mdd .mren.key .btn.pri{flex:1;width:auto;padding:9px 12px}
.mren input.in{padding:7px 10px;font-size:14px}
.mren small{display:block;font-size:12px;color:var(--dim);margin:4px 0 0 2px;line-height:1.4}
.mren .btn.sm{padding:8px 10px;flex:none}
.mren .btn.dz{color:#fff;background:linear-gradient(135deg,#ff5d7a,#ff7a3d)}
.rb.ok{color:#061022;background:linear-gradient(135deg,var(--c1),var(--c2));border-color:transparent}
.rb.dz{color:#ff9d8a}
.msep{height:1px;background:rgba(255,255,255,.07);margin:8px 2px}
.maddrow{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border-radius:12px;font:inherit;font-size:14px;font-weight:600;color:#9ff3ff;background:none;border:0;cursor:pointer}
.maddrow:hover{background:rgba(62,230,255,.06)}
.maddrow i{width:24px;height:24px;border-radius:8px;display:grid;place-items:center;border:1px dashed rgba(62,230,255,.5)}
.maddrow i .ic{width:14px;height:14px;stroke-width:2.4}
.mpill.msm{display:none}
@media (max-width:640px){.hdr > .mpill{display:none}.hdr .ttl.hasm .sub{display:none}.hdr .mpill.msm{display:inline-flex;height:28px;margin-top:5px;padding:0 9px;gap:6px;font-size:13px;border-radius:10px;max-width:100%}.hdr .mpill.msm .ic{width:14px;height:14px}.hdr .mpill.msm .ic.cv{width:12px;height:12px}.mdd{width:auto}.hdr .mpill{height:40px;max-width:120px;padding:0 9px}}
.tscroll{overflow-x:auto;margin:0 -6px;padding:0 6px}
.more{display:flex;justify-content:center;margin-top:10px}
/* tooltip, toast, drawer */
.tip{position:fixed;z-index:50;pointer-events:none;padding:10px 13px;border-radius:13px;background:rgba(10,14,30,.92);border:1px solid rgba(255,255,255,.12);box-shadow:0 20px 40px -10px rgba(0,0,0,.8);font-size:12.5px;line-height:1.55;color:var(--txt);opacity:0;transform:translateY(6px);transition:opacity .15s,transform .15s;max-width:260px}
.tip.on{opacity:1;transform:none;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.tip b{font-weight:600;font-size:13px}
.tip .m{color:var(--mut)}
.tip .r{display:flex;align-items:center;gap:7px}
.tip .v{margin-left:auto;padding-left:14px;font-weight:600;font-variant-numeric:tabular-nums}
.toast{position:fixed;left:50%;bottom:34px;z-index:60;transform:translate(-50%,30px);opacity:0;transition:.35s cubic-bezier(.2,.8,.2,1);padding:13px 20px;border-radius:16px;background:linear-gradient(135deg,rgba(20,30,60,.95),rgba(30,20,60,.95));border:1px solid rgba(62,230,255,.35);box-shadow:0 20px 50px -10px rgba(62,230,255,.4);font-size:14px;display:flex;align-items:center;gap:10px;pointer-events:none}
.toast.on{opacity:1;transform:translate(-50%,0)}
.toast .ic{width:18px;height:18px;color:var(--c1);fill:var(--c1);stroke:none}
.toast .ic.st{fill:none;stroke:var(--c1)}.toast.wait .ic{animation:spin 1s linear infinite}
.toast div{font-weight:600}
.toast small{display:block;font-size:12.5px;font-weight:400;color:var(--mut);margin-top:3px}
.btn .ic.spin{animation:spin 1s linear infinite}
.dw-bg{position:fixed;inset:0;z-index:70;background:rgba(2,4,10,.55);opacity:0;pointer-events:none;transition:.3s}
.dw{position:fixed;top:0;right:0;bottom:0;z-index:71;width:min(420px,100vw);background:linear-gradient(180deg,#0c1228,#070a16);border-left:1px solid rgba(255,255,255,.08);box-shadow:-30px 0 80px -20px rgba(0,0,0,.8);transform:translateX(105%);transition:transform .45s cubic-bezier(.2,.8,.2,1);padding:26px;overflow-y:auto;display:flex;flex-direction:column;gap:20px}
.dw-open .dw-bg{opacity:1;pointer-events:auto;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}.dw-open .dw{transform:none}
.dw h3{margin:0;font-size:20px;font-weight:600}
.dw-s{padding:18px;border-radius:18px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);display:flex;flex-direction:column;gap:12px}
.dw-t{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);font-weight:600}
.opt{display:flex;gap:12px;align-items:flex-start;padding:12px;border-radius:14px;border:1px solid rgba(255,255,255,.07);cursor:pointer;transition:.2s}
.opt:hover{background:rgba(255,255,255,.04)}
.opt.on{border-color:rgba(62,230,255,.5);background:rgba(62,230,255,.07)}
.opt i{width:18px;height:18px;border-radius:50%;border:2px solid var(--dim);flex:none;margin-top:2px}
.opt.on i{border-color:var(--c1);box-shadow:inset 0 0 0 3px #0c1228,inset 0 0 0 9px var(--c1)}
.opt b{font-weight:600;font-size:14px;display:block}
.opt span{font-size:12.5px;color:var(--mut)}
.dw-note{font-size:12.5px;color:var(--mut);line-height:1.5}
.row{display:flex;gap:10px;flex-wrap:wrap}
@media (max-width:1280px){.s7,.s5,.s8,.s4{grid-column:span 12}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.heat .hm-g,.heat .hm-m{max-width:none}}
@media (max-width:860px){.tariff-b{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}.hero{grid-template-columns:1fr}.gwrap{margin:30px auto 0;width:230px;height:230px}}
@media (max-width:640px){.kpis{grid-template-columns:1fr}.two{grid-template-columns:1fr}.ch-b.dense .col:nth-child(even) .xl{visibility:hidden}.card{padding:18px;border-radius:22px}.od,.od-sep{font-size:21px}.hdr .chip{display:none}}
/* moj elektro: 15-min profile + tariff blocks */
.prof{display:flex;flex-direction:column}
.pkrow{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.pk-v{font-size:48px;font-weight:700;letter-spacing:-.035em;line-height:1;font-variant-numeric:tabular-nums}
.pk-v small{font-size:16px;color:var(--mut);margin-left:5px;font-weight:500;letter-spacing:0}
.pk-s{font-size:13px;color:var(--mut);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
/* 15-minute chart: [<] [date] [>] between the title and the kW badge, and the small calendar under the date */
.pnav{position:relative;display:flex;align-items:center;gap:8px;margin-left:auto}
.pn-a{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;padding:0;cursor:pointer;color:var(--txt);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);transition:.2s;flex:none}
.pn-a:hover:not(:disabled){border-color:var(--c1);color:var(--c1)}
.pn-a:disabled{opacity:.28;cursor:default}
.pn-a .ic{width:16px;height:16px}.pn-a.nx .ic{transform:scaleX(-1)}
.pn-d{height:38px;border-radius:12px;display:inline-flex;align-items:center;gap:8px;padding:0 12px;font:inherit;font-size:13.5px;font-weight:600;color:var(--txt);cursor:pointer;white-space:nowrap;background:linear-gradient(135deg,rgba(62,230,255,.10),rgba(123,107,255,.10));border:1px solid rgba(62,230,255,.35);transition:.2s}
.pn-d:hover,.pn-d.open{border-color:rgba(62,230,255,.7)}
.pn-d .ic{width:16px;height:16px;color:var(--c1)}.pn-d .ic.cv{width:13px;height:13px;color:var(--mut);transition:transform .2s}.pn-d.open .ic.cv{transform:rotate(180deg)}
:host([out]) .pn-d{background:linear-gradient(135deg,rgba(62,240,168,.10),rgba(232,255,106,.08));border-color:rgba(62,240,168,.35)}
:host([out]) .pn-d:hover,:host([out]) .pn-d.open{border-color:rgba(62,240,168,.7)}
.pcal{position:absolute;top:calc(100% + 12px);right:0;z-index:40;width:300px;padding:14px;border-radius:18px;background:linear-gradient(180deg,#0e152c,#0a0f22);border:1px solid rgba(255,255,255,.1);box-shadow:0 30px 60px -20px rgba(0,0,0,.85),0 0 0 1px rgba(62,230,255,.06);animation:rise .25s ease-out both}
.cal-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;font-size:14px;font-weight:600}
.cal-h .pn-a{width:32px;height:32px;border-radius:10px}
.cal-g{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center}
.cal-g i{font-style:normal;font-size:11px;color:var(--dim);padding:2px 0 4px;letter-spacing:.04em}
.cal-d,.cal-x{height:34px;border-radius:10px;font:inherit;font-size:13px;display:grid;place-items:center;font-variant-numeric:tabular-nums}
.cal-d{cursor:pointer;color:var(--txt);background:rgba(255,255,255,.05);border:1px solid transparent;padding:0;transition:.15s}
.cal-d:hover{border-color:var(--c1)}
.cal-d.on{background:var(--c1);color:#06101f;font-weight:700;box-shadow:0 6px 18px -6px var(--c1)}
.cal-x{color:var(--dim);opacity:.4}
@media (min-width:641px){.ch-h:has(.pnav){flex-wrap:nowrap}.ch-h:has(.pnav)>div:first-child{flex:1 1 0;min-width:0}}
@media (max-width:640px){.pnav{order:3;width:100%;margin-left:0}.pn-d{flex:1;justify-content:center}.pcal{left:0;right:0;width:auto}}
.bchip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;color:var(--c);background:rgba(255,255,255,.06);border:1px solid var(--c)}
.bchip:before{content:'';width:7px;height:7px;border-radius:50%;background:var(--c)}
.pch{position:relative;display:flex;align-items:flex-end;gap:1px;height:170px;margin-top:18px;border-bottom:1px solid rgba(255,255,255,.14)}
/* the 15-minute card is as tall as the card next to it (the hero): the chart takes the extra height */
.prof .pch{flex:1 1 170px;height:auto;min-height:170px}
.pc{flex:1;height:100%;display:flex;align-items:flex-end;cursor:pointer}
.pc i{display:block;width:100%;border-radius:2px 2px 0 0;min-height:2px;opacity:.85;transform-origin:bottom;animation:grow .8s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i)*6ms)}
.pc:hover i{opacity:1;filter:brightness(1.3)}
.pc.top i{opacity:1;box-shadow:0 0 14px var(--c)}
.bpk span.over{color:#ff6b81}
.bpk span.wa{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bpk span small.ag{font-size:11px;color:var(--dim);font-weight:500}
.xline{font-size:12px;color:var(--mut);margin-top:12px}
.xline b{color:#ff6b81;font-weight:600}
@media (max-width:640px){.pnote .agn{display:block}}
.pxl{position:relative;height:16px;margin-top:6px;font-size:10px;color:var(--dim)}
.pxl span{position:absolute;transform:translateX(-50%);white-space:nowrap}
.bpk{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:14px}
.bpk>div{padding:10px 10px 9px;border-radius:12px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.06);border-top:3px solid var(--c);min-width:0}
.bpk b{display:block;font-size:10.5px;color:var(--mut);font-weight:500;letter-spacing:.06em;text-transform:uppercase}
.bpk span{display:block;font-size:17px;font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}
.bpk em{display:block;font-style:normal;font-size:10.5px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pnote,.bnote{font-size:12px;color:var(--mut);line-height:1.5;margin-top:12px}
.blk-b{display:grid;grid-template-columns:minmax(260px,380px) 1fr;gap:30px;align-items:start}
.bsub{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin:0 0 6px}
.bsub+.brow{margin-top:4px}
.brow{display:grid;grid-template-columns:58px 1fr auto;gap:10px;align-items:center;margin:9px 0;font-size:13px;color:var(--mut)}
.brow .bt{height:10px;border-radius:6px;background:rgba(255,255,255,.05);overflow:hidden}
.brow .bt i{display:block;height:100%;border-radius:6px}
.brow .bv{font-variant-numeric:tabular-nums;color:var(--txt);font-weight:600;min-width:112px;text-align:right}
.brow .bv small{color:var(--mut);font-weight:400;margin-left:6px}
.bgap{height:18px}
.blegend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--mut)}
.blegend span{display:inline-flex;align-items:center;gap:6px}
.blegend i{width:9px;height:9px;border-radius:3px}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.tbl tr.me td:nth-child(2){color:#4cc9f0;font-size:12px}
.tbl .lnote{display:block;font-size:11px;margin-top:2px}
.tbl input.in.ed{width:92px;padding:6px 9px;font-size:14px;text-align:right}
.tbl tr.man td:nth-child(5){color:var(--vt1)}
.tbl .vir-s{display:none}
@media (max-width:640px){.tbl .vcol{display:none}.tbl .vir-s{display:block;font-size:11px;margin-top:3px;color:var(--dim);white-space:normal}.tbl tr.me .vir-s{color:#4cc9f0}}
.fold{display:flex;align-items:center;justify-content:space-between;gap:14px}
@media (max-width:860px){.blk-b{grid-template-columns:1fr}.bpk{grid-template-columns:repeat(3,1fr)}}
/* grid in / grid out */
.gsw{display:inline-flex;padding:4px;border-radius:14px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.08)}
.gsw button{border:0;background:none;color:var(--mut);font:inherit;font-size:13px;font-weight:600;padding:8px 14px;border-radius:10px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:.25s}
.gsw button .ic{width:15px;height:15px}
.gsw button:hover{color:var(--txt)}
.gsw button.on.in{color:#fff;background:linear-gradient(135deg,#ff5d5d,#ff8c42);box-shadow:0 6px 20px -6px rgba(255,110,70,.7)}
.gsw button.on.out{color:#061022;background:linear-gradient(135deg,#3ef0a8,#e8ff6a);box-shadow:0 6px 20px -6px rgba(120,240,140,.7)}
/* Net (Neto): the round button between Grid in and Grid out, in the logo's blue; 38 px, 5% taller than the others */
.gsw{align-items:center}
.gsw button.m{position:relative;width:38px;height:38px;padding:0;margin:-2px 5px;border-radius:50%;justify-content:center;flex:none;color:#6fe9ff;
background:radial-gradient(circle at 50% 0%,rgba(62,230,255,.22),transparent 70%),#0a1022;box-shadow:inset 0 0 0 1.5px rgba(62,230,255,.55),0 0 16px -6px rgba(62,230,255,.6)}
.gsw button.m:after{content:'';position:absolute;inset:-4px;border-radius:50%;border:1px solid rgba(123,107,255,.25);pointer-events:none}
.gsw button.m .ic{width:22px;height:22px;stroke-width:1.8}
.gsw button.m:hover{color:#bdf6ff;box-shadow:inset 0 0 0 1.5px rgba(62,230,255,.9),0 0 22px -4px rgba(62,230,255,.8)}
.gsw button.m.on{color:#061022;background:linear-gradient(135deg,var(--c1),var(--c2));box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 8px 26px -6px rgba(62,230,255,.75),0 0 0 3px rgba(62,230,255,.14)}
.gsw button.m.on:after{border-color:rgba(123,107,255,.45)}
.hdr .gsw button.m{flex:none}
.np{color:#3ef0a8}.nn{color:#ff7a4d}
.nt-hero{display:grid;grid-template-columns:1fr auto;gap:24px;overflow:hidden;min-height:330px}
.nt-hero:after{content:'';position:absolute;width:420px;height:420px;right:-90px;top:-140px;border-radius:50%;background:radial-gradient(circle,rgba(62,240,168,.18),transparent 65%);pointer-events:none}
.nt-hero.minus:after{background:radial-gradient(circle,rgba(255,122,77,.18),transparent 65%)}
.nt-hero .empty{grid-column:1/-1}
.bignum.nt-p{background:linear-gradient(180deg,#fff 10%,#b5ffd9 55%,#3ef0a8);-webkit-background-clip:text;background-clip:text;filter:drop-shadow(0 6px 30px rgba(62,240,168,.35))}
.bignum.nt-n{background:linear-gradient(180deg,#fff 10%,#ffc9a8 55%,#ff7a4d);-webkit-background-clip:text;background-clip:text;filter:drop-shadow(0 6px 30px rgba(255,122,77,.35))}
.nt-say{font-size:16px;color:#cfd6f5;margin:6px 0 22px;max-width:540px;line-height:1.45}
.nt-say b{color:#fff;font-weight:600}
.nt-q{font-size:12px;color:var(--dim)}
.nt-tug{max-width:560px}
.nt-tl{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:var(--mut);margin-top:8px}
.nt-tl span{display:inline-flex;align-items:center;gap:6px}
.nt-tl b{font-size:17px;font-weight:600;color:var(--txt);margin-left:4px}
.nt-tl span:first-child .ic{color:#ff7a4d}.nt-tl span:last-child .ic{color:#3ef0a8}
.nt-split{display:flex;gap:3px;height:28px;border-radius:10px;overflow:hidden;background:rgba(255,255,255,.06);font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
.nt-split .a{flex:none;box-sizing:border-box;display:flex;align-items:center;padding-left:10px;color:#3a0d05;background:linear-gradient(90deg,#ff5d5d,#ff8c42)}
.nt-split .b{flex:1;box-sizing:border-box;display:flex;align-items:center;justify-content:flex-end;padding-right:10px;color:#06301f;background:linear-gradient(90deg,#3ef0a8,#e8ff6a)}
.nt-split .e{padding:0}
.pill.nt-b{color:#aee9ff;background:rgba(62,230,255,.08);border-color:rgba(62,230,255,.25)}
.pill .ic{width:14px;height:14px}
.nt-ring{position:relative;width:270px;height:270px;align-self:center}
.nt-ring svg{width:100%;height:100%;overflow:visible}
.nt-ring .c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none}
.nt-ring .v{font-size:46px;font-weight:700;letter-spacing:-.03em}.nt-ring .v small{font-size:20px;color:var(--mut);font-weight:500}
.nt-ring .l{font-size:12px;color:var(--mut);letter-spacing:.1em;text-transform:uppercase;margin-top:2px}
.nt-ring .k{display:flex;gap:10px;margin-top:10px;font-size:12px;color:var(--mut)}
.nt-ring .k i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
.nt-svg{width:100%;display:block;overflow:visible}
.nt-glow{filter:drop-shadow(0 0 6px rgba(62,240,168,.6))}
.nt-gp{filter:drop-shadow(0 0 8px rgba(62,240,168,.55))}.nt-gn{filter:drop-shadow(0 0 8px rgba(255,110,70,.5))}
.nt-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}
.nt-kpi{padding:18px 20px}
.nt-kl{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
.nt-cmp{letter-spacing:0;text-transform:none;font-size:12px;color:var(--mut);white-space:nowrap}
.nt-kv{font-size:34px;font-weight:700;letter-spacing:-.03em;margin-top:8px;font-variant-numeric:tabular-nums}
.nt-kv small{font-size:15px;color:var(--mut);font-weight:500;margin-left:4px}
.nt-ks{font-size:12.5px;color:var(--mut);margin-top:2px}.nt-cs{margin-top:10px}
.nt-sp{position:relative;display:flex;gap:2px;height:44px;margin-top:10px}
.nt-sp:before{content:'';position:absolute;left:0;right:0;top:50%;border-top:1px solid rgba(255,255,255,.12)}
.nt-sp i{position:relative;flex:1;min-width:0}
.nt-sp b{position:absolute;left:12%;right:12%;border-radius:2px;opacity:.9}
.nt-cov{height:6px;border-radius:999px;background:rgba(255,255,255,.07);margin-top:14px;overflow:hidden}
.nt-cov i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--c1),var(--c2))}
.nt-leg{margin-top:12px}.nt-leg i{width:10px;height:10px;border-radius:3px;display:inline-block}
.nt-clock{width:100%;max-width:330px;display:block;margin:0 auto;overflow:visible}
.nt-yv{text-align:right}.nt-yv>div:first-child{font-size:30px;font-weight:700;letter-spacing:-.02em}.nt-yv small{font-size:14px;color:var(--mut);font-weight:500}
.nt-rec{display:grid;gap:10px}
.nt-rec>div{display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:16px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.05)}
.nt-ri{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;flex:none;color:var(--c);background:color-mix(in srgb,var(--c) 13%,transparent)}
.nt-ri .ic{width:19px;height:19px}
.nt-rt{flex:1;min-width:0}.nt-rt b{display:block;font-size:13px;font-weight:500;color:var(--mut)}.nt-rt span{font-size:12px;color:var(--dim)}
.nt-rv{font-size:20px;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
.nt-rv small{font-size:12px;font-weight:500;color:var(--mut);margin-left:4px}
.ynav{display:flex;align-items:center;gap:8px;margin-left:auto}
.nt-cm{display:grid;grid-template-columns:repeat(var(--w),minmax(0,1fr));gap:3px;margin:0 0 6px 34px;max-width:calc(var(--w) * 24px);font-size:11px;color:var(--dim)}
.nt-cm span{white-space:nowrap;overflow:visible}
.nt-cal{display:grid;grid-template-columns:28px minmax(0,calc(var(--w) * 24px - 34px));gap:6px}
.nt-cd{display:grid;grid-template-rows:repeat(7,1fr);gap:3px;font-size:10.5px;color:var(--dim)}.nt-cd span{display:flex;align-items:center}
.nt-cg{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,1fr);grid-template-columns:repeat(var(--w),minmax(0,1fr));gap:3px}
.nt-cg i{aspect-ratio:1;border-radius:3px;display:block;background:rgba(255,255,255,.04)}.nt-cg i.f{background:none}
.nt-scale{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--mut);margin-top:12px}
.nt-scale .g{flex:1;max-width:220px;height:8px;border-radius:999px;background:linear-gradient(90deg,#ff5d5d,#ff8c42 30%,#2a3150 50%,#3ef0a8 70%,#e8ff6a)}
.nt-tw{overflow-x:auto}
.nt-tbl{width:100%;border-collapse:collapse;font-size:14px}
.nt-tbl th{font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);font-weight:500;text-align:right;padding:0 10px 10px}
.nt-tbl td{padding:11px 10px;border-top:1px solid rgba(255,255,255,.05);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.nt-tbl th:first-child,.nt-tbl td:first-child{text-align:left}
.nt-tbl .nt-nv{font-weight:600}
.nt-tbl td.nt-bar{width:34%}
.nt-dv{position:relative;height:10px}
.nt-dv:before{content:'';position:absolute;left:50%;top:-4px;bottom:-4px;width:1px;background:rgba(255,255,255,.2)}
.nt-dv i{position:absolute;top:0;bottom:0;border-radius:3px}
.tip .nt-d{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
@media (max-width:1280px){.nt-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:860px){.nt-hero{grid-template-columns:1fr}.nt-ring{justify-self:center;width:240px;height:240px}}
@media (max-width:640px){.nt-kpis{gap:12px}.nt-kpi{padding:16px}.nt-kv{font-size:27px}.nt-tbl .nt-bar{display:none}.nt-tbl td,.nt-tbl th{padding-left:6px;padding-right:6px}}
:host([lite]) .nt-hero:after{display:none}
:host([lite]) .bignum.nt-p,:host([lite]) .bignum.nt-n,:host([lite]) .nt-glow,:host([lite]) .nt-gp,:host([lite]) .nt-gn,:host([lite]) .nt-arc{filter:none!important}
.grid{transition:opacity .22s ease}
.grid.fade{opacity:0}
:host([out]){--c1:#3ef0a8}
:host([out]) .logo{background:linear-gradient(135deg,#3ef0a8,#e8ff6a);box-shadow:0 10px 40px -8px rgba(62,240,168,.6),inset 0 1px 0 rgba(255,255,255,.4)}
:host([out]) .logo:after{border-color:rgba(62,240,168,.35)}
:host([out]) .b1{background:#12c97a}:host([out]) .b2{background:#a9b61c}
:host([out]) .bignum{background:linear-gradient(180deg,#fff 20%,#b5ffd8 70%,#3ef0a8);-webkit-background-clip:text;background-clip:text;filter:drop-shadow(0 6px 30px rgba(62,240,168,.35))}
:host([out]) .hero:after{background:radial-gradient(circle,rgba(62,240,168,.18),transparent 65%)}
.h-t .go{color:#c4ff6a}
.bpk.o3{grid-template-columns:repeat(3,1fr)}
.bpk.o3 span{font-size:18px}
.pnote i.sq{display:inline-block;width:9px;height:9px;border-radius:2px;background:#3ef0a8;margin-right:6px}
/* lite mode (slow devices): no blur, no animation, no glow, system fonts */
:host([lite]){font-family:ui-sans-serif,system-ui,Roboto,'Segoe UI',sans-serif}
:host([lite]) *,:host([lite]) *:before,:host([lite]) *:after{animation:none!important;transition:none!important;text-shadow:none!important}
:host([lite]) .blob,:host([lite]) .root:before,:host([lite]) .card:before,:host([lite]) .hero:after,:host([lite]) .logo:after,:host([lite]) .g-spin{display:none}
:host([lite]) .card{backdrop-filter:none;-webkit-backdrop-filter:none;background:#0e1428;box-shadow:none}
:host([lite]) .tip,:host([lite]) .dw-bg{backdrop-filter:none;-webkit-backdrop-filter:none}
:host([lite]) .bignum,:host([lite]) .g-val,:host([lite]) .dn circle{filter:none!important}
:host([lite]) .pc.top i,:host([lite]) .logo,:host([lite]) .chip i,:host([lite]) .dot,:host([lite]) .btn.pri,:host([lite]) .kpi-i,:host([lite]) .bar.tot,:host([lite]) .seg.vt,:host([lite]) .cell.l4,:host([lite]) .seg-tabs button.on,:host([lite]) .toast,:host([lite]) .odo,:host([lite]) .dw{box-shadow:none!important}
:host([lite]) .od,:host([lite]) .od-sep,:host([lite]) input.in.mono,:host([lite]) .fld.vt input.in,:host([lite]) .fld.mt input.in,:host([lite]) .tbl .mono{font-family:ui-monospace,'Roboto Mono',monospace}
/* Popolno Test: the full look without what makes phones hot and slow. The glow blobs stay where they are but as soft
   gradients instead of a live blur, and they do not drift; the cards keep their glass tint without blurring what is
   behind them live. */
:host([phone]) .blob{filter:none;animation:none;opacity:.62;transform:scale(1.5)}
:host([phone]) .b1{background:radial-gradient(closest-side,rgba(31,182,255,.7),rgba(31,182,255,.28) 45%,rgba(31,182,255,0))}
:host([phone]) .b2{background:radial-gradient(closest-side,rgba(106,75,255,.7),rgba(106,75,255,.28) 45%,rgba(106,75,255,0))}
:host([phone]) .b3{opacity:.26;background:radial-gradient(closest-side,rgba(255,106,61,.7),rgba(255,106,61,.28) 45%,rgba(255,106,61,0))}
:host([phone][out]) .b1{background:radial-gradient(closest-side,rgba(18,201,122,.7),rgba(18,201,122,.28) 45%,rgba(18,201,122,0))}
:host([phone][out]) .b2{background:radial-gradient(closest-side,rgba(169,182,28,.7),rgba(169,182,28,.28) 45%,rgba(169,182,28,0))}
:host([phone]) .card{backdrop-filter:none;-webkit-backdrop-filter:none;background:linear-gradient(180deg,rgba(255,255,255,.065),rgba(255,255,255,.02)),rgba(11,16,33,.3)}
:host([phone]) .tip.on,:host([phone]) .dw-open .dw-bg{backdrop-filter:none;-webkit-backdrop-filter:none}
`;

  /* ---------- Net view helpers ---------- */
  const NP = '#3ef0a8', NN = '#ff7a4d'; // plus (more grid out) / minus (more grid in)
  const NET_IDS = ['n-hero', 'n-day', 'n-kpis', 'n-chart', 'n-clock', 'n-year', 'n-rec', 'n-cal', 'n-log'];
  const NORM_IDS = ['hero', 'prof', 'kpis', 'chart', 'heat', 'tariff', 'blocks', 'log', 'form'];
  const nsg = v => { const r = Math.abs(v) < 0.005 ? 0 : v; return (r > 0 ? '+' : '') + fk(r); };
  const ncl = v => v >= 0 ? 'np' : 'nn';
  // a tooltip: bold title, then rows [label, value, colour dot]
  const ntip = (title, rows) => esc(`<b>${title}</b>` + rows.map(([l, v, c]) => `<div class="r">${c ? `<i class="nt-d" style="background:${c}"></i>` : ''}${l}${v !== '' ? `<span class="v">${v}</span>` : ''}</div>`).join(''));

  /* ---------- card ---------- */
  class DailyEnergyCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._data = { entries: [], settings: { ...DEF } };
      const y = new Date(); y.setDate(y.getDate() - 1);
      this._ui = { range: 'day', trange: 'day', all: false, impFrom: `${y.getFullYear()}-01-01`, impTo: iso(y) };
      this._demo = null; this._loaded = false; this._shown = 0; this._sync = null;
      this._dirty = false; this._me = false; this._q15 = {}; this._q15o = {}; this._pinOk = '';
      this._meters = []; this._mm = null;
      const view = LS.get('daily-energy-view'); this._view = view === 'out' || view === 'net' ? view : 'in';
    }
    setConfig(c) { this._config = c || {}; }
    getCardSize() { return 24; }
    set hass(h) {
      const first = !this._hass; this._hass = h;
      if (first) { this._shell(); this._load(); }
      else if (this._applyLang() && this._loaded) this._renderAll(true);
    }
    // Settings > Language: Automatic (the Home Assistant language: Slovenian if it is Slovenian, otherwise English),
    // English or Slovenščina, saved per device. Returns true when the language changed.
    _langPref() { const v = LS.get('daily-energy-lang'); return v === 'en' || v === 'sl' ? v : 'auto'; }
    _applyLang() {
      const p = this._langPref(), h = this._hass;
      const ha = (h && ((h.locale && h.locale.language) || h.language)) || '';
      const l = p === 'auto' ? (/^sl/i.test(ha) ? 'sl' : 'en') : p;
      setLang(l);
      const changed = l !== this._lang; this._lang = l; return changed;
    }
    // Settings > This device: Light, Full or Automatic (light on tablets and on devices that ask for reduced motion)
    _mode() { const v = LS.get('daily-energy-mode'); return v === 'light' || v === 'full' ? v : 'auto'; }
    _applyLite() {
      const m = this._mode(), lite = m === 'light' || (m === 'auto' && (isTablet() || reducedMotion()));
      if (lite !== this._lite) { this._lite = lite; this.toggleAttribute('lite', lite); }
      // Samodejno on a phone: the full look, drawn the way phones can keep up with
      const phone = !lite && m === 'auto' && isPhone();
      if (phone !== this._phone) { this._phone = phone; this.toggleAttribute('phone', phone); }
      // Tablets: the hero card as before the estimated bill (counter left, gauge right); the bill is a button in the
      // header that opens it in a window
      const tablet = isTablet();
      if (tablet !== this._tablet) { this._tablet = tablet; this.toggleAttribute('tablet', tablet); }
      if (!lite) loadFonts();
    }
    // Settings > Grid: "Grid in & Grid out" adds the Grid in / Grid out switch; the chosen view is kept per device
    _gridBoth() { return !!(this._me && !this._demo && this._data.settings && this._data.settings.grid === 'both'); }
    _isOut() { return this._view === 'out' && this._gridBoth(); }
    _setView(v) {
      if (v === this._view) return;
      LS.set('daily-energy-view', v);
      const g = this.shadowRoot.querySelector('.grid');
      const swap = () => { this._view = v; this._shown = 0; this._buildProf(false); this._renderAll(); };
      if (this._lite || !g) { swap(); return; }
      g.classList.add('fade');
      setTimeout(() => { swap(); requestAnimationFrame(() => requestAnimationFrame(() => g.classList.remove('fade'))); }, 230);
    }
    connectedCallback() { this._shell(); if (this._hass && this._sync === 'shared' && !this._unsub) this._load(); }
    disconnectedCallback() { if (this._unsub) { this._unsub(); this._unsub = null; } if (this._unsubEntries) { this._unsubEntries(); this._unsubEntries = null; } }

    /* ----- data: the daily_energy_mojelektro integration (websocket) ----- */
    _ws(cmd, data = {}) { return this._hass.callWS({ type: `${WS}/${cmd}`, entry_id: this._entry, ...data }); }
    async _load() {
      try {
        await this._loadMeters();
        if (!this._meters.length) throw new Error('not set up');
        // the meter picked on this device, else the panel's / card's own, else the first
        const has = id => id && this._meters.some(m => m.id === id), saved = LS.get('daily-energy-meter'), cfg = (this._config || {}).entry_id;
        await this._subscribe(has(saved) ? saved : has(cfg) ? cfg : this._meters[0].id);
        this._sync = 'shared';
        this._watchEntries();
      } catch (e) {
        this._sync = 'none'; this._applyLite();
        this._data = { entries: [], me: [], meOut: [], settings: { ...DEF } }; this._loaded = true; this._renderAll();
      }
    }
    // the meters (one integration entry each), in the order they were added: [{id, eimm, name}]; users who are not
    // administrators get them from the entries command (they can switch, not rename, change the token or remove)
    async _loadMeters() {
      let L;
      try { L = await this._hass.callWS({ type: `${WS}/meters/list` }); }
      catch (e) { L = (await this._hass.callWS({ type: `${WS}/entries` })).map(x => ({ id: x.entry_id, eimm: x.eimm || '', name: x.name || '' })); }
      this._meters = Array.isArray(L) ? L : [];
    }
    async _subscribe(id) {
      if (this._unsub) { try { this._unsub(); } catch (e) { } this._unsub = null; }
      this._entry = id;
      this._unsub = await this._hass.connection.subscribeMessage(m => this._onData(m), { type: `${WS}/subscribe`, entry_id: id });
    }
    // a meter added, removed or renamed in Devices & services: load the list again (administrators only)
    async _watchEntries() {
      if (this._unsubEntries) return;
      try {
        this._unsubEntries = await this._hass.connection.subscribeMessage(msgs => {
          if (Array.isArray(msgs) && msgs.some(m => m && m.type && m.entry && m.entry.domain === WS)) this._refreshMeters();
        }, { type: 'config_entries/subscribe' });
      } catch (e) { }
    }
    async _refreshMeters() {
      try { await this._loadMeters(); } catch (e) { return; }
      if (this._meters.length && !this._meters.some(m => m.id === this._entry)) { await this._switchMeter(this._meters[0].id, true); return; }
      this._renderHdr(); this._renderMM();
    }
    // another meter: menu, edit forms and Settings close, the grid fades out and back in with that meter's data
    async _switchMeter(id, keepMenu = false) {
      if (!id) return;
      if (!keepMenu) this._mm = null;
      if (id === this._entry) { this._renderMM(); this._renderHdr(); return; }
      LS.set('daily-energy-meter', id);
      this._ui.editDay = null; this._ui.blEdit = null; this._ui.pin = false; this._dirty = false; this._pinOk = '';
      this._pday = this._nday = this._pcalM = this._ncalM = this._nrecY = null; this._pcal = this._ncal = false;
      if (this._dwOpen) this._drawer(false);
      this._renderMM();
      const g = this.shadowRoot.querySelector('.grid');
      if (g && !this._lite) { g.classList.add('fade'); this._fadeIn = g; }
      try { await this._subscribe(id); }
      catch (e) { if (g) g.classList.remove('fade'); this._fadeIn = null; this._toast(t('Could not save — {0}', e && e.message || e)); }
      this._renderHdr();
    }
    _onData(s) {
      this._snap = s;
      const ok = d => /^\d{4}-\d{2}-\d{2}$/.test(d);
      const me = Object.entries(s.days || {}).filter(([d, r]) => ok(d) && r && (typeof r.u === 'number' || Array.isArray(r.b))).map(([d, r]) => ({ ...r, d, me: true }));
      const entries = Object.entries(s.manual || {}).filter(([d, r]) => ok(d) && r && typeof r.t === 'number').map(([d, r]) => {
        const e = { d, t: r.t }; if (r.vt != null) e.vt = r.vt; if (r.mt != null) e.mt = r.mt; return e;
      });
      // grid out (energy sent to the grid) is stored in the same day records as o, ovt, omt, omo, omvt, ommt
      const meOut = Object.entries(s.days || {}).filter(([d, r]) => ok(d) && r && typeof r.o === 'number')
        .map(([d, r]) => ({ d, me: true, u: r.o, vt: r.ovt, mt: r.omt, mo: r.omo, mvt: r.omvt, mmt: r.ommt, c: r.oc }));
      this._q15 = s.q15 || {}; this._q15o = s.q15o || {}; this._edits = s.edits || {}; this._hasPin = !!s.has_pin;
      // older 15-minute days: the months kept in Home Assistant, and those already loaded (for this meter)
      if (!this._archData || this._archFor !== s.meter) { this._archFor = s.meter; this._archData = { q15: {}, q15o: {} }; this._archLoaded = new Set(); }
      // every archived day (dates only): the calendar and the arrows offer them, their data loads when picked
      const ad = s.q15_days || {}, dates = o => Object.entries(o || {}).flatMap(([m, ds]) => (Array.isArray(ds) ? ds : []).map(d => `${m}-${pad(d)}`)).sort();
      this._archDays = { q15: dates(ad.q15), q15o: dates(ad.q15o) };
      // the agreed power per tariff block, every period Moj Elektro has: [{from, to, kw: [block 1..5]}]
      this._agreed = Array.isArray(s.agreed) ? s.agreed : [];
      // how the metering point is billed (logic.contract_info): yearly = self-supply netted once a year
      this._contract = s.contract && typeof s.contract === 'object' ? s.contract : {};
      this._q15 = { ...this._archData.q15, ...this._q15 }; this._q15o = { ...this._archData.q15o, ...this._q15o };
      // the integration always fetches from Moj Elektro, so the dashboard is always in Moj Elektro mode
      this._api = !!s.api; this._me = true;
      this._applyLite();
      this._data = { entries, me, meOut, settings: { ...DEF, ...(s.settings || {}) } };
      const first = !this._loaded; this._loaded = true;
      if (this._me) this._buildProf(false);
      this._renderAll(!first);
      // a meter was just switched to: its data is drawn, the grid fades back in on the second frame
      if (this._fadeIn) { const g = this._fadeIn; this._fadeIn = null; requestAnimationFrame(() => requestAnimationFrame(() => g.classList.remove('fade'))); }
    }
    // returns Home Assistant's answer to save_settings ({fetching}), if settings were saved
    async _commit({ put = [], del = [], settings = false } = {}) {
      try {
        if (put.length || del.length) await this._ws('save_manual', { put, delete: del, pin: this._pinOk || '' });
        if (settings) return await this._ws('save_settings', { settings: this._data.settings });
      } catch (err) { this._toast(t('Could not save to Home Assistant — {0}', err && err.message || err)); }
    }

    /* ----- data ----- */
    // out: which grid to work out (default: the one on screen)
    _calc(out = this._isOut()) {
      const s = { ...DEF, ...this._data.settings };
      // the grid-out view only shows Moj Elektro's grid-out days (manual readings are grid in)
      const E = out ? [] : [...(this._demo || this._data.entries)].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
      const days = new Map();
      const put = (d, k, v) => { let o = days.get(d); if (!o) { o = { t: 0, vt: 0, mt: 0, n: 0, has: false, man: true }; days.set(d, o); } o[k] += v; if (k === 't') o.n = 1; else o.has = true; };
      for (let i = 1; i < E.length; i++) {
        const a = E[i - 1], b = E[i], n = diffD(a.d, b.d);
        if (n < 1) continue;
        const dt = (b.t - a.t) * s.mult;
        if (dt >= 0) for (let k = 1; k <= n; k++) put(addD(a.d, k), 't', dt / n);
        if (s.tmode === 'reading' && a.vt != null && b.vt != null && a.mt != null && b.mt != null) {
          const dv = (b.vt - a.vt) * s.mult, dm = (b.mt - a.mt) * s.mult;
          if (dv >= 0 && dm >= 0) for (let k = 1; k <= n; k++) { put(addD(a.d, k), 'vt', dv / n); put(addD(a.d, k), 'mt', dm / n); }
        }
      }
      if (s.tmode === 'usage') for (const e of E) { if (e.vt != null) put(e.d, 'vt', e.vt); if (e.mt != null) put(e.d, 'mt', e.mt); }
      // Moj Elektro days are authoritative (usage = difference of the midnight meter readings at the start
      // and end of that day); their month-to-date totals cover days that were never logged. A day whose
      // meter total has not arrived yet (it comes a day after the 15-min data) counts with its tariff-block
      // total instead (q15), without a VT/MT split, until the meter total replaces it.
      const months = {}; let meLast = null, bLast = null;
      if (!this._demo) for (const m of ((out ? this._data.meOut : this._data.me) || [])) {
        const b = Array.isArray(m.b) && m.b.length === 5 ? m.b.map(x => +x || 0) : null, off = typeof m.u === 'number';
        if (!off && !b) continue;
        const bt = b ? b.reduce((a, x) => a + x, 0) : 0, cur = days.get(m.d);
        // a manual reading wins over Moj Elektro; the difference (dl) goes into the month total
        if (cur && cur.man && cur.n) { if (off) cur.dl = cur.t - m.u; cur.b = b; }
        else days.set(m.d, off
          ? { t: m.u, vt: +m.vt || 0, mt: +m.mt || 0, n: 1, has: m.vt != null && m.mt != null, me: true, b }
          : { t: bt, vt: 0, mt: 0, n: bt > 0 ? 1 : 0, has: false, me: true, b, q15: bt > 0 });
        const ym = m.d.slice(0, 7);
        if (typeof m.mo === 'number' && (!months[ym] || months[ym].thru < m.d)) months[ym] = { t: m.mo, vt: m.mvt, mt: m.mmt, thru: m.d };
        if (off && (!meLast || m.d > meLast)) meLast = m.d;
        if (b && (!bLast || m.d > bLast)) bLast = m.d;
      }
      // until a day's meter total (or, for grid in, its tariff blocks) arrives, its whole-day 15-minute data gives
      // the provisional total
      if (!this._demo) for (const [d, q] of Object.entries((out ? this._q15o : this._q15) || {})) {
        if (days.has(d) || !Array.isArray(q) || q.length < 92) continue;
        const t = q.reduce((a, x) => a + (+x || 0), 0);
        days.set(d, { t, vt: 0, mt: 0, n: 1, has: false, me: true, b: null, q15: true });
      }
      // Manual edits (Log > Edit, grid-out Add) win over everything from Moj Elektro and stay until the day is
      // deleted. dl / dvt / dmt: how much they differ from Moj Elektro's day, so month and year totals follow them.
      // Edited tariff blocks (Časovni bloki > Edit) replace Moj Elektro's blocks of that day.
      if (!this._demo) for (const [d, e] of Object.entries(this._edits || {})) {
        const eb = !out && Array.isArray(e.b) && e.b.length === 5 ? e.b.map(x => +x || 0) : null;
        let v;
        if (out) { if (typeof e.o !== 'number') continue; v = { t: e.o, vt: 0, mt: 0, has: false }; }
        else if (typeof e.vt === 'number' && typeof e.mt === 'number') v = { t: e.vt + e.mt, vt: e.vt, mt: e.mt, has: true };
        else if (typeof e.u === 'number') v = { t: e.u, vt: 0, mt: 0, has: false };
        else {
          if (!eb) continue;
          const cur = days.get(d), bt = eb.reduce((a, x) => a + x, 0);
          if (cur) { cur.b = eb; cur.bed = true; }
          else days.set(d, { t: bt, vt: 0, mt: 0, n: bt > 0 ? 1 : 0, has: false, me: true, b: eb, q15: bt > 0, bed: true });
          continue;
        }
        const cur = days.get(d), o = { ...v, n: 1, me: true, edited: true, b: eb || (cur ? cur.b : null), bed: !!eb };
        if (cur && cur.me && !cur.q15 && !cur.edited) {
          o.dl = o.t - cur.t;
          if (o.has && cur.has) { o.dvt = o.vt - cur.vt; o.dmt = o.mt - cur.mt; }
        } else if (cur && cur.man && cur.dl != null) o.dl = o.t - (cur.t - cur.dl);
        days.set(d, o);
      }
      // a manually edited day whose tariff blocks do not add up to its day total: a triangle in Časovni bloki until
      // they match (0.05 kWh, the precision the card shows)
      if (!out) for (const o of days.values()) if (o.edited || o.bed) o.bwarn = Math.abs((o.b ? o.b.reduce((a, x) => a + x, 0) : 0) - o.t) > 0.05;
      const keys = [...days.keys()].filter(k => days.get(k).n).sort();
      this._c = { s, E, days, keys, months, meLast, bLast, out, today: iso(new Date()) };
      return this._c;
    }
    _sum(from, to) {
      const r = { t: 0, vt: 0, mt: 0, n: 0, has: false, b: [0, 0, 0, 0, 0], bh: false, dl: 0, dvt: 0, dmt: 0 };
      for (const [k, o] of this._c.days) if (k >= from && k <= to) {
        r.t += o.t; r.vt += o.vt; r.mt += o.mt; r.n += o.n; if (o.has) r.has = true; if (o.q15) r.q15 = true;
        r.dl += o.dl || 0; r.dvt += o.dvt || 0; r.dmt += o.dmt || 0; if (o.bwarn) r.bwarn = true;
        if (o.b) { o.b.forEach((x, i) => r.b[i] += x); r.bh = true; }
      }
      return r;
    }
    _monthVal(y, mi) {
      const from = iso(new Date(y, mi, 1)), to = iso(new Date(y, mi + 1, 0)), r = this._sum(from, to), mm = this._c.months[from.slice(0, 7)];
      if (mm) {
        // official month-to-date total, corrected by manual values within it, + any days logged after it
        // (e.g. yesterday's provisional total)
        const x = this._sum(addD(mm.thru, 1), to), w = this._sum(from, mm.thru);
        if (mm.t + w.dl + x.t >= r.t - 0.001) {
          r.t = mm.t + w.dl + x.t; r.n = pd(mm.thru).getDate() + x.n; r.me = true;
          if (mm.vt != null && mm.mt != null) { r.vt = +mm.vt + w.dvt + x.vt; r.mt = +mm.mt + w.dmt + x.mt; r.has = true; }
        }
      }
      return r;
    }
    // prices are for energy bought, so the grid-out view shows no costs
    _cost(o) { const s = this._c.s; return !this._c.out && (s.pVT > 0 || s.pMT > 0) && o.has ? o.vt * s.pVT + o.mt * s.pMT : null; }
    _money(v) { return v == null ? '—' : this._c.s.cur + v.toFixed(2); }
    _buckets(unit) {
      const T = this._c.today, out = [];
      if (unit === 'day') for (let i = 29; i >= 0; i--) { const k = addD(T, -i), d = pd(k); out.push({ label: String(d.getDate()), sub: DOW2[d.getDay()], title: fdate(k), from: k, to: k, now: i === 0 }); }
      if (unit === 'week') { const ws = weekStart(T); for (let i = 11; i >= 0; i--) { const k = addD(ws, -7 * i); out.push({ label: t('W{0}', weekNo(k)), sub: fshort(k), title: t('Week {0} · {1} – {2}', weekNo(k), fshort(k), fshort(addD(k, 6))), from: k, to: addD(k, 6), now: i === 0 }); } }
      if (unit === 'month') { const d = pd(T); for (let i = 11; i >= 0; i--) { const m = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push({ label: MON[m.getMonth()], sub: (i === 11 || m.getMonth() === 0) ? String(m.getFullYear()) : '', title: `${MONL[m.getMonth()]} ${m.getFullYear()}`, from: iso(m), to: iso(new Date(m.getFullYear(), m.getMonth() + 1, 0)), now: i === 0 }); } }
      if (unit === 'year') { const cy = pd(T).getFullYear(); const fy = this._c.keys.length ? pd(this._c.keys[0]).getFullYear() : cy; for (let y = Math.min(fy, cy - 2); y <= cy; y++) out.push({ label: String(y), title: String(y), from: `${y}-01-01`, to: `${y}-12-31`, now: y === cy }); }
      for (const b of out) {
        if (unit === 'month') Object.assign(b, this._monthVal(pd(b.from).getFullYear(), pd(b.from).getMonth()));
        else if (unit === 'year') {
          const acc = { t: 0, vt: 0, mt: 0, n: 0, has: false, b: [0, 0, 0, 0, 0], bh: false };
          for (let mi = 0; mi < 12; mi++) { const r = this._monthVal(+b.label, mi); acc.t += r.t; acc.vt += r.vt; acc.mt += r.mt; acc.n += r.n; acc.has = acc.has || r.has; r.b.forEach((x, i) => acc.b[i] += x); acc.bh = acc.bh || r.bh; }
          Object.assign(b, acc);
        } else Object.assign(b, this._sum(b.from, b.to));
        const end = b.to > T ? T : b.to; b.span = Math.max(0, diffD(b.from, end) + 1);
      }
      return out;
    }

    /* ----- shell ----- */
    _shell() {
      if (this._built) return; this._built = true;
      this.shadowRoot.innerHTML = `<style>${CSS}</style>
<div class="root" id="root"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
<div class="wrap"><header class="hdr" id="hdr"></header><div class="mdd" id="mdd" hidden></div><div id="banner"></div>
<div class="grid">
 <section class="card hero s7" id="hero"></section>
 <section class="card s5" id="prof"></section>
 <div class="kpis s12" id="kpis"></div>
 <section class="card chart s8" id="chart"></section>
 <section class="card heat s4" id="heat"></section>
 <section class="card tariff s12" id="tariff"></section>
 <section class="card s12" id="blocks"></section>
 <section class="card s12" id="log"></section>
 <section class="card form s12" id="form"></section>
 <section class="card nt-hero s7" id="n-hero"></section>
 <section class="card s5" id="n-day"></section>
 <div class="nt-kpis s12" id="n-kpis"></div>
 <section class="card s8" id="n-chart"></section>
 <section class="card s4" id="n-clock"></section>
 <section class="card s8" id="n-year"></section>
 <section class="card s4" id="n-rec"></section>
 <section class="card s12" id="n-cal"></section>
 <section class="card s12" id="n-log"></section>
</div></div>
<div id="dw"></div><div id="hb"></div><div id="bp"></div></div>
<div class="tip" id="tip"></div><div class="toast" id="toast"></div>
<input type="file" id="file" accept=".csv,text/csv,.json,application/json" hidden>`;
      const R = this.shadowRoot;
      this.$ = id => R.getElementById(id);
      R.addEventListener('click', e => this._click(e));
      R.addEventListener('input', e => {
        if (e.target.id && e.target.id.startsWith('f-')) { this._dirty = true; this._preview(); }
        // editing a day in the Log: its total is VT + MT
        if (/^bl-\d$/.test(e.target.id || '')) this._blSum();
        if (e.target.id === 'ed-vt' || e.target.id === 'ed-mt') { const v = num(this.$('ed-vt').value), m = num(this.$('ed-mt').value), s = this.$('ed-sum'); if (s) s.textContent = v != null && m != null ? fk(v + m) + ' kWh' : '—'; }
      });
      R.addEventListener('change', e => this._change(e));
      R.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id && e.target.id.startsWith('f-')) this._saveForm(); if (e.key === 'Enter' && e.target.id === 'pin') this._clearAll(); if (e.key === 'Enter' && e.target.id === 'fpin') this._openFormPin(); if (e.key === 'Enter' && /^ed-/.test(e.target.id || '')) this._saveEdit(this._ui.editDay); if (e.key === 'Enter' && e.target.id === 'oa-o') this._saveOutAdd(); if (e.key === 'Enter' && /^bl-\d$/.test(e.target.id || '')) this._saveBlocks(this._ui.blEdit); if (e.key === 'Enter' && e.target.id === 'mm-name') this._mmRename(this._mm && this._mm.edit); if (e.key === 'Enter' && e.target.id === 'mm-newtok') this._mmToken(this._mm && this._mm.key); if (e.key === 'Enter' && /^bp-/.test(e.target.id || '')) this._savePrices(false); if (e.key === 'Escape') { if (this._ui.bpOpen) { this._ui.bpOpen = false; this._renderPrices(); } else if (this._ui.hbOpen) { this._ui.hbOpen = false; this._renderBillWin(); } this._closeMM(); this._closeCals(); this._drawer(false); } });
      // Info boxes (data-tip): hovering with a mouse shows them; a click or tap on a bar pins the box (see _click) until
      // a click or tap somewhere else, or a scroll of 40 px or more. While pinned, hovering does not change it.
      // Only a mouse (or a tablet's trackpad) hovers: a finger sliding over the bars while scrolling (tablets) shows nothing.
      R.addEventListener('pointermove', e => { if (!this._tipPin && e.pointerType === 'mouse') this._tipMove(e); });
      R.addEventListener('pointerleave', () => { if (!this._tipPin) this.$('tip').classList.remove('on'); }, true);
      // the page, or Home Assistant's own scrolling container (_tipSc, found when a box is pinned)
      this._tipOnScroll = () => { if (this._tipPin && Math.abs(this._tipScrollY() - this._tipPinY) >= 40) this._tipUnpin(); };
      addEventListener('scroll', this._tipOnScroll, { passive: true });
      addEventListener('resize', () => this._placeMM());
      this._renderSkeleton();
    }
    _renderSkeleton() {
      this._applyLang();
      this.$('hdr').innerHTML = this._hdrHtml();
      this.$('hero').innerHTML = `<div class="empty">${ic('bolt')}<span>${t('Loading your energy data…')}</span></div>`;
    }

    _renderAll(remote) {
      if (!this._built) return;
      this._applyLang();
      this._calc();
      // without Moj Elektro the manual form takes the profile's slot next to the hero
      const pr = this.$('prof'), fm = this.$('form'), out = this._c.out, net = this._isNet();
      this.toggleAttribute('out', out); this.toggleAttribute('net', net);
      for (const id of NET_IDS) this.$(id).style.display = net ? '' : 'none';
      for (const id of NORM_IDS) this.$(id).style.display = net ? 'none' : '';
      if (net) { this._renderHdr(); this._renderBanner(); this._renderNet(); if (!(remote && this._dwOpen)) this._renderDrawer(); return; }
      pr.classList.toggle('form', !this._me); pr.classList.toggle('prof', !!this._me);
      // grid out has no VT / MT split card, tariff blocks or manual readings (its box only offers deleting days)
      fm.style.display = this._me ? '' : 'none';
      this.$('blocks').style.display = this._me && !out ? '' : 'none';
      this.$('tariff').style.display = out ? 'none' : '';
      this._renderHdr(); this._renderBanner(); this._renderHero(); if (!(remote && this._dirty)) this._renderForm(); this._renderKpis();
      this._renderChart(); this._renderHeat(); this._renderTariff(); this._renderBlocks(); this._renderLog(); this._renderProf(); if (!(remote && this._dwOpen)) this._renderDrawer();
    }
    _hdrHtml() {
      const d = new Date(), c = this._c || {}, msm = this._meterBtn(true);
      // only warnings get a chip; normal operation keeps the header clean
      const chip = this._demo ? `<span class="chip warn"><i></i>${t('Demo preview')}</span>` : this._sync === 'none' ? `<span class="chip warn"><i></i>${t('Daily Energy integration not set up')}</span>` : '';
      return `<div class="logo">${ic('bolt')}</div><div class="ttl${msm ? ' hasm' : ''}"><h1><span>Daily Energy</span></h1><div class="sub">${flong(d)}</div>${msm}</div><div class="sp"></div>${this._tablet && !this._gridBoth() ? '<span id="hbill"></span><div class="sp"></div>' : ''}<div class="chips">${chip}</div>${this._tablet && this._gridBoth() ? '<span id="hbill" class="gs"></span>' : ''}${this._gridBoth() ? (() => { const cur = this._isOut() ? 'out' : this._isNet() ? 'net' : 'in', b = (v, i, l) => `<button class="${v}${cur === v ? ' on' : ''}" data-act="view" data-v="${v}">${ic(i)}${t(l)}</button>`; return `<div class="gsw">${b('in', 'bolt', 'Grid in')}<button class="m${cur === 'net' ? ' on' : ''}" data-act="view" data-v="net" title="${t('Net')}" aria-label="${t('Net')}">${ic('merge')}</button>${b('out', 'sun', 'Grid out')}</div>`; })() : ''}${this._meterBtn()}${this._entry ? `<button class="ibtn upd${this._checking ? ' busy' : ''}" data-act="update" title="${t('Check for updates')}">${ic('sync')}</button>` : ''}<button class="ibtn" data-act="settings" title="${t('Settings')}">${ic('gear')}</button>`;
    }
    _renderHdr() { this.$('hdr').innerHTML = this._hdrHtml(); this._placeMM(); if (this._tablet && this._c && this._loaded) this._renderBill(); }
    // Update button: asks the Moj Elektro API for new data now (the integration also checks every morning by itself). At most 5 a day per meter.
    async _checkUpdates() {
      if (this._checking || !this._entry) return;
      this._checking = true; this._renderHdr(); this._toast(t('Checking for updates…'), { hold: true, icon: 'sync' });
      const t0 = Date.now(); let msg, sub = '';
      try {
        const res = await this._ws('check_updates');
        if (res && res.limited) { msg = t('Manual refresh is used up'); sub = t('The data will be filled in automatically at the next morning check.'); }
        else msg = t(res && res.error ? 'Could not reach Moj Elektro — try again later' : res && res.changed ? 'Updated the cards!' : 'Nothing has been updated yet');
      } catch (e) { msg = t('Could not check for updates — {0}', e && e.message || e); }
      await new Promise(r => setTimeout(r, Math.max(0, 1200 - (Date.now() - t0))));
      this._checking = false; this._renderHdr(); this._toast(msg, { ms: sub ? 5000 : 3500, sub });
    }
    _renderBanner() {
      const b = this.$('banner');
      if (this._demo) b.innerHTML = `<div class="banner demo">${ic('spark')}<div><b>${t('Demo preview.')}</b> <span>${t('150 days of sample readings so you can explore — nothing here is saved.')}</span></div><div class="sp"></div><button class="btn sm gh" data-act="demo-off">${t('Exit demo')}</button></div>`;
      else if (this._sync === 'none') b.innerHTML = `<div class="banner demo">${ic('bolt')}<div><b>${t('Daily Energy is not set up yet.')}</b> <span>${t('Add it under Settings → Devices &amp; services → Add integration → “Daily Energy for Moj Elektro”.')}</span></div></div>`;
      else if (this._c.out && !this._c.keys.length) b.innerHTML = `<div class="banner">${ic('sun')}<div><b>${t('No grid-out data yet.')}</b> <span>${t("Moj Elektro's grid-out days are fetched from now on. For the past, use ⚙ → Moj Elektro history.")}</span></div></div>`;
      else if (this._me && !this._c.keys.length) b.innerHTML = `<div class="banner">${ic('bolt')}<div><b>${t('Waiting for the first Moj Elektro day.')}</b> <span>${t('New days are fetched automatically every morning. For your history, use ⚙ → Moj Elektro history.')}</span></div></div>`;
      else if (this._c.E.length < 2 && !this._c.meLast && !this._me) b.innerHTML = `<div class="banner">${ic('bolt')}<div><b>${t(this._c.E.length ? 'One more reading to go.' : 'Welcome — log your first meter reading.')}</b> <span>${t(this._c.E.length ? 'Usage is the difference between two readings, so charts light up after your next entry.' : 'Your first reading is the baseline; every reading after it becomes usage.')}</span></div><div class="sp"></div><button class="btn sm gh" data-act="demo-on">${ic('spark')} ${t('Preview with demo data')}</button></div>`;
      else b.innerHTML = '';
    }

    /* ----- hero ----- */
    _renderHero() {
      const { days, keys, today, E, s } = this._c;
      const el = this.$('hero');
      const last = E[E.length - 1];
      const hk = days.has(today) && days.get(today).n ? today : keys[keys.length - 1];
      const hv = hk ? days.get(hk) : null, q15 = !!(hv && hv.q15);
      const pv = []; for (let i = 1; i <= 30; i++) { const o = days.get(addD(hk || today, -i)); if (o && o.n) pv.push(o.t); }
      const avg = pv.length ? pv.reduce((a, b) => a + b, 0) / pv.length : null;
      const ratio = hv && avg ? hv.t / avg : null;
      const out = this._c.out, verb = out ? 'Sent out' : 'Used';
      const lbl = t(!hk ? 'Today' : hk === today ? `${verb} today` : hk === addD(today, -1) ? `${verb} yesterday` : `${verb} on`);
      const pills = [];
      // more energy used is shown in red; more energy sent out is good, so it is shown in green
      if (ratio != null) { const p = (ratio - 1) * 100; pills.push(`<span class="pill ${(p > 0) !== out ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'} ${t('{0}% vs 30-day avg', Math.abs(p).toFixed(0))}</span>`); }
      if (q15) pills.push(`<span class="pill">${t('From 15-min data · VT / MT tomorrow')}</span>`);
      if (hv && hv.has) pills.push(`<span class="pill"><i class="d" style="background:var(--vt1)"></i>VT ${fk(hv.vt)}</span><span class="pill"><i class="d" style="background:var(--mt1)"></i>MT ${fk(hv.mt)}</span>`);
      const c = hv ? this._cost(hv) : null; if (c != null) pills.push(`<span class="pill">≈ ${this._money(c)}</span>`);
      const ml = this._c.meLast, mm = ml && this._c.months[ml.slice(0, 7)];
      const mv = mm && this._monthVal(pd(ml).getFullYear(), pd(ml).getMonth());
      const thru = mm && keys.filter(k => k.slice(0, 7) === ml.slice(0, 7)).pop();
      const odo = mm ? this._odo(mv.t.toFixed(1)) : last ? this._odo(rawStr(last.t, s.mult)) : '<span class="od-sep" style="color:var(--dim)">— — —</span>';
      const meter = mm
        ? `<div><div class="meter-l">${t(out ? '{0} sent out · kWh' : '{0} so far · kWh', MONL[pd(ml).getMonth()])}</div><div class="meter-s">${t('Moj Elektro · through {0}', fdate(thru))}</div></div>`
        : `<div><div class="meter-l">${t('Energy counter')}</div><div class="meter-s">${last ? t('Last read {0}', fdate(last.d)) : t('No readings yet')}</div></div>`;
      const C = 2 * Math.PI * 80, arc = C * 0.75, f = ratio == null ? 0 : Math.min(ratio / 2, 1);
      let ticks = ''; for (let i = 0; i <= 30; i++) { const a = (135 + i * 9) * Math.PI / 180, r1 = 98, r2 = i % 5 ? 102 : 106; ticks += `<line x1="${100 + r1 * Math.cos(a)}" y1="${100 + r1 * Math.sin(a)}" x2="${100 + r2 * Math.cos(a)}" y2="${100 + r2 * Math.sin(a)}" stroke="rgba(255,255,255,${i % 5 ? .12 : .3})" stroke-width="1.4"/>`; }
      el.innerHTML = `<div>
 <div class="eyebrow"><span class="pulse"></span>${lbl}${hk ? ' · ' + fdate(hk) : ''}</div>
 <div class="big"><span class="bignum" id="bignum">${hv ? fk(this._shown) : '0'}</span><span class="unit">kWh</span></div>
 <div class="pills">${pills.join('') || `<span class="pill">${t(out ? 'No grid-out data yet' : this._me ? 'Waiting for the first Moj Elektro day' : 'Log two readings to see daily usage')}</span>`}</div>
 <div class="meter">${meter}<div class="odo">${odo}</div></div>
${this._tablet ? '</div>' : ''}<div class="gwrap"><svg class="gauge" viewBox="0 0 200 200">
 <defs><linearGradient id="gG" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#3ee6ff"/><stop offset=".55" stop-color="#7b6bff"/><stop offset="1" stop-color="#ff7a3d"/></linearGradient>
 <filter id="gl" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
 ${ticks}
 <circle class="g-spin" cx="100" cy="100" r="64" fill="none" stroke="rgba(123,107,255,.35)" stroke-width="1.5" stroke-dasharray="1 7"/>
 <g transform="rotate(135 100 100)"><circle cx="100" cy="100" r="80" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="13" stroke-linecap="round" stroke-dasharray="${arc} ${C}"/>
 <circle class="g-val" id="gval" cx="100" cy="100" r="80" fill="none" stroke="url(#gG)" stroke-width="13" stroke-linecap="round" stroke-dasharray="0 ${C}" filter="url(#gl)" opacity="${f > 0 ? 1 : 0}" data-to="${arc * f} ${C}"/></g>
 <circle cx="100" cy="11" r="3.5" fill="#fff" opacity=".85"/><text x="100" y="-2" fill="#8f98c2" font-size="8" text-anchor="middle" letter-spacing="1">${t('AVG')}</text>
</svg><div class="g-c"><div class="g-v">${ratio == null ? '—' : Math.round(ratio * 100)}<small>%</small></div><div class="g-l">${t('of your average')}</div><div class="g-a">${t('avg {0} kWh/day', avg == null ? '—' : fk(avg))}</div></div></div>${this._tablet ? '' : `</div>
<div class="hero-r" id="bill"></div>`}`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const g = this.$('gval'); if (g) g.setAttribute('stroke-dasharray', g.dataset.to);
        this.shadowRoot.querySelectorAll('.od-r').forEach(r => r.style.transform = `translateY(-${r.dataset.v * 10}%)`);
      }));
      if (hv) this._count(this.$('bignum'), hv.t);
      this._renderBill();
    }
    /* ----- estimated bill (Ocena računa) ----- */
    // agreed power for the bill: Moj Elektro's on the month's last day with data (or its last day), else the one
    // typed in ⚙ from the bill (blank blocks take the block before, or the first one filled in)
    _billKw(day, end) {
      const me = this._agOn(end) || this._agOn(day);
      if (me) return { kw: me, src: 'me' };
      const s = this._c.s, v = [1, 2, 3, 4, 5].map(k => +s['kw' + k] || 0);
      const first = v.find(x => x > 0);
      if (!first) return { kw: null, src: null };
      let prev = first; return { kw: v.map(x => (prev = x > 0 ? x : prev)), src: 'man' };
    }
    // The bill is always for energy taken from the grid: on the grid-out view it is worked out from the grid-in data
    _billIn(which) {
      if (!this._c.out) return this._bill(which);
      const keep = this._c;
      try { this._calc(false); return this._bill(which); } finally { this._c = keep; }
    }
    // which: 'prev' (last month) or 'cur' (this month). A month whose days are not all in yet is projected from the
    // average of its days so far (from 3 days on); fixed charges always count for the whole month.
    _bill(which) {
      const c = this._c, td = pd(c.today);
      const base = new Date(td.getFullYear(), td.getMonth() - (which === 'prev' ? 1 : 0), 1);
      const y = base.getFullYear(), mi = base.getMonth(), ym = iso(base).slice(0, 7), dim = new Date(y, mi + 1, 0).getDate();
      const r = this._monthVal(y, mi);
      const mm = c.months[ym], last = c.keys.filter(k => k.slice(0, 7) === ym).pop();
      const thru = mm && (!last || mm.thru > last) ? mm.thru : last;
      if (!thru || !(r.t > 0)) return { ym, mi, empty: true };
      const nd = pd(thru).getDate();
      if (nd < dim && nd < 3) return { ym, mi, nd, dim, few: true };
      const f = dim / nd, ag = this._billKw(thru, iso(new Date(y, mi, dim))), yearly = !!this._contract.yearly;
      const P = this._billPrices(r.has);
      const res = billEstimate({
        ym, kwh: r.t * f, vt: r.vt * f, mt: r.mt * f, has: r.has, b: r.b.map(x => x * f), kw: ag.kw,
        pET: P.et, pVT: P.vt, pMT: P.mt, yearly
      });
      // self-supply: the calendar year so far, energy taken minus sent out (Moj Elektro's day totals)
      let yr = null;
      if (yearly) {
        let i = 0, o = 0, n = 0;
        for (const [d, rec] of Object.entries((this._snap && this._snap.days) || {})) if (d.slice(0, 4) === String(y) && d.slice(0, 7) <= ym && rec) {
          if (typeof rec.u === 'number') i += rec.u;
          if (typeof rec.o === 'number') { o += rec.o; n++; }
        }
        const s = c.s, et = s.pET > 0 ? s.pET : DEF_PRICE.et;
        yr = n ? { y, in: i, out: o, ...yearlyNet(ym, i, o, et), approx: !(s.pET > 0) } : { y, noOut: true };
      }
      return { ym, mi, nd, dim, proj: nd < dim, kwh: r.t * f, kwSrc: ag.src, yr, approx: P.approx, ...res };
    }
    // The meter's tariffs from Moj Elektro (1 = single tariff ET, 2 = VT / MT, 0 = unknown)
    _tariffs() { return +(this._contract && this._contract.tariffs) || 0; }
    // The metering point's details (tariffs, billing scheme) have arrived from Moj Elektro: until then the bill shows no
    // amount, as a yearly self-supply meter would look like an ordinary monthly bill
    _contractKnown() { return !!(this._contract && 'yearly' in this._contract); }
    // Supplier prices for the bill: the user's own for the meter's tariffs (VT / MT, or ET), else typical prices.
    // A one-price package on a VT / MT meter is typed as the same price in both fields. approx: a typical price is used.
    _billPrices(has) {
      const s = this._c.s, tf = this._tariffs();
      if (tf === 1 || (tf === 0 && s.pET > 0)) return s.pET > 0 ? { et: s.pET, approx: false } : { et: DEF_PRICE.et, approx: true };
      if ((s.pVT > 0 || s.pMT > 0) && has) return { vt: s.pVT > 0 ? s.pVT : DEF_PRICE.vt, mt: s.pMT > 0 ? s.pMT : DEF_PRICE.mt, approx: !(s.pVT > 0 && s.pMT > 0) };
      if (tf !== 1 && has) return { vt: DEF_PRICE.vt, mt: DEF_PRICE.mt, approx: true };
      return { et: DEF_PRICE.et, approx: true };
    }
    // The price window (Vpiši svoje točne cene): the meter's fields, with the typical prices as hints; agreed power
    // per block only when Moj Elektro has none
    _renderPrices() {
      const el = this.$('bp'); if (!el) return;
      if (!this._ui.bpOpen) { el.innerHTML = ''; return; }
      const s = this._c.s, tf = this._tariffs(), B = this._billIn(this._ui.billM || 'prev');
      const fld = (id, label, v, ph, cls = '') => `<label class="fld${cls}"><span>${label}</span><div class="iw"><input class="in" id="bp-${id}" inputmode="decimal" autocomplete="off" value="${v > 0 ? v : ''}" placeholder="${ph}"><em>€/kWh</em></div></label>`;
      const vtmt = `<div class="two">${fld('vt', '<i class="dot vt"></i>VT', s.pVT, DEF_PRICE.vt, ' vt')}${fld('mt', '<i class="dot mt"></i>MT', s.pMT, DEF_PRICE.mt, ' mt')}</div>`;
      const et = fld('et', 'ET', s.pET, DEF_PRICE.et);
      const kw = B.noKw || B.kwSrc === 'man' ? `<div class="bp-t">${t('Agreed power (from your bill)')}</div>
<div class="kw5">${[1, 2, 3, 4, 5].map(k => `<label class="fld"><span>B${k} kW</span><input class="in" id="bp-kw${k}" inputmode="decimal" autocomplete="off" value="${s['kw' + k] || ''}" placeholder="7.7"></label>`).join('')}</div>
<div class="dw-note">${t('Moj Elektro has no agreed power for this meter yet. Empty blocks take the block before.')}</div>` : '';
      el.innerHTML = `<div class="bp-bg" data-act="bp-close"></div><div class="bp" role="dialog" aria-modal="true">
<div class="row" style="align-items:center;justify-content:space-between"><h3>${t('Your exact prices')}</h3><button class="ibtn" data-act="bp-close">${ic('x')}</button></div>
<div class="dw-note">${t("Your supplier's energy prices without VAT, as on your bill. Empty fields use typical prices (shown in grey).")}${tf === 2 ? ' ' + t('If your package has one price for all hours, type it in both fields.') : ''}</div>
${tf === 1 ? et : tf === 2 ? vtmt : `${vtmt}${et}`}
${kw}
<div class="row bp-b"><button class="btn sm gh" data-act="bp-reset">${t('Use typical prices')}</button><button class="btn sm pri" data-act="bp-save">${t('Save')}</button></div></div>`;
      setTimeout(() => { const i = el.querySelector('input'); if (i && !this._phone) i.focus(); }, 60);
    }
    async _savePrices(reset) {
      const S = this._data.settings, v = id => { const i = this.$('bp-' + id); return i ? num(i.value) : null; };
      if (reset) { S.pVT = 0; S.pMT = 0; S.pET = 0; }
      else {
        for (const [k, id] of [['pVT', 'vt'], ['pMT', 'mt'], ['pET', 'et']]) if (this.$('bp-' + id)) { const x = v(id); if (x != null && (x < 0 || x > 2)) { this._toast(t('Enter a price in €/kWh, e.g. 0.125')); return; } S[k] = x || 0; }
        for (let k = 1; k <= 5; k++) if (this.$('bp-kw' + k)) { const x = v('kw' + k); S['kw' + k] = x > 0 ? x : 0; }
      }
      this._ui.bpOpen = false; this._renderPrices();
      this._calc(); this._renderHero(); this._renderKpis(); this._renderChart(); this._renderTariff();
      await this._commit({ settings: true });
      this._toast(t(reset ? 'Typical prices are used' : 'Prices saved'));
    }
    // Tablets: "Ocena računa ≈ €X ▾" in the header; a tap opens the whole box (breakdown open) in a window
    _renderBillBtn(B) {
      const hb = this.$('hbill'); if (!hb) return;
      const ok = B && !B.empty && !B.few && this._contractKnown();
      hb.innerHTML = B ? `<button class="hbill" data-act="hb-open" title="${t('Estimated bill')}"><span class="hbl">${t('Estimated bill')}</span>${ok ? ` <b>≈ ${this._money(B.total)}</b>` : ''}${ic('chev')}</button>` : '';
    }
    _renderBillWin() {
      const w = this.$('hb'); if (!w) return;
      w.innerHTML = this._tablet && this._ui.hbOpen ? `<div class="hb-bg" data-act="hb-close"></div><div class="hbp" role="dialog" aria-modal="true"><button class="ibtn hb-x" data-act="hb-close">${ic('x')}</button><div id="bill"></div></div>` : '';
    }
    _renderBill() {
      const c = this._c, has = !this._demo && this._me && (c.out ? (this._data.me || []).length : c.keys.length);
      if (this._tablet) { this._renderBillBtn(has ? this._billIn(this._ui.billM || 'prev') : null); if (!has && this._ui.hbOpen) { this._ui.hbOpen = false; this._renderBillWin(); } }
      const el = this.$('bill'); if (!el) return;
      if (!has) { el.innerHTML = ''; return; }
      const which = this._ui.billM || 'prev', B = this._billIn(which), open = this._tablet || (this._ui.billOpen ?? !this._phone), m = v => this._money(v);
      const tabs = this._tabs(which, 'bill-m', [['prev', 'Previous month'], ['cur', 'This month']]);
      const head = `<div class="bill-h"><span class="meter-l">${t('Estimated bill')}</span>${tabs}</div>`;
      if (!this._contractKnown()) {
        el.innerHTML = `<div class="bill">${head}<div class="meter-s">${t('Waiting for the meter details from Moj Elektro – press ↻.')}</div></div>`;
        return;
      }
      if (B.empty || B.few) {
        el.innerHTML = `<div class="bill">${head}<div class="meter-s">${t(B.empty ? 'No data for {0} yet.' : 'The estimate for {0} starts after 3 days.', MONL[B.mi])}</div></div>`;
        return;
      }
      const sub = B.proj ? t('{0} · projected from {1} of {2} days', MONL[B.mi], B.nd, B.dim) : t('{0} · whole month', MONL[B.mi]);
      const notes = [];
      if (B.noKw) notes.push(t('No agreed power from Moj Elektro: type it from your bill under the prices.'));
      if (B.guess) notes.push(t('Network prices for {0} are not confirmed yet: the last known ones are used.', MONL[B.mi]));
      const row = (l, v, d, cls = '') => `<div class="bl-r${cls}"><div><b>${l}</b>${d ? `<span>${d}</span>` : ''}</div><em>${v}</em></div>`;
      const yr = B.yr, yl = !yr ? '' : yr.noOut
        ? row(t('Yearly settlement {0}', yr.y), '—', t('Switch on Grid in &amp; Grid out in ⚙ to see the yearly balance.'))
        : row(t('Yearly settlement {0}', yr.y), yr.net <= 0 ? m(0) : '≈ ' + m(yr.cost), yr.net <= 0
          ? t('So far {0} kWh more sent out than taken: the surplus is not paid out.', fk(-yr.net))
          : t('So far {0} kWh more taken than sent out{1}.', fk(yr.net), yr.approx ? t(' (typical ET price)') : ''));
      const det = open ? `<div class="bl-d">
${B.yearly ? `<div class="bill-n">${t('Self-supply with yearly settlement: the monthly bill has only the agreed power; energy is netted in December.')}</div>` : ''}
${B.yearly ? '' : row(t('Energy'), m(B.g.energy), B.approx ? t('supplier · typical prices') : t('supplier · your prices'))}
${row(t('Network charge'), m(B.g.network), `${t('power')} ${m(B.power)} · ${t('energy')} ${m(B.energy)}`)}
${row(t('Levies'), m(B.g.levies), `OVE+SPTE ${m(B.ove)} · ${t('other')} ${m(B.other)}`)}
${row(t('Total without VAT'), m(B.net), '', ' sum')}
${row(t('VAT 22 %'), m(B.vat), '')}
${row(t('Total'), m(B.total), t("Without excess power (informative on the bill) and the supplier's monthly fee."), ' sum')}
${yl}</div>` : '';
      el.innerHTML = `<div class="bill${open ? ' open' : ''}">${head}
<div class="bill-v" data-act="bill-open"><span>≈ ${m(B.total)}</span><small>${t('with VAT')}</small>${ic('chev')}</div>
<div class="meter-s">${sub} · ${fk(B.kwh)} kWh${c.out ? ' ' + t('taken from the grid') : ''}</div>${notes.map(n => `<div class="bill-n">${n}</div>`).join('')}
<div class="bill-p">${B.approx && !B.yearly ? `<span>${t('≈ typical energy prices')}</span>` : ''}<button class="lnk" data-act="bp-open">${ic('edit')}${t(B.approx || B.noKw ? 'Enter your exact prices' : 'Edit prices')}</button></div>${det}</div>`;
    }
    _odo(str) {
      const dot = str.indexOf('.');
      return str.split('').map((ch, i) => /\d/.test(ch)
        ? `<span class="od${dot >= 0 && i > dot ? ' frac' : ''}"><span class="od-r" data-v="${ch}">${'0123456789'.split('').map(x => `<i>${x}</i>`).join('')}</span></span>`
        : `<span class="od-sep">${ch}</span>`).join('');
    }
    _count(el, to) {
      if (!el) return;
      // no count-up animation in lite mode or while the page is hidden (animation frames are paused there)
      if (this._lite || document.hidden) { el.textContent = fk(to); this._shown = to; return; }
      const from = this._shown || 0, t0 = performance.now(), dur = 1100;
      const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4); el.textContent = fk(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); else this._shown = to; };
      requestAnimationFrame(step);
    }

    /* ----- form ----- */
    _renderForm() {
      const { s, E, today } = this._c;
      const d = this._fd || today;
      const ex = E.find(e => e.d === d);
      const u = s.mult === 1000 ? 'MWh' : 'kWh', usage = s.tmode === 'usage';
      const tu = usage ? 'kWh' : u;
      this._dirty = false;
      const host = this.$(this._me ? 'form' : 'prof');
      // Moj Elektro mode: "Open" asks for the PIN (when one is set), then: Add (grid in: a manual counter reading;
      // grid out: a day's kWh), Edit or Remove entry (a pencil or bin on every day in the Log).
      const out = this._c.out, ui = this._ui;
      if (this._me && out && ui.outAdd) {
        host.innerHTML = `<div class="ch-h" style="margin-bottom:4px"><div><div class="h-t">${t('Add a day sent to the grid')}</div></div><button class="btn sm gh" data-act="del-done">${t('Close')}</button></div>
<div class="two"><label class="fld"><span>${t('Date')}</span><input class="in" type="date" id="oa-d" value="${addD(today, -1)}" max="${today}"></label>
<label class="fld"><span>${t('Sent out')}</span><div class="iw"><input class="in" id="oa-o" inputmode="decimal" autocomplete="off" placeholder="12.5"><em>kWh</em></div></label></div>
<div class="acts"><button class="btn pri" data-act="oa-save">${ic('ok')}${t('Save')}</button></div>`;
        return;
      }
      if (this._me && (!ui.formOpen || out)) {
        const note = ui.delMode ? 'Delete mode: tap the bin next to a day in the Log.' : ui.editMode ? 'Edit mode: tap the pencil next to a day in the Log.' : null;
        const acts = note
          ? `<div class="row" style="align-items:center"><span class="h-s" style="margin:0">${t(note)}</span><button class="btn sm gh" data-act="del-done">${t('Done')}</button></div>`
          : ui.formPin
            ? `<div class="row" style="align-items:center">${this._hasPin && !this._pinOk ? `<input class="in pin" id="fpin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="PIN">` : ''}<button class="btn sm gh" data-act="form-pin-ok" data-v="add">${ic('up')}${t('Add')}</button><button class="btn sm gh" data-act="form-pin-ok" data-v="edit">${ic('edit')}${t('Edit')}</button><button class="btn sm gh" data-act="form-pin-ok" data-v="del">${ic('del')}${t('Remove entry')}</button><button class="btn sm gh" data-act="form-pin-no">${t('Cancel')}</button></div>`
            : `<button class="btn sm gh" data-act="form-toggle">${ic('edit')}${t('Open')}</button>`;
        host.innerHTML = `<div class="fold"><div><div class="h-t">${t('Manual meter reading')}</div><div class="h-s">${t('To edit, delete or add usage data.')}</div><div class="h-n">${t('Optional — Moj Elektro now logs your usage automatically every day')}</div></div>${acts}</div>`;
        return;
      }
      host.innerHTML = `<div class="ch-h" style="margin-bottom:4px"><div><div class="h-t">${t(this._me ? 'Manual meter reading' : 'Log a reading')}</div><div class="h-s">${t('Type exactly what your energy counter shows')}</div></div><div class="row" style="align-items:center"><span class="badge ${ex ? 'ed' : ''}" id="f-badge">${t(ex ? (d === today ? 'Logged today ✓' : 'Editing') : 'New entry')}</span>${this._me ? `<button class="btn sm gh" data-act="form-toggle">${t('Close')}</button>` : ''}</div></div>
<label class="fld"><span>${t('Date')}</span><input class="in" type="date" id="f-d" value="${d}" max="${today}"></label>
<label class="fld"><span>${ic('meter')} ${t('Total counter')}</span><div class="iw"><input class="in mono" id="f-t" inputmode="decimal" autocomplete="off" placeholder="${s.mult === 1000 ? '121.334' : '121334'}" value="${ex ? rawStr(ex.t, s.mult) : ''}"><em>${u}</em></div></label>
<div class="two">
 <label class="fld vt"><span><i class="dot vt"></i>Energija VT <small>${t(usage ? 'kWh used' : 'big tariff')}</small></span><div class="iw"><input class="in" id="f-vt" inputmode="decimal" autocomplete="off" placeholder="${t('optional')}" value="${ex && ex.vt != null ? (usage ? ex.vt : rawStr(ex.vt, s.mult)) : ''}"><em>${tu}</em></div></label>
 <label class="fld mt"><span><i class="dot mt"></i>Energija MT <small>${t(usage ? 'kWh used' : 'small tariff')}</small></span><div class="iw"><input class="in" id="f-mt" inputmode="decimal" autocomplete="off" placeholder="${t('optional')}" value="${ex && ex.mt != null ? (usage ? ex.mt : rawStr(ex.mt, s.mult)) : ''}"><em>${tu}</em></div></label>
</div>
<div class="prev" id="f-prev"></div>
<div class="acts"><button class="btn pri" data-act="save">${ic('bolt')}${t(ex ? 'Update reading' : 'Save reading')}</button>${ex ? `<button class="btn gh" data-act="new">${t('Cancel')}</button>` : ''}</div>`;
      this._preview();
    }
    _fv() { const g = id => this.$(id); return { d: g('f-d').value, t: num(g('f-t').value), vt: num(g('f-vt').value), mt: num(g('f-mt').value) }; }
    _preview() {
      const P = this.$('f-prev'); if (!P) return;
      const { s, E } = this._c; const v = this._fv();
      const prev = [...E].reverse().find(e => e.d < v.d), next = E.find(e => e.d > v.d);
      P.className = 'prev';
      if (v.t == null) { P.innerHTML = prev ? `<div>${t('Previous reading {0} on {1}', `<b style="color:var(--txt);font-family:'JetBrains Mono',monospace">${rawStr(prev.t, s.mult)}</b>`, fdate(prev.d))}</div><div>${t("Enter today's number and I'll work out the usage instantly.")}</div>` : `<div><b style="color:var(--txt)">${t('This will be your baseline.')}</b></div><div>${t('Usage appears from your second reading onward.')}</div>`; return; }
      if (!prev) { P.innerHTML = `<div><b style="color:var(--txt)">${t('Baseline reading')}</b> — ${t(next ? 'earlier than your other readings.' : 'the next reading will show usage.')}</div>`; return; }
      const n = diffD(prev.d, v.d), dt = (v.t - prev.t) * s.mult;
      if (dt < 0) { P.className = 'prev bad'; P.innerHTML = `<div><b>${t('Lower than the previous reading')}</b> ${t('({0} on {1}).', rawStr(prev.t, s.mult), fshort(prev.d))}</div><div>${t('Double-check the digits — counters only go up.')}</div>`; return; }
      let tr = '';
      if (s.tmode === 'reading' && v.vt != null && v.mt != null && prev.vt != null && prev.mt != null) tr = `<div class="tr"><span><i class="dot vt"></i>VT +${fk((v.vt - prev.vt) * s.mult)} kWh</span><span><i class="dot mt"></i>MT +${fk((v.mt - prev.mt) * s.mult)} kWh</span></div>`;
      if (s.tmode === 'usage' && (v.vt != null || v.mt != null)) tr = `<div class="tr"><span><i class="dot vt"></i>VT ${fk(v.vt || 0)} kWh</span><span><i class="dot mt"></i>MT ${fk(v.mt || 0)} kWh</span></div>`;
      P.innerHTML = `<div class="pv">+${fk(dt)} <small>kWh</small></div><div>${t('over {0} since {1}', LANG === 'sl' ? `${n} ${n === 1 ? 'dnevu' : 'dneh'}` : nDays(n), fdate(prev.d))}${n > 1 ? ` · ${fk(dt / n)} ${t('kWh/day')}` : ''}</div>${tr}`;
    }
    async _saveForm() {
      if (this._demo) { this._toast(t('Exit the demo preview to log real readings')); return; }
      const v = this._fv(), { s, E } = this._c;
      if (!v.d) { this._toast(t('Pick a date')); return; }
      if (v.t == null) { this._toast(t('Enter the total counter reading')); this.$('f-t').focus(); return; }
      const prev = [...E].reverse().find(e => e.d < v.d), next = E.find(e => e.d > v.d);
      if ((prev && v.t < prev.t) || (next && v.t > next.t)) { if (!confirm(t('This reading does not fit between your neighbouring readings (counters only go up). Save anyway?'))) return; }
      const e = { d: v.d, t: v.t }; if (v.vt != null) e.vt = v.vt; if (v.mt != null) e.mt = v.mt;
      this._data.entries = this._data.entries.filter(x => x.d !== v.d).concat(e);
      this._fd = null; this._ui.formOpen = false;
      const dt = prev ? (v.t - prev.t) * s.mult : null;
      this._renderAll(); await this._commit({ put: [e] });
      this._toast(dt != null && dt >= 0 ? t('Saved · +{0} kWh since {1}', fk(dt), fshort(prev.d)) : t('Reading saved'));
    }

    /* ----- kpis ----- */
    _renderKpis() {
      const { today, days } = this._c;
      const ws = weekStart(today), wk = this._sum(ws, today), lw = this._sum(addD(ws, -7), addD(ws, -1));
      const d = pd(today), mo = this._monthVal(d.getFullYear(), d.getMonth());
      const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const proj = mo.n >= 3 ? mo.t / mo.n * dim : null;
      const yr = { t: 0, vt: 0, mt: 0, n: 0, has: false };
      for (let mi = 0; mi <= d.getMonth(); mi++) { const r = this._monthVal(d.getFullYear(), mi); yr.t += r.t; yr.vt += r.vt; yr.mt += r.mt; yr.n += r.n; yr.has = yr.has || r.has; }
      // daily average of this month = the month's total over the days it covers (same numbers as the month tile)
      const dm = []; let peak = null;
      for (let k = iso(new Date(d.getFullYear(), d.getMonth(), 1)); k <= today; k = addD(k, 1)) { const o = days.get(k); dm.push(o && o.n ? o.t : null); if (o && o.n && (!peak || o.t > peak.v)) peak = { v: o.t, k }; }
      const avg = mo.n ? mo.t / mo.n : null;
      const wks = this._buckets('week').slice(-8).map(b => b.n ? b.t : null);
      const mos = this._buckets('month').map(b => b.n ? b.t : null);
      const cost = o => { const c = this._cost(o); return c != null ? ` · <b>${this._money(c)}</b>` : ''; };
      const tile = (i, a, b, lab, v, sub, sp, id) => `<section class="card kpi" style="--a:${a};--b:${b};animation-delay:${i * 70}ms"><div class="kpi-t"><span class="kpi-i">${ic(id)}</span>${lab}</div><div class="kpi-v">${v == null ? '—' : fk(v)}<small>kWh</small></div><div class="kpi-s">${sub}</div>${this._spark(sp, a, b, 'sp' + i)}</section>`;
      this.$('kpis').innerHTML =
        tile(0, '#3ef0a8', '#3ee6ff', t('Daily average · this month'), avg, peak ? t(this._c.out ? 'Peak sent out {0} kWh on {1}' : 'Peak {0} kWh on {1}', `<b>${fk(peak.v)}</b>`, fshort(peak.k)) : MONL[d.getMonth()], dm, 'avg') +
        tile(1, '#3ee6ff', '#5b8cff', t('This week'), wk.n ? wk.t : null, `${t('Last week {0} kWh', `<b>${lw.n ? fk(lw.t) : '—'}</b>`)}${cost(wk)}`, wks, 'week') +
        tile(2, '#8f7dff', '#c07bff', MONL[d.getMonth()], mo.n ? mo.t : null, `${t(this._c.out ? 'Projected sent out {0} kWh' : 'Projected {0} kWh', `<b>${proj == null ? '—' : fk(proj)}</b>`)}${cost(mo)}`, mos, 'month') +
        tile(3, '#ffc857', '#ff7a3d', t('Year {0}', d.getFullYear()), yr.n ? yr.t : null, `${MON[0]} – ${MON[d.getMonth()]}${cost(yr)}`, mos.slice(-(d.getMonth() + 1)), 'year');
    }
    _spark(vals, a, b, id) {
      const pts = vals.map((v, i) => [i, v]).filter(p => p[1] != null);
      if (pts.length < 2) return `<svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none"></svg>`;
      const mx = Math.max(...pts.map(p => p[1])) || 1, mn = Math.min(...pts.map(p => p[1])), n = Math.max(1, vals.length - 1);
      const xy = pts.map(([i, v]) => [i / n * 100, 36 - ((v - mn) / ((mx - mn) || 1)) * 26]);
      let d = `M${xy[0][0]},${xy[0][1]}`;
      for (let i = 1; i < xy.length; i++) { const [x0, y0] = xy[i - 1], [x1, y1] = xy[i], cx = (x0 + x1) / 2; d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; }
      return `<svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none"><defs><linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}" stop-opacity=".35"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></linearGradient><linearGradient id="${id}s" x1="0" x2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><path d="${d} L${xy[xy.length - 1][0]},40 L${xy[0][0]},40Z" fill="url(#${id}f)"/><path d="${d}" fill="none" stroke="url(#${id}s)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
    }

    /* ----- charts ----- */
    // stack: false = total, true = VT/MT, 'b' = tariff blocks 1–5
    _bars(bk, stack, sm, ak) {
      const V = b => stack === 'b' ? b.b.reduce((a, x) => a + x, 0) : stack ? b.vt + b.mt : b.t;
      const vals = bk.map(V);
      const hasF = b => stack === 'b' ? b.bh : stack ? b.has : b.n > 0;
      const mx = nice(Math.max(0, ...vals));
      const wd = bk.filter(hasF), avg = wd.length ? wd.reduce((a, b) => a + V(b), 0) / wd.length : 0;
      const ticks = [1, .75, .5, .25, 0];
      // Časovni bloki in edit mode (Log > Edit): a pencil under each day whose blocks do not match its total
      const bedit = stack === 'b' && !this._demo && !!this._ui.editMode, pen = b => bedit && b.bwarn && b.from === b.to;
      let h = `<div class="ch${sm ? ' sm' : ''}${bk.some(pen) ? ' edb' : ''}"><div class="ch-y">${ticks.map(f => `<span>${fax(mx * f)}</span>`).join('')}</div><div class="ch-p"><div class="ch-g">${ticks.map(() => '<i></i>').join('')}</div>`;
      if (avg > 0 && this._avgOn(ak)) h += `<div class="ch-avg" style="bottom:${avg / mx * 100}%"><span>${t('avg {0}', fk(avg))}</span></div>`;
      h += `<div class="ch-b${bk.length > 20 ? ' dense' : ''}">`;
      bk.forEach((b, i) => {
        const v = vals[i], has = hasF(b), part = has && b.n < b.span && b.span > 1;
        let tip = `<b>${b.title}</b>`;
        if (has) {
          tip += `<div class="r"><span>${t('Total')}</span><span class="v">${fk(stack ? v : b.t)} kWh</span></div>`;
          if (stack === 'b') tip += b.b.map((x, j) => x > 0 ? `<div class="r"><i class="dot" style="background:${BLK[j]}"></i>Blok ${j + 1}<span class="v">${fk(x)} kWh</span></div>` : '').join('');
          else if (b.has) tip += `<div class="r"><i class="dot vt"></i>VT<span class="v">${fk(b.vt)} kWh</span></div><div class="r"><i class="dot mt"></i>MT<span class="v">${fk(b.mt)} kWh</span></div>`;
          const c = this._cost(b); if (c != null) tip += `<div class="r"><span>${t('Cost')}</span><span class="v">${this._money(c)}</span></div>`;
          if (b.span > 1) tip += `<div class="m">${t('{0} of {1} days logged · {2} kWh/day', b.n, b.span, fk((stack ? v : b.t) / Math.max(1, b.n)))}</div>`;
          if (!stack && b.q15) tip += `<div class="m">${t('incl. 15-min data · meter total tomorrow')}</div>`;
        } else tip += `<div class="m">${t('No data')}</div>`;
        if (stack === 'b' && b.bwarn) tip += `<div class="r" style="color:var(--vt1)">${ic('warn')}${t('Tariff blocks do not match the day total')}</div>`;
        let bar;
        if (!has) bar = `<div class="bar none"></div>`;
        else if (stack === 'b') bar = `<div class="bar stk" style="height:${v / mx * 100}%;--i:${i}">${[4, 3, 2, 1, 0].map(j => b.b[j] > 0 ? `<div class="seg" style="flex:${b.b[j]};background:${BLK[j]}"></div>` : '').join('')}</div>`;
        else if (stack) bar = `<div class="bar stk" style="height:${v / mx * 100}%;--i:${i}"><div class="seg mt" style="flex:${b.mt}"></div><div class="seg vt" style="flex:${b.vt}"></div></div>`;
        else bar = `<div class="bar tot" style="height:${Math.max(v / mx * 100, .8)}%;--i:${i}"></div>`;
        const tri = stack === 'b' && b.bwarn ? `<i class="btri" style="bottom:calc(${has ? v / mx * 100 : 0}% + 5px)">${ic('warn')}</i>` : '';
        const pbtn = pen(b) ? `<button class="bed${this._ui.blEdit === b.from ? ' on' : ''}" data-act="bl-edit" data-d="${b.from}" title="${t('Edit tariff blocks')}">${ic('edit')}</button>` : '';
        h += `<div class="col${b.now ? ' now' : ''}${part ? ' part' : ''}" data-tip="${esc(tip)}">${bar}${tri}<span class="xl">${b.label}${b.sub ? `<small>${b.sub}</small>` : ''}</span>${pbtn}</div>`;
      });
      return h + '</div></div></div>';
    }
    _stats(bk, stack) {
      const hasF = b => stack ? b.has : b.n > 0, V = b => stack ? b.vt + b.mt : b.t;
      const wd = bk.filter(hasF);
      if (!wd.length) return '';
      const tot = wd.reduce((a, b) => a + V(b), 0), av = tot / wd.length;
      const hi = wd.reduce((a, b) => V(b) > V(a) ? b : a), lo = wd.reduce((a, b) => V(b) < V(a) ? b : a);
      const st = (l, v, sub) => `<div class="st"><div class="st-l">${l}</div><div class="st-v">${fk(v)}<small>kWh</small></div><div class="st-s">${sub}</div></div>`;
      const c = bk.reduce((a, b) => { const x = this._cost(b); return x == null ? a : (a || 0) + x; }, null);
      return `<div class="stats">${st(t('Total'), tot, c != null ? '≈ ' + this._money(c) : t('{0} periods', wd.length))}${st(t('Average'), av, t('per period'))}${st(t(this._c.out ? 'Highest sent out' : 'Highest'), V(hi), hi.title)}${st(t(this._c.out ? 'Lowest sent out' : 'Lowest'), V(lo), lo.title)}</div>`;
    }
    // Povprečje chip: the dashed average line, on or off per chart (use / vtmt / blk), remembered per device
    _avgOn(k) { return LS.get('daily-energy-avg-' + k) !== '0'; }
    _avgChip(k) { const on = this._avgOn(k); return `<button class="avgck${on ? '' : ' off'}" data-act="avgline" data-v="${k}"><i>${on ? '✓' : ''}</i>${t('Average')}</button>`; }
    _tabs(cur, act, opts) { return `<div class="seg-tabs">${opts.map(([k, l]) => `<button class="${k === cur ? 'on' : ''}" data-act="${act}" data-v="${k}">${t(l)}</button>`).join('')}</div>`; }
    _renderChart() {
      const r = this._ui.range, bk = this._buckets(r);
      const sub = t({ day: 'Last 30 days', week: 'Last 12 weeks', month: 'Last 12 months', year: 'By year' }[r]);
      this.$('chart').innerHTML = `<div class="ch-h"><div><div class="h-t">${t(this._c.out ? 'Sent to the grid' : 'Consumption')}</div><div class="h-s">${sub} · kWh</div></div><div class="row" style="align-items:center;gap:18px">${this._avgChip('use')}${this._tabs(r, 'range', [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']])}</div></div>${this._bars(bk, false, false, 'use')}${this._stats(bk, false)}`;
    }
    /* ----- Net (Neto): grid out − grid in, the round button between Grid in and Grid out ----- */
    _isNet() { return this._view === 'net' && this._gridBoth(); }
    // Days that have both grid in and grid out, each worked out by the same rules as its own view (edits, month
    // totals, 15-minute totals until the meter total arrives). n = grid out − grid in: plus = more sent than taken.
    _netData() {
      const ci = this._calc(false), co = this._calc(true);
      this._calc();
      const days = new Map();
      for (const k of ci.keys) {
        const a = ci.days.get(k), b = co.days.get(k);
        if (a && a.n && b && b.n) days.set(k, { i: a.t, o: b.t, n: b.t - a.t, q: !!(a.q15 || b.q15) });
      }
      const keys = [...days.keys()].sort();
      return { days, keys, last: keys.length ? keys[keys.length - 1] : null };
    }
    _nSum(from, to) {
      const r = { i: 0, o: 0, n: 0, c: 0 };
      for (const k of this._N.keys) if (k >= from && k <= to) { const x = this._N.days.get(k); r.i += x.i; r.o += x.o; r.c++; }
      r.n = r.o - r.i;
      return r;
    }
    // the days of both grids' 15-minute data, as kW per quarter hour: [{t, i, o, n}]
    _nQuarters(d) {
      const qi = (this._q15 || {})[d], qo = (this._q15o || {})[d];
      if (!Array.isArray(qi) || !Array.isArray(qo) || qi.length < 92 || qo.length !== qi.length) return null;
      const t0 = pd(d).getTime();
      return qi.map((v, j) => { const i = (+v || 0) * 4, o = (+qo[j] || 0) * 4; return { t: new Date(t0 + j * 9e5), i, o, n: o - i }; });
    }
    _renderNet() {
      this._N = this._netData();
      if (!this._N.last) {
        this.$('n-hero').innerHTML = `<div class="empty">${ic('merge')}<b>${t('No days with both grid in and grid out yet')}</b><span>${t('Net appears as soon as Moj Elektro has both for the same day.')}</span></div>`;
        for (const id of NET_IDS.slice(1)) this.$(id).style.display = 'none';
        return;
      }
      this._nHero(); this._nDay(); this._nKpis(); this._nChart(); this._nClock(); this._nYear(); this._nRec(); this._nCal(); this._nLog();
    }
    _nHero() {
      const N = this._N, k = N.last, x = N.days.get(k), pk = N.keys[N.keys.length - 2], p = pk ? N.days.get(pk) : null;
      const pos = x.n >= 0, yest = k === addD(iso(new Date()), -1);
      // days in a row on the same side (plus or minus), without a gap
      let st = 0;
      for (let j = N.keys.length - 1; j >= 0; j--) {
        if ((N.days.get(N.keys[j]).n >= 0) !== pos || (j < N.keys.length - 1 && diffD(N.keys[j], N.keys[j + 1]) !== 1)) break;
        st++;
      }
      const share = x.i + x.o > 0 ? x.i / (x.i + x.o) * 100 : 50, M = Math.max(x.i, x.o) || 1, C1 = 2 * Math.PI * 112, C2 = 2 * Math.PI * 92;
      const cov = x.i > 0 ? Math.round(x.o / x.i * 100) : null, pi = Math.round(share);
      const el = this.$('n-hero'); el.classList.toggle('minus', !pos);
      el.innerHTML = `<div class="nt-hl">
<div class="eyebrow"><span class="pulse"></span>${t('Balance')} · ${yest ? t('yesterday') + ', ' : ''}${fdate(k)}</div>
<div class="big"><span class="bignum nt-${pos ? 'p' : 'n'}">${nsg(x.n)}</span><span class="unit">kWh</span></div>
<div class="nt-say">${pos ? t('You sent <b>{0} kWh more</b> to the grid than you took from it.', fk(x.n)) : t('You took <b>{0} kWh more</b> from the grid than you sent to it.', fk(-x.n))}${x.q ? ` <span class="nt-q">${t('15-min data · meter total tomorrow')}</span>` : ''}</div>
<div class="nt-tug"><div class="nt-split">${x.i > 0 ? `<div class="a${share < 12 ? ' e' : ''}" style="width:${share.toFixed(1)}%">${share < 12 ? '' : `${pi} %`}</div>` : ''}${x.o > 0 ? `<div class="b${share > 88 ? ' e' : ''}">${share > 88 ? '' : `${100 - pi} %`}</div>` : ''}</div>
<div class="nt-tl"><span>${ic('bolt')}${t('Grid in')}<b>${fk(x.i)} kWh</b></span><span>${t('Grid out')}<b>${fk(x.o)} kWh</b>${ic('sun')}</span></div></div>
<div class="pills">${p ? `<span class="pill ${x.n >= p.n ? 'down' : 'up'}">${ic(x.n >= p.n ? 'up' : 'down')}${t('{0} kWh vs the day before', nsg(x.n - p.n))}</span>` : ''}<span class="pill nt-b">${ic('flame')}${t(pos ? '{0} in a row in plus' : '{0} in a row in minus', nDays(st))}</span></div></div>
<div class="nt-ring" data-tip="${ntip(fdate(k), [[t('Grid out'), fk(x.o) + ' kWh', NP], [t('Grid in'), fk(x.i) + ' kWh', NN], [t('Coverage'), cov == null ? '—' : cov + ' %']])}"><svg viewBox="0 0 270 270"><defs>
<linearGradient id="nt-gp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3ef0a8"/><stop offset="1" stop-color="#e8ff6a"/></linearGradient>
<linearGradient id="nt-gn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5d5d"/><stop offset="1" stop-color="#ff8c42"/></linearGradient></defs>
<circle cx="135" cy="135" r="112" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="14"/><circle cx="135" cy="135" r="92" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="14"/>
<circle class="nt-arc" cx="135" cy="135" r="112" fill="none" stroke="url(#nt-gp)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${(C1 * x.o / M * .96).toFixed(1)} ${C1.toFixed(1)}" transform="rotate(-90 135 135)" style="filter:drop-shadow(0 0 10px rgba(62,240,168,.5))"/>
<circle class="nt-arc" cx="135" cy="135" r="92" fill="none" stroke="url(#nt-gn)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${(C2 * x.i / M * .96).toFixed(1)} ${C2.toFixed(1)}" transform="rotate(-90 135 135)" style="filter:drop-shadow(0 0 10px rgba(255,110,70,.45))"/>
</svg><div class="c"><div class="v">${cov == null ? '—' : `${cov}<small>%</small>`}</div><div class="l">${t('coverage')}</div><div class="k"><span><i style="background:${NP}"></i>${t('grid out')}</span><span><i style="background:${NN}"></i>${t('grid in')}</span></div></div></div>`;
    }
    // the days with 15-minute data for both grids, and the one the Neto day chart shows (picked, else the newest)
    _nKeys() { return Object.keys(this._q15 || {}).filter(k => this._nQuarters(k)).sort(); }
    _nDayKey() { const K = this._nKeys(); return this._nday && K.includes(this._nday) ? this._nday : K[K.length - 1]; }
    _nDay() {
      const el = this.$('n-day'), d = this._nDayKey();
      const head = sub => `<div class="ch-h"><div><div class="h-t">${t('Through the day · net')}</div><div class="h-s">${sub}</div></div>${d ? this._pNav(d, 'n') : ''}<span class="badge">kW</span></div>`;
      if (!d) { el.innerHTML = head(t('Moj Elektro · 24 h delay')) + `<div class="empty" style="min-height:240px">${ic('merge')}<b>${t('No 15-minute data for both yet')}</b></div>`; return; }
      const Q = this._nQuarters(d), W = 600, H = 230;
      const mx = Math.max(0.1, ...Q.map(q => q.n)), mn = Math.min(-0.1, ...Q.map(q => q.n)), sc = (H - 22) / (mx - mn), z = 12 + mx * sc;
      const X = j => j / (Q.length - 1) * W, Y = v => z - v * sc;
      const pts = Q.map((q, j) => `${X(j).toFixed(1)},${Y(q.n).toFixed(1)}`), line = 'M' + pts.join('L'), area = `M0,${z.toFixed(1)}L${pts.join('L')}L${W},${z.toFixed(1)}Z`;
      const pk = Q.reduce((a, q) => q.n > a.n ? q : a), lo = Q.reduce((a, q) => q.n < a.n ? q : a), on = Q.filter(q => q.n > 0.0005);
      const ticks = [0, 6, 12, 18, 24].map(h => { const x = h / 24 * W; return `<line x1="${x}" x2="${x}" y1="4" y2="${H}" stroke="rgba(255,255,255,.05)"/><text x="${Math.min(W - 16, Math.max(16, x))}" y="${H + 18}" fill="#59618c" font-size="12" text-anchor="middle">${pad(h)}:00</text>`; }).join('');
      const bw = W / Q.length, hits = Q.map((q, j) => `<rect x="${(j * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}" fill="transparent" data-tip="${ntip(`${fdate(d)} · ${hm(q.t)}`, [[t('Grid out'), fk(q.o) + ' kW', NP], [t('Grid in'), fk(q.i) + ' kW', NN], [t('Net'), nsg(q.n) + ' kW']])}"/>`).join('');
      const tile = (c, l, v, s) => `<div style="--c:${c}"><b>${l}</b><span>${v}</span><em>${s}</em></div>`;
      el.innerHTML = head(`${fdate(d)} · ${t('grid out − grid in, every 15 minutes')}`) + `<svg class="nt-svg" viewBox="0 0 ${W} ${H + 24}"><defs>
<clipPath id="nt-cu"><rect x="0" y="0" width="${W}" height="${z.toFixed(1)}"/></clipPath><clipPath id="nt-cd"><rect x="0" y="${z.toFixed(1)}" width="${W}" height="${H}"/></clipPath>
<linearGradient id="nt-au" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8ff6a" stop-opacity=".55"/><stop offset="1" stop-color="#3ef0a8" stop-opacity=".05"/></linearGradient>
<linearGradient id="nt-ad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8c42" stop-opacity=".05"/><stop offset="1" stop-color="#ff5d5d" stop-opacity=".55"/></linearGradient></defs>
${ticks}<path d="${area}" fill="url(#nt-au)" clip-path="url(#nt-cu)"/><path d="${area}" fill="url(#nt-ad)" clip-path="url(#nt-cd)"/>
<path d="${line}" fill="none" stroke="${NP}" stroke-width="2.2" clip-path="url(#nt-cu)" class="nt-glow"/><path d="${line}" fill="none" stroke="${NN}" stroke-width="2.2" clip-path="url(#nt-cd)"/>
<line x1="0" x2="${W}" y1="${z.toFixed(1)}" y2="${z.toFixed(1)}" stroke="rgba(255,255,255,.3)" stroke-dasharray="3 4"/>
<text x="4" y="16" fill="${NP}" font-size="11.5" font-weight="600">▲ ${t('GRID OUT')}</text><text x="4" y="${H - 6}" fill="${NN}" font-size="11.5" font-weight="600">▼ ${t('GRID IN')}</text>
${pk.n > 0 ? `<circle cx="${X(Q.indexOf(pk)).toFixed(1)}" cy="${Y(pk.n).toFixed(1)}" r="5" fill="#e8ff6a" stroke="#050811" stroke-width="2"/>` : ''}${lo.n < 0 ? `<circle cx="${X(Q.indexOf(lo)).toFixed(1)}" cy="${Y(lo.n).toFixed(1)}" r="5" fill="#ff5d5d" stroke="#050811" stroke-width="2"/>` : ''}
${hits}</svg>
<div class="bpk o3">${tile(NP, t('In plus'), on.length ? `${hm(on[0].t)}–${hm(new Date(+on[on.length - 1].t + 9e5))}` : '—', on.length ? t('quarters in plus: {0}', on.length) : t('no quarter in plus'))}${tile('#e8ff6a', t('Most sent'), pk.n > 0 ? `${fk(pk.n)} kW` : '—', pk.n > 0 ? t('at {0}', hm(pk.t)) : '')}${tile(NN, t('Most taken'), lo.n < 0 ? `${fk(-lo.n)} kW` : '—', lo.n < 0 ? t('at {0}', hm(lo.t)) : '')}</div>`;
    }
    _nKpis() {
      const N = this._N, L = N.last, Ld = pd(L), y = Ld.getFullYear(), m = Ld.getMonth(), dd = Ld.getDate();
      const spark = vals => { const mx = Math.max(0.1, ...vals.map(x => Math.abs(x.v))); return `<div class="nt-sp">${vals.map(x => `<i data-tip="${x.tip}">${x.c ? `<b style="${x.v >= 0 ? `bottom:50%;height:${Math.max(3, x.v / mx * 50).toFixed(1)}%;background:${NP}` : `top:50%;height:${Math.max(3, -x.v / mx * 50).toFixed(1)}%;background:${NN}`}"></b>` : ''}</i>`).join('')}</div>`; };
      const dayTip = (k, s) => ntip(fdate(k), s.c ? [[t('Grid out'), fk(s.o) + ' kWh', NP], [t('Grid in'), fk(s.i) + ' kWh', NN], [t('Net'), nsg(s.n) + ' kWh']] : [[t('No data'), '']]);
      const tile = (label, cmp, s, sp) => `<section class="card nt-kpi"><div class="nt-kl"><span>${label}</span>${cmp}</div><div class="nt-kv ${ncl(s.n)}">${nsg(s.n)}<small>kWh</small></div><div class="nt-ks">${t('grid in {0} · grid out {1} kWh', fk(s.i), fk(s.o))}</div>${sp}</section>`;
      const cmp = (label, tip, s) => s.c ? `<span class="nt-cmp" data-tip="${tip}">${label} ${nsg(s.n)}</span>` : '';
      // last 7 days against the 7 before
      const w = this._nSum(addD(L, -6), L), wp = this._nSum(addD(L, -13), addD(L, -7));
      const wv = [...Array(7)].map((_, j) => { const k = addD(L, j - 6), s = this._nSum(k, k); return { v: s.n, c: s.c, tip: dayTip(k, s) }; });
      // this month against the same days of the month before
      const mf = `${y}-${pad(m + 1)}-01`, ms = this._nSum(mf, L), pm = new Date(y, m - 1, 1), pe = new Date(y, m - 1, Math.min(dd, new Date(y, m, 0).getDate()));
      const mp = this._nSum(iso(pm), iso(pe)), mv = [...Array(dd)].map((_, j) => { const k = iso(new Date(y, m, j + 1)), s = this._nSum(k, k); return { v: s.n, c: s.c, tip: dayTip(k, s) }; });
      // this year against last year up to the same day
      const ys = this._nSum(`${y}-01-01`, L), yp = this._nSum(`${y - 1}-01-01`, `${y - 1}${L.slice(4)}`);
      const yv = [...Array(m + 1)].map((_, j) => { const s = this._nSum(iso(new Date(y, j, 1)), iso(new Date(y, j + 1, 0))); return { v: s.n, c: s.c, tip: ntip(`${MONL[j]} ${y}`, s.c ? [[t('Grid out'), fk(s.o) + ' kWh', NP], [t('Grid in'), fk(s.i) + ' kWh', NN], [t('Net'), nsg(s.n) + ' kWh']] : [[t('No data'), '']]) }; });
      const cov = ys.i > 0 ? ys.o / ys.i * 100 : 0;
      this.$('n-kpis').innerHTML = tile(t('Last 7 days'), cmp(t('week before'), ntip(`${fshort(addD(L, -13))} – ${fshort(addD(L, -7))}`, [[t('Net'), nsg(wp.n) + ' kWh']]), wp), w, spark(wv))
        + tile(t('This month'), cmp(MON[pm.getMonth()], ntip(`${fshort(iso(pm))} – ${fshort(iso(pe))}`, [[t('Net'), nsg(mp.n) + ' kWh']]), mp), ms, spark(mv))
        + tile(t('This year'), cmp(t('last year'), ntip(`${fshort(`${y - 1}-01-01`)} ${y - 1} – ${fshort(`${y - 1}${L.slice(4)}`)}`, [[t('Net'), nsg(yp.n) + ' kWh']]), yp), ys, spark(yv))
        + `<section class="card nt-kpi"><div class="nt-kl"><span>${t('Coverage this year')}</span></div><div class="nt-kv">${ys.i > 0 ? Math.round(cov) : '—'}<small>%</small></div><div class="nt-ks">${t('grid out / grid in since 1 January')}</div><div class="nt-cov"><i style="width:${Math.min(100, cov).toFixed(1)}%"></i></div><div class="nt-ks nt-cs">${cov >= 100 ? t('This year you sent more than you took.') : t('{0} kWh more grid out to reach 100 %.', fk(ys.i - ys.o))}</div></section>`;
    }
    _nChart() {
      const N = this._N, L = N.last, u = this._ui.nrange || 'month', B = [];
      if (u === 'day') for (let j = 29; j >= 0; j--) { const k = addD(L, -j), d = pd(k); B.push({ l: String(d.getDate()), s: DOW2[d.getDay()], title: fdate(k), from: k, to: k, now: !j }); }
      if (u === 'week') { const ws = weekStart(L); for (let j = 11; j >= 0; j--) { const k = addD(ws, -7 * j); B.push({ l: t('W{0}', weekNo(k)), s: fshort(k), title: t('Week {0} · {1} – {2}', weekNo(k), fshort(k), fshort(addD(k, 6))), from: k, to: addD(k, 6), now: !j }); } }
      if (u === 'month') { const d = pd(L); for (let j = 11; j >= 0; j--) { const mo = new Date(d.getFullYear(), d.getMonth() - j, 1); B.push({ l: MON[mo.getMonth()], s: j === 11 || mo.getMonth() === 0 ? String(mo.getFullYear()) : '', title: `${MONL[mo.getMonth()]} ${mo.getFullYear()}`, from: iso(mo), to: iso(new Date(mo.getFullYear(), mo.getMonth() + 1, 0)), now: !j }); } }
      if (u === 'year') { const ly = pd(L).getFullYear(), fy = pd(N.keys[0]).getFullYear(); for (let yy = Math.min(fy, ly - 2); yy <= ly; yy++) B.push({ l: String(yy), s: '', title: String(yy), from: `${yy}-01-01`, to: `${yy}-12-31`, now: yy === ly }); }
      B.forEach(b => Object.assign(b, this._nSum(b.from, b.to)));
      const W = 820, H = 300, z = H / 2, mx = Math.max(0.1, ...B.map(b => Math.max(b.i, b.o))), sc = (z - 20) / mx, bw = W / B.length;
      const gw = Math.min(bw * .62, 80), nw = Math.max(3, Math.min(bw * .3, 36)), lab = B.length <= 12;
      let s = '';
      B.forEach((b, j) => {
        const c = j * bw + bw / 2, nh = Math.abs(b.n) * sc, show = lab || (B.length - 1 - j) % 5 === 0;
        if (b.c) {
          if (b.o > 0) s += `<rect x="${(c - gw / 2).toFixed(1)}" y="${(z - b.o * sc).toFixed(1)}" width="${gw.toFixed(1)}" height="${Math.max(1, b.o * sc - 2).toFixed(1)}" rx="${Math.min(6, gw / 3).toFixed(1)}" fill="url(#nt-go)" opacity=".26"/>`;
          if (b.i > 0) s += `<rect x="${(c - gw / 2).toFixed(1)}" y="${z + 2}" width="${gw.toFixed(1)}" height="${Math.max(1, b.i * sc - 2).toFixed(1)}" rx="${Math.min(6, gw / 3).toFixed(1)}" fill="url(#nt-gi)" opacity=".26"/>`;
          s += `<rect x="${(c - nw / 2).toFixed(1)}" y="${(b.n >= 0 ? z - nh : z).toFixed(1)}" width="${nw.toFixed(1)}" height="${Math.max(2, nh).toFixed(1)}" rx="${Math.min(5, nw / 3).toFixed(1)}" fill="url(#nt-${b.n >= 0 ? 'go' : 'gi'})" class="nt-${b.n >= 0 ? 'gp' : 'gn'}"/>`;
          if (lab) s += `<text x="${c.toFixed(1)}" y="${(b.n >= 0 ? z - nh - 8 : z + nh + 16).toFixed(1)}" fill="${b.n >= 0 ? '#98ffd6' : '#ffc2a8'}" font-size="12" font-weight="600" text-anchor="middle">${nsg(b.n)}</text>`;
        }
        if (show) s += `<text x="${c.toFixed(1)}" y="${H + 18}" fill="${b.now ? '#eef1ff' : '#8f98c2'}" font-size="12.5" font-weight="${b.now ? 600 : 400}" text-anchor="middle">${esc(b.l)}</text>${b.s && lab ? `<text x="${c.toFixed(1)}" y="${H + 34}" fill="#59618c" font-size="11" text-anchor="middle">${esc(b.s)}</text>` : ''}`;
        s += `<rect x="${(j * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}" fill="transparent" data-tip="${ntip(b.title, b.c ? [[t('Grid out'), fk(b.o) + ' kWh', NP], [t('Grid in'), fk(b.i) + ' kWh', NN], [t('Net'), nsg(b.n) + ' kWh'], [t('days with data: {0}', b.c), '']] : [[t('No data'), '']])}"/>`;
      });
      const sub = t({ day: 'Last 30 days', week: 'Last 12 weeks', month: 'Last 12 months', year: 'By year' }[u]);
      this.$('n-chart').innerHTML = `<div class="ch-h"><div><div class="h-t">${t('Balance')}</div><div class="h-s">${sub} · ${t('net = grid out − grid in')}</div></div>${this._tabs(u, 'nrange', [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']])}</div>
<svg class="nt-svg" viewBox="0 0 ${W} ${H + 40}"><defs>
<linearGradient id="nt-go" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8ff6a"/><stop offset="1" stop-color="#3ef0a8"/></linearGradient>
<linearGradient id="nt-gi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8c42"/><stop offset="1" stop-color="#ff5d5d"/></linearGradient></defs>
<line x1="0" x2="${W}" y1="${z}" y2="${z}" stroke="rgba(255,255,255,.28)" stroke-dasharray="3 4"/>${s}</svg>
<div class="legend nt-leg"><span><i style="background:${NP};opacity:.4"></i>${t('Grid out (up)')}</span><span><i style="background:${NN};opacity:.4"></i>${t('Grid in (down)')}</span><span><i style="background:linear-gradient(#e8ff6a,#3ef0a8)"></i>${t('Net in plus')}</span><span><i style="background:linear-gradient(#ff8c42,#ff5d5d)"></i>${t('Net in minus')}</span></div>`;
    }
    _nClock() {
      const el = this.$('n-clock'), L = this._N.last, from = addD(L, -20), sum = Array(24).fill(0), cnt = Array(24).fill(0);
      let nd = 0;
      for (const d of Object.keys(this._q15 || {})) {
        if (d < from || d > L) continue;
        const Q = this._nQuarters(d); if (!Q) continue;
        nd++; for (const q of Q) { const h = q.t.getHours(); sum[h] += q.n; cnt[h]++; }
      }
      const head = `<div class="ch-h"><div><div class="h-t">${t('Sun clock')}</div><div class="h-s">${nd ? t('Average per hour · {0}', lastDays(nd)) : t('Moj Elektro · 24 h delay')}</div></div></div>`;
      if (!nd) { el.innerHTML = head + `<div class="empty" style="min-height:260px">${ic('sun')}<b>${t('No 15-minute data for both yet')}</b></div>`; return; }
      const av = sum.map((s, h) => cnt[h] ? s / cnt[h] : 0), m = Math.max(0.05, ...av.map(Math.abs)), cx = 150, cy = 150, r0 = 78, ro = 58, ri = 40;
      const P = (r, a) => `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
      // noon at the top, the day runs clockwise
      const ang = h => h / 24 * 2 * Math.PI + Math.PI / 2;
      const seg = av.map((v, h) => {
        const a0 = ang(h) + .02, a1 = ang(h + 1) - .02, R = v >= 0 ? r0 + v / m * ro : r0 + v / m * ri, sw = 1;
        return `<path d="M${P(r0, a0)}L${P(R, a0)}A${R.toFixed(1)},${R.toFixed(1)} 0 0 ${sw} ${P(R, a1)}L${P(r0, a1)}A${r0},${r0} 0 0 ${1 - sw} ${P(r0, a0)}Z" fill="url(#nt-${v >= 0 ? 'sg' : 'sn'})" opacity="${(.45 + .55 * Math.abs(v) / m).toFixed(2)}" data-tip="${ntip(`${pad(h)}:00–${pad((h + 1) % 24)}:00`, [[t('Average net'), nsg(v) + ' kW'], [t(v >= 0 ? 'more grid out' : 'more grid in'), '']])}"/>`;
      }).join('');
      const plus = av.map((v, h) => v > 0 ? h : -1).filter(h => h >= 0);
      const lbl = [0, 6, 12, 18].map(h => { const a = ang(h), R = r0 + ro + 14; return `<text x="${(cx + R * Math.cos(a)).toFixed(1)}" y="${(cy + R * Math.sin(a) + 4).toFixed(1)}" fill="#8f98c2" font-size="12" text-anchor="middle">${pad(h)}</text>`; }).join('');
      el.innerHTML = head + `<svg class="nt-clock" viewBox="0 0 300 300"><defs>
<radialGradient id="nt-sg" cx="150" cy="150" r="140" gradientUnits="userSpaceOnUse"><stop offset=".55" stop-color="#3ef0a8"/><stop offset="1" stop-color="#e8ff6a"/></radialGradient>
<radialGradient id="nt-sn" cx="150" cy="150" r="80" gradientUnits="userSpaceOnUse"><stop offset=".45" stop-color="#ff5d5d"/><stop offset="1" stop-color="#ff8c42"/></radialGradient></defs>
<circle cx="150" cy="150" r="${r0 + ro}" fill="none" stroke="rgba(255,255,255,.05)"/><circle cx="150" cy="150" r="${r0 - ri}" fill="rgba(0,0,0,.25)" stroke="rgba(255,255,255,.05)"/>
${seg}<circle cx="150" cy="150" r="${r0}" fill="none" stroke="rgba(255,255,255,.35)" stroke-dasharray="2 4" pointer-events="none"/>${lbl}
<text x="150" y="146" fill="#eef1ff" font-size="20" font-weight="700" text-anchor="middle">${plus.length ? `${plus[0]}–${plus[plus.length - 1] + 1} h` : '—'}</text>
<text x="150" y="164" fill="#8f98c2" font-size="11" text-anchor="middle" letter-spacing="1">${t('IN PLUS')}</text></svg>
<div class="legend nt-leg" style="justify-content:center"><span><i style="background:${NP}"></i>${t('outward: grid out')}</span><span><i style="background:${NN}"></i>${t('inward: grid in')}</span></div>`;
    }
    _nYear() {
      const N = this._N, L = N.last, y = pd(L).getFullYear();
      const run = (yy, to) => { let c = 0; const a = []; for (const k of N.keys) if (k >= `${yy}-01-01` && k <= to) { c += N.days.get(k).n; a.push({ k, c }); } return a; };
      const A = run(y, L), B = run(y - 1, `${y - 1}-12-31`), byMd = new Map(B.map(x => [x.k.slice(5), x.c]));
      const W = 820, H = 260, all = [...A, ...B].map(x => x.c), mx = Math.max(1, ...all), mn = Math.min(-1, ...all), sc = (H - 30) / (mx - mn), z = 15 + mx * sc;
      const X = k => { const d = pd(k); return (d - new Date(d.getFullYear(), 0, 1)) / 864e5 / 365 * W; }, Yv = v => z - v * sc;
      const path = a => a.map((x, j) => `${j ? 'L' : 'M'}${X(x.k).toFixed(1)},${Yv(x.c).toFixed(1)}`).join('');
      const end = A[A.length - 1], same = B.filter(x => x.k.slice(5) <= L.slice(5)).pop();
      const fill = end ? `${path(A)}L${X(end.k).toFixed(1)},${z.toFixed(1)}L${X(A[0].k).toFixed(1)},${z.toFixed(1)}Z` : '';
      const hits = A.map(x => `<rect x="${X(x.k).toFixed(1)}" y="0" width="${(W / 365 + .5).toFixed(2)}" height="${H}" fill="transparent" data-tip="${ntip(fdate(x.k), [[String(y), nsg(x.c) + ' kWh', x.c >= 0 ? NP : NN], ...(byMd.has(x.k.slice(5)) ? [[String(y - 1), nsg(byMd.get(x.k.slice(5))) + ' kWh']] : [])])}"/>`).join('');
      this.$('n-year').innerHTML = `<div class="ch-h"><div><div class="h-t">${t('Year balance')}</div><div class="h-s">${t('Running net total since 1 January')}${B.length ? ` · ${t('this year against last year')}` : ''}</div></div>
<div class="nt-yv"><div class="${ncl(end.c)}">${nsg(end.c)} <small>kWh</small></div>${same ? `<div class="h-s">${t('last year on this day {0} kWh', nsg(same.c))}</div>` : ''}</div></div>
<svg class="nt-svg" viewBox="0 0 ${W} ${H + 24}"><defs>
<clipPath id="nt-ru"><rect x="0" y="0" width="${W}" height="${z.toFixed(1)}"/></clipPath><clipPath id="nt-rd"><rect x="0" y="${z.toFixed(1)}" width="${W}" height="${H}"/></clipPath>
<linearGradient id="nt-ra" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3ef0a8" stop-opacity=".35"/><stop offset="1" stop-color="#3ef0a8" stop-opacity="0"/></linearGradient>
<linearGradient id="nt-rb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a4d" stop-opacity="0"/><stop offset="1" stop-color="#ff7a4d" stop-opacity=".35"/></linearGradient></defs>
${MON.map((mo, j) => `<line x1="${(j / 12 * W).toFixed(1)}" x2="${(j / 12 * W).toFixed(1)}" y1="0" y2="${H}" stroke="rgba(255,255,255,.04)"/><text x="${((j + .5) / 12 * W).toFixed(1)}" y="${H + 18}" fill="#59618c" font-size="12" text-anchor="middle">${mo}</text>`).join('')}
<line x1="0" x2="${W}" y1="${z.toFixed(1)}" y2="${z.toFixed(1)}" stroke="rgba(255,255,255,.28)" stroke-dasharray="3 4"/>
${B.length ? `<path d="${path(B)}" fill="none" stroke="#8f98c2" stroke-width="1.6" stroke-dasharray="5 5" opacity=".6"/>` : ''}
<path d="${fill}" fill="url(#nt-ra)" clip-path="url(#nt-ru)"/><path d="${fill}" fill="url(#nt-rb)" clip-path="url(#nt-rd)"/>
<path d="${path(A)}" fill="none" stroke="${NP}" stroke-width="2.6" clip-path="url(#nt-ru)" class="nt-glow"/><path d="${path(A)}" fill="none" stroke="${NN}" stroke-width="2.6" clip-path="url(#nt-rd)"/>
<circle cx="${X(end.k).toFixed(1)}" cy="${Yv(end.c).toFixed(1)}" r="6" fill="#050811" stroke="${end.c >= 0 ? NP : NN}" stroke-width="3"/>${hits}</svg>
<div class="legend nt-leg"><span><i style="background:${NP}"></i>${t('{0} in plus', y)}</span><span><i style="background:${NN}"></i>${t('{0} in minus', y)}</span>${B.length ? `<span><i style="background:repeating-linear-gradient(90deg,#8f98c2 0 4px,transparent 4px 7px)"></i>${y - 1}</span>` : ''}</div>`;
    }
    // records of one year: the newest by default, [<] [>] step through the years with data (not saved)
    _nRec() {
      const N = this._N, Y = [...new Set(N.keys.map(k => k.slice(0, 4)))], ny = N.last.slice(0, 4);
      const y = Y.includes(this._nrecY) ? this._nrecY : ny, yi = Y.indexOf(y), now = y === ny;
      const D = N.keys.filter(k => k.startsWith(y)).map(k => ({ k, ...N.days.get(k) }));
      const best = D.reduce((a, x) => x.n > a.n ? x : a), worst = D.reduce((a, x) => x.n < a.n ? x : a), plus = D.filter(x => x.n > 0).length;
      const mo = new Map(); for (const x of D) mo.set(x.k.slice(0, 7), (mo.get(x.k.slice(0, 7)) || 0) + x.n);
      const bm = [...mo.entries()].reduce((a, e) => e[1] > a[1] ? e : a), wm = [...mo.entries()].reduce((a, e) => e[1] < a[1] ? e : a);
      const kwh = v => `${nsg(v)}<small>kWh</small>`;
      const arrow = (v, off, label, cls) => `<button class="pn-a${cls}" data-act="nrec" data-v="${v}"${off ? ' disabled' : ''} title="${t(label)}" aria-label="${t(label)}">${ic('back')}</button>`;
      const nav = `<div class="ynav">${arrow(Y[yi - 1] || '', yi <= 0, 'Previous year', '')}${arrow(Y[yi + 1] || '', yi >= Y.length - 1, 'Next year', ' nx')}</div>`;
      let bs = 0, cur = 0, bsEnd = null, prev = null;
      for (const x of D) { cur = x.n > 0 ? (prev && diffD(prev, x.k) === 1 && cur ? cur + 1 : 1) : 0; prev = x.k; if (cur > bs) { bs = cur; bsEnd = x.k; } }
      const row = (icon, c, l, s, v, cl) => `<div><span class="nt-ri" style="--c:${c}">${ic(icon)}</span><span class="nt-rt"><b>${l}</b><span>${s}</span></span><span class="nt-rv ${cl}">${v}</span></div>`;
      this.$('n-rec').innerHTML = `<div class="ch-h"><div><div class="h-t">${now ? t('Records this year') : t('Records {0}', y)}</div><div class="h-s">${now ? t('Since 1 January {0}', y) : t('Whole year {0}', y)}</div></div>${nav}</div><div class="nt-rec">
${row('trophy', NP, t('Best day'), fdate(best.k), kwh(best.n), ncl(best.n))}
${row('down', NN, t('Worst day'), fdate(worst.k), kwh(worst.n), ncl(worst.n))}
${row('sun', '#e8ff6a', t('Best month'), `${MONL[+bm[0].slice(5) - 1]} ${y}`, kwh(bm[1]), ncl(bm[1]))}
${row('moon', NN, t('Worst month'), `${MONL[+wm[0].slice(5) - 1]} ${y}`, kwh(wm[1]), ncl(wm[1]))}
${bs ? row('flame', '#3ee6ff', t('Longest run in plus'), t('until {0}', fdate(bsEnd)), nDays(bs), '') : ''}
${row('week', '#a18bff', t('Days in plus'), now ? t('{0} % of days this year', Math.round(plus / D.length * 100)) : t('{0} % of days in {1}', Math.round(plus / D.length * 100), y), `${plus} / ${D.length}`, '')}</div>`;
    }
    _nCal() {
      const N = this._N, L = N.last, Wk = (this.$('n-cal').clientWidth || innerWidth) < 640 ? 26 : 53, start = addD(weekStart(L), -7 * (Wk - 1));
      const vals = []; for (let j = 0; j < Wk * 7; j++) { const x = N.days.get(addD(start, j)); if (x) vals.push(Math.abs(x.n)); }
      vals.sort((a, b) => a - b);
      const ref = Math.max(0.5, vals.length ? vals[Math.floor(vals.length * .9)] : 1);
      let cells = '', months = '', lastM = -1;
      for (let w = 0; w < Wk; w++) {
        const m = pd(addD(start, w * 7)).getMonth(); months += `<span>${m !== lastM ? MON[m] : ''}</span>`; lastM = m;
        for (let d = 0; d < 7; d++) {
          const k = addD(start, w * 7 + d), x = N.days.get(k);
          if (k > L) { cells += '<i class="f"></i>'; continue; }
          if (!x) { cells += `<i data-tip="${ntip(fdate(k), [[t('No data'), '']])}"></i>`; continue; }
          const a = Math.min(1, Math.abs(x.n) / ref), bg = a < .06 ? '#2a3150' : x.n > 0 ? `rgba(62,240,168,${(.18 + .82 * a).toFixed(2)})` : `rgba(255,122,77,${(.18 + .82 * a).toFixed(2)})`;
          cells += `<i style="background:${bg}" data-tip="${ntip(fdate(k), [[t('Grid out'), fk(x.o) + ' kWh', NP], [t('Grid in'), fk(x.i) + ' kWh', NN], [t('Net'), nsg(x.n) + ' kWh']])}"></i>`;
        }
      }
      this.$('n-cal').innerHTML = `<div class="ch-h"><div><div class="h-t">${t('Balance calendar')}</div><div class="h-s">${t(Wk > 26 ? 'Every day, last 12 months' : 'Every day, last 6 months')}</div></div></div>
<div class="nt-cm" style="--w:${Wk}">${months}</div><div class="nt-cal" style="--w:${Wk}"><div class="nt-cd">${[DOW[1], '', DOW[3], '', DOW[5], '', DOW[0]].map(x => `<span>${x}</span>`).join('')}</div><div class="nt-cg" style="--w:${Wk}">${cells}</div></div>
<div class="nt-scale">${t('more grid in')}<div class="g"></div>${t('more grid out')}</div>`;
    }
    _nLog() {
      const N = this._N, all = !!this._ui.nlogAll, ks = N.keys.slice().reverse(), shown = all ? ks : ks.slice(0, 14);
      const m = Math.max(0.1, ...shown.map(k => Math.abs(N.days.get(k).n)));
      const rows = shown.map(k => { const x = N.days.get(k), w = (Math.abs(x.n) / m * 50).toFixed(1);
        return `<tr><td>${fdate(k)}${x.q ? ` <span class="nt-q" title="${t('15-min data · meter total tomorrow')}">*</span>` : ''}</td><td>${fk(x.i)}</td><td>${fk(x.o)}</td><td class="${ncl(x.n)} nt-nv">${nsg(x.n)}</td><td class="nt-bar"><div class="nt-dv"><i style="${x.n >= 0 ? `left:50%;width:${w}%;background:linear-gradient(90deg,#3ef0a8,#e8ff6a)` : `right:50%;width:${w}%;background:linear-gradient(90deg,#ff5d5d,#ff8c42)`}"></i></div></td></tr>`; }).join('');
      this.$('n-log').innerHTML = `<div class="ch-h"><div><div class="h-t">${t('Log')}</div><div class="h-s">${t('Grid in, grid out and net per day · kWh')}</div></div></div>
<div class="nt-tw"><table class="nt-tbl"><tr><th>${t('Day')}</th><th>${t('Grid in')}</th><th>${t('Grid out')}</th><th>${t('Net')}</th><th class="nt-bar"></th></tr>${rows}</table></div>
${ks.length > 14 ? `<div class="more"><button class="btn sm gh" data-act="nlog">${all ? t('Show less') : t('Show all {0}', ks.length)}</button></div>` : ''}`;
    }
    _renderHeat() {
      const { today, days } = this._c;
      const W = 17, start = addD(weekStart(today), -7 * (W - 1));
      let mx = 0, mn = Infinity; for (let i = 0; i < W * 7; i++) { const o = days.get(addD(start, i)); if (o && o.n) { mx = Math.max(mx, o.t); mn = Math.min(mn, o.t); } }
      const rg = mx - mn || 1;
      let cells = '', months = '', lastM = -1;
      for (let w = 0; w < W; w++) {
        const ws = addD(start, w * 7), m = pd(ws).getMonth();
        months += `<span>${m !== lastM ? MON[m] : ''}</span>`; lastM = m;
        for (let d = 0; d < 7; d++) {
          const k = addD(ws, d), o = days.get(k);
          if (k > today) { cells += `<div class="cell f"></div>`; continue; }
          const lv = o && o.n ? 1 + Math.min(3, Math.floor((o.t - mn) / rg * 4)) : 0;
          cells += `<div class="cell l${lv}${k === today ? ' td' : ''}" data-tip="${esc(`<b>${fdate(k)}</b><div class="${o && o.n ? '' : 'm'}">${o && o.n ? fk(o.t) + ' kWh' : t('No data')}</div>${o && o.q15 ? `<div class="m">${t('15-min data · meter total tomorrow')}</div>` : ''}`)}"></div>`;
        }
      }
      const sums = Array(7).fill(0), cnt = Array(7).fill(0);
      for (let i = 0; i < 84; i++) { const k = addD(today, -i), o = days.get(k); if (o && o.n) { const w = (pd(k).getDay() + 6) % 7; sums[w] += o.t; cnt[w]++; } }
      const av = sums.map((s, i) => cnt[i] ? s / cnt[i] : 0), amx = Math.max(...av) || 1;
      const nz = av.filter(x => x > 0), amn = nz.length ? Math.min(...nz) * 0.7 : 0;
      const wk = [1, 2, 3, 4, 5, 6, 0].map((w, i) => `<div class="wk-c${i > 4 ? ' we' : ''}" data-tip="${esc(`<b>${DOWP[w]}</b><div>${cnt[i] ? t('{0} kWh avg', fk(av[i])) : t('No data')}</div><div class="m">${t('last 12 weeks')}</div>`)}"><i style="height:${av[i] ? Math.max(8, (av[i] - amn) / ((amx - amn) || 1) * 100) : 4}%;--i:${i}"></i><span>${DOW2[w]}</span></div>`).join('');
      this.$('heat').innerHTML = `<div class="ch-h"><div><div class="h-t">${t('Energy rhythm')}</div><div class="h-s">${t('Every day, last {0} weeks', W)}</div></div></div>
<div class="hm-m">${months}</div><div class="hm"><div class="hm-d">${[DOW[1], '', DOW[3], '', DOW[5], '', DOW[0]].map(x => `<span>${x}</span>`).join('')}</div><div class="hm-g">${cells}</div></div>
<div class="hm-leg">${t('less')} <div class="cell"></div><div class="cell l1"></div><div class="cell l2"></div><div class="cell l3"></div><div class="cell l4"></div> ${t('more')}</div>
<div class="wk"><div class="wk-t">${t('Average by weekday')}</div><div class="wk-b">${wk}</div></div>`;
    }
    _renderTariff() {
      const r = this._ui.trange, { today } = this._c;
      const bk = this._buckets(r);
      const any = bk.some(b => b.has);
      // with Moj Elektro the title says it all, so there is no subtitle
      const head = `<div class="ch-h"><div><div class="h-t">Energija VT · MT</div>${this._me ? '' : `<div class="h-s">${t('Big (VT) and small (MT) tariff split')}</div>`}</div><div class="row" style="align-items:center;gap:18px">${this._avgChip('vtmt')}<div class="legend"><span><i class="dot vt"></i>${t('VT · big')}</span><span><i class="dot mt"></i>${t('MT · small')}</span></div>${this._tabs(r, 'trange', [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']])}</div></div>`;
      if (!any) { this.$('tariff').innerHTML = head + `<div class="empty">${ic('sun')}<b>${t('No tariff data yet')}</b><span>${t('Fill in the Energija VT and MT fields when you log a reading{0} to unlock this split.', this._c.s.tmode === 'reading' ? t(' (both readings are needed on two consecutive entries)') : '')}</span></div>`; return; }
      const cur = [...bk].reverse().find(b => b.has);
      const nm = { day: cur.now ? t('Today') : fdate(cur.from), week: cur.now ? t('This week') : cur.title, month: cur.now ? t('This month') : cur.title, year: cur.now ? t('This year') : cur.title }[r];
      const tot = cur.vt + cur.mt, fv = tot ? cur.vt / tot : 0;
      const R = 88, C = 2 * Math.PI * R, gap = tot && fv > 0 && fv < 1 ? 6 : 0;
      const vtLen = Math.max(0, C * fv - gap), mtLen = Math.max(0, C * (1 - fv) - gap);
      const s = this._c.s, cv = s.pVT > 0 ? cur.vt * s.pVT : null, cm = s.pMT > 0 ? cur.mt * s.pMT : null;
      const vS = bk.filter(b => b.has).reduce((a, b) => a + b.vt, 0), mS = bk.filter(b => b.has).reduce((a, b) => a + b.mt, 0);
      const totC = bk.reduce((a, b) => { const x = this._cost(b); return x == null ? a : (a || 0) + x; }, null);
      const sp = r === 'year' ? `${bk[0].label}–${bk[bk.length - 1].label}` : t({ day: '30 days', week: '12 weeks', month: '12 months' }[r]);
      this.$('tariff').innerHTML = head + `<div class="tariff-b">
<div class="donut-w"><div class="dn"><svg viewBox="0 0 200 200"><defs><linearGradient id="dVT" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc857"/><stop offset="1" stop-color="#ff7a3d"/></linearGradient><linearGradient id="dMT" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a18bff"/><stop offset="1" stop-color="#4f8dff"/></linearGradient></defs>
<circle cx="100" cy="100" r="${R}" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="18"/>
<circle cx="100" cy="100" r="${R}" fill="none" stroke="url(#dVT)" stroke-width="18" stroke-linecap="round" stroke-dasharray="${vtLen} ${C}" style="filter:drop-shadow(0 0 8px rgba(255,122,61,.5))"/>
<circle cx="100" cy="100" r="${R}" fill="none" stroke="url(#dMT)" stroke-width="18" stroke-linecap="round" stroke-dasharray="${mtLen} ${C}" stroke-dashoffset="${-(C * fv)}" style="filter:drop-shadow(0 0 8px rgba(161,139,255,.5))"/>
<circle cx="100" cy="100" r="66" fill="none" stroke="rgba(255,255,255,.06)" stroke-dasharray="2 5"/></svg>
<div class="dn-c"><div class="dn-l">${nm}</div><div class="dn-v">${fk(tot)}<small>kWh</small></div><div class="dn-l">${Math.round(fv * 100)}% VT · ${100 - Math.round(fv * 100)}% MT</div></div></div>
<div class="tl"><div class="tl-i vt"><div class="tl-n">${ic('sun')}Energija VT</div><div class="tl-v">${fk(cur.vt)}<small>kWh</small></div><div class="tl-s">${cv != null ? '≈ ' + this._money(cv) : t('big tariff')}</div></div>
<div class="tl-i mt"><div class="tl-n">${ic('moon')}Energija MT</div><div class="tl-v">${fk(cur.mt)}<small>kWh</small></div><div class="tl-s">${cm != null ? '≈ ' + this._money(cm) : t('small tariff')}</div></div></div></div>
<div>${this._bars(bk, true, true, 'vtmt')}<div class="stats"><div class="st"><div class="st-l">VT · ${sp}</div><div class="st-v" style="color:var(--vt1)">${fk(vS)}<small>kWh</small></div><div class="st-s">${s.pVT > 0 ? '≈ ' + this._money(vS * s.pVT) : t('big tariff')}</div></div><div class="st"><div class="st-l">MT · ${sp}</div><div class="st-v" style="color:var(--mt1)">${fk(mS)}<small>kWh</small></div><div class="st-s">${s.pMT > 0 ? '≈ ' + this._money(mS * s.pMT) : t('small tariff')}</div></div><div class="st"><div class="st-l">${t('MT share')}</div><div class="st-v">${vS + mS ? Math.round(mS / (vS + mS) * 100) : 0}<small>%</small></div><div class="st-s">${t('of tariff energy')}</div></div><div class="st"><div class="st-l">${t('Energy cost')}</div><div class="st-v">${totC != null ? this._money(totC) : '—'}</div><div class="st-s">${totC != null ? sp : t('set prices in Ocena računa')}</div></div></div></div></div>`;
    }

    /* ----- Moj Elektro: 15-minute load profile -----
       Only whole days are shown, all fetched from Moj Elektro (or imported from a CSV export). One day at a time:
       the newest one, or the day picked with [<] [date] [>] (not saved, so a reload shows the newest again). */
    _buildProf(render) {
      const out = this._isOut(), Q = 9e5, q15 = (out ? this._q15o : this._q15) || {}, byDay = new Map();
      for (const d in q15) {
        const t0 = pd(d).getTime(), a = [];
        q15[d].forEach((v, i) => { const st = new Date(t0 + i * Q); if (isFinite(v)) a.push({ t: st, kwh: v, kw: v * 4, b: blockOf(st) }); });
        if (a.length) byDay.set(d, a);
      }
      const keys = [...byDay.keys()].sort();
      if (!keys.length) this._prof = null;
      else {
        let best = null;
        for (const d of keys) for (const x of byDay.get(d)) if (!best || x.kw > best.kw) best = x;
        this._prof = { byDay, keys, best, days: keys.length, out };
      }
      if (render) this._renderProf();
    }
    // the agreed-power period that applies on a day: of the periods covering it, the one entered last (Moj Elektro
    // keeps older entries for the same dates), or null
    _agFor(d) {
      let f = null, k = null;
      (this._agreed || []).forEach((p, i) => {
        if (!(p.from <= d && (!p.to || d <= p.to))) return;
        const key = `${p.entered || ''}|${String(i).padStart(4, '0')}`;
        if (k === null || key > k) { f = p; k = key; }
      });
      return f;
    }
    // the agreed power per block on a day, or null: no period, or not set yet (0 kW, e.g. a new user)
    _agOn(d) { const p = this._agFor(d); return p && Array.isArray(p.kw) && p.kw.length === 5 ? p.kw : null; }
    // excess power of the day's month per block, as on the bill: √(Σ (kW − agreed)²) of every quarter hour above
    // the block's agreed power. Uses the month's days in the browser; an archived month is loaded first.
    _excess(day) {
      const m = day.slice(0, 7), P = this._prof, A = this._archDays || { q15: [] };
      if (A.q15.some(d => d.startsWith(m) && !P.byDay.has(d)) && !this._archLoaded.has(m)) {
        if (!this._archBusy) this._loadArch(m).then(ok => { if (ok) this._renderProf(); });
        return null;
      }
      const sq = [0, 0, 0, 0, 0]; let last = null;
      for (const d of P.keys) {
        if (!d.startsWith(m)) continue;
        const ag = this._agOn(d); if (!ag) continue;
        last = d;
        for (const x of P.byDay.get(d)) { const o = x.kw - ag[x.b - 1]; if (o > 0) sq[x.b - 1] += o * o; }
      }
      return last && { m, last, kw: sq.map(v => Math.sqrt(v)) };
    }
    // the day the chart shows: the picked one while it has data, else the newest
    _pDay() {
      const P = this._prof; if (!P) return null;
      return this._pday && P.byDay.has(this._pday) ? this._pday : P.keys[P.keys.length - 1];
    }
    // [<] [date] [>]: the arrows step to the day before / after that has data; the date opens the calendar.
    // sc: 'p' = the 15-minute chart (grid in / grid out), 'n' = the Neto day chart; each keeps its own day
    // the days the navigation offers: the loaded ones and the archived ones (whose data loads when picked)
    _dayKeys(sc) {
      const A = !this._demo && this._archDays || { q15: [], q15o: [] };
      if (sc === 'n') { const o = new Set(A.q15o); return [...new Set([...this._nKeys(), ...A.q15.filter(d => o.has(d))])].sort(); }
      return [...new Set([...(this._prof ? this._prof.keys : []), ...(this._isOut() ? A.q15o : A.q15)])].sort();
    }
    // this day's 15-minute data is in the browser
    _hasDay(k, sc) { return sc === 'n' ? !!this._nQuarters(k) : !!(this._prof && this._prof.byDay.has(k)); }
    _pNav(day, sc = 'p') {
      const K = this._dayKeys(sc), i = K.indexOf(day), yest = day === addD(iso(new Date()), -1), open = this['_' + sc + 'cal'], busy = this._archBusy;
      const arrow = (v, off, label, cls) => `<button class="pn-a${cls}" data-act="pday" data-s="${sc}" data-v="${v}"${off ? ' disabled' : ''} title="${t(label)}" aria-label="${t(label)}">${ic('back')}</button>`;
      return `<div class="pnav">${arrow('prev', i <= 0, 'Previous day', '')}<button class="pn-d${open ? ' open' : ''}" data-act="pday" data-s="${sc}" data-v="cal" title="${t('Choose a day')}">${ic('month')}<span>${busy ? t('Loading…') : yest ? t('Yesterday') : fdate(day)}</span>${ic('chev', 'cv')}</button>${arrow('next', i >= K.length - 1, 'Next day', ' nx')}${open ? this._pCal(day, sc) : ''}</div>`;
    }
    // the calendar: one month, Monday first; only days with 15-minute data can be picked
    _pCal(day, sc = 'p') {
      const K = this._dayKeys(sc), has = new Set(K), m = this['_' + sc + 'calM'] || day.slice(0, 7), [yy, mm] = m.split('-').map(Number);
      const lead = (new Date(yy, mm - 1, 1).getDay() + 6) % 7, n = new Date(yy, mm, 0).getDate();
      const earlier = K[0].slice(0, 7) < m, later = K[K.length - 1].slice(0, 7) > m;
      let g = [1, 2, 3, 4, 5, 6, 0].map(i => `<i>${DOW2[i]}</i>`).join('') + '<span></span>'.repeat(lead);
      for (let d = 1; d <= n; d++) {
        const k = `${m}-${pad(d)}`;
        g += has.has(k) ? `<button class="cal-d${k === day ? ' on' : ''}" data-act="pday" data-s="${sc}" data-v="${k}">${d}</button>` : `<span class="cal-x">${d}</span>`;
      }
      return `<div class="pcal"><div class="cal-h"><button class="pn-a" data-act="pday" data-s="${sc}" data-v="m-"${earlier ? '' : ' disabled'} aria-label="${t('Previous month')}">${ic('back')}</button><span>${MONL[mm - 1]} ${yy}</span><button class="pn-a nx" data-act="pday" data-s="${sc}" data-v="m+"${later ? '' : ' disabled'} aria-label="${t('Next month')}">${ic('back')}</button></div><div class="cal-g">${g}</div></div>`;
    }
    // loads one archived month (both grids) into the 15-minute data; true when loaded
    async _loadArch(m) {
      if (this._archBusy || this._demo || this._archLoaded.has(m)) return false;
      this._archBusy = true; this._renderProf(); if (this._isNet()) this._nDay();
      try {
        const r = await this._ws('q15_month', { month: m });
        for (const [q, key] of [['q15', '_q15'], ['q15o', '_q15o']]) {
          Object.assign(this._archData[q], r[q] || {});
          this[key] = { ...(r[q] || {}), ...this[key] };
        }
        this._archLoaded.add(m);
        return true;
      } catch (e) { this._toast(t('Could not read the 15-minute history')); return false; }
      finally { this._archBusy = false; this._buildProf(false); }
    }
    async _pdayAct(v, sc = 'p') {
      if (this._archBusy) return;
      const K = this._dayKeys(sc), cur = sc === 'n' ? this._nDayKey() : this._pDay(), i = K.indexOf(cur), P = '_' + sc;
      if (!cur) return;
      if (v === 'cal') { this[P + 'cal'] = !this[P + 'cal']; this[P + 'calM'] = null; }
      else if (v === 'm-' || v === 'm+') { const d = pd(`${this[P + 'calM'] || cur.slice(0, 7)}-01`); d.setMonth(d.getMonth() + (v === 'm+' ? 1 : -1)); this[P + 'calM'] = iso(d).slice(0, 7); }
      else {
        const k = v === 'prev' ? K[i - 1] : v === 'next' ? K[i + 1] : v;
        if (!k || !K.includes(k)) return;
        // an archived day: its month is loaded first ("Nalagam…" on the date button), once
        if (!this._hasDay(k, sc)) await this._loadArch(k.slice(0, 7));
        if (!this._hasDay(k, sc)) { if (sc === 'n') this._nDay(); else this._renderProf(); return; }
        // the newest day is kept as "the newest", so the next morning's day replaces it by itself
        this[P + 'day'] = k === K[K.length - 1] ? null : k; this[P + 'cal'] = false; this[P + 'calM'] = null;
      }
      if (sc === 'n') this._nDay(); else this._renderProf();
    }
    // a click outside a date navigation, or Esc, closes its calendar
    _closeCals() {
      if (this._pcal) { this._pcal = false; this._pcalM = null; this._renderProf(); }
      if (this._ncal) { this._ncal = false; this._ncalM = null; if (this._isNet()) this._nDay(); }
    }
    _renderProf() {
      const el = this.$('prof'); if (!this._me || !el || !this._built) return;
      if (this._prof && !!this._prof.out !== this._isOut()) this._buildProf(false);
      if (this._isOut()) { this._renderProfOut(el); return; }
      const P = this._prof, day = this._pDay(), L = day && P.byDay.get(day);
      let h = `<div class="ch-h"><div><div class="h-t">${t('15-minute power')}</div><div class="h-s">${L && L.length ? `${fdate(iso(L[0].t))} ${hm(L[0].t)} → ${hm(L[L.length - 1].t)}` : t('Moj Elektro · 24 h delay')}</div></div>${L ? this._pNav(day) : ''}<span class="badge">kW</span></div>`;
      if (!L || !L.length) { el.innerHTML = h + `<div class="empty" style="min-height:240px">${ic('bolt')}<b>${t(P && P.err ? 'Could not read the 15-minute history' : 'Collecting 15-minute data…')}</b><span>${P && P.err ? esc(P.err) : t('Moj Elektro publishes yesterday’s 15-minute data at about 06:00. It appears here by itself, or tap Update.')}</span></div>`; return; }
      const AGF = this._agFor(day), AG = this._agOn(day), pk = L.reduce((a, s) => s.kw > a.kw ? s : a), mx = nice(pk.kw), peaks = [null, null, null, null, null];
      for (const s of L) if (!peaks[s.b - 1] || s.kw > peaks[s.b - 1].kw) peaks[s.b - 1] = s;
      const bars = L.map((s, i) => `<div class="pc${s === pk ? ' top' : ''}" style="--c:${BLK[s.b - 1]}" data-tip="${esc(`<b>${fdate(iso(s.t))} · ${hm(s.t)}</b><div class="r">${t('Power')}<span class="v">${fk(s.kw)} kW</span></div><div class="r">${t('Energy')}<span class="v">${s.kwh.toFixed(3)} kWh</span></div><div class="r"><i class="dot" style="background:${BLK[s.b - 1]}"></i>Blok ${s.b}</div>`)}"><i style="height:${Math.max(1.5, s.kw / mx * 100)}%;background:${BLK[s.b - 1]};--i:${i}"></i></div>`).join('');
      // with the agreed power: the month's excess power
      // the agreed power for the note: one value when all blocks have it, else B1-B5 in their colours
      let xs = '', agv = '';
      if (AG) {
        agv = AG.every(v => v === AG[0]) ? `${fk(AG[0])} kW` : AG.map((v, i) => `<span style="color:${BLK[i]}">B${i + 1}</span> ${fk(v)}`).join(' · ') + ' kW';
        const X = this._excess(day), parts = X ? X.kw.map((v, i) => +v.toFixed(1) > 0 ? `Blok ${i + 1} <b>${v.toFixed(1)} kW</b>` : '').filter(Boolean) : [];
        if (X) xs = `<div class="xline" data-tip="${esc(t('Excess power as on the bill: per block, the square root of the sum of the squared overshoots in the month.'))}">${t('Excess power in {0}', MONL[+day.slice(5, 7) - 1])}: ${parts.length ? parts.join(' · ') : t('none')}</div>`;
      }
      const xl = L.map((s, i) => s.t.getMinutes() === 0 && s.t.getHours() % 6 === 0 ? `<span style="left:${(i + .5) / L.length * 100}%">${pad(s.t.getHours())}:00</span>` : '').join('');
      const bp = peaks.map((s, i) => { const o = AG && s && s.kw > AG[i]; return `<div style="--c:${BLK[i]}"><b>Blok ${i + 1}</b><span class="${AG ? 'wa' : ''}${o ? ' over' : ''}">${s ? fk(s.kw) : '—'}${s ? `${AG ? `<small class="ag"> / ${fk(AG[i])}</small>` : '<small style="font-size:11px;color:var(--mut);font-weight:500"> kW</small>'}` : ''}</span><em>${s ? `${fshort(iso(s.t))} ${hm(s.t)}` : t('no data')}</em></div>`; }).join('');
      el.innerHTML = h + `<div class="pkrow"><div class="pk-v">${fk(pk.kw)}<small>${t('kW peak')}</small></div><div class="pk-s">${fdate(iso(pk.t))} · ${hm(pk.t)} <span class="bchip" style="--c:${BLK[pk.b - 1]}">Blok ${pk.b}</span></div></div>
<div class="pch">${bars}</div><div class="pxl">${xl}</div>
<div class="bsub" style="margin-top:14px">${t('Highest 15-min power per block · {0}', fdate(day))}</div>
<div class="bpk">${bp}</div>${xs}
<div class="pnote">${t("Your network bill's billed power (obračunska moč) is based on 15-minute peaks like these, per tariff block. Colours show which block each quarter hour falls in.")}${AG ? ` <span class="agn">${t('Agreed power: {0}.', agv)}</span>` : AGF ? ` ${t(AGF.new ? 'Moj Elektro has no agreed power set for this day (new user).' : 'Moj Elektro has no agreed power set for this day.')}` : ''}</div>`;
    }
    // Grid out: the newest complete day of energy sent to the grid, what that day sent out, the net against
    // grid in and the hours it was exporting.
    _renderProfOut(el) {
      const P = this._prof, pday = this._pDay(), L = pday && P.byDay.get(pday);
      const h = `<div class="ch-h"><div><div class="h-t">${t('15-minute power')} · <span class="go">${t('grid out')}</span></div><div class="h-s">${L && L.length ? t('{0} · energy sent to the grid', fdate(iso(L[0].t))) : t('Moj Elektro · 24 h delay')}</div></div>${L ? this._pNav(pday) : ''}<span class="badge" style="color:var(--c1);border-color:rgba(62,240,168,.3);background:rgba(62,240,168,.1)">kW</span></div>`;
      if (!L || !L.length) { el.innerHTML = h + `<div class="empty" style="min-height:240px">${ic('sun')}<b>${t('No grid-out 15-minute data yet')}</b><span>${t('Moj Elektro publishes yesterday’s 15-minute data at about 06:00. It appears here by itself, or tap Update.')}</span></div>`; return; }
      const day = iso(L[0].t), pk = L.reduce((a, s) => s.kw > a.kw ? s : a), mx = nice(pk.kw || .1);
      const bars = L.map((s, i) => `<div class="pc${s === pk && s.kw > 0 ? ' top' : ''}" style="--c:#3ef0a8" data-tip="${esc(`<b>${fdate(iso(s.t))} · ${hm(s.t)}</b><div class="r">${t('Power out')}<span class="v">${fk(s.kw)} kW</span></div><div class="r">${t('Energy out')}<span class="v">${s.kwh.toFixed(3)} kWh</span></div>`)}"><i style="height:${Math.max(1.5, s.kw / mx * 100)}%;background:linear-gradient(180deg,#e8ff6a,#3ef0a8);--i:${i}"></i></div>`).join('');
      const xl = L.map((s, i) => s.t.getMinutes() === 0 && s.t.getHours() % 6 === 0 ? `<span style="left:${(i + .5) / L.length * 100}%">${pad(s.t.getHours())}:00</span>` : '').join('');
      const on = L.filter(s => s.kwh > 0.0005), sent = L.reduce((a, s) => a + s.kwh, 0);
      // grid in of the same day: its 15-minute data, or else Moj Elektro's day total
      const qi = this._q15[day], mi = (this._data.me || []).find(m => m.d === day);
      const used = Array.isArray(qi) && qi.length >= 92 ? qi.reduce((a, x) => a + (+x || 0), 0) : mi && typeof mi.u === 'number' ? mi.u : null;
      const net = used == null ? null : sent - used;
      const end = on.length ? new Date(+on[on.length - 1].t + 9e5) : null, B = P.best;
      const tile = (c, l, v, s) => `<div style="--c:${c}"><b>${l}</b><span>${v}</span><em>${s}</em></div>`;
      el.innerHTML = h + `<div class="pkrow"><div class="pk-v">${fk(pk.kw)}<small>${t('kW peak out')}</small></div><div class="pk-s">${pk.kw > 0 ? `${fdate(day)} · ${hm(pk.t)}` : t('nothing sent out')}</div></div>
<div class="pch">${bars}</div><div class="pxl">${xl}</div>
<div class="bpk o3">${tile('#3ef0a8', t('Sent out'), `${fk(sent)}<small style="font-size:11px;color:var(--mut);font-weight:500"> kWh</small>`, LANG === 'sl' ? `četrture z oddajo: ${on.length}` : `${on.length} quarter${on.length === 1 ? '' : 's'} exporting`)}${tile('#ffc857', t('Net'), net == null ? '—' : `${net > 0 ? '+' : ''}${fk(net)}<small style="font-size:11px;color:var(--mut);font-weight:500"> kWh</small>`, t(net == null ? 'grid in not known yet' : net >= 0 ? 'more out than in' : 'more in than out'))}${tile('#4cc9f0', t('Exporting'), on.length ? `${hm(on[0].t)}–${hm(end)}` : '—', B && B.kw > 0 ? t('best {0} kW · {1}', fk(B.kw), fshort(iso(B.t))) : lastDays(P.days))}</div>
<div class="pnote"><i class="sq"></i>${t("Energy sent to the grid (A−). What you produce and use yourself never passes the meter, so it isn't shown here.")}</div>`;
    }

    /* ----- Moj Elektro: network tariff blocks ----- */
    _renderBlocks() {
      const el = this.$('blocks'); if (!this._me || !el) return;
      const { days, bLast: meLast, today } = this._c, r = this._ui.brange || 'day';
      const legend = `<div class="blegend">${BLK.map((c, i) => `<span><i style="background:${c}"></i>Blok ${i + 1}</span>`).join('')}</div>`;
      const head = `<div class="ch-h"><div><div class="h-t">${t('Časovni bloki · tariff blocks')}</div><div class="h-s">${t('Energy per network tariff block, from Moj Elektro')}</div></div><div class="row" style="align-items:center;gap:18px">${this._avgChip('blk')}${legend}${this._tabs(r, 'brange', [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']])}</div></div>`;
      const y = meLast && days.get(meLast);
      if (!y || !y.b) { el.innerHTML = head + `<div class="empty" style="min-height:160px">${ic('bolt')}<b>${t('No block data yet')}</b><span>${t('The daily automation adds it every morning.')}</span></div>`; return; }
      const rows = (vals, tot) => vals.map((x, i) => `<div class="brow"><span>Blok ${i + 1}</span><div class="bt"><i style="width:${tot ? x / tot * 100 : 0}%;background:${BLK[i]}"></i></div><span class="bv">${fk(x)} kWh<small>${tot ? Math.round(x / tot * 100) : 0}%</small></span></div>`).join('');
      const d = pd(today), ms = this._sum(iso(new Date(d.getFullYear(), d.getMonth(), 1)), today);
      const yt = y.b.reduce((a, x) => a + x, 0), mt = ms.b.reduce((a, x) => a + x, 0);
      let mdays = 0; for (const [k, o] of days) if (k.slice(0, 7) === today.slice(0, 7) && o.b) mdays++;
      el.innerHTML = head + `<div class="blk-b"><div>
<div class="bsub">${meLast === addD(today, -1) ? t('Yesterday') : fdate(meLast)} · ${fk(yt)} kWh${y.bwarn ? ` <span class="btri-i" title="${t('Tariff blocks do not match the day total')}" style="color:var(--vt1)">${ic('warn')}</span>` : ''}</div>${rows(y.b, yt)}
<div class="bgap"></div>
<div class="bsub">${MONL[d.getMonth()]} · ${count(mdays, 'logged day', 'logged days', 'zabeleženi dnevi')} · ${fk(mt)} kWh</div>${rows(ms.b, mt)}
<div class="bnote">${t('Blok 1 is the most expensive network block and only applies on working days from November to February. Weekends, holidays and the lower season (March–October) fall into the cheaper blocks 2–5.')}</div>
</div><div>${this._bars(this._buckets(r), 'b', true, 'blk')}${this._blEditor()}</div></div>`;
    }
    // Časovni bloki > Edit (edit mode, pencil under a day): the five blocks of that day, with their total against
    // the day's Used; saved as a manual edit, so fetching never overwrites it
    _blEditor() {
      const d = this._ui.blEdit, o = d && this._c.days.get(d);
      if (!d || !this._ui.editMode || this._demo) return '';
      const b = o && o.b ? o.b : [0, 0, 0, 0, 0], u = o ? o.t : null;
      return `<div class="bedit"><div class="bedit-h"><b>${t('Edit tariff blocks')} · ${fdate(d)} ${pd(d).getFullYear()}</b><span>${t('Used {0} kWh', `<b style="color:var(--txt)">${fk(u)}</b>`)}</span></div>
<div class="bedit-g">${b.map((x, i) => `<label class="fld"><span><i style="background:${BLK[i]}"></i>Blok ${i + 1}</span><input class="in" id="bl-${i}" inputmode="decimal" autocomplete="off" value="${+(+x).toFixed(3)}"></label>`).join('')}</div>
<div class="bedit-f"><span class="bsum" id="bl-sum"></span><button class="btn sm pri" data-act="bl-save" data-d="${d}">${ic('ok')}${t('Save')}</button><button class="btn sm gh" data-act="bl-cancel">${t('Cancel')}</button></div></div>`;
    }
    _blSum() {
      const el = this.$('bl-sum'), o = this._c.days.get(this._ui.blEdit); if (!el) return;
      const vals = [0, 1, 2, 3, 4].map(i => num(this.$('bl-' + i).value)), tot = vals.reduce((a, x) => a + (x || 0), 0), df = o ? tot - o.t : 0;
      const ok = Math.abs(df) <= 0.05;
      el.className = 'bsum ' + (ok ? 'ok' : 'bad');
      el.innerHTML = `${t('Blocks total {0} kWh', `<b>${fk(tot)}</b>`)} · ${ok ? t('matches the day total') : t('difference {0} kWh', (df > 0 ? '+' : '') + fk(df))}`;
    }
    async _saveBlocks(d) {
      const b = [0, 1, 2, 3, 4].map(i => num(this.$('bl-' + i).value));
      if (b.some(x => x == null || x < 0)) { this._toast(t('Enter a number of kWh')); return; }
      try {
        await this._ws('save_edit', { day: d, grid: 'in', values: { b }, pin: this._pinOk || '' });
        this._ui.blEdit = null; this._toast(t('Saved: {0}', `${fdate(d)} ${pd(d).getFullYear()}`));
      } catch (e) { this._toast(e && e.code === 'wrong_pin' ? t('Wrong PIN') : t('Could not save to Home Assistant — {0}', e && e.message || e)); }
    }

    /* ----- log ----- */
    _renderLog() {
      const { E, s, out } = this._c, ui = this._ui;
      const ED = this._demo ? {} : (this._edits || {});
      // the manual value (Log > Edit, grid-out Add) that wins over Moj Elektro's for a day, in the view shown
      const edv = d => { const e = ED[d]; if (!e) return null; if (out) return typeof e.o === 'number' ? { u: e.o } : null; if (typeof e.vt === 'number' && typeof e.mt === 'number') return { u: e.vt + e.mt, vt: e.vt, mt: e.mt }; return typeof e.u === 'number' ? { u: e.u } : null; };
      const ME = this._demo ? [] : [...((out ? this._data.meOut : this._data.me) || [])];
      for (const d of Object.keys(ED)) if (edv(d) && !ME.some(m => m.d === d)) ME.push({ d, added: true });
      const el = this.$('log');
      if (!E.length && !ME.length) { el.innerHTML = `<div class="ch-h"><div><div class="h-t">${t('Reading log')}</div><div class="h-s">${t("Every counter reading you've entered")}</div></div></div><div class="empty" style="min-height:120px">${ic('meter')}<span>${t('No readings yet')}</span></div>`; return; }
      // after the PIN (Manual meter reading > Edit / Remove entry): a pencil or a bin on every day, and the
      // export / import buttons
      const del = !this._demo && !!ui.delMode, edm = !this._demo && !!ui.editMode, act = del || edm;
      const unlocked = !this._demo && (del || edm || !!ui.formOpen || !!ui.outAdd);
      const tool = (d, k) => del ? `<button class="rb d" data-act="del-day" data-d="${d}" data-k="${k}" title="${t('Delete')}">${ic('del')}</button>` : edm ? `<button class="rb" data-act="${k === 'manual' ? 'edit' : 'ed-day'}" data-d="${d}" title="${t('Edit')}">${ic('edit')}</button>` : '';
      const dash = '<span class="m">—</span>', inp = (id, v) => `<input class="in ed" id="${id}" inputmode="decimal" autocomplete="off" value="${v == null ? '' : +(+v).toFixed(3)}">`;
      const rows = [];
      for (const m of ME) {
        const e = edv(m.d), off = typeof m.u === 'number', bt = Array.isArray(m.b) && m.b.some(x => +x > 0) ? m.b.reduce((a, x) => a + (+x || 0), 0) : null;
        const u = e ? e.u : off ? m.u : bt, vt = e ? e.vt : m.vt, mt = e ? e.mt : m.mt, split = !out && (vt != null && mt != null);
        // what the day is based on, in small print under the source
        const note = e || off ? '' : bt != null ? t('15-min data · VT / MT tomorrow') : t('tariff blocks only');
        const cnt = typeof m.c === 'number' ? `<td class="mono">${rawStr(m.c / s.mult, s.mult)}</td>` : `<td>${dash}</td>`;
        const vir = e || m.added ? t('Manually edited') : 'Moj Elektro';
        const date = `<td>${fdate(m.d)} <span class="m">${pd(m.d).getFullYear()}</span><small class="vir-s">${vir}${note ? ` · ${note}` : ''}</small></td><td class="vcol">${vir}${note ? `<small class="m lnote">${note}</small>` : ''}</td>${cnt}`;
        let cells;
        if (ui.editDay === m.d && edm) {
          // editing: grid out Sent out, grid in VT and MT (the day total is their sum), or the kWh of a 15-minute day
          const btns = `<button class="rb" data-act="ed-save" data-d="${m.d}" title="${t('Save')}">${ic('ok')}</button><button class="rb" data-act="ed-cancel" title="${t('Cancel')}">${ic('x')}</button>`;
          cells = out ? `<td>${inp('ed-o', u)}</td><td>${btns}</td>`
            : split ? `<td class="use" id="ed-sum">${fk(u)} kWh</td><td>${inp('ed-vt', vt)}</td><td>${inp('ed-mt', mt)}</td><td>${btns}</td>`
              : `<td>${inp('ed-u', u)}</td><td>${dash}</td><td>${dash}</td><td>${btns}</td>`;
        } else {
          cells = `${u != null ? `<td class="use">${fk(u)} kWh</td>` : `<td class="m">—</td>`}${out ? '' : `<td class="vtc">${vt != null ? fk(+vt) : dash}</td><td class="mtc">${mt != null ? fk(+mt) : dash}</td>`}${act ? `<td>${tool(m.d, 'me')}</td>` : ''}`;
        }
        rows.push([m.d + 'b', `<tr class="me${e ? ' man' : ''}">${date}${cells}</tr>`]);
      }
      for (let i = E.length - 1; i >= 0; i--) {
        const e = E[i], p = E[i - 1];
        const dt = p ? (e.t - p.t) * s.mult : null;
        const vtu = s.tmode === 'usage' ? e.vt : (p && e.vt != null && p.vt != null ? (e.vt - p.vt) * s.mult : null);
        const mtu = s.tmode === 'usage' ? e.mt : (p && e.mt != null && p.mt != null ? (e.mt - p.mt) * s.mult : null);
        rows.push([e.d + 'a', `<tr><td>${fdate(e.d)} <span class="m">${pd(e.d).getFullYear()}</span><small class="vir-s">${t('Manual reading')}</small></td><td class="vcol">${t('Manual reading')}</td><td class="mono">${rawStr(e.t, s.mult)}</td><td class="${dt == null ? 'm' : dt < 0 ? 'neg' : 'use'}">${dt == null ? t('baseline') : fk(dt) + ' kWh'}</td><td class="vtc">${vtu == null ? dash : fk(vtu)}</td><td class="mtc">${mtu == null ? dash : fk(mtu)}</td>${act ? `<td>${tool(e.d, 'manual')}</td>` : ''}</tr>`]);
      }
      rows.sort((a, b) => a[0] < b[0] ? 1 : -1);
      const show = (ui.all ? rows : rows.slice(0, 8)).map(r => r[1]);
      const first = [...E.map(e => e.d), ...ME.map(m => m.d)].sort()[0];
      const sub = [E.length ? count(E.length, 'manual reading', 'manual readings', 'ročni odčitki') : '', ME.length ? (out ? count(ME.length, 'Moj Elektro grid-out day', 'Moj Elektro grid-out days', 'dnevi oddaje Moj Elektro') : count(ME.length, 'Moj Elektro day', 'Moj Elektro days', 'dnevi Moj Elektro')) : ''].filter(Boolean).join(' · ');
      el.innerHTML = `<div class="ch-h"><div><div class="h-t">${t('Log')}</div><div class="h-s">${t('{0} · since {1}', sub, `${fdate(first)} ${pd(first).getFullYear()}`)}</div></div>${unlocked ? `<div class="row"><button class="btn sm warn" data-act="del-done">${t('Done')}</button><button class="btn sm gh" data-act="export">${ic('down')}${t('Export')}</button><button class="btn sm gh" data-act="import">${ic('up')}${t('Import')}</button></div>` : ''}</div>
<div class="tscroll"><table class="tbl"><thead><tr><th>${t('Date')}</th><th class="vcol">${t('Source')}</th><th>${t('Counter')} ${s.mult === 1000 ? 'MWh' : 'kWh'}</th><th>${t(out ? 'Sent out' : 'Used')}</th>${out ? '' : '<th>VT kWh</th><th>MT kWh</th>'}${act ? '<th></th>' : ''}</tr></thead><tbody>${show.join('')}</tbody></table></div>
${rows.length > 8 ? `<div class="more"><button class="btn sm gh" data-act="all">${ui.all ? t('Show less') : t('Show all {0}', rows.length)}</button></div>` : ''}`;
    }

    /* ----- settings drawer ----- */
    _renderDrawer() {
      const s = this._c.s, open = this._dwOpen, mode = this._mode(), lang = this._langPref();
      const opt = (k, v, b, d) => `<div class="opt${s[k] === v ? ' on' : ''}" data-act="set" data-k="${k}" data-v="${v}"><i></i><div><b>${t(b)}</b><span>${t(d)}</span></div></div>`;
      this.$('dw').innerHTML = `<div class="${open ? 'dw-open' : ''}"${open ? '' : ' hidden'}><div class="dw-bg" data-act="close"></div><aside class="dw">
<div class="row" style="align-items:center;justify-content:space-between"><h3>${t('Settings')}</h3><button class="ibtn" data-act="close">${ic('x')}</button></div>
<div class="dw-s"><div class="dw-t">${t('Display mode')}</div>
${[['auto', 'Automatic', 'Detects the device and adapts to it automatically.'], ['light', 'Minimal', 'No animations, blur or shadows, for slower devices.'], ['full', 'Full', 'All animations and visual effects enabled.']].map(([v, b, d]) => `<div class="opt${mode === v ? ' on' : ''}" data-act="mode" data-v="${v}"><i></i><div><b>${t(b)}</b><span>${t(d)}</span></div></div>`).join('')}</div>
<div class="dw-s"><div class="dw-t">${t('Language')}</div>
${[['auto', t('Automatic'), t('Follows the Home Assistant language.')], ['en', 'English', ''], ['sl', 'Slovenščina', '']].map(([v, b, d]) => `<div class="opt${lang === v ? ' on' : ''}" data-act="lang" data-v="${v}"><i></i><div><b>${b}</b>${d ? `<span>${d}</span>` : ''}</div></div>`).join('')}</div>
${this._me && this._sync === 'shared' && !this._demo ? `<div class="dw-s"><div class="dw-t">${t('Grid')}</div>
${opt('grid', 'in', 'Grid in', 'Energy you take from the grid.')}
${opt('grid', 'both', 'Grid in &amp; Grid out', 'Also the energy you send to the grid (for example from solar panels), with a Grid in / Grid out switch at the top.')}</div>` : ''}
${this._me ? '' : `<div class="dw-s"><div class="dw-t">${t('Counter format')}</div>
${opt('mult', 1000, 'MWh with 3 decimals', '120.622 on the display = 120 622 kWh. For example 121.334 − 120.622 = 712 kWh.')}
${opt('mult', 1, 'Plain kWh', 'The counter already shows kWh (e.g. 120622 or 12.5).')}</div>
<div class="dw-s"><div class="dw-t">${t('Energija VT / MT input')}</div>
${opt('tmode', 'reading', 'Counter readings', 'Type the VT and MT registers from the meter; usage is the difference between readings.')}
${opt('tmode', 'usage', 'kWh used', 'Type how many kWh were used on VT and MT for that day.')}</div>`}
${this._canApiImport() ? `<div class="dw-s"><div class="dw-t">${t('Moj Elektro history')}</div>
<div class="dw-note">${t("Fetches the chosen days straight from Moj Elektro and fills them in: daily usage, VT / MT, month totals and tariff blocks (and the 15-minute chart for the last three weeks){0}. Days already in the log are updated with Moj Elektro's numbers.", this._gridBoth() ? t(', for grid in and grid out') : '')}</div>
<div class="two"><label class="fld"><span>${t('From')}</span><input class="in" type="date" id="imp-from" value="${this._ui.impFrom}" max="${this._impMax()}"${this._importing ? ' disabled' : ''}></label>
<label class="fld"><span>${t('To')}</span><input class="in" type="date" id="imp-to" value="${this._ui.impTo}" max="${this._impMax()}"${this._importing ? ' disabled' : ''}></label></div>
<div class="row"><button class="btn sm gh" data-act="api-import"${this._importing ? ' disabled' : ''}>${ic('sync', this._importing ? 'spin' : '')}${t(this._importing ? 'Importing…' : 'Export &amp; import from Moj Elektro')}</button></div></div>` : ''}
<div class="dw-s"><div class="dw-t">${t('Your data')}</div>
<div class="dw-note">${t(this._sync === 'shared' ? 'Everything is stored by the Daily Energy integration inside Home Assistant (included in its backups) and shared by every user; changes show up live on every open dashboard. New Moj Elektro days are logged automatically. Import accepts Moj Elektro CSV exports (daily readings, daily per block, 15-minute data) and Daily Energy JSON backups.' : 'The Daily Energy integration is not set up, so nothing can be saved.')}</div>
<div class="row"><button class="btn sm gh" data-act="export">${ic('down')}${t('Export JSON')}</button><button class="btn sm gh" data-act="import">${ic('up')}${t('Import CSV / JSON')}</button></div>
${this._isAdmin() && this._sync === 'shared' ? `<div class="row" style="align-items:center">${this._ui.pin
        ? `${this._hasPin ? '<input class="in pin" id="pin" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="PIN">' : `<span class="dw-note" style="margin:0">${t('Delete all data?')}</span>`}<button class="btn sm warn" data-act="clear-ok">${ic('del')}${t('Delete')}</button><button class="btn sm gh" data-act="clear-no">${t('Cancel')}</button>`
        : `<button class="btn sm warn" data-act="clear">${ic('del')}${t('Delete all data')}</button>`}</div>` : ''}</div>
</aside></div>`;
    }
    // Import from Moj Elektro: administrators only (checked by Home Assistant too), with API access
    _canApiImport() { return this._sync === 'shared' && this._api && !this._demo && !!(this._hass && this._hass.user && this._hass.user.is_admin); }
    _impMax() { return addD(iso(new Date()), -1); }
    // The integration fetches one month per call, so the toast can show how far it has got.
    async _apiImport() {
      if (this._importing) return;
      const max = this._impMax();
      let a = this._ui.impFrom, b = this._ui.impTo;
      if (!a || !b) { this._toast(t('Pick both dates')); return; }
      if (a > b) [a, b] = [b, a];
      if (b > max) b = max;
      if (a > b) { this._toast(t('Pick days before today')); return; }
      const spans = [];
      for (let s = a; s <= b;) { const d = pd(s), e = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)), end = e < b ? e : b; spans.push([s, end]); s = addD(end, 1); }
      this._importing = true;
      // phones: Settings covers the whole screen, so it slides away and the dashboard shows the import's progress
      if (isPhone()) this._drawer(false); else this._renderDrawer();
      let days = 0, noTotal = 0, err = null;
      for (let i = 0; i < spans.length && !err; i++) {
        const d = pd(spans[i][0]);
        this._toast(t('Importing from Moj Elektro · {0}…', `${MONL[d.getMonth()]} ${d.getFullYear()}${spans.length > 1 ? ` (${i + 1}/${spans.length})` : ''}`), { hold: true, icon: 'sync' });
        try {
          const r = await this._ws('import_api', { start: spans[i][0], end: spans[i][1] });
          if (r.error) err = r.error; else { days += r.days || 0; noTotal += r.no_total || 0; }
        } catch (e) { err = e && e.code === 'unauthorized' ? t('Only administrators can import') : (e && e.message || String(e)); }
      }
      this._importing = false; this._renderDrawer();
      const done = count(days, 'day updated', 'days updated', 'posodobljeni dnevi');
      if (err) this._toast(t('Import stopped — {0}', `${err}${days ? ` (${done})` : ''}`), { ms: 6000 });
      else if (days) this._toast(t('Imported from Moj Elektro: {0}', `${done}${noTotal ? t(' · {0} without a meter total', noTotal) : ''}`), { ms: 5000 });
      else this._toast(t(noTotal > (pd(b) - pd(a)) / 864e5 ? 'Moj Elektro has no data for those days' : 'Nothing new — those days are already up to date'), { ms: 5000 });
    }
    _drawer(o) { this._dwOpen = o; if (!o && this._ui.pin) { this._ui.pin = false; this._renderDrawer(); } const w = this.$('dw').firstElementChild; if (!w) return;
      // closed, the panel leaves the page completely (display:none): iPhone Safari colours the area behind its bottom bar
      // from elements pinned to the screen's edge, and kept the dark panel's colour after closing
      clearTimeout(this._dwT);
      if (o) { w.hidden = false; void w.offsetWidth; w.classList.add('dw-open'); }
      else { w.classList.remove('dw-open'); this._dwT = setTimeout(() => { if (!this._dwOpen) w.hidden = true; }, 460); }
    }

    /* ----- meters: the meter button and its menu ----- */
    _meterLabel(m) { return m ? (m.name || m.eimm || '—') : '—'; }
    _meterBtn(small) {
      if (!this._meters || !this._meters.length) return '';
      const open = this._mm && this._mm.view;
      const cur = this._meters.find(m => m.id === this._entry) || this._meters[0];
      return `<button class="mpill${small ? ' msm' : ''}${open ? ' open' : ''}" data-act="mm" data-v="list" title="${t('Meters')}">${ic('pin')}<span>${esc(this._meterLabel(cur))}</span>${ic('chev', 'cv')}</button>`;
    }
    _renderMM() {
      const el = this.$('mdd'); if (!el) return;
      const M = this._mm;
      if (!M || !this._meters || !this._meters.length) { el.hidden = true; el.innerHTML = ''; return; }
      const typed = {}; el.querySelectorAll('input').forEach(i => { typed[i.id] = i.value; });
      const err = M.err ? `<div class="merr">${esc(M.err)}</div>` : '';
      const rows = this._meters.map(m => {
        const cur = m.id === this._entry || (!this._entry && m === this._meters[0]);
        if (M.del === m.id) return `<div class="mren del"><div class="mnm"><b>${t('Remove {0}?', esc(this._meterLabel(m)))}</b><small>${t('All data of this meter is deleted.')}</small></div><button class="btn sm dz" data-act="mm-del-ok" data-v="${esc(m.id)}"${M.busy ? ' disabled' : ''}>${t('Remove')}</button><button class="rb" data-act="mm-del-no" title="${t('Cancel')}">${ic('x')}</button></div>`;
        if (M.key === m.id) return `<div class="mren key"><div class="mnm"><b>${t('New API token for {0}', esc(this._meterLabel(m)))}</b><input class="in" id="mm-newtok" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="${t('New API token')}" style="margin-top:6px"><small>${t('Create it at mojelektro.si under API storitve › Kreiraj žeton (tick Neomejeno).')}</small></div><button class="btn sm pri" data-act="mm-key-ok" data-v="${esc(m.id)}"${M.busy ? ' disabled' : ''}>${M.busy ? ic('sync', 'spin') : t('Save')}</button><button class="rb" data-act="mm-key-no" title="${t('Cancel')}">${ic('x')}</button></div>`;
        if (M.edit === m.id) return `<div class="mren"><div class="mnm"><input class="in" id="mm-name" maxlength="30" autocomplete="off" value="${esc(m.name || '')}" placeholder="${t('Any name')}"><small>${esc(m.eimm)}</small></div><button class="rb ok" data-act="mm-save" data-v="${esc(m.id)}" title="${t('Save')}">${ic('ok')}</button><button class="rb" data-act="mm-key" data-v="${esc(m.id)}" title="${t('Change the API token')}" aria-label="${t('Change the API token')}">${ic('key')}</button>${this._meters.length > 1 ? `<button class="rb dz" data-act="mm-del" data-v="${esc(m.id)}" title="${t('Remove')}">${ic('del')}</button>` : ''}</div>`;
        return `<div class="mrow${cur ? ' cur' : ''}" data-act="mm-pick" data-v="${esc(m.id)}"><i class="dt"></i><div class="mnm"><b>${esc(this._meterLabel(m))}</b>${m.name ? `<small>${esc(m.eimm)}</small>` : ''}</div><button class="rb" data-act="mm-edit" data-v="${esc(m.id)}" title="${t('Rename')}">${ic('edit')}</button></div>`;
      }).join('');
      el.innerHTML = `<div class="mlist">${rows}</div>${err}<div class="msep"></div><button class="maddrow" data-act="mm-addha"><i>${ic('plus')}</i>${t('Add a meter')}</button>`;
      el.hidden = false;
      for (const [id, v] of Object.entries(typed)) { const i = this.$(id); if (i && id !== 'mm-name') i.value = v; }
      el.querySelectorAll('input').forEach(i => { i.disabled = !!M.busy; });
      this._placeMM();
    }
    // under its button, arrow pointing at it; full width on phones
    _placeMM() {
      const d = this.$('mdd'), b = [...this.$('hdr').querySelectorAll('[data-act="mm"]')].find(x => x.offsetParent !== null);
      if (!d || d.hidden || !b) return;
      const w = this.shadowRoot.querySelector('.wrap').getBoundingClientRect(), r = b.getBoundingClientRect();
      d.style.top = (r.bottom - w.top + 12) + 'px';
      if (w.width < 640) { d.style.left = '0px'; d.style.right = '0px'; }
      else { d.style.right = 'auto'; d.style.left = Math.max(0, Math.min(w.width - 320, r.left + r.width / 2 - w.left - 160)) + 'px'; }
      const dr = d.getBoundingClientRect();
      d.style.setProperty('--ax', (r.left + r.width / 2 - dr.left - 6) + 'px');
    }
    _closeMM() { if (!this._mm) return; this._mm = null; this._renderMM(); this._renderHdr(); }
    _mmErr(e) {
      const c = e && e.code;
      return c === 'invalid_auth' ? t('Moj Elektro did not accept this API token.')
        : c === 'invalid_meter' ? t('Moj Elektro refused the request. Check the meter ID (EIMM) and that the token belongs to it.')
        : c === 'cannot_connect' ? t('Could not reach the Moj Elektro API. Try again later.')
        : c === 'invalid_format' ? t('Check the API token.') : '';
    }
    async _mmRename(id) {
      const M = this._mm, i = this.$('mm-name'); if (!M || !id || !i || M.busy) return;
      const name = i.value.trim().slice(0, 30);
      M.busy = true; M.err = ''; this._renderMM();
      try { await this._hass.callWS({ type: `${WS}/meters/rename`, meter: id, name }); M.edit = null; await this._loadMeters(); }
      catch (e) { M.err = t('Could not save — {0}', e && e.message || e); }
      M.busy = false; this._renderMM(); this._renderHdr();
    }
    async _mmToken(id) {
      const M = this._mm, i = this.$('mm-newtok'); if (!M || !id || !i || M.busy) return;
      const token = i.value.trim();
      if (!token) { M.err = t('Enter the new API token.'); this._renderMM(); return; }
      M.busy = true; M.err = ''; this._renderMM();
      try {
        const r = await this._hass.callWS({ type: `${WS}/meters/token`, meter: id, token });
        if (r && r.same) { M.busy = false; M.err = t('This is the token already saved.'); this._renderMM(); return; }
        this._closeMM();
        this._toast(r && r.shared > 0 ? t('Token changed (also for the meters with the same token)') : t('Token changed'));
      } catch (e) { M.busy = false; M.err = this._mmErr(e) || t('Could not save — {0}', e && e.message || e); this._renderMM(); }
    }
    async _mmRemove(id) {
      const M = this._mm; if (!M || !id || M.busy) return;
      M.busy = true; M.err = ''; this._renderMM();
      try {
        await this._hass.callWS({ type: `${WS}/meters/remove`, meter: id });
        await this._loadMeters();
        this._mm = this._meters.length > 1 ? { view: 'list' } : null;
        if (id === this._entry && this._meters.length) await this._switchMeter(this._meters[0].id, true);
        this._renderMM(); this._renderHdr(); this._toast(t('Meter removed'));
      } catch (e) { M.busy = false; M.err = t('Could not delete — {0}', e && e.message || e); this._renderMM(); }
    }
    _mmAct(a, v) {
      const M = this._mm;
      if (a === 'mm') { if (M) { this._closeMM(); return; } this._mm = { view: 'list' }; this._renderMM(); this._renderHdr(); this._refreshMeters(); }
      else if (!M) return;
      else if (a === 'mm-pick') this._switchMeter(v);
      else if (a === 'mm-edit') { M.edit = M.edit === v ? null : v; M.del = M.key = null; M.err = ''; this._renderMM(); const i = this.$('mm-name'); if (i) i.focus(); }
      else if (a === 'mm-save') this._mmRename(v);
      else if (a === 'mm-key') { M.key = v; M.edit = M.del = null; M.err = ''; this._renderMM(); const i = this.$('mm-newtok'); if (i) i.focus(); }
      else if (a === 'mm-key-no') { M.key = null; M.err = ''; this._renderMM(); }
      else if (a === 'mm-key-ok') this._mmToken(v);
      else if (a === 'mm-del') { M.del = v; M.edit = M.key = null; M.err = ''; this._renderMM(); }
      else if (a === 'mm-del-no') { M.del = null; M.err = ''; this._renderMM(); }
      else if (a === 'mm-del-ok') this._mmRemove(v);
      else if (a === 'mm-addha') { this._closeMM(); history.pushState(null, '', `/config/integrations/integration/${WS}`); window.dispatchEvent(new CustomEvent('location-changed')); }
    }

    /* ----- events ----- */
    async _click(e) {
      // the meter menu closes with a click anywhere outside it and its button
      if (this._mm && !e.composedPath().some(n => n.id === 'mdd' || (n.dataset && n.dataset.act === 'mm'))) this._closeMM();
      // a click or tap on something with an info box (a bar, a square…) pins that box; anywhere else unpins it
      // the 15-minute calendar closes with a click anywhere outside the date navigation
      if ((this._pcal || this._ncal) && !e.composedPath().some(n => n.classList && n.classList.contains('pnav'))) this._closeCals();
      const tipEl = e.composedPath().find(n => n.dataset && n.dataset.tip != null);
      if (tipEl && !e.target.closest('[data-act]')) { this._tipPin = false; this._tipMove(e); this._tipPin = true; this._tipWatch(); this._tipPinY = this._tipScrollY(); return; }
      if (this._tipPin) this._tipUnpin();
      const t = e.target.closest('[data-act]'); if (!t) return;
      const a = t.dataset.act;
      if (a === 'mm' || a.startsWith('mm-')) { this._mmAct(a, t.dataset.v); return; }
      if (a === 'range') { this._ui.range = t.dataset.v; this._renderChart(); }
      else if (a === 'avgline') { const k = t.dataset.v; LS.set('daily-energy-avg-' + k, this._avgOn(k) ? '0' : '1'); if (k === 'use') this._renderChart(); else if (k === 'vtmt') this._renderTariff(); else this._renderBlocks(); }
      else if (a === 'trange') { this._ui.trange = t.dataset.v; this._renderTariff(); }
      else if (a === 'bill-m') { this._ui.billM = t.dataset.v; this._renderBill(); }
      else if (a === 'bill-open') { this._ui.billOpen = !(this._ui.billOpen ?? !this._phone); this._renderBill(); }
      else if (a === 'bp-open') { this._ui.bpOpen = true; this._renderPrices(); }
      else if (a === 'hb-open') { this._ui.hbOpen = true; this._renderBillWin(); this._renderBill(); }
      else if (a === 'hb-close') { this._ui.hbOpen = false; this._renderBillWin(); }
      else if (a === 'bp-close') { this._ui.bpOpen = false; this._renderPrices(); }
      else if (a === 'bp-save') this._savePrices(false);
      else if (a === 'bp-reset') this._savePrices(true);
      else if (a === 'brange') { this._ui.brange = t.dataset.v; this._renderBlocks(); }
      else if (a === 'pday') this._pdayAct(t.dataset.v, t.dataset.s);
      else if (a === 'nrec') { if (t.dataset.v) { this._nrecY = t.dataset.v; this._nRec(); } }
      else if (a === 'form-toggle') {
        // Moj Elektro mode: "Open" offers Add / Remove entry (behind the PIN when one is set); "Close" closes the form
        if (this._me && !this._ui.formOpen) { this._fd = null; this._askFormPin(); }
        else { this._ui.formOpen = !this._ui.formOpen; this._fd = null; this._renderForm(); }
      }
      else if (a === 'form-pin-ok') this._openFormPin(t.dataset.v);
      else if (a === 'form-pin-no') { this._ui.formPin = false; this._fd = null; this._pinOk = ''; this._renderForm(); }
      else if (a === 'del-done') { Object.assign(this._ui, { delMode: false, editMode: false, editDay: null, blEdit: null, outAdd: false, formOpen: false, formPin: false }); this._pinOk = ''; this._renderForm(); this._renderLog(); this._renderBlocks(); }
      else if (a === 'ed-day') { this._ui.editDay = t.dataset.d; this._renderLog(); setTimeout(() => { const i = this.$('ed-vt') || this.$('ed-u') || this.$('ed-o'); if (i) { i.focus(); i.select(); } }, 50); }
      else if (a === 'ed-cancel') { this._ui.editDay = null; this._renderLog(); }
      else if (a === 'ed-save') this._saveEdit(t.dataset.d);
      else if (a === 'bl-edit') { this._ui.blEdit = this._ui.blEdit === t.dataset.d ? null : t.dataset.d; this._renderBlocks(); this._blSum(); setTimeout(() => { const i = this.$('bl-0'); if (i) { i.focus(); i.select(); } }, 50); }
      else if (a === 'bl-cancel') { this._ui.blEdit = null; this._renderBlocks(); }
      else if (a === 'bl-save') this._saveBlocks(t.dataset.d);
      else if (a === 'oa-save') this._saveOutAdd();
      else if (a === 'del-day') this._delDay(t.dataset.d, t.dataset.k);
      else if (a === 'save') this._saveForm();
      else if (a === 'new') { this._fd = null; this._renderForm(); }
      else if (a === 'edit') {
        this._fd = t.dataset.d;
        if (this._me && !this._ui.formOpen && this._hasPin && !this._pinOk) { this._askFormPin(); this._scrollTo(this.$('form'), 'center'); }
        else { this._ui.formOpen = true; this._renderForm(); this._scrollTo(this.$('form'), 'center'); setTimeout(() => this.$('f-t') && this.$('f-t').focus(), 400); }
      }
      else if (a === 'all') { this._ui.all = !this._ui.all; this._renderLog(); }
      else if (a === 'update') this._checkUpdates();
      else if (a === 'view') this._setView(t.dataset.v);
      else if (a === 'nrange') { this._ui.nrange = t.dataset.v; this._nChart(); }
      else if (a === 'nlog') { this._ui.nlogAll = !this._ui.nlogAll; this._nLog(); }
      else if (a === 'mode') { LS.set('daily-energy-mode', t.dataset.v); this._applyLite(); this._renderAll(); }
      else if (a === 'lang') { LS.set('daily-energy-lang', t.dataset.v); this._renderAll(); this._drawer(true); }
      else if (a === 'settings') { this._renderDrawer(); requestAnimationFrame(() => this._drawer(true)); }
      else if (a === 'close') this._drawer(false);
      else if (a === 'set') {
        let v = t.dataset.v; if (t.dataset.k === 'mult') v = Number(v);
        const on = t.dataset.k === 'grid' && v === 'both' && this._data.settings.grid !== 'both';
        this._data.settings[t.dataset.k] = v; if (this._demo) this._demo = this._genDemo(); this._renderAll(); this._drawer(true); const res = await this._commit({ settings: true });
        // only the meter's first switch to Grid in & Grid out fetches
        if (on) this._toast(res && res.fetching ? tr('Grid out is on, fetching the last 3 days from Moj Elektro.') : tr('Grid out on'), { ms: res && res.fetching ? 6000 : 2800 });
      }
      else if (a === 'demo-on') { this._demo = this._genDemo(); this._shown = 0; this._dwOpen = false; this._renderAll(); this._toast(tr('Demo data loaded — explore away')); }
      else if (a === 'demo-off') { this._demo = null; this._shown = 0; this._renderAll(); }
      else if (a === 'export') this._export();
      else if (a === 'import') this.$('file').click();
      else if (a === 'api-import') this._apiImport();
      // no popup: the row asks for the PIN (or, without a PIN, just to confirm) right there
      else if (a === 'clear') { this._ui.pin = true; this._renderDrawer(); setTimeout(() => this.$('pin') && this.$('pin').focus(), 50); }
      else if (a === 'clear-no') { this._ui.pin = false; this._renderDrawer(); }
      else if (a === 'clear-ok') this._clearAll();
    }
    // Scroll the page's real scroll area (Home Assistant's view, or the window) to an element. scrollIntoView
    // would also scroll the dashboard's clipped frame, which cannot be scrolled back by hand.
    // the element that really scrolls the card: Home Assistant may scroll its own container instead of the page (null)
    _scroller() {
      let n = this, sc = null;
      while (n && !sc) {
        n = n.parentNode instanceof ShadowRoot ? n.parentNode.host : n.parentNode;
        if (n && n.nodeType === 1) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) sc = n; }
      }
      return sc;
    }
    _scrollTo(el, where = 'start') {
      if (!el) return;
      const sc = this._scroller();
      const r = el.getBoundingClientRect(), box = sc ? sc.getBoundingClientRect() : { top: 0, height: innerHeight };
      const top = where === 'center' ? r.top - box.top - (box.height - r.height) / 2 : r.top - box.top - 16;
      (sc || window).scrollBy({ top, behavior: this._lite ? 'auto' : 'smooth' });
    }
    // the PIN is asked every time the box is opened: a PIN entered before is forgotten here
    _askFormPin() { this._pinOk = ''; this._ui.formPin = true; this._renderForm(); setTimeout(() => this.$('fpin') && this.$('fpin').focus(), 50); }
    // The PIN lives in the integration options and is checked by Home Assistant, never in this file.
    // v: 'add' opens the manual reading form (grid out: a day's kWh), 'edit' / 'del' turn on edit / delete mode
    // (a pencil / bin on every day in the Log)
    async _openFormPin(v) {
      if (!v) v = 'add';
      if (this._hasPin && !this._pinOk) {
        const p = this.$('fpin'), pin = p ? p.value : '';
        let ok = false; try { ok = (await this._ws('verify_pin', { pin })).ok; } catch (e) { }
        if (!ok) { this._toast(t('Wrong PIN')); if (p) { p.value = ''; p.focus(); } return; }
        this._pinOk = pin;
      }
      const out = this._c.out;
      Object.assign(this._ui, { formPin: false, delMode: v === 'del', editMode: v === 'edit', editDay: null, blEdit: null, outAdd: v === 'add' && out, formOpen: v === 'add' && !out });
      this._renderForm(); this._renderLog(); this._renderBlocks();
      if (v === 'del' || v === 'edit') { this._scrollTo(this.$('log')); return; }
      setTimeout(() => { const i = this.$(out ? 'oa-o' : 'f-t'); if (i) i.focus(); }, 100);
    }
    // Log > Edit: save one day's manual value (it wins over Moj Elektro until the day is deleted)
    async _saveEdit(d) {
      const out = this._c.out, label = `${fdate(d)} ${pd(d).getFullYear()}`, val = id => { const i = this.$(id); return i ? num(i.value) : null; };
      let values;
      if (out) values = { o: val('ed-o') };
      else if (this.$('ed-vt')) values = { vt: val('ed-vt'), mt: val('ed-mt') };
      else values = { u: val('ed-u') };
      if (Object.values(values).some(x => x == null || x < 0)) { this._toast(t('Enter a number of kWh')); return; }
      try {
        await this._ws('save_edit', { day: d, grid: out ? 'out' : 'in', values, pin: this._pinOk || '' });
        this._ui.editDay = null; this._renderLog(); this._toast(t('Saved: {0}', label));
      } catch (e) { this._toast(e && e.code === 'wrong_pin' ? t('Wrong PIN') : t('Could not save to Home Assistant — {0}', e && e.message || e)); }
    }
    // Grid out > Add: a day's kWh sent to the grid, kept like an edit
    async _saveOutAdd() {
      const d = this.$('oa-d') && this.$('oa-d').value, o = this.$('oa-o') ? num(this.$('oa-o').value) : null;
      if (!d) { this._toast(t('Pick a date')); return; }
      if (o == null || o < 0) { this._toast(t('Enter a number of kWh')); return; }
      try {
        await this._ws('save_edit', { day: d, grid: 'out', values: { o }, pin: this._pinOk || '' });
        this.$('oa-o').value = ''; this._toast(t('Saved: {0}', `${fdate(d)} ${pd(d).getFullYear()}`));
      } catch (e) { this._toast(e && e.code === 'wrong_pin' ? t('Wrong PIN') : t('Could not save to Home Assistant — {0}', e && e.message || e)); }
    }
    // Delete one day of the log shown: a Moj Elektro day (grid in or grid out only, from every card) or a
    // manual reading. The integration checks the PIN.
    async _delDay(d, k) {
      const out = this._c.out, label = `${fdate(d)} ${pd(d).getFullYear()}`;
      try {
        if (k === 'manual') {
          this._data.entries = this._data.entries.filter(x => x.d !== d); this._renderAll();
          await this._commit({ del: [d] }); this._toast(t('Deleted: {0}', label)); return;
        }
        const r = await this._ws('delete_day', { day: d, grid: out ? 'out' : 'in', pin: this._pinOk || '' });
        this._toast(r && r.deleted ? t('Deleted: {0}', label) : t('Nothing to delete for {0}', label));
      } catch (e) { this._toast(e && e.code === 'wrong_pin' ? t('Wrong PIN') : t('Could not delete — {0}', e && e.message || e)); }
    }
    async _clearAll(given) {
      const p = this.$('pin'), pin = given != null ? given : (p ? p.value : '');
      try { await this._ws('clear_all', { pin }); }
      catch (e) { this._toast(e && e.code === 'wrong_pin' ? t('Wrong PIN') : e && e.code === 'unauthorized' ? t('Only administrators can delete data') : t('Could not delete — {0}', e && e.message || e)); if (p) { p.value = ''; p.focus(); } return; }
      this._ui.pin = false; this._demo = null; this._shown = 0; this._renderDrawer(); this._drawer(true); this._toast(t('All data deleted'));
    }
    _isAdmin() { return !!(this._hass && this._hass.user && this._hass.user.is_admin); }
    async _change(e) {
      const t = e.target;
      if (t.id === 'f-d') { this._fd = t.value || null; const ex = this._c.E.find(x => x.d === t.value); if (ex) this._renderForm(); else { const b = this.$('f-badge'); b.textContent = tr('New entry'); b.className = 'badge'; this._preview(); } }
      else if (t.id === 'imp-from') this._ui.impFrom = t.value;
      else if (t.id === 'imp-to') this._ui.impTo = t.value;
      else if (t.dataset && t.dataset.set) { const k = t.dataset.set; this._data.settings[k] = k === 'cur' ? (t.value.trim() || '€') : (num(t.value) || 0); this._calc(); this._renderHero(); this._renderKpis(); this._renderChart(); this._renderTariff(); await this._commit({ settings: true }); }
      else if (t.id === 'file' && t.files[0]) {
        // Moj Elektro CSV exports and Daily Energy JSON backups are parsed and merged by the integration
        const f = t.files[0]; t.value = '';
        try {
          const text = await f.text();
          const r = /\.json$/i.test(f.name) ? await this._ws('import_backup', { data: JSON.parse(text) }) : await this._ws('import_csv', { text });
          const kind = tr({ readings: 'daily meter readings', blocks: 'daily tariff blocks', quarters: '15-minute data', backup: 'backup' }[r.kind] || r.kind);
          this._toast(tr('Imported {0}: {1}', kind, count(r.days, 'day updated', 'days updated', 'posodobljeni dnevi')));
        } catch (err) {
          this._toast(err && err.code === 'unauthorized' ? tr('Only administrators can import') : tr('Could not import — {0}', err && err.message || tr('unknown file')));
        }
      }
    }
    _export() {
      const s = this._snap || {};
      const blob = new Blob([JSON.stringify({ app: 'daily_energy_mojelektro', version: s.version, days: s.days || {}, manual: s.manual || {}, edits: s.edits || {}, settings: s.settings || {} }, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `daily-energy-${iso(new Date())}.json`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    _tipUnpin() { this._tipPin = false; this.$('tip').classList.remove('on'); this._tipEl = null; }
    // where the card is scrolled to, and listening to the container that scrolls it when that is not the page
    _tipScrollY() { return this._tipSc ? this._tipSc.scrollTop : scrollY; }
    _tipWatch() {
      const sc = this._scroller();
      if (sc === this._tipSc) return;
      if (this._tipSc) this._tipSc.removeEventListener('scroll', this._tipOnScroll);
      this._tipSc = sc;
      if (sc) sc.addEventListener('scroll', this._tipOnScroll, { passive: true });
    }
    _tipMove(e) {
      const tip = this.$('tip'); const t = e.composedPath().find(n => n.dataset && n.dataset.tip != null);
      if (!t) { tip.classList.remove('on'); this._tipEl = null; return; }
      if (this._tipEl !== t) { tip.innerHTML = t.dataset.tip; this._tipEl = t; }
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = e.clientX + 16, y = e.clientY - h - 14;
      if (x + w > innerWidth - 8) x = e.clientX - w - 16;
      // always fully on the screen (on a phone there is no room beside the finger)
      x = Math.max(8, Math.min(x, innerWidth - w - 8));
      if (y < 8) y = e.clientY + 18;
      tip.style.left = x + 'px'; tip.style.top = y + 'px'; tip.classList.add('on');
    }
    _toast(msg, o = {}) {
      const t = this.$('toast'); t.innerHTML = ic(o.icon || 'bolt', o.icon === 'sync' ? 'st' : '') + (o.sub ? `<div>${esc(msg)}<small>${esc(o.sub)}</small></div>` : esc(msg)); t.classList.toggle('wait', !!o.hold); t.classList.add('on');
      clearTimeout(this._tt); if (!o.hold) this._tt = setTimeout(() => t.classList.remove('on'), o.ms || 2800);
    }

    /* ----- demo ----- */
    _genDemo() {
      const s = { ...DEF, ...this._data.settings }, r = rng(7), T0 = iso(new Date()), out = [];
      let T = 118240, V = 74100, M = 44140;
      const dec = s.mult === 1000 ? 3 : 1, raw = v => +(v / s.mult).toFixed(dec);
      for (let i = 150; i >= 0; i--) {
        const d = addD(T0, -i), dt = pd(d), we = dt.getDay() === 0 || dt.getDay() === 6;
        const season = 1 + 0.32 * Math.cos(((dt.getMonth() + dt.getDate() / 30) / 12) * 2 * Math.PI);
        const use = i === 150 ? 0 : (15 + r() * 10) * season * (we ? 1.22 : 1);
        const vs = we ? 0.08 + r() * .1 : 0.58 + r() * .12;
        T += use; V += use * vs; M += use * (1 - vs);
        if (i > 0 && i < 150 && r() < 0.1) continue;
        const e = { d, t: raw(T) };
        if (s.tmode === 'usage') { if (i < 150) { e.vt = +(use * vs).toFixed(1); e.mt = +(use * (1 - vs)).toFixed(1); } }
        else { e.vt = raw(V); e.mt = raw(M); }
        out.push(e);
      }
      return out;
    }
  }

  customElements.define(TAG, DailyEnergyCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: TAG, name: 'Daily Energy', description: 'Moj Elektro dashboard: daily/weekly/monthly/yearly usage, VT/MT, tariff blocks and 15-minute power.' });

  /* Full-page sidebar panel registered by the integration (panel_custom). HA sets hass, narrow and panel. */
  class DailyEnergyPanel extends HTMLElement {
    set hass(h) { this._h = h; this._mount(); if (this._card) this._card.hass = h; }
    set panel(p) { this._p = p; this._mount(); }
    set narrow(n) { this._n = n; if (this._menu) this._menu.style.display = n ? '' : 'none'; }
    _mount() {
      if (this._card || !this._h || !this._p) return;
      const cfg = this._p.config || {};
      this.style.display = 'block';
      const menu = this._menu = document.createElement('button');
      menu.title = t('Menu');
      menu.style.cssText = 'position:fixed;top:12px;left:12px;z-index:5;width:40px;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(10,14,30,.7);color:#eef1ff;cursor:pointer;display:none';
      menu.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
      menu.addEventListener('click', () => this.dispatchEvent(new Event('hass-toggle-menu', { bubbles: true, composed: true })));
      if (this._n) menu.style.display = '';
      const card = this._card = document.createElement(TAG);
      card.setConfig({ entry_id: cfg.entry_id });
      this.append(menu, card);
      card.hass = this._h;
    }
  }
  if (!customElements.get('daily-energy-panel')) customElements.define('daily-energy-panel', DailyEnergyPanel);
})();
