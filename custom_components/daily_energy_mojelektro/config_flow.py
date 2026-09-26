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

from .const import (
    CONF_LITE_USERS,
    CONF_METER,
    CONF_PIN,
    CONF_SIDEBAR,
    CONF_SOURCE_ENTRY,
    CONF_TOKEN,
    DOMAIN,
    MOJ_ELEKTRO_DOMAIN,
)
from .manager import async_test_access

PASSWORD = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))


def _options(user_input: dict[str, Any]) -> dict[str, Any]:
    return {CONF_PIN: user_input.get(CONF_PIN, ""), CONF_SIDEBAR: True, CONF_LITE_USERS: ""}


class DailyEnergyConfigFlow(ConfigFlow, domain=DOMAIN):
    """Set up a meter: its Moj Elektro meter ID and API token, or those of the Moj Elektro integration."""

    VERSION = 1

    def _meter_of(self, entry: ConfigEntry) -> str | None:
        if entry.data.get(CONF_METER):
            return entry.data[CONF_METER]
        source = self.hass.config_entries.async_get_entry(entry.data.get(CONF_SOURCE_ENTRY) or "")
        return source.data.get(CONF_METER) if source else None

    def _used_meters(self) -> set[str]:
        return {m for m in (self._meter_of(e) for e in self._async_current_entries()) if m}

    def _link_choices(self) -> dict[str, str]:
        """Moj Elektro integration entries whose meter has no Daily Energy dashboard yet."""
        used = self._used_meters()
        return {
            m.entry_id: m.title
            for m in self.hass.config_entries.async_entries(MOJ_ELEKTRO_DOMAIN)
            if m.data.get(CONF_METER) not in used and m.data.get(CONF_TOKEN)
        }

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if self._link_choices():
            return self.async_show_menu(step_id="user", menu_options=["api", "link"])
        return await self.async_step_api()

    async def async_step_api(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Meter ID and API token from the Moj Elektro portal."""
        errors: dict[str, str] = {}
        if user_input is not None:
            meter = str(user_input[CONF_METER]).strip()
            token = str(user_input[CONF_TOKEN]).strip()
            if meter in self._used_meters():
                return self.async_abort(reason="already_configured")
            await self.async_set_unique_id(meter)
            self._abort_if_unique_id_configured()
            error = await async_test_access(self.hass, meter, token)
            if error:
                errors["base"] = error
            else:
                return self.async_create_entry(
                    title=f"Daily Energy · {meter}",
                    data={CONF_METER: meter, CONF_TOKEN: token},
                    options=_options(user_input),
                )

        schema = vol.Schema(
            {
                vol.Required(CONF_METER, default=(user_input or {}).get(CONF_METER, "")): str,
                vol.Required(CONF_TOKEN): PASSWORD,
                vol.Optional(CONF_PIN, default=(user_input or {}).get(CONF_PIN, "")): str,
            }
        )
        return self.async_show_form(step_id="api", data_schema=schema, errors=errors)

    async def async_step_link(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Use the meter and token of an installed Moj Elektro integration (its sensors then log too)."""
        choices = self._link_choices()
        if not choices:
            return self.async_abort(reason="already_configured")

        if user_input is not None:
            source = user_input[CONF_SOURCE_ENTRY]
            await self.async_set_unique_id(source)
            self._abort_if_unique_id_configured()
            return self.async_create_entry(
                title=f"Daily Energy · {choices.get(source, 'Moj Elektro')}",
                data={CONF_SOURCE_ENTRY: source},
                options=_options(user_input),
            )

        schema = vol.Schema(
            {
                vol.Required(CONF_SOURCE_ENTRY, default=next(iter(choices))): vol.In(choices),
                vol.Optional(CONF_PIN, default=""): str,
            }
        )
        return self.async_show_form(step_id="link", data_schema=schema)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return DailyEnergyOptionsFlow()


class DailyEnergyOptionsFlow(OptionsFlow):
    """PIN, sidebar panel, light mode and (for a meter set up with its own token) a new API token."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        entry = self.config_entry
        own_token = bool(entry.data.get(CONF_TOKEN))
        errors: dict[str, str] = {}
        if user_input is not None:
            options = dict(user_input)
            token = str(options.pop(CONF_TOKEN, "") or "").strip()
            if own_token and token and token != entry.data[CONF_TOKEN]:
                error = await async_test_access(self.hass, entry.data[CONF_METER], token)
                if error:
                    errors["base"] = error
                else:
                    self.hass.config_entries.async_update_entry(entry, data={**entry.data, CONF_TOKEN: token})
            if not errors:
                return self.async_create_entry(data=options)

        opts = entry.options
        fields: dict[Any, Any] = {
            vol.Optional(CONF_PIN, default=opts.get(CONF_PIN, "")): str,
            vol.Optional(CONF_SIDEBAR, default=opts.get(CONF_SIDEBAR, True)): bool,
            vol.Optional(CONF_LITE_USERS, default=opts.get(CONF_LITE_USERS, "")): str,
        }
        if own_token:
            fields[vol.Optional(CONF_TOKEN, default="")] = PASSWORD
        return self.async_show_form(step_id="init", data_schema=vol.Schema(fields), errors=errors)
