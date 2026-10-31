# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Daily Energy za Moj Elektro: nadzorna plošča porabim.com v Home Assistantu. Podatki so na porabim.com."""
from __future__ import annotations

import logging
from pathlib import Path

import aiohttp

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.helpers import config_entry_oauth2_flow, config_validation as cv, issue_registry as ir
from homeassistant.helpers.typing import ConfigType

from . import api, meters, oauth, oldlog, websocket
from .const import (
    CARD_URL,
    CONF_OLD_METER,
    CONF_SIDEBAR,
    DOMAIN,
    ISSUE_CONNECT,
    ISSUE_OLD_LOG,
    PANEL_ELEMENT,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL,
)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
_LOGGER = logging.getLogger(__name__)
PLATFORMS = [Platform.SENSOR]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Prijava v porabim.com in edini ukaz websocket, ki ga uporablja plošča."""
    hass.data.setdefault(DOMAIN, {})
    oauth.async_register(hass)
    websocket.async_register(hass)
    await hass.http.async_register_static_paths(
        [StaticPathConfig(f"/{DOMAIN}", str(Path(__file__).parent / "frontend"), cache_headers=False)]
    )
    # preberemo enkrat tukaj, da poznejše zahteve nikoli ne čakajo na shrambo Home Assistanta
    await api.async_instance_hash(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """En račun porabim: njegov ključ in plošča v stranski vrstici s kartico porabim."""
    hass.data.setdefault(DOMAIN, {})
    oauth.async_register(hass)
    if "token" not in entry.data:
        # Vnos iz 1.x: dnevni zapis čaka v stari shrambi, dokler se uporabnik ne poveže s porabim.com
        ir.async_create_issue(
            hass,
            DOMAIN,
            f"{ISSUE_CONNECT}_{entry.entry_id}",
            is_fixable=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=ISSUE_CONNECT,
            translation_placeholders={"title": entry.title},
        )
        raise ConfigEntryAuthFailed("Connect to porabim.com")
    implementation = await config_entry_oauth2_flow.async_get_config_entry_implementation(hass, entry)
    session = config_entry_oauth2_flow.OAuth2Session(hass, entry, implementation)
    try:
        await session.async_ensure_token_valid()
    except aiohttp.ClientResponseError as err:
        if 400 <= err.status < 500:
            raise ConfigEntryAuthFailed("porabim.com refused the key") from err
        raise ConfigEntryNotReady("porabim.com did not answer") from err
    except (aiohttp.ClientError, TimeoutError) as err:
        raise ConfigEntryNotReady("porabim.com did not answer") from err
    link = api.PorabimLink(entry, session, options=dict(entry.options))
    hass.data[DOMAIN][entry.entry_id] = link
    if entry.options.get(CONF_SIDEBAR, True):
        link.panel_url = _panel_url(hass, entry)
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=link.panel_url,
            webcomponent_name=PANEL_ELEMENT,
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=PANEL_URL,
            # naša plošča naloži kartico s porabim.com; brez tega HA ob vsakem odprtju vpraša "Do you trust the external panel"
            trust_external=True,
            config={"entry_id": entry.entry_id, "card": CARD_URL},
            require_admin=False,
        )
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    entry.async_create_background_task(
        hass, oldlog.async_upload(hass, link, entry, entry.data.get(CONF_OLD_METER)), f"{DOMAIN} old log upload"
    )
    entry.async_create_background_task(hass, _async_meters_then_sensors(hass, link), f"{DOMAIN} meters")
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Odstrani ploščo in entitete; povezava na porabim ostane."""
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    link = hass.data[DOMAIN].pop(entry.entry_id, None)
    if link is not None and link.panel_url:
        frontend.async_remove_panel(hass, link.panel_url)
    return True


async def _async_meters_then_sensors(hass: HomeAssistant, link: api.PorabimLink) -> None:
    """Najprej naprave merilnih mest, da jih prva osvežitev senzorjev najde (entitete gredo na te naprave)."""
    await meters.async_sync(hass, link)
    if link.sensors is not None:
        await link.sensors.async_refresh()


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Izbris vnosa konča njegovo povezavo na porabim (napake prezremo) in izbriše zapis iz 1.x, ki še čaka."""
    if "token" in entry.data:
        try:
            implementation = await config_entry_oauth2_flow.async_get_config_entry_implementation(hass, entry)
            token = entry.data["token"]
            if not config_entry_oauth2_flow.OAuth2Session(hass, entry, implementation).valid_token:
                token = await implementation.async_refresh_token(token)
            await api.async_revoke(hass, token["access_token"])
        except Exception:  # noqa: BLE001
            _LOGGER.debug("porabim.com did not take the revoke; the link ends when its key expires")
    ir.async_delete_issue(hass, DOMAIN, f"{ISSUE_CONNECT}_{entry.entry_id}")
    ir.async_delete_issue(hass, DOMAIN, f"{ISSUE_OLD_LOG}_{entry.entry_id}")
    await oldlog.store(hass, entry).async_remove()


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """1.x → 3: merilno mesto in žeton Moj Elektro zapustita Home Assistant (vnese se ju na porabim.com).

    Stari dnevni zapis ostane v svoji shrambi; nastavitev nato uporabnika prosi za povezavo, prva povezava ga naloži.
    """
    if entry.version < 3:
        hass.config_entries.async_update_entry(entry, data={}, options={CONF_SIDEBAR: entry.options.get(CONF_SIDEBAR, True)}, version=3)
    return True


async def _async_reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Home Assistant to pokliče ob vsaki spremembi vnosa; ponovno nalaganje je potrebno samo za možnosti (stranska
    vrstica). Ne za nov ključ, ki ga shrani vsaka osvežitev (približno na uro), in ne za naslov: nalaganje je odstranilo
    ploščo in vse entitete."""
    link = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if link is not None and dict(entry.options) == link.options:
        return
    await hass.config_entries.async_reload(entry.entry_id)


def _panel_url(hass: HomeAssistant, entry: ConfigEntry) -> str:
    """"daily-energy" za prvi vnos, "daily-energy-2" in tako naprej za naslednje (naslovi iz 1.x)."""
    entries = hass.config_entries.async_entries(DOMAIN)
    index = next((i for i, e in enumerate(entries) if e.entry_id == entry.entry_id), 0)
    return "daily-energy" if index == 0 else f"daily-energy-{index + 1}"
