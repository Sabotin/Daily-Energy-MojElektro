# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Config and options flow: connect Home Assistant to porabim.com."""
from __future__ import annotations

import asyncio
from collections.abc import Mapping
import logging
from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant.config_entries import SOURCE_REAUTH, ConfigEntry, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import config_entry_oauth2_flow, issue_registry as ir
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from . import api, oauth
from .const import API_URL, CONF_SIDEBAR, DOMAIN, ISSUE_CONNECT, TIMEOUT, VERSION

_LOGGER = logging.getLogger(__name__)


async def _async_meter_title(hass, access_token: str) -> str:
    """Porabim · <meter>, from porabim's own snapshot; just Porabim if that does not work."""
    try:
        async with asyncio.timeout(TIMEOUT):
            resp = await async_get_clientsession(hass).get(
                f"{API_URL}/snapshot",
                headers={"authorization": f"Bearer {access_token}", "x-porabim-client": f"ha/{VERSION}"},
            )
            data = await resp.json(content_type=None) if resp.status == 200 else None
    except (aiohttp.ClientError, TimeoutError, ValueError):
        data = None
    return api.meter_title(data)


class DailyEnergyConfigFlow(config_entry_oauth2_flow.AbstractOAuth2FlowHandler, domain=DOMAIN):
    """Add integration → porabim.com (meter ID and Moj Elektro token there) → back here with a key."""

    DOMAIN = DOMAIN
    VERSION = 3

    @property
    def logger(self) -> logging.Logger:
        return _LOGGER

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        oauth.async_register(self.hass)
        return await super().async_step_user(user_input)

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        """The key stopped working (porabim refused the refresh), or a 1.x entry is not linked yet."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is None:
            return self.async_show_form(step_id="reauth_confirm")
        return await self.async_step_user()

    async def async_oauth_create_entry(self, data: dict[str, Any]) -> ConfigFlowResult:
        account = str(data["token"].get("account") or "")
        if not account:
            return self.async_abort(reason="oauth_error")
        if self.source == SOURCE_REAUTH:
            entry = self._get_reauth_entry()
            if "token" in entry.data and entry.unique_id != account:
                # A linked entry must come back to the same porabim account
                return self.async_abort(reason="wrong_account")
            other = next(
                (e for e in self._async_current_entries(include_ignore=False) if e.unique_id == account and e.entry_id != entry.entry_id),
                None,
            )
            if other is not None:
                return self.async_abort(reason="already_configured")
            # A 1.x entry had the meter as its unique id; from now on it is the porabim account
            self.hass.config_entries.async_update_entry(entry, unique_id=account, data=data)
            ir.async_delete_issue(self.hass, DOMAIN, f"{ISSUE_CONNECT}_{entry.entry_id}")
            self.hass.config_entries.async_schedule_reload(entry.entry_id)
            return self.async_abort(reason="reauth_successful")
        await self.async_set_unique_id(account)
        self._abort_if_unique_id_configured()
        title = await _async_meter_title(self.hass, data["token"]["access_token"])
        return self.async_create_entry(title=title, data=data, options={CONF_SIDEBAR: True})

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
