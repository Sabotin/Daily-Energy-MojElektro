"""Daily Energy for Moj Elektro: an energy dashboard and day log, fed straight from the Moj Elektro API."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import SOURCE_IGNORE, ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from . import websocket
from .const import (
    CARD_FILE,
    CONF_METER,
    CONF_SIDEBAR,
    CONF_TOKEN,
    DOMAIN,
    PANEL_ELEMENT,
    PANEL_ICON,
    PANEL_TITLE,
    URL_BASE,
    VERSION,
)
from .manager import DailyEnergyManager, entry_state

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

MODULE_URL = f"{URL_BASE}/{CARD_FILE}?v={VERSION}"
PANEL_URL = "daily-energy"

_LOGGER = logging.getLogger(__name__)
# Version 1 entries could borrow the meter and token of the Moj Elektro integration instead.
LEGACY_SOURCE = "mojelektro_entry_id"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve the card once and make it available to every dashboard."""
    hass.data.setdefault(DOMAIN, {})
    await hass.http.async_register_static_paths(
        [StaticPathConfig(URL_BASE, str(Path(__file__).parent / "frontend"), False)]
    )
    frontend.add_extra_js_url(hass, MODULE_URL)
    websocket.async_register(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up one meter: storage, the hourly Moj Elektro check and the sidebar panel."""
    manager = DailyEnergyManager(hass, entry)
    await manager.async_load()
    manager.entry_state = entry_state(entry)
    hass.data[DOMAIN][entry.entry_id] = manager
    entry.async_on_unload(manager.async_start())

    # one sidebar panel, from the first meter: the dashboard's meter button switches between the meters
    if entry.options.get(CONF_SIDEBAR, True) and _first_entry(hass) is entry:
        manager.panel_url = PANEL_URL
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=manager.panel_url,
            webcomponent_name=PANEL_ELEMENT,
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=MODULE_URL,
            config={"entry_id": entry.entry_id},
            require_admin=False,
        )

    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Remove the panel and stop the hourly check; the stored data stays."""
    manager: DailyEnergyManager = hass.data[DOMAIN].pop(entry.entry_id)
    if manager.panel_url:
        frontend.async_remove_panel(hass, manager.panel_url)
    await manager.async_flush()
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Deleting the integration entry also deletes its stored log (and its 15-minute archive). When it was the
    meter with the sidebar panel, the next meter takes the panel over."""
    await DailyEnergyManager.async_remove_store(hass, entry)
    first = _first_entry(hass, without=entry.entry_id)
    manager = hass.data.get(DOMAIN, {}).get(first.entry_id) if first else None
    if manager is not None and not manager.panel_url and first.options.get(CONF_SIDEBAR, True):
        hass.async_create_task(hass.config_entries.async_reload(first.entry_id))


async def _async_reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Options or meter / token changed. A new name only (the entry title follows it) needs no restart, nor does a
    token the dashboard already handed to the running meter."""
    manager = hass.data.get(DOMAIN, {}).get(entry.entry_id)
    if manager is not None and manager.entry_state == entry_state(entry):
        return
    await hass.config_entries.async_reload(entry.entry_id)


def _first_entry(hass: HomeAssistant, without: str | None = None) -> ConfigEntry | None:
    """The first meter that was added (and is not ignored or disabled)."""
    return next(
        (
            e
            for e in hass.config_entries.async_entries(DOMAIN)
            if e.entry_id != without and e.source != SOURCE_IGNORE and e.disabled_by is None
        ),
        None,
    )


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Version 1 -> 2: copy the meter ID and token of a linked Moj Elektro integration into this entry."""
    if entry.version == 1:
        data = dict(entry.data)
        source_id = data.pop(LEGACY_SOURCE, None)
        source = hass.config_entries.async_get_entry(source_id) if source_id else None
        if source is not None and not (data.get(CONF_METER) and data.get(CONF_TOKEN)):
            data[CONF_METER] = source.data.get(CONF_METER)
            data[CONF_TOKEN] = source.data.get(CONF_TOKEN)
        if not (data.get(CONF_METER) and data.get(CONF_TOKEN)):
            _LOGGER.warning(
                "%s has no Moj Elektro meter ID and API token: enter them under Configure", entry.title
            )
        hass.config_entries.async_update_entry(entry, data=data, version=2)
    return True
