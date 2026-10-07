import { createHash } from "node:crypto";

import {
  buildCapsule,
  composeContextCapsule,
  verifyCapsule,
  type CapsuleAuditSink,
} from "../packages/capsules/src/index.js";
import {
  Ed25519SigningProvider,
  SecretValue,
  generateEd25519Key,
  type SecretProvider,
} from "../packages/crypto/src/index.js";

import type { HostedRequest, HostedResponse } from "./http.js";
import { secureJson } from "./http.js";

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const providerReference = "demo/capsule-signing";

interface HostedFindingInput {
  readonly rule_id: string;
  readonly reason_code: string;
  readonly severity: "low" | "medium" | "high" | "critical";
}

interface HostedCapsuleInput {
  readonly scan_id: string;
  readonly disposition: "allow" | "review" | "block";
  readonly findings: readonly HostedFindingInput[];
  readonly input_digest: string;
  readonly rule_set_digest: string;
  readonly rule_set_version: string;
  readonly processed_at: string;
}

class MemorySecretProvider implements SecretProvider {
  readonly #values = new Map<string, Uint8Array>();

  async put(reference: string, value: SecretValue): Promise<void> {
    this.#values.set(
      reference,
      value.use((bytes) => Uint8Array.from(bytes)),
    );
  }

  async withSecret<T>(
    reference: string,
    operation: (value: SecretValue) => Promise<T> | T,
  ): Promise<T> {
    const bytes = this.#values.get(reference);
    if (bytes === undefined) throw new Error("Demo signing key is unavailable.");
    const secret = new SecretValue(bytes);
    try {
      return await operation(secret);
    } finally {
      secret.destroy();
    }
  }

  async delete(reference: string): Promise<void> {
    const bytes = this.#values.get(reference);
    bytes?.fill(0);
    this.#values.delete(reference);
  }
}

const audit: CapsuleAuditSink = {
  async append() {
    return undefined;
  },
};

function identifier(prefix: string, seed: string): `${string}_${string}` {
  const digest = createHash("sha256").update(seed).digest().subarray(0, 16);
  let value = BigInt("0x" + Buffer.from(digest).toString("hex"));
  let encoded = "";
  for (let index = 0; index < 26; index += 1) {
    encoded = alphabet[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return `${prefix}_${encoded}`;
}

function bodyFrom(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function parseInput(value: unknown): HostedCapsuleInput {
  const body = bodyFrom(value);
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new TypeError("Request body must be a JSON object.");
  const record = body as Record<string, unknown>;
  if (
    typeof record.scan_id !== "string" ||
    !["allow", "review", "block"].includes(String(record.disposition)) ||
    typeof record.input_digest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(record.input_digest) ||
    typeof record.rule_set_digest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(record.rule_set_digest) ||
    typeof record.rule_set_version !== "string" ||
    typeof record.processed_at !== "string" ||
    Number.isNaN(Date.parse(record.processed_at)) ||
    !Array.isArray(record.findings)
  ) {
    throw new TypeError("Hosted scan metadata is invalid.");
  }

  const findings = record.findings.map((candidate): HostedFindingInput => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate))
      throw new TypeError("Hosted finding is invalid.");
    const finding = candidate as Record<string, unknown>;
    if (
      typeof finding.rule_id !== "string" ||
      typeof finding.reason_code !== "string" ||
      !["low", "medium", "high", "critical"].includes(String(finding.severity))
    ) {
      throw new TypeError("Hosted finding is invalid.");
    }
    return {
      rule_id: finding.rule_id,
      reason_code: finding.reason_code,
      severity: finding.severity as HostedFindingInput["severity"],
    };
  });

  return {
    scan_id: record.scan_id,
    disposition: record.disposition as HostedCapsuleInput["disposition"],
    findings,
    input_digest: record.input_digest,
    rule_set_digest: record.rule_set_digest,
    rule_set_version: record.rule_set_version,
    processed_at: new Date(record.processed_at).toISOString(),
  };
}

export async function createSignedDemoCapsule(value: unknown) {
  const input = parseInput(value);
  const seed = [input.scan_id, input.input_digest, input.processed_at].join(":");
  const secrets = new MemorySecretProvider();
  const keyId = identifier("key", seed);
  const publicKey = await generateEd25519Key(keyId, providerReference, secrets);
  const signer = new Ed25519SigningProvider(secrets);

  try {
    const capsule = await composeContextCapsule({
      capsuleId: identifier("cap", seed),
      scan: {
        createdAt: new Date(input.processed_at),
        inputDigest: input.input_digest as `sha256:${string}`,
        scanId: identifier("scan", seed),
        state:
          input.disposition === "allow"
            ? "allowed"
            : input.disposition === "block"
              ? "blocked"
              : "review",
        workspaceId: identifier("ws", "verus-public-judge-demo"),
      },
      findings: input.findings.map((finding, index) => ({
        category: "hosted_detector",
        confidenceBps: undefined,
        detectorId: `hosted/${input.rule_set_version}`,
        findingId: identifier("finding", `${seed}:${index}`),
        location: { representation: "canonical" },
        reasonCode: finding.reason_code,
        severity: finding.severity,
      })),
      policy: {
        policy_id: identifier("policy", input.rule_set_digest),
        version: "1.0.0",
        digest: input.rule_set_digest as `sha256:${string}`,
      },
      component: {
        component: "hosted-detector",
        version: "1.0.0",
        digest: input.rule_set_digest as `sha256:${string}`,
      },
      key: { ...publicKey, providerReference },
      signer,
      audit,
      build: buildCapsule,
    });

    const verification = await verifyCapsule({
      capsule,
      keys: [publicKey],
      audit,
    });

    return Object.freeze({
      artifact_type: "signed_demo_context_capsule",
      source_scan: {
        hosted_scan_id: input.scan_id,
        cryptographically_signed: false,
        relationship: "derived_from_digest_disposition_and_findings",
      },
      capsule,
      verification: {
        valid: verification.valid,
        artifact_digest: verification.artifactDigest,
        algorithm: "Ed25519",
        key_id: publicKey.keyId,
        public_key: publicKey.publicKey,
        key_scope: "ephemeral_per_request_demo",
        production_key_attested: false,
      },
      truth_boundary: {
        signature_proves: "artifact integrity under this ephemeral demo key",
        signature_does_not_prove: "real-world factual truth or production key provenance",
        factual_claims_verified: false,
        evidence_connectors_used: false,
      },
    });
  } finally {
    await secrets.delete(providerReference).catch(() => undefined);
  }
}

export default async function contextCapsule(
  request: HostedRequest,
  response: HostedResponse,
): Promise<void> {
  secureJson(response);
  if (request.method !== "POST") {
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }
  try {
    response.status(200).json(await createSignedDemoCapsule(request.body));
  } catch (error) {
    response.status(400).json({
      error: "INVALID_REQUEST",
      message: error instanceof Error ? error.message : "Invalid capsule request.",
    });
  }
}
