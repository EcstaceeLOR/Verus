import type { HostedScanResult } from "./scan-workflow.js";

export interface AgentDelivery {
  readonly state: "pending" | "delivered" | "review" | "withheld";
  readonly title: string;
  readonly detail: string;
}

export function protectedAgentDelivery(result?: HostedScanResult): AgentDelivery {
  if (result === undefined) {
    return {
      state: "pending",
      title: "Not evaluated yet",
      detail:
        "Run the same context through Verus to decide whether it may cross the trust boundary.",
    };
  }

  if (result.disposition === "allow") {
    return {
      state: "delivered",
      title: "Screened context delivered",
      detail:
        "No configured manipulation rule matched. The context may reach the agent, but Verus does not claim the content is factually true.",
    };
  }

  if (result.disposition === "review") {
    return {
      state: "review",
      title: "Held before inference",
      detail:
        "Verus requires human review, so the protected agent does not receive this context automatically.",
    };
  }

  return {
    state: "withheld",
    title: "Blocked before inference",
    detail:
      "Verus stopped this context at the trust boundary. The protected agent never receives the hostile text.",
  };
}

export function protectedContextPreview(text: string, result?: HostedScanResult): string {
  if (result === undefined) return "Run Verus to determine what crosses the trust boundary.";
  return result.disposition === "allow"
    ? text
    : "[CONTEXT WITHHELD BY VERUS — downstream agent receives no raw hostile text]";
}
