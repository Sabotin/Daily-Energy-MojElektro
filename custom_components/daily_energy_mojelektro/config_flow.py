# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Config and options flow: connect Home Assistant to porabim.com."""
from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant.config_entries import SOURCE_REAUTH, SOURCE_USER, ConfigEntry, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import config_entry_oauth2_flow, issue_registry as ir
from homeassistant.helpers.selector import TextSelector, TextSelectorConfig, TextSelectorType

from . import api, meters, oauth
from .const import CONF_SIDEBAR, DOMAIN, ISSUE_CONNECT

_LOGGER = logging.getLogger(__name__)

CONF_METER = "meter"
CONF_TOKEN = "token"
# porabim's POST /api/meters/add errors → this form's (translations: config.error)
ADD_ERRORS = {
    "invalid_auth": "invalid_auth",
    "invalid_meter": "invalid_meter",
    "cannot_connect": "cannot_connect",
    "invalid_format": "invalid_format",
    "duplicate_meter": "duplicate_meter",
    "too_many_meters": "too_many_meters",
    "meter_blocked": "meter_blocked",
    "too_many": "too_many",
}


class DailyEnergyConfigFlow(config_entry_oauth2_flow.AbstractOAuth2FlowHandler, domain=DOMAIN):
    """Add integration → porabim.com (meter ID and Moj Elektro token there) → back here with a key."""

    DOMAIN = DOMAIN
    VERSION = 3

    @property
    def logger(self) -> logging.Logger:
        return _LOGGER

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if self.source == SOURCE_USER and self._async_current_entries(include_ignore=False):
            # One entry, one porabim account per Home Assistant: another meter goes into it, as + in the panel does
            if self._link() is None:
                return self.async_abort(reason="connect_first")
            return await self.async_step_add_meter()
        oauth.async_register(self.hass)
        return await super().async_step_user(user_input)

    def _link(self) -> api.PorabimLink | None:
        """The first connected entry's link (none while every entry still waits to be connected)."""
        links = self.hass.data.get(DOMAIN, {})
        return next((links[e.entry_id] for e in self._async_current_entries(include_ignore=False) if e.entry_id in links), None)

    async def async_step_add_meter(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Add integration again: the meter goes into the account Home Assistant already has, with porabim's own
        POST /api/meters/add (the panel's +). No second entry, sidebar or account; the token is not kept here."""
        errors: dict[str, str] = {}
        meter = ""
        if user_input is not None:
            meter = str(user_input[CONF_METER]).strip()
            body = {"meter": meter, "token": str(user_input[CONF_TOKEN]).strip()}
            link = self._link()
            if link is None:
                return self.async_abort(reason="connect_first")
            try:
                status, data = await api.async_call(self.hass, link, "POST", "meters/add", body)
            except (aiohttp.ClientError, TimeoutError):
                status, data = 0, None
            if 200 <= status < 300 and isinstance(data, dict) and data.get("ok"):
                link.entry.async_create_background_task(self.hass, meters.async_sync(self.hass, link), f"{DOMAIN} meters")
                return self.async_abort(reason="meter_added", description_placeholders={"meter": meter})
            if status == 401:
                return self.async_abort(reason="connect_first")
            error = data.get("error") if isinstance(data, dict) else None
            errors["base"] = ADD_ERRORS.get(error, "too_many" if status == 429 else "cannot_connect" if status == 0 else "unknown")
        schema = vol.Schema(
            {
                vol.Required(CONF_METER, default=meter): str,
                vol.Required(CONF_TOKEN): TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD)),
            }
        )
        return self.async_show_form(step_id="add_meter", data_schema=schema, errors=errors)

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        """The key stopped working (porabim refused the refresh), or a 1.x entry is not linked yet."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is None:
            return self.async_show_form(step_id="reauth_confirm")
        return await self.async_step_user()

    async def _old_account_alive(self, entry: ConfigEntry) -> bool:
        """The old key still refreshes, so its account exists. Refused (account deleted on porabim): the entry may move
        to the new account, its devices follow the new account's meters at the reload."""
        implementation = await config_entry_oauth2_flow.async_get_config_entry_implementation(self.hass, entry)
        try:
            token = await implementation.async_refresh_token(entry.data["token"])
        except aiohttp.ClientResponseError as err:
            return not 400 <= err.status < 500
        except (aiohttp.ClientError, TimeoutError):
            return True
        # porabim rotates the refresh token on every use: keep the new one
        self.hass.config_entries.async_update_entry(entry, data={**entry.data, "token": token})
        return True

    async def _async_abort_and_revoke(self, data: dict[str, Any], reason: str) -> ConfigFlowResult:
        """porabim already made a link for this key: end it, so no unused link is left there."""
        await api.async_revoke(self.hass, data["token"]["access_token"])
        return self.async_abort(reason=reason)

    async def async_oauth_create_entry(self, data: dict[str, Any]) -> ConfigFlowResult:
        account = str(data["token"].get("account") or "")
        if not account:
            return await self._async_abort_and_revoke(data, "oauth_error")
        if self.source == SOURCE_REAUTH:
            entry = self._get_reauth_entry()
            if "token" in entry.data and entry.unique_id != account and await self._old_account_alive(entry):
                # A linked entry comes back to the same porabim account while that one still exists
                return await self._async_abort_and_revoke(data, "wrong_account")
            other = next(
                (e for e in self._async_current_entries(include_ignore=False) if e.unique_id == account and e.entry_id != entry.entry_id),
                None,
            )
            if other is not None:
                return await self._async_abort_and_revoke(data, "already_configured")
            old = entry.data.get("token")
            # A 1.x entry had the meter as its unique id; from now on it is the porabim account
            self.hass.config_entries.async_update_entry(entry, unique_id=account, data=data)
            ir.async_delete_issue(self.hass, DOMAIN, f"{ISSUE_CONNECT}_{entry.entry_id}")
            if old and old.get("access_token"):
                # The new link replaces the old one; end the old one too (it may already be dead)
                await api.async_revoke(self.hass, old["access_token"])
            self.hass.config_entries.async_schedule_reload(entry.entry_id)
            return self.async_abort(reason="reauth_successful")
        await self.async_set_unique_id(account)
        if any(e.unique_id == account for e in self._async_current_entries(include_ignore=False)):
            return await self._async_abort_and_revoke(data, "already_configured")
        # The account can hold several meters: they show as its devices, the entry itself is just Porabim
        return self.async_create_entry(title=api.TITLE, data=data, options={CONF_SIDEBAR: True})

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return DailyEnergyOptionsFlow()


class DailyEnergyOptionsFlow(OptionsFlow):
    """The sidebar panel on or off; everything else (PIN, meter, token) is on porabim.com."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        schema = vol.Schema(
            {vol.Optional(CONF_SIDEBAR, default=self.config_entry.options.get(CONF_SIDEBAR, True)): bool}
        )
        return self.async_show_form(step_id="init", data_schema=schema)
