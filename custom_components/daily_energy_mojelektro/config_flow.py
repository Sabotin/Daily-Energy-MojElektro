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
from homeassistant.helpers.selector import TextSelector, TextSelectorConfig, TextSelectorType

from .const import CONF_METER, CONF_PIN, CONF_SIDEBAR, CONF_TOKEN, DOMAIN
from .manager import async_test_access

PASSWORD = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))


class DailyEnergyConfigFlow(ConfigFlow, domain=DOMAIN):
    """Set up a meter: its Moj Elektro meter ID and API token."""

    # 2: meter ID and token are stored in the entry itself (see async_migrate_entry)
    VERSION = 2

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Meter ID and API token from the Moj Elektro portal, checked with one request before saving."""
        errors: dict[str, str] = {}
        if user_input is not None:
            meter = str(user_input[CONF_METER]).strip()
            token = str(user_input[CONF_TOKEN]).strip()
            await self.async_set_unique_id(meter)
            self._abort_if_unique_id_configured()
            error = await async_test_access(self.hass, meter, token)
            if error:
                errors["base"] = error
            else:
                return self.async_create_entry(
                    title=f"Daily Energy · {meter}",
                    data={CONF_METER: meter, CONF_TOKEN: token},
                    options={CONF_PIN: user_input.get(CONF_PIN, ""), CONF_SIDEBAR: True},
                )

        schema = vol.Schema(
            {
                vol.Required(CONF_METER, default=(user_input or {}).get(CONF_METER, "")): str,
                vol.Required(CONF_TOKEN): PASSWORD,
                vol.Optional(CONF_PIN, default=(user_input or {}).get(CONF_PIN, "")): str,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return DailyEnergyOptionsFlow()


class DailyEnergyOptionsFlow(OptionsFlow):
    """PIN, sidebar panel, and the meter ID or a new API token (checked before they are saved)."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        entry = self.config_entry
        errors: dict[str, str] = {}
        if user_input is not None:
            options = dict(user_input)
            meter = str(options.pop(CONF_METER, "") or "").strip() or entry.data.get(CONF_METER, "")
            token = str(options.pop(CONF_TOKEN, "") or "").strip() or entry.data.get(CONF_TOKEN, "")
            if (meter, token) != (entry.data.get(CONF_METER), entry.data.get(CONF_TOKEN)):
                error = await async_test_access(self.hass, meter, token) if meter and token else "invalid_auth"
                if error:
                    errors["base"] = error
                else:
                    self.hass.config_entries.async_update_entry(
                        entry, data={**entry.data, CONF_METER: meter, CONF_TOKEN: token}
                    )
            if not errors:
                return self.async_create_entry(data=options)

        opts = entry.options
        schema = vol.Schema(
            {
                vol.Optional(CONF_PIN, default=opts.get(CONF_PIN, "")): str,
                vol.Optional(CONF_SIDEBAR, default=opts.get(CONF_SIDEBAR, True)): bool,
                vol.Optional(CONF_METER, default=entry.data.get(CONF_METER, "")): str,
                vol.Optional(CONF_TOKEN, default=""): PASSWORD,
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema, errors=errors)
