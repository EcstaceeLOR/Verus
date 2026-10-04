import type { ApiMcpServiceOptions } from "./index.js";

export interface McpRuntimeConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly workspaceId: string;
  readonly signingKeys: NonNullable<ApiMcpServiceOptions["signingKeys"]>;
}

export interface McpHttpRuntimeConfig {
  readonly baseUrl: string;
  readonly signingKeys: NonNullable<ApiMcpServiceOptions["signingKeys"]>;
}

export function loadRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): McpRuntimeConfig {
  const shared = loadHttpRuntimeConfig(environment);
  return Object.freeze({
    ...shared,
    apiKey: required(environment, "VERUS_API_KEY"),
    workspaceId: required(environment, "VERUS_WORKSPACE_ID"),
  });
}

export function loadHttpRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): McpHttpRuntimeConfig {
  const baseUrl = required(environment, "VERUS_API_URL");
  const parsedUrl = new URL(baseUrl);
  if (
    parsedUrl.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)
  ) {
    throw new Error("VERUS_API_URL must use HTTPS outside loopback development.");
  }
  return Object.freeze({
    baseUrl: parsedUrl.toString(),
    signingKeys: parseSigningKeys(environment.VERUS_SIGNING_KEYS_JSON),
  });
}

function required(environment: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseSigningKeys(
  value: string | undefined,
): NonNullable<ApiMcpServiceOptions["signingKeys"]> {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("VERUS_SIGNING_KEYS_JSON must be valid JSON.");
  }
  if (!Array.isArray(parsed)) throw new Error("VERUS_SIGNING_KEYS_JSON must be an array.");
  return parsed.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null)
      throw new Error("Signing key entry is invalid.");
    const record = candidate as Record<string, unknown>;
    if (typeof record.key_id !== "string" || typeof record.public_key_pem !== "string") {
      throw new Error("Signing key entries require key_id and public_key_pem.");
    }
    return {
      keyId: record.key_id,
      algorithm: "Ed25519" as const,
      publicKey: record.public_key_pem,
    };
  });
}
