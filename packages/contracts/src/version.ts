import { UnsupportedContractVersionError } from "./errors.js";

export const SUPPORTED_CONTRACT_VERSIONS = Object.freeze(["1.0"] as const);
export type SupportedContractVersion = (typeof SUPPORTED_CONTRACT_VERSIONS)[number];

export function isSupportedContractVersion(value: unknown): value is SupportedContractVersion {
  return (
    typeof value === "string" && SUPPORTED_CONTRACT_VERSIONS.some((version) => version === value)
  );
}

export function assertSupportedContractVersion(
  value: unknown,
): asserts value is SupportedContractVersion {
  if (!isSupportedContractVersion(value)) {
    throw new UnsupportedContractVersionError(SUPPORTED_CONTRACT_VERSIONS);
  }
}

export function negotiateContractVersion(
  offeredVersions: readonly string[],
): SupportedContractVersion {
  const match = offeredVersions.find(isSupportedContractVersion);
  if (match === undefined) {
    throw new UnsupportedContractVersionError(SUPPORTED_CONTRACT_VERSIONS);
  }
  return match;
}
