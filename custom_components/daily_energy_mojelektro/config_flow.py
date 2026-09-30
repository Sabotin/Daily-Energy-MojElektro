# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
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
from homeassistant.helpers.selector import (
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .const import CONF_METER, CONF_NAME, CONF_PIN, CONF_SIDEBAR, CONF_TOKEN, DOMAIN
from .manager import async_test_access

PASSWORD = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))
USE_EXISTING = "use_existing"
TOKEN_FROM = "token_from"


def meter_label(entry: ConfigEntry) -> str:
    """"name (EIMM)", or the EIMM when the meter has no name."""
    meter, name = entry.data.get(CONF_METER, ""), entry.options.get(CONF_NAME, "")
    return f"{name} ({meter})" if name else meter


class DailyEnergyConfigFlow(ConfigFlow, domain=DOMAIN):
    """Set up a meter: its Moj Elektro meter ID and API token. Every meter (EIMM) is an entry of its own."""

    # 2: meter ID and token are stored in the entry itself (see async_migrate_entry)
    VERSION = 2

    def __init__(self) -> None:
        self._meter = ""
        self._pin = ""

    def _with_token(self) -> list[ConfigEntry]:
        """The meters already set up that have a token (in the order they were added)."""
        return [e for e in self.hass.config_entries.async_entries(DOMAIN) if e.data.get(CONF_TOKEN)]

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Meter ID and API token from the Moj Elektro portal, checked with one request before saving.
        With a meter already set up, the add step can use its token instead."""
        if user_input is None and self._with_token():
            return await self.async_step_add()
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

    async def async_step_add(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Another meter: its EIMM, and the token of a meter already set up ("Use the existing token", on by
        default; with more than one token, which meter's) or a new one in the next step. Tokens are never shown."""
        entries = self._with_token()
        tokens = {e.data[CONF_TOKEN] for e in entries}
        errors: dict[str, str] = {}
        if user_input is not None:
            meter = str(user_input[CONF_METER]).strip()
            await self.async_set_unique_id(meter)
            self._abort_if_unique_id_configured()
            self._pin = str(user_input.get(CONF_PIN, "") or "").strip()
            if not user_input.get(USE_EXISTING, True):
                self._meter = meter
                return await self.async_step_token()
            source = next((e for e in entries if e.entry_id == user_input.get(TOKEN_FROM)), entries[0])
            token = source.data[CONF_TOKEN]
            error = await async_test_access(self.hass, meter, token)
            if error:
                errors["base"] = error
            else:
                return self._create(meter, token)

        fields: dict[Any, Any] = {
            vol.Required(CONF_METER, default=(user_input or {}).get(CONF_METER, "")): str,
            vol.Required(USE_EXISTING, default=(user_input or {}).get(USE_EXISTING, True)): bool,
        }
        if len(tokens) > 1:
            choices = [SelectOptionDict(value=e.entry_id, label=meter_label(e)) for e in entries]
            fields[vol.Required(TOKEN_FROM, default=(user_input or {}).get(TOKEN_FROM, entries[0].entry_id))] = (
                SelectSelector(SelectSelectorConfig(options=choices, mode=SelectSelectorMode.DROPDOWN))
            )
        fields[vol.Optional(CONF_PIN, default=(user_input or {}).get(CONF_PIN, ""))] = str
        return self.async_show_form(step_id="add", data_schema=vol.Schema(fields), errors=errors)

    async def async_step_token(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """A new API token for the meter of the add step."""
        errors: dict[str, str] = {}
        if user_input is not None:
            token = str(user_input[CONF_TOKEN]).strip()
            error = await async_test_access(self.hass, self._meter, token)
            if error:
                errors["base"] = error
            else:
                return self._create(self._meter, token)
        return self.async_show_form(
            step_id="token",
            data_schema=vol.Schema({vol.Required(CONF_TOKEN): PASSWORD}),
            errors=errors,
            description_placeholders={"meter": self._meter},
        )

    def _create(self, meter: str, token: str) -> ConfigFlowResult:
        # the entry title is the EIMM until the meter gets a name (the dashboard's meter button renames it)
        return self.async_create_entry(
            title=meter,
            data={CONF_METER: meter, CONF_TOKEN: token},
            options={CONF_PIN: self._pin, CONF_SIDEBAR: True},
        )

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
                # the meter's name (renamed on the dashboard) is not in this form, so it is kept
                if entry.options.get(CONF_NAME):
                    options[CONF_NAME] = entry.options[CONF_NAME]
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
