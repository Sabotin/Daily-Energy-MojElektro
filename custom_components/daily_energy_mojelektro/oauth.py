# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Prijava s porabim.com: avtorizacijska koda OAuth2 s PKCE (S256), javni odjemalec, brez skrivnosti."""
from __future__ import annotations

import base64
import hashlib
import secrets
from typing import Any

from yarl import URL

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_entry_oauth2_flow

from . import api
from .const import AUTHORIZE_URL, CLIENT_ID, DOMAIN, REDIRECT_URI, TOKEN_URL


def code_challenge(verifier: str) -> str:
    """b64url(sha256(verifier)) brez polnila, kot zahteva RFC 7636 S256."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


class PorabimImplementation(config_entry_oauth2_flow.LocalOAuth2Implementation):
    """/ha/connect in /ha/token na porabim.com, z novim preverjevalnikom kode za vsak potek."""

    def __init__(self, hass: HomeAssistant) -> None:
        super().__init__(hass, DOMAIN, CLIENT_ID, "", AUTHORIZE_URL, TOKEN_URL)
        self._verifiers: dict[str, str] = {}

    @property
    def name(self) -> str:
        return "porabim.com"

    @property
    def redirect_uri(self) -> str:
        """Vedno preusmeritev my.home-assistant.io: edina, ki jo porabim sprejme."""
        return REDIRECT_URI

    async def async_generate_authorize_url(self, flow_id: str) -> str:
        verifier = secrets.token_urlsafe(64)
        self._verifiers[flow_id] = verifier
        url = await super().async_generate_authorize_url(flow_id)
        return str(
            URL(url).update_query(
                code_challenge=code_challenge(verifier),
                code_challenge_method="S256",
                # porabim hrani en račun na Home Assistant, tudi po izbrisu in ponovnem dodajanju te integracije
                ha_instance=await api.async_instance_hash(self.hass),
            )
        )

    async def async_resolve_external_data(self, external_data: Any) -> dict:
        """Zamenja kodo za žetone; porabim preveri preverjevalnik glede na izziv."""
        verifier = self._verifiers.pop(external_data["state"]["flow_id"], "")
        return await self._token_request(
            {
                "grant_type": "authorization_code",
                "code": external_data["code"],
                "redirect_uri": external_data["state"]["redirect_uri"],
                "code_verifier": verifier,
            }
        )


@callback
def async_register(hass: HomeAssistant) -> None:
    """Registrira edino izvedbo (večkrat ni težava: kličeta jo nastavitev in potek nastavitve)."""
    current = hass.data.get(config_entry_oauth2_flow.DATA_IMPLEMENTATIONS, {}).get(DOMAIN, {})
    if DOMAIN not in current:
        config_entry_oauth2_flow.async_register_implementation(hass, DOMAIN, PorabimImplementation(hass))
