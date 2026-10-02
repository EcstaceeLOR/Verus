import type { DetectionVerdict, DeterministicRuleEngine } from "@verus/detection";
import { VerusError } from "@verus/domain";
import { withWorkspaceTransaction, workspaceId, type ScanRecord } from "@verus/persistence";
import type { Pool } from "pg";

export interface ProcessedScan {
  readonly detection: Readonly<DetectionVerdict> | undefined;
  readonly scan: Readonly<ScanRecord>;
}

function findingId(scanId: string, index: number): string {
  return `finding_${scanId.slice("scan_".length)}_${String(index).padStart(3, "0")}`;
}

function textFromEnvelope(envelope: Readonly<Record<string, unknown>>): string | undefined {
  const input = envelope.input;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const text = (input as Record<string, unknown>).text;
  return typeof text === "string" ? text : undefined;
}

/**
 * Executes deterministic inspection under the same tenant transaction that writes its findings and
 * verdict. A crash or processing error rolls back the entire decision, leaving the queued job safe
 * to retry. Inputs without locally retrievable text are deliberately sent to human review.
 */
export class ScanProcessingService {
  constructor(
    readonly pool: Pool,
    readonly detector: DeterministicRuleEngine,
  ) {}

  async process(workspace: string, scanId: string): Promise<Readonly<ProcessedScan>> {
    return withWorkspaceTransaction(
      this.pool,
      workspaceId(workspace),
      async (store) => {
        const current = await store.getScan(scanId);
        if (["allowed", "blocked", "cancelled", "failed", "review"].includes(current.state)) {
          return Object.freeze({ scan: current, detection: undefined });
        }
        if (current.state !== "queued")
          throw new VerusError("CONFLICT", "Scan is not ready for processing.");
        const processing = await store.transitionScan({
          scanId,
          expectedVersion: current.stateVersion,
          from: "queued",
          to: "processing",
        });
        const envelope = await store.getIngestionEnvelope(scanId);
        if (envelope === undefined)
          throw new VerusError("SERVICE_UNAVAILABLE", "Accepted scan envelope is unavailable.");
        const text = textFromEnvelope(envelope.envelope);
        if (text === undefined) {
          await store.insertFinding({
            findingId: findingId(scanId, 0),
            scanId,
            category: "processing",
            severity: "medium",
            detectorId: "verus.processing.v1",
            reasonCode: "INPUT_REQUIRES_REVIEW",
            location: { representation: "metadata" },
          });
          const scan = await store.transitionScan({
            scanId,
            expectedVersion: processing.stateVersion,
            from: "processing",
            to: "review",
          });
          return Object.freeze({ scan, detection: undefined });
        }
        const sourceId =
          envelope.inputKind === "feed_event" &&
          typeof (envelope.envelope.input as { source_id?: unknown })?.source_id === "string"
            ? (envelope.envelope.input as { source_id: string }).source_id
            : undefined;
        const detection = this.detector.evaluate({
          content: text,
          tenantId: workspace,
          ...(sourceId === undefined ? {} : { sourceId }),
        });
        for (const [index, finding] of detection.findings.entries()) {
          await store.insertFinding({
            findingId: findingId(scanId, index),
            scanId,
            category: "prompt_injection",
            severity: finding.severity,
            detectorId: finding.ruleId,
            reasonCode: finding.reasonCode,
            confidenceBps: 10_000,
            location: {
              representation: "canonical",
              text_end: finding.location.end.offset,
              text_start: finding.location.start.offset,
            },
          });
        }
        const state =
          detection.disposition === "allow"
            ? "allowed"
            : detection.disposition === "block"
              ? "blocked"
              : "review";
        const scan = await store.transitionScan({
          scanId,
          expectedVersion: processing.stateVersion,
          from: "processing",
          to: state,
        });
        return Object.freeze({ scan, detection });
      },
      { isolation: "serializable", operationName: "scan.process" },
    );
  }
}
