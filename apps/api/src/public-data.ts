import { withWorkspaceTransaction, workspaceId } from "@verus/persistence";
import type { Pool } from "pg";

import type { ApiKeyLookup } from "./auth.js";
import type { PublicApiData } from "./public-api.js";

function scanRecord(scan: {
  readonly createdAt: Date;
  readonly inputDigest: string;
  readonly requestId: string;
  readonly scanId: string;
  readonly state: string;
  readonly stateVersion: number;
  readonly updatedAt: Date;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    created_at: scan.createdAt.toISOString(),
    input_digest: scan.inputDigest,
    request_id: scan.requestId,
    scan_id: scan.scanId,
    state: scan.state,
    state_version: scan.stateVersion,
    updated_at: scan.updatedAt.toISOString(),
  });
}

/**
 * PostgreSQL-backed read surface for the versioned API. Every call opens a workspace transaction,
 * so row-level tenant policies apply even when a caller supplies a valid key for another tenant.
 */
export class PostgresPublicApiData implements ApiKeyLookup, PublicApiData {
  constructor(readonly pool: Pool) {}

  async find(workspace: string, keyId: string) {
    return this.#within(workspace, async (store) => store.credentials().findUsableApiKey(keyId));
  }

  async recordUse(workspace: string, keyId: string): Promise<void> {
    await this.#within(workspace, async (store) => store.credentials().recordApiKeyUse(keyId));
  }

  async getScan(workspace: string, scanId: string) {
    return this.#within(workspace, async (store) => {
      const scan = await store.findScan(scanId);
      return scan === undefined ? undefined : scanRecord(scan);
    });
  }

  async listScans(input: Readonly<{ workspaceId: string; after?: string; limit: number }>) {
    return this.#within(input.workspaceId, async (store) => {
      const result = await store.listScans({
        limit: input.limit,
        ...(input.after === undefined ? {} : { after: input.after }),
      });
      return Object.freeze({
        items: Object.freeze(result.items.map(scanRecord)),
        ...(result.next === undefined ? {} : { next: result.next }),
      });
    });
  }

  async getFindings(workspace: string, scanId: string) {
    return this.#within(workspace, async (store) => {
      if ((await store.findScan(scanId)) === undefined) return undefined;
      return store.listFindings(scanId).then((items) =>
        Object.freeze(
          items.map((finding) =>
            Object.freeze({
              category: finding.category,
              confidence_bps: finding.confidenceBps,
              created_at: finding.createdAt.toISOString(),
              detector_id: finding.detectorId,
              finding_id: finding.findingId,
              location: finding.location,
              reason_code: finding.reasonCode,
              severity: finding.severity,
            }),
          ),
        ),
      );
    });
  }

  async getEvidence(workspace: string, scanId: string) {
    return this.#within(workspace, async (store) => {
      if ((await store.findScan(scanId)) === undefined) return undefined;
      return store.listEvidence(scanId).then((items) =>
        Object.freeze(
          items.map((evidence) =>
            Object.freeze({
              evidence_id: evidence.evidenceId,
              freshness: evidence.freshness,
              identity_state: evidence.identityState,
              retrieved_at: evidence.retrievedAt.toISOString(),
              snapshot_digest: evidence.snapshotDigest,
              source_id: evidence.sourceId,
            }),
          ),
        ),
      );
    });
  }

  /** Capsules fail closed until their signed records are durably persisted with the scan. */
  async getCapsule() {
    return undefined;
  }

  async #within<T>(
    workspace: string,
    operation: Parameters<typeof withWorkspaceTransaction<T>>[2],
  ) {
    return withWorkspaceTransaction(this.pool, workspaceId(workspace), operation, {
      operationName: "public_api.read",
    });
  }
}
