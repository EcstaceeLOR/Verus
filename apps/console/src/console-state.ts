export type WorkspaceRole = "owner" | "admin" | "analyst" | "viewer";

export type ConsoleView = "overview" | "scans" | "evidence" | "policies" | "settings";

export interface OnboardingStep {
  readonly id: "workspace" | "members" | "api-key" | "sample";
  readonly title: string;
  readonly detail: string;
  readonly complete: boolean;
}

const permissions: Readonly<Record<WorkspaceRole, readonly ConsoleView[]>> = Object.freeze({
  owner: ["overview", "scans", "evidence", "policies", "settings"],
  admin: ["overview", "scans", "evidence", "policies", "settings"],
  analyst: ["overview", "scans", "evidence", "policies"],
  viewer: ["overview", "scans", "evidence"],
});

export function canOpen(role: WorkspaceRole, view: ConsoleView): boolean {
  return permissions[role].includes(view);
}

export function onboardingSteps(input: {
  readonly hasWorkspace: boolean;
  readonly hasMember: boolean;
  readonly hasApiKey: boolean;
  readonly hasSample: boolean;
}): readonly OnboardingStep[] {
  return [
    {
      id: "workspace",
      title: "Create your workspace",
      detail: "Keep scans, evidence, and policies with the people who need them.",
      complete: input.hasWorkspace,
    },
    {
      id: "members",
      title: "Invite a teammate",
      detail: "Give each person the least access they need. You can change it later.",
      complete: input.hasMember,
    },
    {
      id: "api-key",
      title: "Add a Verus API key",
      detail: "Use a scoped Verus key. Exchange credentials must always be read-only.",
      complete: input.hasApiKey,
    },
    {
      id: "sample",
      title: "Review a safe sample",
      detail: "Learn the verdict labels before connecting live sources.",
      complete: input.hasSample,
    },
  ];
}

export function nextOnboardingAction(steps: readonly OnboardingStep[]): OnboardingStep | undefined {
  return steps.find((step) => !step.complete);
}
