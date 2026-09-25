"""Config and options flow for Daily Energy for Moj Elektro."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback

from .const import (
    CONF_LITE_USERS,
    CONF_PIN,
    CONF_SIDEBAR,
    CONF_SOURCE_ENTRY,
    DOMAIN,
    MOJ_ELEKTRO_DOMAIN,
)


class DailyEnergyConfigFlow(ConfigFlow, domain=DOMAIN):
    """Pick the Moj Elektro meter the dashboard should follow."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        meters = self.hass.config_entries.async_entries(MOJ_ELEKTRO_DOMAIN)
        if not meters:
            return self.async_abort(reason="mojelektro_missing")
        used = {e.data.get(CONF_SOURCE_ENTRY) for e in self._async_current_entries()}
        choices = {m.entry_id: m.title for m in meters if m.entry_id not in used}
        if not choices:
            return self.async_abort(reason="already_configured")

        if user_input is not None:
            source = user_input[CONF_SOURCE_ENTRY]
            await self.async_set_unique_id(source)
            self._abort_if_unique_id_configured()
            return self.async_create_entry(
                title=f"Daily Energy · {choices.get(source, 'Moj Elektro')}",
                data={CONF_SOURCE_ENTRY: source},
                options={CONF_PIN: user_input.get(CONF_PIN, ""), CONF_SIDEBAR: True, CONF_LITE_USERS: ""},
            )

        schema = vol.Schema(
            {
                vol.Required(CONF_SOURCE_ENTRY, default=next(iter(choices))): vol.In(choices),
                vol.Optional(CONF_PIN, default=""): str,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return DailyEnergyOptionsFlow()


class DailyEnergyOptionsFlow(OptionsFlow):
    """PIN, sidebar panel and light mode."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        opts = self.config_entry.options
        schema = vol.Schema(
            {
                vol.Optional(CONF_PIN, default=opts.get(CONF_PIN, "")): str,
                vol.Optional(CONF_SIDEBAR, default=opts.get(CONF_SIDEBAR, True)): bool,
                vol.Optional(CONF_LITE_USERS, default=opts.get(CONF_LITE_USERS, "")): str,
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
