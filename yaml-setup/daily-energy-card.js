/* Daily Energy — meter-reading dashboard (type: custom:daily-energy-card)
 * Log the energy counter once a day; the card derives daily / weekly / monthly /
 * yearly usage plus the Energija VT / MT split. Readings are shared by all users:
 * each one is an item in a Local To-do list (config `entity`, default
 * todo.daily_energy_log) whose description holds the JSON. Falls back to per-user
 * storage if the list is unavailable. */
(() => {
  const TAG = 'daily-energy-card';
  if (customElements.get(TAG)) return;
  const KEY = 'daily_energy_card_v1';
  const SET_SUM = 'Daily Energy settings';
  const DEF = { mult: 1000, tmode: 'reading', pVT: 0, pMT: 0, cur: '€' };
  const DEL_PIN = '4085';

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
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const fdate = s => { const d = pd(s); return `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`; };
  const fshort = s => { const d = pd(s); return `${d.getDate()} ${MON[d.getMonth()]}`; };
  const num = v => { if (v == null) return null; const t = String(v).trim().replace(/\s/g, '').replace(',', '.'); if (t === '') return null; const x = Number(t); return isFinite(x) ? x : null; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const grp = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
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

  const I = {
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
    week: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    month: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4M7 13h2M11 13h2M15 13h2M7 17h2M11 17h2"/>',
    year: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    avg: '<path d="M3 17l5-5 4 4 8-8"/><path d="M14 8h6v6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    del: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    down: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    up: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
    spark: '<path d="M12 3l1.9 5.8L20 10l-5 3.6L16.8 20 12 16.3 7.2 20 9 13.6 4 10l6.1-1.2z"/>',
    meter: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h10M7 13h4"/>',
    sync: '<path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>'
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
.root{position:relative;min-height:calc(100vh - var(--header-height,56px));overflow:hidden;
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
.odo{display:inline-flex;align-items:center;padding:8px 10px;gap:3px;border-radius:14px;background:linear-gradient(180deg,#02040a,#0b1124);border:1px solid rgba(255,255,255,.08);box-shadow:inset 0 2px 10px rgba(0,0,0,.8),0 0 0 4px rgba(255,255,255,.02)}
.od{display:inline-block;width:.78em;height:1.25em;overflow:hidden;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:26px;font-weight:700;color:#e9fbff;background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.02) 50%,rgba(255,255,255,.07));border-radius:6px;text-align:center;position:relative;text-shadow:0 0 12px rgba(62,230,255,.6)}
.od.frac{color:#ffd9a8;text-shadow:0 0 12px rgba(255,160,70,.6)}
.od-r{display:flex;flex-direction:column;transition:transform 1.4s cubic-bezier(.2,.9,.1,1)}
.od-r i{font-style:normal;height:1.25em;line-height:1.25em}
.od-sep{font-family:'JetBrains Mono',monospace;font-size:26px;color:var(--vt1);font-weight:700;padding:0 1px}
.gwrap{position:relative;width:260px;height:260px;align-self:center}
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
.wk-c i{width:100%;max-width:30px;border-radius:7px 7px 3px 3px;background:linear-gradient(180deg,rgba(161,139,255,.9),rgba(79,141,255,.35));transform-origin:bottom;animation:grow .9s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i)*50ms)}
.wk-c.we i{background:linear-gradient(180deg,rgba(255,200,87,.95),rgba(255,122,61,.35))}
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
.tbl th:first-child,.tbl td:first-child{text-align:left}
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
.tscroll{overflow-x:auto;margin:0 -6px;padding:0 6px}
.more{display:flex;justify-content:center;margin-top:10px}
/* tooltip, toast, drawer */
.tip{position:fixed;z-index:50;pointer-events:none;padding:10px 13px;border-radius:13px;background:rgba(10,14,30,.92);border:1px solid rgba(255,255,255,.12);box-shadow:0 20px 40px -10px rgba(0,0,0,.8);backdrop-filter:blur(10px);font-size:12.5px;line-height:1.55;color:var(--txt);opacity:0;transform:translateY(6px);transition:opacity .15s,transform .15s;max-width:260px}
.tip.on{opacity:1;transform:none}
.tip b{font-weight:600;font-size:13px}
.tip .m{color:var(--mut)}
.tip .r{display:flex;align-items:center;gap:7px}
.tip .v{margin-left:auto;padding-left:14px;font-weight:600;font-variant-numeric:tabular-nums}
.toast{position:fixed;left:50%;bottom:34px;z-index:60;transform:translate(-50%,30px);opacity:0;transition:.35s cubic-bezier(.2,.8,.2,1);padding:13px 20px;border-radius:16px;background:linear-gradient(135deg,rgba(20,30,60,.95),rgba(30,20,60,.95));border:1px solid rgba(62,230,255,.35);box-shadow:0 20px 50px -10px rgba(62,230,255,.4);font-size:14px;display:flex;align-items:center;gap:10px;pointer-events:none}
.toast.on{opacity:1;transform:translate(-50%,0)}
.toast .ic{width:18px;height:18px;color:var(--c1);fill:var(--c1);stroke:none}
.toast .ic.st{fill:none;stroke:var(--c1)}.toast.wait .ic{animation:spin 1s linear infinite}
.dw-bg{position:fixed;inset:0;z-index:70;background:rgba(2,4,10,.55);backdrop-filter:blur(4px);opacity:0;pointer-events:none;transition:.3s}
.dw{position:fixed;top:0;right:0;bottom:0;z-index:71;width:min(420px,100vw);background:linear-gradient(180deg,#0c1228,#070a16);border-left:1px solid rgba(255,255,255,.08);box-shadow:-30px 0 80px -20px rgba(0,0,0,.8);transform:translateX(105%);transition:transform .45s cubic-bezier(.2,.8,.2,1);padding:26px;overflow-y:auto;display:flex;flex-direction:column;gap:20px}
.dw-open .dw-bg{opacity:1;pointer-events:auto}.dw-open .dw{transform:none}
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
@media (max-width:860px){.tariff-b{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}.hero{grid-template-columns:1fr}.gwrap{margin:0 auto;width:230px;height:230px}}
@media (max-width:640px){.kpis{grid-template-columns:1fr}.two{grid-template-columns:1fr}.ch-b.dense .col:nth-child(even) .xl{visibility:hidden}.card{padding:18px;border-radius:22px}.od,.od-sep{font-size:21px}.hdr .chip{display:none}}
/* moj elektro: 15-min profile + tariff blocks */
.prof{display:flex;flex-direction:column}
.pkrow{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.pk-v{font-size:48px;font-weight:700;letter-spacing:-.035em;line-height:1;font-variant-numeric:tabular-nums}
.pk-v small{font-size:16px;color:var(--mut);margin-left:5px;font-weight:500;letter-spacing:0}
.pk-s{font-size:13px;color:var(--mut);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bchip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;color:var(--c);background:rgba(255,255,255,.06);border:1px solid var(--c)}
.bchip:before{content:'';width:7px;height:7px;border-radius:50%;background:var(--c)}
.pch{position:relative;display:flex;align-items:flex-end;gap:1px;height:170px;margin-top:18px;border-bottom:1px solid rgba(255,255,255,.14)}
.pc{flex:1;height:100%;display:flex;align-items:flex-end;cursor:pointer}
.pc i{display:block;width:100%;border-radius:2px 2px 0 0;min-height:2px;opacity:.85;transform-origin:bottom;animation:grow .8s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i)*6ms)}
.pc:hover i{opacity:1;filter:brightness(1.3)}
.pc.top i{opacity:1;box-shadow:0 0 14px var(--c)}
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
.fold{display:flex;align-items:center;justify-content:space-between;gap:14px}
@media (max-width:860px){.blk-b{grid-template-columns:1fr}.bpk{grid-template-columns:repeat(3,1fr)}}
/* lite mode (slow devices): no blur, no animation, no glow, system fonts */
:host([lite]){font-family:ui-sans-serif,system-ui,Roboto,'Segoe UI',sans-serif}
:host([lite]) *,:host([lite]) *:before,:host([lite]) *:after{animation:none!important;transition:none!important;text-shadow:none!important}
:host([lite]) .blob,:host([lite]) .root:before,:host([lite]) .card:before,:host([lite]) .hero:after,:host([lite]) .logo:after,:host([lite]) .g-spin{display:none}
:host([lite]) .card{backdrop-filter:none;-webkit-backdrop-filter:none;background:#0e1428;box-shadow:none}
:host([lite]) .tip,:host([lite]) .dw-bg{backdrop-filter:none;-webkit-backdrop-filter:none}
:host([lite]) .bignum,:host([lite]) .g-val,:host([lite]) .dn circle{filter:none!important}
:host([lite]) .pc.top i,:host([lite]) .logo,:host([lite]) .chip i,:host([lite]) .dot,:host([lite]) .btn.pri,:host([lite]) .kpi-i,:host([lite]) .bar.tot,:host([lite]) .seg.vt,:host([lite]) .cell.l4,:host([lite]) .seg-tabs button.on,:host([lite]) .toast,:host([lite]) .odo,:host([lite]) .dw{box-shadow:none!important}
:host([lite]) .od,:host([lite]) .od-sep,:host([lite]) input.in.mono,:host([lite]) .fld.vt input.in,:host([lite]) .fld.mt input.in,:host([lite]) .tbl .mono{font-family:ui-monospace,'Roboto Mono',monospace}
`;

  /* ---------- card ---------- */
  class DailyEnergyCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._data = { entries: [], settings: { ...DEF } };
      this._ui = { range: 'day', trange: 'day', all: false };
      this._demo = null; this._loaded = false; this._shown = 0; this._sync = null;
      this._ent = 'todo.daily_energy_log'; this._uids = {}; this._sUid = null; this._dirty = false;
    }
    setConfig(c) { this._config = c || {}; this._ent = this._config.entity || 'todo.daily_energy_log'; }
    getCardSize() { return 24; }
    set hass(h) {
      const first = !this._hass; this._hass = h;
      if (first) {
        // lite: true/false forces the mode; otherwise it is on for users named in lite_users
        const c = this._config || {}, u = h.user || {};
        const names = (c.lite_users || []).map(x => String(x).toLowerCase());
        this._lite = typeof c.lite === 'boolean' ? c.lite : names.includes(String(u.name || '').toLowerCase()) || names.includes(u.id);
        this.toggleAttribute('lite', this._lite);
        if (!this._lite) loadFonts();
        // Moj Elektro: daily values arrive via the log automation; 15-min data is read from history
        const pre = c.mojelektro_prefix || 'sensor.moj_elektro_';
        this._me = c.mojelektro !== false && !!h.states[pre + 'daily_input'];
        this._qEnt = pre + '15min_input';
        this._shell(); this._load();
      }
      const q = this._me && h.states[this._qEnt];
      if (q && q.last_updated !== this._qLU) { this._qLU = q.last_updated; this._loadProfile(); }
    }
    connectedCallback() { this._shell(); if (this._hass && this._sync === 'shared' && !this._unsub) this._load(); }
    disconnectedCallback() { if (this._unsub) { this._unsub(); this._unsub = null; } }

    /* ----- storage: shared to-do list, per-user fallback ----- */
    async _load() {
      try {
        this._unsub = await this._hass.connection.subscribeMessage(m => this._onItems(m.items || []), { type: 'todo/item/subscribe', entity_id: this._ent });
        this._sync = 'shared';
      } catch (e) {
        this._sync = 'local';
        const v = await this._legacy();
        if (v) this._data = { entries: v.entries, settings: { ...DEF, ...(v.settings || {}) } };
        this._loaded = true; this._renderAll();
      }
    }
    async _legacy() {
      let v = null;
      try { const r = await this._hass.callWS({ type: 'frontend/get_user_data', key: KEY }); v = r && r.value; } catch (e) { }
      if (!v) { try { const l = localStorage.getItem(KEY); if (l) v = JSON.parse(l); } catch (e) { } }
      return v && Array.isArray(v.entries) ? v : null;
    }
    _onItems(items) {
      const entries = [], uids = {}, me = [], meUids = {}, q15 = {}; let settings = null, sUid = null;
      for (const it of items) {
        let j = null; try { j = JSON.parse(it.description || ''); } catch (e) { }
        if (!j || typeof j !== 'object') continue;
        if (it.summary === SET_SUM) { settings = j; sUid = it.uid; continue; }
        // exact 15-min kWh per quarter hour for one day (from a Moj Elektro CSV export)
        if (Array.isArray(j.q15)) { if (/^\d{4}-\d{2}-\d{2}$/.test(j.d)) q15[j.d] = j.q15.map(Number); continue; }
        if (j.me === true) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(j.d) || (typeof j.u !== 'number' && !Array.isArray(j.b))) continue;
          if (meUids[j.d]) me.splice(me.findIndex(x => x.d === j.d), 1);
          me.push(j); meUids[j.d] = it.uid; continue;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(j.d) || typeof j.t !== 'number') continue;
        const e = { d: j.d, t: j.t }; if (j.vt != null) e.vt = j.vt; if (j.mt != null) e.mt = j.mt;
        if (uids[j.d]) entries.splice(entries.findIndex(x => x.d === j.d), 1);
        entries.push(e); uids[j.d] = it.uid;
      }
      this._uids = uids; this._sUid = sUid; this._meUids = meUids; this._q15 = q15;
      this._data = { entries, me, settings: { ...DEF, ...(settings || {}) } };
      const first = !this._loaded; this._loaded = true;
      if (this._me) this._buildProf(false);
      this._renderAll(!first);
      if (first && !entries.length && !me.length) this._migrate();
    }
    async _migrate() {
      if (this._migrated) return; this._migrated = true;
      const v = await this._legacy(); if (!v || !v.entries.length) return;
      this._data = { entries: v.entries, me: this._data.me || [], settings: { ...DEF, ...(v.settings || {}) } };
      this._renderAll();
      await this._commit({ put: v.entries, settings: true });
      this._toast(`Moved ${v.entries.length} readings into the shared log`);
    }
    _svc(service, data) { return this._hass.callService('todo', service, data, { entity_id: this._ent }); }
    async _commit({ put = [], del = [], settings = false } = {}) {
      if (this._sync !== 'shared') {
        try { localStorage.setItem(KEY, JSON.stringify(this._data)); } catch (e) { }
        try { await this._hass.callWS({ type: 'frontend/set_user_data', key: KEY, value: this._data }); } catch (e) { }
        return;
      }
      try {
        const gone = del.map(d => this._uids[d]).filter(Boolean);
        if (gone.length) { await this._svc('remove_item', { item: gone }); del.forEach(d => delete this._uids[d]); }
        const mult = this._data.settings.mult;
        for (const e of put) {
          const desc = JSON.stringify(e), lab = `${e.d} · ${rawStr(e.t, mult)}`, uid = this._uids[e.d];
          if (uid) await this._svc('update_item', { item: uid, rename: lab, description: desc });
          else await this._svc('add_item', { item: lab, description: desc });
        }
        if (settings) {
          const desc = JSON.stringify(this._data.settings);
          if (this._sUid) await this._svc('update_item', { item: this._sUid, description: desc });
          else await this._svc('add_item', { item: SET_SUM, description: desc });
        }
      } catch (err) { this._toast('Could not save to Home Assistant — ' + (err && err.message || err)); }
    }

    /* ----- data ----- */
    _calc() {
      const s = { ...DEF, ...this._data.settings };
      const E = [...(this._demo || this._data.entries)].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
      const days = new Map();
      const put = (d, k, v) => { let o = days.get(d); if (!o) { o = { t: 0, vt: 0, mt: 0, n: 0, has: false }; days.set(d, o); } o[k] += v; if (k === 't') o.n = 1; else o.has = true; };
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
      if (!this._demo) for (const m of (this._data.me || [])) {
        const b = Array.isArray(m.b) && m.b.length === 5 ? m.b.map(x => +x || 0) : null, off = typeof m.u === 'number';
        if (!off && !b) continue;
        const bt = b ? b.reduce((a, x) => a + x, 0) : 0;
        days.set(m.d, off
          ? { t: m.u, vt: +m.vt || 0, mt: +m.mt || 0, n: 1, has: m.vt != null && m.mt != null, me: true, b }
          : { t: bt, vt: 0, mt: 0, n: bt > 0 ? 1 : 0, has: false, me: true, b, q15: bt > 0 });
        const ym = m.d.slice(0, 7);
        if (typeof m.mo === 'number' && (!months[ym] || months[ym].thru < m.d)) months[ym] = { t: m.mo, vt: m.mvt, mt: m.mmt, thru: m.d };
        if (off && (!meLast || m.d > meLast)) meLast = m.d;
        if (b && (!bLast || m.d > bLast)) bLast = m.d;
      }
      const keys = [...days.keys()].filter(k => days.get(k).n).sort();
      this._c = { s, E, days, keys, months, meLast, bLast, today: iso(new Date()) };
      return this._c;
    }
    _sum(from, to) {
      const r = { t: 0, vt: 0, mt: 0, n: 0, has: false, b: [0, 0, 0, 0, 0], bh: false };
      for (const [k, o] of this._c.days) if (k >= from && k <= to) {
        r.t += o.t; r.vt += o.vt; r.mt += o.mt; r.n += o.n; if (o.has) r.has = true; if (o.q15) r.q15 = true;
        if (o.b) { o.b.forEach((x, i) => r.b[i] += x); r.bh = true; }
      }
      return r;
    }
    _monthVal(y, mi) {
      const from = iso(new Date(y, mi, 1)), to = iso(new Date(y, mi + 1, 0)), r = this._sum(from, to), mm = this._c.months[from.slice(0, 7)];
      if (mm) {
        // official month-to-date total + any days logged after it (e.g. yesterday's provisional total)
        const x = this._sum(addD(mm.thru, 1), to);
        if (mm.t + x.t >= r.t) {
          r.t = mm.t + x.t; r.n = pd(mm.thru).getDate() + x.n; r.me = true;
          if (mm.vt != null && mm.mt != null) { r.vt = +mm.vt + x.vt; r.mt = +mm.mt + x.mt; r.has = true; }
        }
      }
      return r;
    }
    _cost(o) { const s = this._c.s; return (s.pVT > 0 || s.pMT > 0) && o.has ? o.vt * s.pVT + o.mt * s.pMT : null; }
    _money(v) { return v == null ? '—' : this._c.s.cur + v.toFixed(2); }
    _buckets(unit) {
      const T = this._c.today, out = [];
      if (unit === 'day') for (let i = 29; i >= 0; i--) { const k = addD(T, -i), d = pd(k); out.push({ label: String(d.getDate()), sub: DOW[d.getDay()].slice(0, 2), title: fdate(k), from: k, to: k, now: i === 0 }); }
      if (unit === 'week') { const ws = weekStart(T); for (let i = 11; i >= 0; i--) { const k = addD(ws, -7 * i); out.push({ label: 'W' + weekNo(k), sub: fshort(k), title: `Week ${weekNo(k)} · ${fshort(k)} – ${fshort(addD(k, 6))}`, from: k, to: addD(k, 6), now: i === 0 }); } }
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
<div class="wrap"><header class="hdr" id="hdr"></header><div id="banner"></div>
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
</div></div>
<div id="dw"></div></div>
<div class="tip" id="tip"></div><div class="toast" id="toast"></div>
<input type="file" id="file" accept="application/json,.json" hidden>`;
      const R = this.shadowRoot;
      this.$ = id => R.getElementById(id);
      R.addEventListener('click', e => this._click(e));
      R.addEventListener('input', e => { if (e.target.id && e.target.id.startsWith('f-')) { this._dirty = true; this._preview(); } });
      R.addEventListener('change', e => this._change(e));
      R.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id && e.target.id.startsWith('f-')) this._saveForm(); if (e.key === 'Enter' && e.target.id === 'pin') this._clearAll(); if (e.key === 'Enter' && e.target.id === 'fpin') this._openFormPin(); if (e.key === 'Escape') this._drawer(false); });
      R.addEventListener('pointermove', e => this._tipMove(e));
      R.addEventListener('pointerleave', () => this.$('tip').classList.remove('on'), true);
      this._renderSkeleton();
    }
    _renderSkeleton() {
      this.$('hdr').innerHTML = this._hdrHtml();
      this.$('hero').innerHTML = `<div class="empty">${ic('bolt')}<span>Loading your energy data…</span></div>`;
    }

    _renderAll(remote) {
      if (!this._built) return;
      this._calc();
      // without Moj Elektro the manual form takes the profile's slot next to the hero
      const pr = this.$('prof'), fm = this.$('form');
      pr.classList.toggle('form', !this._me); pr.classList.toggle('prof', !!this._me);
      fm.style.display = this._me ? '' : 'none';
      this.$('blocks').style.display = this._me ? '' : 'none';
      this._renderHdr(); this._renderBanner(); this._renderHero(); if (!(remote && this._dirty)) this._renderForm(); this._renderKpis();
      this._renderChart(); this._renderHeat(); this._renderTariff(); this._renderBlocks(); this._renderLog(); this._renderProf(); if (!(remote && this._dwOpen)) this._renderDrawer();
    }
    _hdrHtml() {
      const d = new Date(), c = this._c || {};
      // only warnings get a chip; normal operation keeps the header clean
      const chip = this._demo ? `<span class="chip warn"><i></i>Demo preview</span>` : this._sync === 'local' ? `<span class="chip warn"><i></i>Shared list unavailable · saved for you only</span>` : '';
      return `<div class="logo">${ic('bolt')}</div><div><h1><span>Daily Energy</span></h1><div class="sub">${DOWL[d.getDay()]}, ${d.getDate()} ${MONL[d.getMonth()]} ${d.getFullYear()}</div></div><div class="sp"></div><div class="chips">${chip}</div>${this._canUpd() ? `<button class="ibtn upd${this._checking ? ' busy' : ''}" data-act="update" title="Check for updates">${ic('sync')}</button>` : ''}<button class="ibtn" data-act="settings" title="Settings">${ic('gear')}</button>`;
    }
    _renderHdr() { this.$('hdr').innerHTML = this._hdrHtml(); }
    // Update button: runs script.daily_energy_check_updates (asks Moj Elektro for new data). Shown only when that script exists.
    _canUpd() { const s = this._hass && this._hass.services && this._hass.services.script; return !!(this._me && s && s.daily_energy_check_updates); }
    async _checkUpdates() {
      if (this._checking || !this._hass) return;
      this._checking = true; this._renderHdr(); this._toast('Checking for updates…', { hold: true, icon: 'sync' });
      const t0 = Date.now(); let msg;
      try {
        const r = await this._hass.callWS({ type: 'call_service', domain: 'script', service: 'daily_energy_check_updates', service_data: {}, return_response: true });
        const res = r && r.response;
        msg = res && res.error ? 'Could not reach Moj Elektro — try again later' : res && res.changed ? 'Updated the cards!' : 'Nothing has been updated yet';
      } catch (e) { msg = 'Could not check for updates — ' + (e && e.message || e); }
      await new Promise(r => setTimeout(r, Math.max(0, 1200 - (Date.now() - t0))));
      this._checking = false; this._renderHdr(); this._toast(msg, { ms: 3500 });
    }
    _renderBanner() {
      const b = this.$('banner');
      if (this._demo) b.innerHTML = `<div class="banner demo">${ic('spark')}<div><b>Demo preview.</b> <span>150 days of sample readings so you can explore — nothing here is saved.</span></div><div class="sp"></div><button class="btn sm gh" data-act="demo-off">Exit demo</button></div>`;
      else if (this._c.E.length < 2 && !this._c.meLast) b.innerHTML = `<div class="banner">${ic('bolt')}<div><b>${this._c.E.length ? 'One more reading to go.' : 'Welcome — log your first meter reading.'}</b> <span>${this._c.E.length ? 'Usage is the difference between two readings, so charts light up after your next entry.' : 'Your first reading is the baseline; every reading after it becomes usage.'}</span></div><div class="sp"></div><button class="btn sm gh" data-act="demo-on">${ic('spark')} Preview with demo data</button></div>`;
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
      const lbl = !hk ? 'Today' : hk === today ? 'Used today' : hk === addD(today, -1) ? 'Used yesterday' : 'Used on';
      const pills = [];
      if (ratio != null) { const p = (ratio - 1) * 100; pills.push(`<span class="pill ${p > 0 ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}% vs 30-day avg</span>`); }
      if (q15) pills.push(`<span class="pill">From 15-min data · VT / MT tomorrow</span>`);
      if (hv && hv.has) pills.push(`<span class="pill"><i class="d" style="background:var(--vt1)"></i>VT ${fk(hv.vt)}</span><span class="pill"><i class="d" style="background:var(--mt1)"></i>MT ${fk(hv.mt)}</span>`);
      const c = hv ? this._cost(hv) : null; if (c != null) pills.push(`<span class="pill">≈ ${this._money(c)}</span>`);
      const ml = this._c.meLast, mm = ml && this._c.months[ml.slice(0, 7)];
      const mv = mm && this._monthVal(pd(ml).getFullYear(), pd(ml).getMonth());
      const thru = mm && keys.filter(k => k.slice(0, 7) === ml.slice(0, 7)).pop();
      const odo = mm ? this._odo(mv.t.toFixed(1)) : last ? this._odo(rawStr(last.t, s.mult)) : '<span class="od-sep" style="color:var(--dim)">— — —</span>';
      const meter = mm
        ? `<div><div class="meter-l">${MONL[pd(ml).getMonth()]} so far · kWh</div><div class="meter-s">Moj Elektro · through ${fdate(thru)}</div></div>`
        : `<div><div class="meter-l">Energy counter</div><div class="meter-s">${last ? 'Last read ' + fdate(last.d) : 'No readings yet'}</div></div>`;
      const C = 2 * Math.PI * 80, arc = C * 0.75, f = ratio == null ? 0 : Math.min(ratio / 2, 1);
      let ticks = ''; for (let i = 0; i <= 30; i++) { const a = (135 + i * 9) * Math.PI / 180, r1 = 98, r2 = i % 5 ? 102 : 106; ticks += `<line x1="${100 + r1 * Math.cos(a)}" y1="${100 + r1 * Math.sin(a)}" x2="${100 + r2 * Math.cos(a)}" y2="${100 + r2 * Math.sin(a)}" stroke="rgba(255,255,255,${i % 5 ? .12 : .3})" stroke-width="1.4"/>`; }
      el.innerHTML = `<div>
 <div class="eyebrow"><span class="pulse"></span>${lbl}${hk ? ' · ' + fdate(hk) : ''}</div>
 <div class="big"><span class="bignum" id="bignum">${hv ? fk(this._shown) : '0'}</span><span class="unit">kWh</span></div>
 <div class="pills">${pills.join('') || `<span class="pill">${this._me ? 'Waiting for the first Moj Elektro day' : 'Log two readings to see daily usage'}</span>`}</div>
 <div class="meter">${meter}<div class="odo">${odo}</div></div>
</div>
<div class="gwrap"><svg class="gauge" viewBox="0 0 200 200">
 <defs><linearGradient id="gG" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#3ee6ff"/><stop offset=".55" stop-color="#7b6bff"/><stop offset="1" stop-color="#ff7a3d"/></linearGradient>
 <filter id="gl" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
 ${ticks}
 <circle class="g-spin" cx="100" cy="100" r="64" fill="none" stroke="rgba(123,107,255,.35)" stroke-width="1.5" stroke-dasharray="1 7"/>
 <g transform="rotate(135 100 100)"><circle cx="100" cy="100" r="80" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="13" stroke-linecap="round" stroke-dasharray="${arc} ${C}"/>
 <circle class="g-val" id="gval" cx="100" cy="100" r="80" fill="none" stroke="url(#gG)" stroke-width="13" stroke-linecap="round" stroke-dasharray="0 ${C}" filter="url(#gl)" opacity="${f > 0 ? 1 : 0}" data-to="${arc * f} ${C}"/></g>
 <circle cx="100" cy="11" r="3.5" fill="#fff" opacity=".85"/><text x="100" y="-2" fill="#8f98c2" font-size="8" text-anchor="middle" letter-spacing="1">AVG</text>
</svg><div class="g-c"><div class="g-v">${ratio == null ? '—' : Math.round(ratio * 100)}<small>%</small></div><div class="g-l">of your average</div><div class="g-a">avg ${avg == null ? '—' : fk(avg)} kWh/day</div></div></div>`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const g = this.$('gval'); if (g) g.setAttribute('stroke-dasharray', g.dataset.to);
        this.shadowRoot.querySelectorAll('.od-r').forEach(r => r.style.transform = `translateY(-${r.dataset.v * 10}%)`);
      }));
      if (hv) this._count(this.$('bignum'), hv.t);
    }
    _odo(str) {
      const dot = str.indexOf('.');
      return str.split('').map((ch, i) => /\d/.test(ch)
        ? `<span class="od${dot >= 0 && i > dot ? ' frac' : ''}"><span class="od-r" data-v="${ch}">${'0123456789'.split('').map(x => `<i>${x}</i>`).join('')}</span></span>`
        : `<span class="od-sep">${ch}</span>`).join('');
    }
    _count(el, to) {
      if (!el) return;
      if (this._lite) { el.textContent = fk(to); this._shown = to; return; }
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
      if (this._me && !this._ui.formOpen) {
        host.innerHTML = `<div class="fold"><div><div class="h-t">Manual meter reading</div><div class="h-s">Optional — Moj Elektro now logs your usage automatically every day</div></div>${this._ui.formPin
          ? `<div class="row" style="align-items:center"><input class="in pin" id="fpin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="PIN"><button class="btn sm gh" data-act="form-pin-ok">${ic('edit')}Open</button><button class="btn sm gh" data-act="form-pin-no">Cancel</button></div>`
          : `<button class="btn sm gh" data-act="form-toggle">${ic('edit')}Open</button>`}</div>`;
        return;
      }
      host.innerHTML = `<div class="ch-h" style="margin-bottom:4px"><div><div class="h-t">${this._me ? 'Manual meter reading' : 'Log a reading'}</div><div class="h-s">Type exactly what your energy counter shows</div></div><div class="row" style="align-items:center"><span class="badge ${ex ? 'ed' : ''}" id="f-badge">${ex ? (d === today ? 'Logged today ✓' : 'Editing') : 'New entry'}</span>${this._me ? `<button class="btn sm gh" data-act="form-toggle">Close</button>` : ''}</div></div>
<label class="fld"><span>Date</span><input class="in" type="date" id="f-d" value="${d}" max="${today}"></label>
<label class="fld"><span>${ic('meter')} Total counter</span><div class="iw"><input class="in mono" id="f-t" inputmode="decimal" autocomplete="off" placeholder="${s.mult === 1000 ? '121.334' : '121334'}" value="${ex ? rawStr(ex.t, s.mult) : ''}"><em>${u}</em></div></label>
<div class="two">
 <label class="fld vt"><span><i class="dot vt"></i>Energija VT <small>${usage ? 'kWh used' : 'big tariff'}</small></span><div class="iw"><input class="in" id="f-vt" inputmode="decimal" autocomplete="off" placeholder="optional" value="${ex && ex.vt != null ? (usage ? ex.vt : rawStr(ex.vt, s.mult)) : ''}"><em>${tu}</em></div></label>
 <label class="fld mt"><span><i class="dot mt"></i>Energija MT <small>${usage ? 'kWh used' : 'small tariff'}</small></span><div class="iw"><input class="in" id="f-mt" inputmode="decimal" autocomplete="off" placeholder="optional" value="${ex && ex.mt != null ? (usage ? ex.mt : rawStr(ex.mt, s.mult)) : ''}"><em>${tu}</em></div></label>
</div>
<div class="prev" id="f-prev"></div>
<div class="acts"><button class="btn pri" data-act="save">${ic('bolt')}${ex ? 'Update reading' : 'Save reading'}</button>${ex ? `<button class="btn gh" data-act="new">Cancel</button>` : ''}</div>`;
      this._preview();
    }
    _fv() { const g = id => this.$(id); return { d: g('f-d').value, t: num(g('f-t').value), vt: num(g('f-vt').value), mt: num(g('f-mt').value) }; }
    _preview() {
      const P = this.$('f-prev'); if (!P) return;
      const { s, E } = this._c; const v = this._fv();
      const prev = [...E].reverse().find(e => e.d < v.d), next = E.find(e => e.d > v.d);
      P.className = 'prev';
      if (v.t == null) { P.innerHTML = prev ? `<div>Previous reading <b style="color:var(--txt);font-family:'JetBrains Mono',monospace">${rawStr(prev.t, s.mult)}</b> on ${fdate(prev.d)}</div><div>Enter today's number and I'll work out the usage instantly.</div>` : `<div><b style="color:var(--txt)">This will be your baseline.</b></div><div>Usage appears from your second reading onward.</div>`; return; }
      if (!prev) { P.innerHTML = `<div><b style="color:var(--txt)">Baseline reading</b> — ${next ? 'earlier than your other readings.' : 'the next reading will show usage.'}</div>`; return; }
      const n = diffD(prev.d, v.d), dt = (v.t - prev.t) * s.mult;
      if (dt < 0) { P.className = 'prev bad'; P.innerHTML = `<div><b>Lower than the previous reading</b> (${rawStr(prev.t, s.mult)} on ${fshort(prev.d)}).</div><div>Double-check the digits — counters only go up.</div>`; return; }
      let tr = '';
      if (s.tmode === 'reading' && v.vt != null && v.mt != null && prev.vt != null && prev.mt != null) tr = `<div class="tr"><span><i class="dot vt"></i>VT +${fk((v.vt - prev.vt) * s.mult)} kWh</span><span><i class="dot mt"></i>MT +${fk((v.mt - prev.mt) * s.mult)} kWh</span></div>`;
      if (s.tmode === 'usage' && (v.vt != null || v.mt != null)) tr = `<div class="tr"><span><i class="dot vt"></i>VT ${fk(v.vt || 0)} kWh</span><span><i class="dot mt"></i>MT ${fk(v.mt || 0)} kWh</span></div>`;
      P.innerHTML = `<div class="pv">+${fk(dt)} <small>kWh</small></div><div>over ${n} day${n > 1 ? 's' : ''} since ${fdate(prev.d)}${n > 1 ? ` · ${fk(dt / n)} kWh/day` : ''}</div>${tr}`;
    }
    async _saveForm() {
      if (this._demo) { this._toast('Exit the demo preview to log real readings'); return; }
      const v = this._fv(), { s, E } = this._c;
      if (!v.d) { this._toast('Pick a date'); return; }
      if (v.t == null) { this._toast('Enter the total counter reading'); this.$('f-t').focus(); return; }
      const prev = [...E].reverse().find(e => e.d < v.d), next = E.find(e => e.d > v.d);
      if ((prev && v.t < prev.t) || (next && v.t > next.t)) { if (!confirm('This reading does not fit between your neighbouring readings (counters only go up). Save anyway?')) return; }
      const e = { d: v.d, t: v.t }; if (v.vt != null) e.vt = v.vt; if (v.mt != null) e.mt = v.mt;
      this._data.entries = this._data.entries.filter(x => x.d !== v.d).concat(e);
      this._fd = null; this._ui.formOpen = false;
      const dt = prev ? (v.t - prev.t) * s.mult : null;
      this._renderAll(); await this._commit({ put: [e] });
      this._toast(dt != null && dt >= 0 ? `Saved · +${fk(dt)} kWh since ${fshort(prev.d)}` : 'Reading saved');
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
        tile(0, '#3ef0a8', '#3ee6ff', 'Daily average · this month', avg, peak ? `Peak <b>${fk(peak.v)}</b> kWh on ${fshort(peak.k)}` : MONL[d.getMonth()], dm, 'avg') +
        tile(1, '#3ee6ff', '#5b8cff', 'This week', wk.n ? wk.t : null, `Last week <b>${lw.n ? fk(lw.t) : '—'}</b> kWh${cost(wk)}`, wks, 'week') +
        tile(2, '#8f7dff', '#c07bff', `${MONL[d.getMonth()]}${mo.me ? ' · Moj Elektro' : ''}`, mo.n ? mo.t : null, `Projected <b>${proj == null ? '—' : fk(proj)}</b> kWh${cost(mo)}`, mos, 'month') +
        tile(3, '#ffc857', '#ff7a3d', `Year ${d.getFullYear()}`, yr.n ? yr.t : null, `${MON[0]} – ${MON[d.getMonth()]}${cost(yr)}`, mos.slice(-(d.getMonth() + 1)), 'year');
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
    _bars(bk, stack, sm) {
      const V = b => stack === 'b' ? b.b.reduce((a, x) => a + x, 0) : stack ? b.vt + b.mt : b.t;
      const vals = bk.map(V);
      const hasF = b => stack === 'b' ? b.bh : stack ? b.has : b.n > 0;
      const mx = nice(Math.max(0, ...vals));
      const wd = bk.filter(hasF), avg = wd.length ? wd.reduce((a, b) => a + V(b), 0) / wd.length : 0;
      const ticks = [1, .75, .5, .25, 0];
      let h = `<div class="ch${sm ? ' sm' : ''}"><div class="ch-y">${ticks.map(f => `<span>${fax(mx * f)}</span>`).join('')}</div><div class="ch-p"><div class="ch-g">${ticks.map(() => '<i></i>').join('')}</div>`;
      if (avg > 0) h += `<div class="ch-avg" style="bottom:${avg / mx * 100}%"><span>avg ${fk(avg)}</span></div>`;
      h += `<div class="ch-b${bk.length > 20 ? ' dense' : ''}">`;
      bk.forEach((b, i) => {
        const v = vals[i], has = hasF(b), part = has && b.n < b.span && b.span > 1;
        let tip = `<b>${b.title}</b>`;
        if (has) {
          tip += `<div class="r"><span>Total</span><span class="v">${fk(stack ? v : b.t)} kWh</span></div>`;
          if (stack === 'b') tip += b.b.map((x, j) => x > 0 ? `<div class="r"><i class="dot" style="background:${BLK[j]}"></i>Blok ${j + 1}<span class="v">${fk(x)} kWh</span></div>` : '').join('');
          else if (b.has) tip += `<div class="r"><i class="dot vt"></i>VT<span class="v">${fk(b.vt)} kWh</span></div><div class="r"><i class="dot mt"></i>MT<span class="v">${fk(b.mt)} kWh</span></div>`;
          const c = this._cost(b); if (c != null) tip += `<div class="r"><span>Cost</span><span class="v">${this._money(c)}</span></div>`;
          if (b.span > 1) tip += `<div class="m">${b.n} of ${b.span} days logged · ${fk((stack ? v : b.t) / Math.max(1, b.n))} kWh/day</div>`;
          if (!stack && b.q15) tip += `<div class="m">incl. 15-min data · meter total tomorrow</div>`;
        } else tip += `<div class="m">No data</div>`;
        let bar;
        if (!has) bar = `<div class="bar none"></div>`;
        else if (stack === 'b') bar = `<div class="bar stk" style="height:${v / mx * 100}%;--i:${i}">${[4, 3, 2, 1, 0].map(j => b.b[j] > 0 ? `<div class="seg" style="flex:${b.b[j]};background:${BLK[j]}"></div>` : '').join('')}</div>`;
        else if (stack) bar = `<div class="bar stk" style="height:${v / mx * 100}%;--i:${i}"><div class="seg mt" style="flex:${b.mt}"></div><div class="seg vt" style="flex:${b.vt}"></div></div>`;
        else bar = `<div class="bar tot" style="height:${Math.max(v / mx * 100, .8)}%;--i:${i}"></div>`;
        h += `<div class="col${b.now ? ' now' : ''}${part ? ' part' : ''}" data-tip="${esc(tip)}">${bar}<span class="xl">${b.label}${b.sub ? `<small>${b.sub}</small>` : ''}</span></div>`;
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
      return `<div class="stats">${st('Total', tot, c != null ? '≈ ' + this._money(c) : `${wd.length} periods`)}${st('Average', av, 'per period')}${st('Highest', V(hi), hi.title)}${st('Lowest', V(lo), lo.title)}</div>`;
    }
    _tabs(cur, act, opts) { return `<div class="seg-tabs">${opts.map(([k, l]) => `<button class="${k === cur ? 'on' : ''}" data-act="${act}" data-v="${k}">${l}</button>`).join('')}</div>`; }
    _renderChart() {
      const r = this._ui.range, bk = this._buckets(r);
      const sub = { day: 'Last 30 days', week: 'Last 12 weeks', month: 'Last 12 months', year: 'By year' }[r];
      this.$('chart').innerHTML = `<div class="ch-h"><div><div class="h-t">Consumption</div><div class="h-s">${sub} · kWh</div></div>${this._tabs(r, 'range', [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']])}</div>${this._bars(bk, false)}${this._stats(bk, false)}`;
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
          cells += `<div class="cell l${lv}${k === today ? ' td' : ''}" data-tip="${esc(`<b>${fdate(k)}</b><div class="${o && o.n ? '' : 'm'}">${o && o.n ? fk(o.t) + ' kWh' : 'No data'}</div>${o && o.q15 ? '<div class="m">15-min data · meter total tomorrow</div>' : ''}`)}"></div>`;
        }
      }
      const sums = Array(7).fill(0), cnt = Array(7).fill(0);
      for (let i = 0; i < 84; i++) { const k = addD(today, -i), o = days.get(k); if (o && o.n) { const w = (pd(k).getDay() + 6) % 7; sums[w] += o.t; cnt[w]++; } }
      const av = sums.map((s, i) => cnt[i] ? s / cnt[i] : 0), amx = Math.max(...av) || 1;
      const nz = av.filter(x => x > 0), amn = nz.length ? Math.min(...nz) * 0.7 : 0;
      const wk = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n, i) => `<div class="wk-c${i > 4 ? ' we' : ''}" data-tip="${esc(`<b>${DOWL[(i + 1) % 7]}s</b><div>${cnt[i] ? fk(av[i]) + ' kWh avg' : 'No data'}</div><div class="m">last 12 weeks</div>`)}"><i style="height:${av[i] ? Math.max(8, (av[i] - amn) / ((amx - amn) || 1) * 100) : 4}%;--i:${i}"></i><span>${n[0]}${n[1]}</span></div>`).join('');
      this.$('heat').innerHTML = `<div class="ch-h"><div><div class="h-t">Energy rhythm</div><div class="h-s">Every day, last ${W} weeks</div></div></div>
<div class="hm-m">${months}</div><div class="hm"><div class="hm-d">${['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map(x => `<span>${x}</span>`).join('')}</div><div class="hm-g">${cells}</div></div>
<div class="hm-leg">less <div class="cell"></div><div class="cell l1"></div><div class="cell l2"></div><div class="cell l3"></div><div class="cell l4"></div> more</div>
<div class="wk"><div class="wk-t">Average by weekday</div><div class="wk-b">${wk}</div></div>`;
    }
    _renderTariff() {
      const r = this._ui.trange, { today } = this._c;
      const bk = this._buckets(r);
      const any = bk.some(b => b.has);
      const head = `<div class="ch-h"><div><div class="h-t">Energija VT · MT</div><div class="h-s">${this._me ? 'Big (VT = peak) and small (MT = off-peak) tariff, from Moj Elektro' : 'Big (VT) and small (MT) tariff split'}</div></div><div class="row" style="align-items:center;gap:18px"><div class="legend"><span><i class="dot vt"></i>VT · big</span><span><i class="dot mt"></i>MT · small</span></div>${this._tabs(r, 'trange', [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']])}</div></div>`;
      if (!any) { this.$('tariff').innerHTML = head + `<div class="empty">${ic('sun')}<b>No tariff data yet</b><span>Fill in the Energija VT and MT fields when you log a reading${this._c.s.tmode === 'reading' ? ' (both readings are needed on two consecutive entries)' : ''} to unlock this split.</span></div>`; return; }
      const cur = [...bk].reverse().find(b => b.has);
      const nm = { day: cur.now ? 'Today' : fdate(cur.from), week: cur.now ? 'This week' : cur.title, month: cur.now ? 'This month' : cur.title }[r];
      const tot = cur.vt + cur.mt, fv = tot ? cur.vt / tot : 0;
      const R = 88, C = 2 * Math.PI * R, gap = tot && fv > 0 && fv < 1 ? 6 : 0;
      const vtLen = Math.max(0, C * fv - gap), mtLen = Math.max(0, C * (1 - fv) - gap);
      const s = this._c.s, cv = s.pVT > 0 ? cur.vt * s.pVT : null, cm = s.pMT > 0 ? cur.mt * s.pMT : null;
      const vS = bk.filter(b => b.has).reduce((a, b) => a + b.vt, 0), mS = bk.filter(b => b.has).reduce((a, b) => a + b.mt, 0);
      const totC = bk.reduce((a, b) => { const x = this._cost(b); return x == null ? a : (a || 0) + x; }, null);
      const sp = { day: '30 days', week: '12 weeks', month: '12 months' }[r];
      this.$('tariff').innerHTML = head + `<div class="tariff-b">
<div class="donut-w"><div class="dn"><svg viewBox="0 0 200 200"><defs><linearGradient id="dVT" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc857"/><stop offset="1" stop-color="#ff7a3d"/></linearGradient><linearGradient id="dMT" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a18bff"/><stop offset="1" stop-color="#4f8dff"/></linearGradient></defs>
<circle cx="100" cy="100" r="${R}" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="18"/>
<circle cx="100" cy="100" r="${R}" fill="none" stroke="url(#dVT)" stroke-width="18" stroke-linecap="round" stroke-dasharray="${vtLen} ${C}" style="filter:drop-shadow(0 0 8px rgba(255,122,61,.5))"/>
<circle cx="100" cy="100" r="${R}" fill="none" stroke="url(#dMT)" stroke-width="18" stroke-linecap="round" stroke-dasharray="${mtLen} ${C}" stroke-dashoffset="${-(C * fv)}" style="filter:drop-shadow(0 0 8px rgba(161,139,255,.5))"/>
<circle cx="100" cy="100" r="66" fill="none" stroke="rgba(255,255,255,.06)" stroke-dasharray="2 5"/></svg>
<div class="dn-c"><div class="dn-l">${nm}</div><div class="dn-v">${fk(tot)}<small>kWh</small></div><div class="dn-l">${Math.round(fv * 100)}% VT · ${100 - Math.round(fv * 100)}% MT</div></div></div>
<div class="tl"><div class="tl-i vt"><div class="tl-n">${ic('sun')}Energija VT</div><div class="tl-v">${fk(cur.vt)}<small>kWh</small></div><div class="tl-s">${cv != null ? '≈ ' + this._money(cv) : 'big tariff'}</div></div>
<div class="tl-i mt"><div class="tl-n">${ic('moon')}Energija MT</div><div class="tl-v">${fk(cur.mt)}<small>kWh</small></div><div class="tl-s">${cm != null ? '≈ ' + this._money(cm) : 'small tariff'}</div></div></div></div>
<div>${this._bars(bk, true, true)}<div class="stats"><div class="st"><div class="st-l">VT · ${sp}</div><div class="st-v" style="color:var(--vt1)">${fk(vS)}<small>kWh</small></div><div class="st-s">${s.pVT > 0 ? '≈ ' + this._money(vS * s.pVT) : 'big tariff'}</div></div><div class="st"><div class="st-l">MT · ${sp}</div><div class="st-v" style="color:var(--mt1)">${fk(mS)}<small>kWh</small></div><div class="st-s">${s.pMT > 0 ? '≈ ' + this._money(mS * s.pMT) : 'small tariff'}</div></div><div class="st"><div class="st-l">MT share</div><div class="st-v">${vS + mS ? Math.round(mS / (vS + mS) * 100) : 0}<small>%</small></div><div class="st-s">of tariff energy</div></div><div class="st"><div class="st-l">Energy cost</div><div class="st-v">${totC != null ? this._money(totC) : '—'}</div><div class="st-s">${totC != null ? sp : 'set prices in ⚙'}</div></div></div></div></div>`;
    }

    /* ----- Moj Elektro: 15-minute load profile -----
       The 15min sensor shows, every quarter hour, the matching quarter of *yesterday*. Sampling its
       recorded history on the quarter grid and shifting it back 24 h rebuilds the real load curve. */
    async _loadProfile() {
      if (!this._me || !this._hass || this._profBusy) return;
      this._profBusy = true;
      try {
        const ent = this._qEnt, end = Date.now(), Q = 9e5;
        const r = await this._hass.callWS({ type: 'history/history_during_period', start_time: new Date(end - 10 * 864e5).toISOString(), end_time: new Date(end).toISOString(), entity_ids: [ent], minimal_response: true, no_attributes: true, significant_changes_only: false });
        const pts = (r[ent] || []).map(x => ({ t: x.lu != null ? x.lu * 1000 : Date.parse(x.last_updated || x.last_changed), v: parseFloat(x.s != null ? x.s : x.state) }))
          .filter(p => isFinite(p.t) && isFinite(p.v)).sort((a, b) => a.t - b.t);
        const slots = [];
        let i = 0, cur = null;
        if (pts.length) for (let q = Math.floor(pts[0].t / Q) * Q; q <= end; q += Q) {
          while (i < pts.length && pts[i].t <= q + 3e5) cur = pts[i++]; // the sensor refreshes a few seconds after each quarter
          // an unchanged value is not re-recorded, so carry it forward, but not across real gaps (restart, API outage)
          if (!cur || q + 3e5 - cur.t > 72e5) continue;
          const st = new Date(q - 864e5);
          slots.push({ t: st, kwh: cur.v, kw: cur.v * 4, b: blockOf(st) });
        }
        this._hist = slots; this._histErr = null;
      } catch (e) { this._histErr = String(e && e.message || e); }
      this._profBusy = false;
      this._buildProf(true);
    }
    // Only whole days are shown: the full days fetched from Moj Elektro (or imported from a CSV) are exact;
    // history-derived quarters are a fallback and count only when they cover a complete past day. The chart
    // keeps showing the newest complete day until the next one has arrived, then switches all at once.
    _buildProf(render) {
      const Q = 9e5, from = Date.now() - 11 * 864e5, today = iso(new Date()), q15 = this._q15 || {}, byDay = new Map();
      for (const s of this._hist || []) {
        const d = iso(s.t); if (q15[d] || d >= today) continue;
        if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(s);
      }
      for (const [d, a] of byDay) if (a.length < 92) byDay.delete(d); // DST days have 92 / 100 quarters
      for (const d in q15) {
        const t0 = pd(d).getTime(), a = [];
        q15[d].forEach((v, i) => { const st = new Date(t0 + i * Q); if (+st >= from && isFinite(v)) a.push({ t: st, kwh: v, kw: v * 4, b: blockOf(st) }); });
        if (a.length) byDay.set(d, a);
      }
      const keys = [...byDay.keys()].sort(), slots = keys.flatMap(d => byDay.get(d)).sort((a, b) => a.t - b.t);
      if (!slots.length) this._prof = this._histErr ? { err: this._histErr } : null;
      else {
        const peaks = [null, null, null, null, null];
        for (const s of slots) if (!peaks[s.b - 1] || s.kw > peaks[s.b - 1].kw) peaks[s.b - 1] = s;
        this._prof = { last: byDay.get(keys[keys.length - 1]).slice().sort((a, b) => a.t - b.t), peaks, days: keys.length };
      }
      if (render) this._renderProf();
    }
    _renderProf() {
      const el = this.$('prof'); if (!this._me || !el || !this._built) return;
      const P = this._prof, L = P && P.last;
      let h = `<div class="ch-h"><div><div class="h-t">15-minute power</div><div class="h-s">${L && L.length ? `${fdate(iso(L[0].t))} ${hm(L[0].t)} → ${fdate(iso(L[L.length - 1].t))} ${hm(L[L.length - 1].t)}` : 'Moj Elektro · 24 h delay'}</div></div><span class="badge">kW</span></div>`;
      if (!L || !L.length) { el.innerHTML = h + `<div class="empty" style="min-height:240px">${ic('bolt')}<b>${P && P.err ? 'Could not read the 15-minute history' : 'Collecting 15-minute data…'}</b><span>${P && P.err ? esc(P.err) : 'Moj Elektro sends yesterday’s load curve one quarter hour at a time, so this chart fills in over the next 24 hours.'}</span></div>`; return; }
      const pk = L.reduce((a, s) => s.kw > a.kw ? s : a), mx = nice(pk.kw);
      const bars = L.map((s, i) => `<div class="pc${s === pk ? ' top' : ''}" style="--c:${BLK[s.b - 1]}" data-tip="${esc(`<b>${fdate(iso(s.t))} · ${hm(s.t)}</b><div class="r">Power<span class="v">${fk(s.kw)} kW</span></div><div class="r">Energy<span class="v">${s.kwh.toFixed(3)} kWh</span></div><div class="r"><i class="dot" style="background:${BLK[s.b - 1]}"></i>Blok ${s.b}</div>`)}"><i style="height:${Math.max(1.5, s.kw / mx * 100)}%;background:${BLK[s.b - 1]};--i:${i}"></i></div>`).join('');
      const xl = L.map((s, i) => s.t.getMinutes() === 0 && s.t.getHours() % 6 === 0 ? `<span style="left:${(i + .5) / L.length * 100}%">${pad(s.t.getHours())}:00</span>` : '').join('');
      const bp = P.peaks.map((s, i) => `<div style="--c:${BLK[i]}"><b>Blok ${i + 1}</b><span>${s ? fk(s.kw) : '—'}${s ? '<small style="font-size:11px;color:var(--mut);font-weight:500"> kW</small>' : ''}</span><em>${s ? `${fshort(iso(s.t))} ${hm(s.t)}` : 'no data'}</em></div>`).join('');
      el.innerHTML = h + `<div class="pkrow"><div class="pk-v">${fk(pk.kw)}<small>kW peak</small></div><div class="pk-s">${fdate(iso(pk.t))} · ${hm(pk.t)} <span class="bchip" style="--c:${BLK[pk.b - 1]}">Blok ${pk.b}</span></div></div>
<div class="pch">${bars}</div><div class="pxl">${xl}</div>
<div class="bsub" style="margin-top:14px">Highest 15-min power per block · last ${P.days} day${P.days > 1 ? 's' : ''}</div>
<div class="bpk">${bp}</div>
<div class="pnote">Your network bill's billed power (obračunska moč) is based on 15-minute peaks like these, per tariff block. Colours show which block each quarter hour falls in.</div>`;
    }

    /* ----- Moj Elektro: network tariff blocks ----- */
    _renderBlocks() {
      const el = this.$('blocks'); if (!this._me || !el) return;
      const { days, bLast: meLast, today } = this._c, r = this._ui.brange || 'day';
      const legend = `<div class="blegend">${BLK.map((c, i) => `<span><i style="background:${c}"></i>Blok ${i + 1}</span>`).join('')}</div>`;
      const head = `<div class="ch-h"><div><div class="h-t">Časovni bloki · tariff blocks</div><div class="h-s">Energy per network tariff block, from Moj Elektro</div></div><div class="row" style="align-items:center;gap:18px">${legend}${this._tabs(r, 'brange', [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']])}</div></div>`;
      const y = meLast && days.get(meLast);
      if (!y || !y.b) { el.innerHTML = head + `<div class="empty" style="min-height:160px">${ic('bolt')}<b>No block data yet</b><span>The daily automation adds it every morning.</span></div>`; return; }
      const rows = (vals, tot) => vals.map((x, i) => `<div class="brow"><span>Blok ${i + 1}</span><div class="bt"><i style="width:${tot ? x / tot * 100 : 0}%;background:${BLK[i]}"></i></div><span class="bv">${fk(x)} kWh<small>${tot ? Math.round(x / tot * 100) : 0}%</small></span></div>`).join('');
      const d = pd(today), ms = this._sum(iso(new Date(d.getFullYear(), d.getMonth(), 1)), today);
      const yt = y.b.reduce((a, x) => a + x, 0), mt = ms.b.reduce((a, x) => a + x, 0);
      let mdays = 0; for (const [k, o] of days) if (k.slice(0, 7) === today.slice(0, 7) && o.b) mdays++;
      el.innerHTML = head + `<div class="blk-b"><div>
<div class="bsub">${meLast === addD(today, -1) ? 'Yesterday' : fdate(meLast)} · ${fk(yt)} kWh</div>${rows(y.b, yt)}
<div class="bgap"></div>
<div class="bsub">${MONL[d.getMonth()]} · ${mdays} logged day${mdays === 1 ? '' : 's'} · ${fk(mt)} kWh</div>${rows(ms.b, mt)}
<div class="bnote">Blok 1 is the most expensive network block and only applies on working days from November to February. Weekends, holidays and the lower season (March–October) fall into the cheaper blocks 2–5.</div>
</div><div>${this._bars(this._buckets(r), 'b', true)}</div></div>`;
    }

    /* ----- log ----- */
    _renderLog() {
      const { E, s } = this._c;
      const el = this.$('log'), ME = this._demo ? [] : (this._data.me || []);
      if (!E.length && !ME.length) { el.innerHTML = `<div class="ch-h"><div><div class="h-t">Reading log</div><div class="h-s">Every counter reading you've entered</div></div></div><div class="empty" style="min-height:120px">${ic('meter')}<span>No readings yet</span></div>`; return; }
      const rows = [], act = !this._demo && E.length > 0;
      for (const m of ME) rows.push([m.d + 'b', `<tr class="me"><td>${fdate(m.d)} <span class="m">${pd(m.d).getFullYear()}</span></td><td>Moj Elektro</td>${typeof m.u === 'number' ? `<td class="use">+${fk(m.u)} kWh</td><td class="m">1 day</td>` : Array.isArray(m.b) && m.b.some(x => +x > 0) ? `<td class="use">+${fk(m.b.reduce((a, x) => a + (+x || 0), 0))} kWh</td><td class="m">15-min data · VT / MT tomorrow</td>` : `<td class="m">—</td><td class="m">tariff blocks only</td>`}<td class="vtc">${m.vt != null ? fk(+m.vt) : '<span class="m">—</span>'}</td><td class="mtc">${m.mt != null ? fk(+m.mt) : '<span class="m">—</span>'}</td>${act ? '<td></td>' : ''}</tr>`]);
      for (let i = E.length - 1; i >= 0; i--) {
        const e = E[i], p = E[i - 1];
        const n = p ? diffD(p.d, e.d) : 0, dt = p ? (e.t - p.t) * s.mult : null;
        const vtu = s.tmode === 'usage' ? e.vt : (p && e.vt != null && p.vt != null ? (e.vt - p.vt) * s.mult : null);
        const mtu = s.tmode === 'usage' ? e.mt : (p && e.mt != null && p.mt != null ? (e.mt - p.mt) * s.mult : null);
        rows.push([e.d + 'a', `<tr><td>${fdate(e.d)} <span class="m">${pd(e.d).getFullYear()}</span></td><td class="mono">${rawStr(e.t, s.mult)}</td><td class="${dt == null ? 'm' : dt < 0 ? 'neg' : 'use'}">${dt == null ? 'baseline' : (dt >= 0 ? '+' : '') + fk(dt) + ' kWh'}</td><td class="m">${n > 1 ? `${n} days · ${fk(dt / n)}/day` : n === 1 ? '1 day' : ''}</td><td class="vtc">${vtu == null ? '<span class="m">—</span>' : fk(vtu)}</td><td class="mtc">${mtu == null ? '<span class="m">—</span>' : fk(mtu)}</td>${act ? `<td><button class="rb" data-act="edit" data-d="${e.d}" title="Edit">${ic('edit')}</button></td>` : ''}</tr>`]);
      }
      rows.sort((a, b) => a[0] < b[0] ? 1 : -1);
      const show = (this._ui.all ? rows : rows.slice(0, 8)).map(r => r[1]);
      const first = [...E.map(e => e.d), ...ME.map(m => m.d)].sort()[0];
      const sub = [E.length ? `${E.length} manual reading${E.length > 1 ? 's' : ''}` : '', ME.length ? `${ME.length} Moj Elektro day${ME.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
      el.innerHTML = `<div class="ch-h"><div><div class="h-t">Log</div><div class="h-s">${sub} · since ${fdate(first)} ${pd(first).getFullYear()}</div></div><div class="row"><button class="btn sm gh" data-act="export">${ic('down')}Export</button><button class="btn sm gh" data-act="import">${ic('up')}Import</button></div></div>
<div class="tscroll"><table class="tbl"><thead><tr><th>Date</th><th>Counter / source</th><th>Used</th><th>Span</th><th>VT kWh</th><th>MT kWh</th>${act ? '<th></th>' : ''}</tr></thead><tbody>${show.join('')}</tbody></table></div>
${rows.length > 8 ? `<div class="more"><button class="btn sm gh" data-act="all">${this._ui.all ? 'Show less' : `Show all ${rows.length}`}</button></div>` : ''}`;
    }

    /* ----- settings drawer ----- */
    _renderDrawer() {
      const s = this._c.s, open = this._dwOpen;
      const opt = (k, v, t, d) => `<div class="opt${s[k] === v ? ' on' : ''}" data-act="set" data-k="${k}" data-v="${v}"><i></i><div><b>${t}</b><span>${d}</span></div></div>`;
      this.$('dw').innerHTML = `<div class="${open ? 'dw-open' : ''}"><div class="dw-bg" data-act="close"></div><aside class="dw">
<div class="row" style="align-items:center;justify-content:space-between"><h3>Settings</h3><button class="ibtn" data-act="close">${ic('x')}</button></div>
${this._me ? '' : `<div class="dw-s"><div class="dw-t">Counter format</div>
${opt('mult', 1000, 'MWh with 3 decimals', '120.622 on the display = 120 622 kWh. Your example: 121.334 − 120.622 = 712 kWh.')}
${opt('mult', 1, 'Plain kWh', 'The counter already shows kWh (e.g. 120622 or 12.5).')}</div>
<div class="dw-s"><div class="dw-t">Energija VT / MT input</div>
${opt('tmode', 'reading', 'Counter readings', 'Type the VT and MT registers from the meter; usage is the difference between readings.')}
${opt('tmode', 'usage', 'kWh used', 'Type how many kWh were used on VT and MT for that day.')}</div>`}
<div class="dw-s"><div class="dw-t">Prices (optional)</div>
<div class="two"><label class="fld vt"><span><i class="dot vt"></i>VT / kWh</span><input class="in" data-set="pVT" inputmode="decimal" value="${s.pVT || ''}" placeholder="0.12"></label>
<label class="fld mt"><span><i class="dot mt"></i>MT / kWh</span><input class="in" data-set="pMT" inputmode="decimal" value="${s.pMT || ''}" placeholder="0.08"></label></div>
<label class="fld"><span>Currency symbol</span><input class="in" data-set="cur" value="${esc(s.cur)}" maxlength="4"></label>
<div class="dw-note">Used for cost estimates of the VT/MT energy part only (network fees and taxes are not included).</div></div>
<div class="dw-s"><div class="dw-t">Your data</div>
<div class="dw-note">${this._sync === 'shared' ? `Readings and settings are shared by every user. They live in the Home Assistant to-do list <b>${esc(this._ent)}</b> (included in HA backups), and changes show up live on every open dashboard. Please don't edit those to-do items by hand.${this._me ? ' Moj Elektro days are added automatically every morning by the automation “Daily Energy – log Moj Elektro day”.' : ''}` : `The shared list <b>${esc(this._ent)}</b> is unavailable, so readings are saved for your user only.`}</div>
<div class="row"><button class="btn sm gh" data-act="export">${ic('down')}Export JSON</button><button class="btn sm gh" data-act="import">${ic('up')}Import JSON</button></div>
<div class="row" style="align-items:center">${this._ui.pin
        ? `<input class="in pin" id="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="PIN"><button class="btn sm warn" data-act="clear-ok">${ic('del')}Delete</button><button class="btn sm gh" data-act="clear-no">Cancel</button>`
        : `<button class="btn sm warn" data-act="clear">${ic('del')}Delete all readings</button>`}</div></div>
</aside></div>`;
    }
    _drawer(o) { this._dwOpen = o; if (!o && this._ui.pin) { this._ui.pin = false; this._renderDrawer(); } const w = this.$('dw').firstElementChild; if (w) w.classList.toggle('dw-open', o); }

    /* ----- events ----- */
    async _click(e) {
      const t = e.target.closest('[data-act]'); if (!t) return;
      const a = t.dataset.act;
      if (a === 'range') { this._ui.range = t.dataset.v; this._renderChart(); }
      else if (a === 'trange') { this._ui.trange = t.dataset.v; this._renderTariff(); }
      else if (a === 'brange') { this._ui.brange = t.dataset.v; this._renderBlocks(); }
      else if (a === 'form-toggle') {
        // with Moj Elektro the manual form is locked behind the PIN, asked every time it is opened
        if (this._me && !this._ui.formOpen) { this._fd = null; this._askFormPin(); }
        else { this._ui.formOpen = !this._ui.formOpen; this._fd = null; this._renderForm(); }
      }
      else if (a === 'form-pin-ok') this._openFormPin();
      else if (a === 'form-pin-no') { this._ui.formPin = false; this._fd = null; this._renderForm(); }
      else if (a === 'save') this._saveForm();
      else if (a === 'new') { this._fd = null; this._renderForm(); }
      else if (a === 'edit') {
        this._fd = t.dataset.d;
        if (this._me && !this._ui.formOpen) { this._askFormPin(); this.$('form').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        else { this._ui.formOpen = true; this._renderForm(); this.$('form').scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => this.$('f-t') && this.$('f-t').focus(), 400); }
      }
      else if (a === 'all') { this._ui.all = !this._ui.all; this._renderLog(); }
      else if (a === 'update') this._checkUpdates();
      else if (a === 'settings') { this._renderDrawer(); requestAnimationFrame(() => this._drawer(true)); }
      else if (a === 'close') this._drawer(false);
      else if (a === 'set') { let v = t.dataset.v; if (t.dataset.k === 'mult') v = Number(v); this._data.settings[t.dataset.k] = v; if (this._demo) this._demo = this._genDemo(); this._renderAll(); this._drawer(true); await this._commit({ settings: true }); }
      else if (a === 'demo-on') { this._demo = this._genDemo(); this._shown = 0; this._dwOpen = false; this._renderAll(); this._toast('Demo data loaded — explore away'); }
      else if (a === 'demo-off') { this._demo = null; this._shown = 0; this._renderAll(); }
      else if (a === 'export') this._export();
      else if (a === 'import') this.$('file').click();
      else if (a === 'clear') { this._ui.pin = true; this._renderDrawer(); setTimeout(() => this.$('pin') && this.$('pin').focus(), 50); }
      else if (a === 'clear-no') { this._ui.pin = false; this._renderDrawer(); }
      else if (a === 'clear-ok') this._clearAll();
    }
    _askFormPin() { this._ui.formPin = true; this._renderForm(); setTimeout(() => this.$('fpin') && this.$('fpin').focus(), 50); }
    _openFormPin() {
      const p = this.$('fpin');
      if (!p || p.value !== DEL_PIN) { this._toast('Wrong PIN'); if (p) { p.value = ''; p.focus(); } return; }
      this._ui.formPin = false; this._ui.formOpen = true; this._renderForm();
      setTimeout(() => this.$('f-t') && this.$('f-t').focus(), 100);
    }
    // "Delete all readings" asks for a PIN first. It only guards against accidental taps: the PIN is in the card code.
    async _clearAll() {
      const p = this.$('pin');
      if (!p || p.value !== DEL_PIN) { this._toast('Wrong PIN'); if (p) { p.value = ''; p.focus(); } return; }
      this._ui.pin = false;
      const all = this._data.entries.map(x => x.d); this._data.entries = []; this._demo = null; this._renderAll(); this._drawer(true);
      await this._commit({ del: all }); this._toast('All readings deleted');
    }
    async _change(e) {
      const t = e.target;
      if (t.id === 'f-d') { this._fd = t.value || null; const ex = this._c.E.find(x => x.d === t.value); if (ex) this._renderForm(); else { const b = this.$('f-badge'); b.textContent = 'New entry'; b.className = 'badge'; this._preview(); } }
      else if (t.dataset && t.dataset.set) { const k = t.dataset.set; this._data.settings[k] = k === 'cur' ? (t.value.trim() || '€') : (num(t.value) || 0); this._calc(); this._renderHero(); this._renderKpis(); this._renderChart(); this._renderTariff(); await this._commit({ settings: true }); }
      else if (t.id === 'file' && t.files[0]) {
        try {
          const v = JSON.parse(await t.files[0].text());
          const en = Array.isArray(v) ? v : v.entries;
          if (!Array.isArray(en) || en.some(x => !x || !/^\d{4}-\d{2}-\d{2}$/.test(x.d) || typeof x.t !== 'number')) throw 0;
          if (!confirm(`Replace the shared readings with ${en.length} imported readings?`)) return;
          const old = this._data.entries.map(x => x.d).filter(d => !en.some(x => x.d === d));
          const clean = en.map(x => { const o = { d: x.d, t: x.t }; if (x.vt != null) o.vt = x.vt; if (x.mt != null) o.mt = x.mt; return o; });
          this._data = { entries: clean, me: this._data.me || [], settings: { ...DEF, ...this._data.settings, ...(v.settings || {}) } }; this._demo = null;
          this._renderAll(); await this._commit({ del: old, put: clean, settings: !!v.settings }); this._toast(`Imported ${en.length} readings`);
        } catch (err) { this._toast('That file is not a Daily Energy export'); }
        t.value = '';
      }
    }
    _export() {
      const blob = new Blob([JSON.stringify(this._data, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `daily-energy-${iso(new Date())}.json`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    _tipMove(e) {
      const tip = this.$('tip'); const t = e.composedPath().find(n => n.dataset && n.dataset.tip != null);
      if (!t) { tip.classList.remove('on'); this._tipEl = null; return; }
      if (this._tipEl !== t) { tip.innerHTML = t.dataset.tip; this._tipEl = t; }
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = e.clientX + 16, y = e.clientY - h - 14;
      if (x + w > innerWidth - 8) x = e.clientX - w - 16;
      if (y < 8) y = e.clientY + 18;
      tip.style.left = x + 'px'; tip.style.top = y + 'px'; tip.classList.add('on');
    }
    _toast(msg, o = {}) {
      const t = this.$('toast'); t.innerHTML = ic(o.icon || 'bolt', o.icon === 'sync' ? 'st' : '') + esc(msg); t.classList.toggle('wait', !!o.hold); t.classList.add('on');
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
  window.customCards.push({ type: TAG, name: 'Daily Energy', description: 'Log daily meter readings; daily/weekly/monthly/yearly usage and VT/MT tariff split.' });
})();
