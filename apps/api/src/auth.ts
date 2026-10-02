import type { IncomingMessage } from "node:http";

import { verifyApiKey, type SecretValue } from "@verus/crypto";
import { VerusError, type AuthorizationAction } from "@verus/domain";

import type { ApiAuthenticator, ApiPrincipal } from "./public-api.js";

export interface ApiKeyLookup {
  find(
    workspaceId: string,
    keyId: string,
  ): Promise<
    | Readonly<{ keyId: string; verifier: string; scopes: readonly AuthorizationAction[] }>
    | undefined
  >;
  recordUse(workspaceId: string, keyId: string): Promise<void>;
}

function bearer(request: IncomingMessage): string {
  const value = request.headers.authorization;
  if (
    typeof value !== "string" ||
    !/^Bearer vrk\.key_[0-9A-HJKMNP-TV-Z]{26}\.[A-Za-z0-9_-]{40,}$/u.test(value)
  )
    throw new VerusError("AUTHENTICATION_REQUIRED", "A valid API bearer token is required.");
  return value.slice("Bearer ".length);
}

/** Validates key identity, HMAC verifier, tenant binding, and action scope without logging the bearer value. */
export class ApiKeyAuthenticator implements ApiAuthenticator {
  constructor(
    readonly lookup: ApiKeyLookup,
    readonly pepper: SecretValue,
  ) {}

  async authenticate(request: IncomingMessage, action: AuthorizationAction): Promise<ApiPrincipal> {
    const workspaceId = request.headers["x-verus-workspace-id"];
    if (typeof workspaceId !== "string" || !/^ws_[0-9A-HJKMNP-TV-Z]{26}$/u.test(workspaceId))
      throw new VerusError("AUTHENTICATION_REQUIRED", "A valid workspace header is required.");
    const token = bearer(request);
    const keyId = token.split(".")[1] as string;
    const key = await this.lookup.find(workspaceId, keyId);
    if (!key || !verifyApiKey(token, key, this.pepper))
      throw new VerusError("AUTHENTICATION_REQUIRED", "API key is invalid or unavailable.");
    if (!key.scopes.includes(action))
      throw new VerusError("AUTHORIZATION_DENIED", "API key does not have the required scope.");
    await this.lookup.recordUse(workspaceId, key.keyId);
    return Object.freeze({ workspaceId, keyId: key.keyId, scopes: Object.freeze([...key.scopes]) });
  }
}
