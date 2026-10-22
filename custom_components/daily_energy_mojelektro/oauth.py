# Daily Energy for Moj Elektro
# Copyright (c) 2026 Sabotin (https://github.com/Sabotin). All rights reserved.
# Personal, non-commercial use through HACS only. Copying, modifying, sharing or reusing
# any part of this file without written permission is not allowed. See LICENSE.
"""Sign-in with porabim.com: OAuth2 authorization code with PKCE (S256), public client, no secret."""
from __future__ import annotations

import base64
import hashlib
import secrets
from typing import Any

from yarl import URL

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_entry_oauth2_flow

from .const import AUTHORIZE_URL, CLIENT_ID, DOMAIN, REDIRECT_URI, TOKEN_URL


def code_challenge(verifier: str) -> str:
    """b64url(sha256(verifier)) without padding, as RFC 7636 S256 wants."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


class PorabimImplementation(config_entry_oauth2_flow.LocalOAuth2Implementation):
    """porabim.com's /ha/connect and /ha/token, with a new code verifier for every flow."""

    def __init__(self, hass: HomeAssistant) -> None:
        super().__init__(hass, DOMAIN, CLIENT_ID, "", AUTHORIZE_URL, TOKEN_URL)
        self._verifiers: dict[str, str] = {}

    @property
    def name(self) -> str:
        return "porabim.com"

    @property
    def redirect_uri(self) -> str:
        """Always the my.home-assistant.io redirect: the only one porabim accepts."""
        return REDIRECT_URI

    async def async_generate_authorize_url(self, flow_id: str) -> str:
        verifier = secrets.token_urlsafe(64)
        self._verifiers[flow_id] = verifier
        url = await super().async_generate_authorize_url(flow_id)
        return str(URL(url).update_query(code_challenge=code_challenge(verifier), code_challenge_method="S256"))

    async def async_resolve_external_data(self, external_data: Any) -> dict:
        """Swap the code for tokens; porabim checks the verifier against the challenge."""
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
    """Register the one implementation (again is fine: the setup and the config flow both call it)."""
    current = hass.data.get(config_entry_oauth2_flow.DATA_IMPLEMENTATIONS, {}).get(DOMAIN, {})
    if DOMAIN not in current:
        config_entry_oauth2_flow.async_register_implementation(hass, DOMAIN, PorabimImplementation(hass))
