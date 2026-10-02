import type { CandidateClaim } from "./claims.js";
export type VerificationState =
  "verified" | "contradicted" | "unsupported" | "ambiguous" | "pending";
export interface EvidenceItem {
  readonly id: string;
  readonly primary: boolean;
  readonly entity: string;
  readonly value: number;
  readonly currency?: string;
  readonly period?: string;
  readonly citation: string;
}
export interface QuorumPolicy {
  readonly version: string;
  readonly claimType: CandidateClaim["type"];
  readonly minimumMatches: number;
  readonly requirePrimary: boolean;
}
export function verifyClaim(
  claim: CandidateClaim,
  evidence: readonly EvidenceItem[],
  policy: QuorumPolicy,
): Readonly<{
  state: VerificationState;
  policyVersion: string;
  supporting: readonly string[];
  contradicting: readonly string[];
}> {
  if (claim.subject.ambiguity === "ambiguous")
    return Object.freeze({
      state: "ambiguous",
      policyVersion: policy.version,
      supporting: Object.freeze([]),
      contradicting: Object.freeze([]),
    });
  if (claim.value === undefined || policy.claimType !== claim.type)
    return Object.freeze({
      state: "pending",
      policyVersion: policy.version,
      supporting: Object.freeze([]),
      contradicting: Object.freeze([]),
    });
  const matching = evidence.filter(
    (item) =>
      item.entity === claim.subject.entity &&
      item.value === claim.value &&
      (item.currency ?? "USD") === (claim.currency ?? "USD"),
  );
  const contradicting = evidence
    .filter((item) => item.entity === claim.subject.entity && item.value !== claim.value)
    .map((item) => item.id)
    .sort();
  const supporting = matching.map((item) => item.id).sort();
  const primary = matching.some((item) => item.primary);
  const state: VerificationState = contradicting.length
    ? "contradicted"
    : supporting.length >= policy.minimumMatches && (!policy.requirePrimary || primary)
      ? "verified"
      : "unsupported";
  return Object.freeze({
    state,
    policyVersion: policy.version,
    supporting: Object.freeze(supporting),
    contradicting: Object.freeze(contradicting),
  });
}
