# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Daily Energy for Moj Elektro: porabim.com's dashboard in Home Assistant. The data lives on porabim.com."""
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
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType

from . import api, meters, oauth, websocket
from .const import (
    CARD_URL,
    CONF_SIDEBAR,
    DOMAIN,
    ISSUE_CONNECT,
    PANEL_ELEMENT,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL,
    STORAGE_VERSION,
    VERSION,
)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
_LOGGER = logging.getLogger(__name__)
PLATFORMS = [Platform.SENSOR]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """The porabim.com sign-in and the one websocket command the panel uses."""
    hass.data.setdefault(DOMAIN, {})
    oauth.async_register(hass)
    websocket.async_register(hass)
    await hass.http.async_register_static_paths(
        [StaticPathConfig(f"/{DOMAIN}", str(Path(__file__).parent / "frontend"), cache_headers=False)]
    )
    # read once here, so requests later never wait for Home Assistant's storage
    await api.async_instance_hash(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """One porabim account: its key and the sidebar panel with porabim's card."""
    hass.data.setdefault(DOMAIN, {})
    oauth.async_register(hass)
    if "token" not in entry.data:
        # A 1.x entry: its day log waits in the old store until the user connects to porabim.com
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
    link = api.PorabimLink(entry, session)
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
            # our panel loads porabim.com's own card; without this HA asks "Do you trust the external panel" on every open
            trust_external=True,
            config={"entry_id": entry.entry_id, "card": CARD_URL},
            require_admin=False,
        )
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    entry.async_create_background_task(hass, _async_upload_old_log(hass, link), f"{DOMAIN} old log upload")
    entry.async_create_background_task(hass, _async_meters_then_sensors(hass, link), f"{DOMAIN} meters")
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Remove the panel and the entities; the link on porabim stays."""
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    link = hass.data[DOMAIN].pop(entry.entry_id, None)
    if link is not None and link.panel_url:
        frontend.async_remove_panel(hass, link.panel_url)
    return True


async def _async_meters_then_sensors(hass: HomeAssistant, link: api.PorabimLink) -> None:
    """The meter devices first, so the first sensor refresh finds them (entities go on those devices)."""
    await meters.async_sync(hass, link)
    if link.sensors is not None:
        await link.sensors.async_refresh()


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Deleting the entry ends its link on porabim (errors ignored) and deletes a 1.x log still waiting."""
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
    await _old_store(hass, entry).async_remove()


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """1.x → 3: the Moj Elektro meter and token leave Home Assistant (they are entered on porabim.com).

    The old day log stays in its store; setup then asks the user to connect, and the first link uploads it.
    """
    if entry.version < 3:
        hass.config_entries.async_update_entry(entry, data={}, options={CONF_SIDEBAR: entry.options.get(CONF_SIDEBAR, True)}, version=3)
    return True


async def _async_reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


def _panel_url(hass: HomeAssistant, entry: ConfigEntry) -> str:
    """"daily-energy" for the first entry, "daily-energy-2" and so on for more (the 1.x addresses)."""
    entries = hass.config_entries.async_entries(DOMAIN)
    index = next((i for i, e in enumerate(entries) if e.entry_id == entry.entry_id), 0)
    return "daily-energy" if index == 0 else f"daily-energy-{index + 1}"


def _old_store(hass: HomeAssistant, entry: ConfigEntry) -> Store:
    return Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}")


async def _async_upload_old_log(hass: HomeAssistant, link: api.PorabimLink) -> None:
    """Once, after the first link: the 1.x day log goes to porabim as the backup the old card exported.

    The store is deleted only when porabim took it; otherwise the next start tries again.
    """
    store = _old_store(hass, link.entry)
    old = await store.async_load()
    if not isinstance(old, dict):
        return
    backup = {"app": DOMAIN, "version": VERSION}
    for key in ("days", "manual", "edits", "settings"):
        backup[key] = old.get(key) if isinstance(old.get(key), dict) else {}
    if any(backup[key] for key in ("days", "manual", "edits")):
        try:
            status, _ = await api.async_call(hass, link, "POST", "import-backup", backup)
        except (aiohttp.ClientError, TimeoutError):
            status = 0
        if not 200 <= status < 300:
            _LOGGER.warning("porabim.com did not take the old day log (HTTP %s); trying again at the next start", status)
            return
    await store.async_remove()
