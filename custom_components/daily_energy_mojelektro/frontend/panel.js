// Daily Energy for Moj Elektro
// Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
// Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
// any part of this file without written permission is not allowed. See LICENSE.

// The sidebar panel: porabim's own panel inside it. porabim's panel colours the whole page dark (html and body), but
// Home Assistant shows it on its own page, not in a frame, so the dark page stayed on every dashboard after it. This
// panel notes what the page had when it opens and puts it back when it is left.
(() => {
  if (customElements.get('daily-energy-panel')) return;
  // what porabim's panel sets on the page; the rest of the page's style (Home Assistant's theme) is left alone
  const PAGE = [
    [() => document.documentElement.style, ['background', 'colorScheme']],
    [() => document.body && document.body.style, ['margin', 'background', 'color', 'minHeight']],
  ];

  class DailyEnergyPanel extends HTMLElement {
    set hass(h) { this._hass = h; if (this._inner) this._inner.hass = h; }
    set panel(p) { this._panel = p; if (this._inner) this._inner.panel = p; this._load(); }
    set narrow(n) { this._narrow = n; if (this._inner) this._inner.narrow = n; }
    set route(r) { this._route = r; if (this._inner) this._inner.route = r; }

    connectedCallback() {
      // before porabim's panel inside is connected (a parent is connected first)
      this._page = PAGE.map(([get, keys]) => { const s = get(); return s ? keys.map(k => s[k]) : null; });
      this._lang = document.documentElement.getAttribute('lang');
      this.style.display = 'block';
      this._load();
    }

    disconnectedCallback() {
      if (!this._page) return;
      PAGE.forEach(([get, keys], i) => {
        const s = get(), was = this._page[i];
        if (s && was) keys.forEach((k, j) => { s[k] = was[j]; });
      });
      if (this._lang === null) document.documentElement.removeAttribute('lang');
      else document.documentElement.setAttribute('lang', this._lang);
      this._page = null;
    }

    async _load() {
      const card = this._panel && this._panel.config && this._panel.config.card;
      if (this._inner || this._loading || !card) return;
      this._loading = true;
      try {
        if (!customElements.get('porabim-panel')) await import(card);
      } finally {
        this._loading = false;
      }
      if (this._inner) return;
      const inner = document.createElement('porabim-panel');
      inner.panel = this._panel;
      if (this._hass) inner.hass = this._hass;
      if (this._narrow !== undefined) inner.narrow = this._narrow;
      if (this._route !== undefined) inner.route = this._route;
      this._inner = inner;
      this.appendChild(inner);
    }
  }

  customElements.define('daily-energy-panel', DailyEnergyPanel);
})();
