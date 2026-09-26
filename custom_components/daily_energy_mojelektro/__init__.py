"""Daily Energy for Moj Elektro: an energy dashboard and day log, fed straight from the Moj Elektro API."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from . import websocket
from .const import (
    CARD_FILE,
    CONF_SIDEBAR,
    DOMAIN,
    PANEL_ELEMENT,
    PANEL_ICON,
    PANEL_TITLE,
    URL_BASE,
    VERSION,
)
from .manager import DailyEnergyManager

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

MODULE_URL = f"{URL_BASE}/{CARD_FILE}?v={VERSION}"


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
    """Set up one meter: storage, the daily logger and the sidebar panel."""
    manager = DailyEnergyManager(hass, entry)
    await manager.async_load()
    hass.data[DOMAIN][entry.entry_id] = manager
    entry.async_on_unload(manager.async_start())

    if entry.options.get(CONF_SIDEBAR, True):
        manager.panel_url = _panel_url(hass, entry)
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=manager.panel_url,
            webcomponent_name=PANEL_ELEMENT,
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=MODULE_URL,
            config={"entry_id": entry.entry_id, "lite_users": manager.lite_users},
            require_admin=False,
        )

    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Remove the panel and stop the logger; the stored data stays."""
    manager: DailyEnergyManager = hass.data[DOMAIN].pop(entry.entry_id)
    if manager.panel_url:
        frontend.async_remove_panel(hass, manager.panel_url)
    await manager.async_flush()
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Deleting the integration entry also deletes its stored log."""
    await DailyEnergyManager.async_remove_store(hass, entry)


async def _async_reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


def _panel_url(hass: HomeAssistant, entry: ConfigEntry) -> str:
    """"daily-energy" for the first meter, "daily-energy-2" and so on for more."""
    entries = hass.config_entries.async_entries(DOMAIN)
    index = next((i for i, e in enumerate(entries) if e.entry_id == entry.entry_id), 0)
    return "daily-energy" if index == 0 else f"daily-energy-{index + 1}"
