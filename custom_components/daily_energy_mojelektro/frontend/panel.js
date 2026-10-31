// Daily Energy for Moj Elektro
// Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
// Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
// any part of this file without written permission is not allowed. See LICENSE.

// Plošča v stranski vrstici: v njej je plošča porabim. Ta temno pobarva celo stran (html in body), Home Assistant pa jo
// prikaže na svoji strani, ne v okvirju, zato je temna stran ostala na vseh naslednjih nadzornih ploščah. Ta plošča si ob
// odprtju zapomni stanje strani in ga ob izhodu vrne.
(() => {
  if (customElements.get('daily-energy-panel')) return;
  // kar plošča porabim nastavi na strani; preostali slog strani (tema Home Assistanta) ostane nedotaknjen
  const PAGE = [
    [() => document.documentElement.style, ['background', 'colorScheme']],
    [() => document.body && document.body.style, ['margin', 'background', 'color', 'minHeight']],
  ];
  // prikazano, dokler se kartica s porabim.com ne more naložiti (brez povezave, porabim.com ne deluje)
  const TEXT = {
    en: { title: 'Could not reach porabim.com', hint: 'Check the internet connection of this device and try again.', retry: 'Try again' },
    sl: { title: 'porabim.com ni dosegljiv', hint: 'Preverite internetno povezavo te naprave in poskusite znova.', retry: 'Poskusi znova' },
  };

  class DailyEnergyPanel extends HTMLElement {
    set hass(h) { this._hass = h; if (this._inner) this._inner.hass = h; if (this._menu) this._menu.hass = h; }
    set panel(p) { this._panel = p; if (this._inner) this._inner.panel = p; this._load(); }
    set narrow(n) { this._narrow = n; if (this._inner) this._inner.narrow = n; if (this._menu) this._menu.narrow = n; }
    set route(r) { this._route = r; if (this._inner) this._inner.route = r; }

    connectedCallback() {
      // preden se poveže notranja plošča porabim (najprej se poveže nadrejeni element)
      this._page = PAGE.map(([get, keys]) => { const s = get(); return s ? keys.map(k => s[k]) : null; });
      this._lang = document.documentElement.getAttribute('lang');
      this.style.display = 'block';
      this._load();
    }

    disconnectedCallback() {
      this._hideError();
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
      this._hideError();
      try {
        // brskalnik si zapomni neuspel uvoz: ponovni poskus zahteva kartico pod drugim naslovom
        if (!customElements.get('porabim-panel')) {
          await import(this._tries ? `${card}${card.includes('?') ? '&' : '?'}try=${this._tries}` : card);
        }
      } catch (err) {
        this._tries = (this._tries || 0) + 1;
        if (this.isConnected) this._showError();
        return;
      } finally {
        this._loading = false;
      }
      if (this._inner || !customElements.get('porabim-panel')) return;
      const inner = document.createElement('porabim-panel');
      inner.panel = this._panel;
      if (this._hass) inner.hass = this._hass;
      if (this._narrow !== undefined) inner.narrow = this._narrow;
      if (this._route !== undefined) inner.route = this._route;
      this._inner = inner;
      this.appendChild(inner);
    }

    _showError() {
      this._hideError();
      const lang = String((this._hass && this._hass.language) || navigator.language || 'en').toLowerCase();
      const t = TEXT[lang.startsWith('sl') ? 'sl' : 'en'];
      const box = document.createElement('div');
      box.setAttribute('role', 'alert');
      box.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;'
        + 'gap:12px;min-height:100vh;padding:24px;box-sizing:border-box;text-align:center;'
        + 'background:var(--primary-background-color);color:var(--primary-text-color);font-family:var(--ha-font-family-body,Roboto,sans-serif);';
      // plošča nima glave Home Assistanta: na telefonu je to pot do stranske vrstice
      const menu = document.createElement('ha-menu-button');
      menu.style.cssText = 'position:absolute;top:4px;left:4px;';
      menu.hass = this._hass;
      menu.narrow = this._narrow;
      const title = document.createElement('div');
      title.textContent = t.title;
      title.style.cssText = 'font-size:20px;font-weight:500;';
      const hint = document.createElement('div');
      hint.textContent = t.hint;
      hint.style.cssText = 'max-width:360px;color:var(--secondary-text-color);';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = t.retry;
      retry.style.cssText = 'margin-top:8px;padding:10px 24px;border:0;border-radius:20px;cursor:pointer;font:inherit;font-weight:500;'
        + 'background:var(--primary-color,#03a9f4);color:var(--text-primary-color,#fff);';
      retry.addEventListener('click', () => this._load());
      box.append(menu, title, hint, retry);
      // spet na spletu: sama poskusi znova
      this._online = () => this._load();
      window.addEventListener('online', this._online);
      this._menu = menu;
      this._error = box;
      this.appendChild(box);
    }

    _hideError() {
      if (this._online) window.removeEventListener('online', this._online);
      if (this._error) this._error.remove();
      this._online = this._error = this._menu = null;
    }
  }

  customElements.define('daily-energy-panel', DailyEnergyPanel);
})();
