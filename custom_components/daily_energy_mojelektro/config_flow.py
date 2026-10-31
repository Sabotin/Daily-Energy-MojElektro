# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Potek nastavitve in možnosti: povezava Home Assistanta s porabim.com."""
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

from . import api, meters, oauth, oldlog
from .const import CONF_OLD_METER, CONF_SIDEBAR, DOMAIN, ISSUE_CONNECT

_LOGGER = logging.getLogger(__name__)

CONF_METER = "meter"
CONF_TOKEN = "token"
# napake POST /api/meters/add na porabim → napake tega obrazca (prevodi: config.error)
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
    """Dodaj integracijo → porabim.com (tam ID merilnega mesta in žeton Moj Elektro) → nazaj sem s ključem."""

    DOMAIN = DOMAIN
    VERSION = 3

    @property
    def logger(self) -> logging.Logger:
        return _LOGGER

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if self.source == SOURCE_USER and self._async_current_entries(include_ignore=False):
            # En vnos, en račun porabim na Home Assistant: novo merilno mesto gre vanj, tako kot + v plošči
            if self._link() is None:
                return self.async_abort(reason="connect_first")
            return await self.async_step_add_meter()
        oauth.async_register(self.hass)
        return await super().async_step_user(user_input)

    def _link(self) -> api.PorabimLink | None:
        """Povezava prvega povezanega vnosa (nobene, dokler vsi vnosi še čakajo na povezavo)."""
        links = self.hass.data.get(DOMAIN, {})
        return next((links[e.entry_id] for e in self._async_current_entries(include_ignore=False) if e.entry_id in links), None)

    async def async_step_add_meter(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Znova Dodaj integracijo: merilno mesto gre v račun, ki ga Home Assistant že ima, prek POST /api/meters/add na
        porabim (+ v plošči). Brez drugega vnosa, stranske vrstice ali računa; žetona tukaj ne hranimo."""
        errors: dict[str, str] = {}
        meter = ""
        if user_input is not None:
            meter = str(user_input[CONF_METER]).strip()
            link = self._link()
            if link is None:
                return self.async_abort(reason="connect_first")
            error = await self._async_add(link, meter, str(user_input[CONF_TOKEN]).strip())
            if error is None:
                link.entry.async_create_background_task(self.hass, meters.async_sync(self.hass, link), f"{DOMAIN} meters")
                if link.entry.data.get(CONF_OLD_METER):
                    # dnevni zapis iz 1.x je morda čakal na to merilno mesto
                    link.entry.async_create_background_task(
                        self.hass,
                        oldlog.async_upload(self.hass, link, link.entry, link.entry.data[CONF_OLD_METER]),
                        f"{DOMAIN} old log upload",
                    )
                return self.async_abort(reason="meter_added", description_placeholders={"meter": meter})
            if error == "signed_out":
                return self.async_abort(reason="connect_first")
            errors["base"] = error
        schema = vol.Schema(
            {
                vol.Required(CONF_METER, default=meter): str,
                vol.Required(CONF_TOKEN): TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD)),
            }
        )
        return self.async_show_form(step_id="add_meter", data_schema=schema, errors=errors)

    async def _async_add(self, link: api.PorabimLink, meter: str, token: str) -> str | None:
        """POST /api/meters/add na porabim (+ v plošči): None, ko je merilno mesto dodano, sicer napaka tega obrazca
        ("signed_out": porabim je zavrnil ključ)."""
        try:
            status, data = await api.async_call(self.hass, link, "POST", "meters/add", {"meter": meter, "token": token})
        except (aiohttp.ClientError, TimeoutError):
            status, data = 0, None
        if 200 <= status < 300 and isinstance(data, dict) and data.get("ok"):
            return None
        if status == 401:
            return "signed_out"
        error = data.get("error") if isinstance(data, dict) else None
        return ADD_ERRORS.get(error, "too_many" if status == 429 else "cannot_connect" if status == 0 else "unknown")

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        """Ključ ne deluje več (porabim je zavrnil osvežitev) ali pa vnos iz 1.x še ni povezan."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is None:
            return self.async_show_form(step_id="reauth_confirm")
        entry = self._get_reauth_entry()
        if "token" not in entry.data and entry.unique_id and self._link() is not None:
            # Vnos iz 1.x za drugo merilno mesto (1.x je imel en vnos na merilno mesto), ta Home Assistant pa svoj račun porabim
            # že ima: povezava bi spet pristala v tem računu
            return await self.async_step_merge()
        return await self.async_step_user()

    async def async_step_merge(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Merilno mesto vnosa iz 1.x gre v račun, ki ga Home Assistant ima (+ na porabim, če ga še ni), dnevni zapis nanj,
        nato se vnos odstrani: en vnos, en element v stranski vrstici za vsa merilna mesta."""
        entry = self._get_reauth_entry()
        link = self._link()
        if link is None:
            return self.async_abort(reason="connect_first")
        # unique id vnosa iz 1.x je njegovo merilno mesto
        meter = str(entry.unique_id)
        errors: dict[str, str] = {}
        if user_input is not None:
            token = str(user_input.get(CONF_TOKEN) or "").strip()
            error = await self._async_add(link, meter, token) if token else None
            if error in (None, "duplicate_meter"):
                error = await oldlog.async_upload(self.hass, link, entry, meter, must_have=True)
            if error is None:
                # ne pred koncem tega poteka: odstranitev vnosa prekine njegove poteke, tudi tega, če bi se začela takoj
                # (2024.12 ga prekine, preden se vrne: UnknownFlow)
                self.hass.async_create_task(
                    self.hass.config_entries.async_remove(entry.entry_id), f"{DOMAIN} merge", eager_start=False
                )
                link.entry.async_create_background_task(self.hass, meters.async_sync(self.hass, link), f"{DOMAIN} meters")
                return self.async_abort(reason="merged", description_placeholders={"meter": meter})
            if error == "signed_out":
                return self.async_abort(reason="connect_first")
            errors["base"] = error
        schema = vol.Schema({vol.Optional(CONF_TOKEN): TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))})
        return self.async_show_form(
            step_id="merge", data_schema=schema, errors=errors, description_placeholders={"meter": meter}
        )

    async def _old_account_alive(self, entry: ConfigEntry) -> bool:
        """Stari ključ se še osveži, torej račun obstaja. Če je zavrnjen (račun izbrisan na porabim), se vnos sme preseliti na
        nov račun, njegove naprave pa ob ponovnem nalaganju sledijo merilnim mestom novega računa."""
        implementation = await config_entry_oauth2_flow.async_get_config_entry_implementation(self.hass, entry)
        try:
            token = await implementation.async_refresh_token(entry.data["token"])
        except aiohttp.ClientResponseError as err:
            return not 400 <= err.status < 500
        except (aiohttp.ClientError, TimeoutError):
            return True
        # porabim ob vsaki uporabi zamenja žeton za osvežitev: shranimo novega
        self.hass.config_entries.async_update_entry(entry, data={**entry.data, "token": token})
        return True

    async def _async_abort_and_revoke(self, data: dict[str, Any], reason: str) -> ConfigFlowResult:
        """porabim je za ta ključ že naredil povezavo: končamo jo, da tam ne ostane neuporabljena."""
        await api.async_revoke(self.hass, data["token"]["access_token"])
        return self.async_abort(reason=reason)

    async def async_oauth_create_entry(self, data: dict[str, Any]) -> ConfigFlowResult:
        account = str(data["token"].get("account") or "")
        if not account:
            return await self._async_abort_and_revoke(data, "oauth_error")
        if self.source == SOURCE_REAUTH:
            entry = self._get_reauth_entry()
            if "token" in entry.data and entry.unique_id != account and await self._old_account_alive(entry):
                # Povezan vnos se vrne na isti račun porabim, dokler ta obstaja
                return await self._async_abort_and_revoke(data, "wrong_account")
            other = next(
                (e for e in self._async_current_entries(include_ignore=False) if e.unique_id == account and e.entry_id != entry.entry_id),
                None,
            )
            if other is not None:
                return await self._async_abort_and_revoke(data, "already_configured")
            old = entry.data.get("token")
            # Vnos iz 1.x je imel za unique id merilno mesto; odslej je to račun porabim. Merilno mesto ostane: dnevni zapis
            # vnosa gre nanj, tudi če je vnos povezan z drugim merilnim mestom (oldlog)
            old_meter = entry.data.get(CONF_OLD_METER) or (None if old else entry.unique_id)
            if old_meter:
                data = {**data, CONF_OLD_METER: old_meter}
            self.hass.config_entries.async_update_entry(entry, unique_id=account, data=data)
            ir.async_delete_issue(self.hass, DOMAIN, f"{ISSUE_CONNECT}_{entry.entry_id}")
            if old and old.get("access_token"):
                # Nova povezava zamenja staro; končamo tudi staro (morda je že mrtva)
                await api.async_revoke(self.hass, old["access_token"])
            self.hass.config_entries.async_schedule_reload(entry.entry_id)
            return self.async_abort(reason="reauth_successful")
        await self.async_set_unique_id(account)
        if any(e.unique_id == account for e in self._async_current_entries(include_ignore=False)):
            return await self._async_abort_and_revoke(data, "already_configured")
        # Račun ima lahko več merilnih mest: prikazana so kot njegove naprave, sam vnos je samo Porabim
        return self.async_create_entry(title=api.TITLE, data=data, options={CONF_SIDEBAR: True})

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return DailyEnergyOptionsFlow()


class DailyEnergyOptionsFlow(OptionsFlow):
    """Plošča v stranski vrstici vklopljena ali izklopljena; vse drugo (PIN, merilno mesto, žeton) je na porabim.com."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        schema = vol.Schema(
            {vol.Optional(CONF_SIDEBAR, default=self.config_entry.options.get(CONF_SIDEBAR, True)): bool}
        )
        return self.async_show_form(step_id="init", data_schema=schema)
