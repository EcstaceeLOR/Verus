export type PolicyLifecycle = "draft" | "approved" | "active" | "superseded" | "rolled_back";
export interface PolicyVersion {
  readonly id: string;
  readonly version: number;
  readonly lifecycle: PolicyLifecycle;
  readonly author: string;
  readonly reviewer?: string;
  readonly reason: string;
  readonly controls: Readonly<Record<string, boolean>>;
}
const required = new Set(["prompt_injection", "tenant_isolation", "audit"]);
export function validatePolicy(next: PolicyVersion, previous?: PolicyVersion): readonly string[] {
  const errors: string[] = [];
  for (const control of required)
    if (next.controls[control] !== true) errors.push(`NON_OVERRIDABLE_${control.toUpperCase()}`);
  if (next.lifecycle === "approved" && !next.reviewer) errors.push("REVIEWER_REQUIRED");
  if (previous && next.version <= previous.version) errors.push("VERSION_NOT_IMMUTABLE");
  return Object.freeze(errors);
}
export function canTransition(from: PolicyLifecycle, to: PolicyLifecycle): boolean {
  return (
    {
      draft: ["approved"],
      approved: ["active"],
      active: ["superseded", "rolled_back"],
      superseded: [],
      rolled_back: ["active"],
    } as Record<PolicyLifecycle, readonly PolicyLifecycle[]>
  )[from].includes(to);
}
