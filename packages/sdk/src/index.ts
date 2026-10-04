import type {
  ContextCapsule,
  Evidence,
  Finding,
  IngestionRequest,
  PolicyReference,
} from "@verus/contracts";
import { parseContextCapsule } from "@verus/contracts";
import {
  canonicalizeJson,
  sha256Digest,
  verifyEd25519Signature,
  type PublicSigningKey,
} from "@verus/crypto";

export type ScanState =
  "accepted" | "allowed" | "blocked" | "cancelled" | "failed" | "processing" | "queued" | "review";

export interface IngestionAccepted {
  readonly scan_id: string;
  readonly state: "queued";
  readonly idempotent_replay: boolean;
  readonly correlation_id: string;
}
export interface ScanRecord {
  readonly scan_id: string;
  readonly request_id: string;
  readonly input_digest: string;
  readonly state: ScanState;
  readonly state_version: number;
  readonly created_at: string;
  readonly updated_at: string;
}
export interface FindingRecord extends Omit<Finding, "extensions"> {
  readonly created_at?: string;
}
export type EvidenceRecord = Omit<
  Evidence,
  "extensions" | "published_at" | "source_class" | "source_tier" | "quality_grade" | "canonical_url"
>;
export interface Page<T> {
  readonly data: readonly T[];
  readonly next?: string;
}
export interface ScanInspection {
  readonly scan: ScanRecord;
  readonly findings: readonly FindingRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly capsule?: ContextCapsule;
}
export interface PolicyResult {
  readonly scan_id: string;
  readonly disposition: ContextCapsule["disposition"];
  readonly policy: PolicyReference;
  readonly reason_codes: readonly string[];
}
export interface VerificationResult {
  readonly valid: boolean;
  readonly artifact_digest?: string;
  readonly key_id?: string;
  readonly reason?: "SIGNING_KEY_UNAVAILABLE" | "SIGNATURE_INVALID";
}

export class VerusApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "VerusApiError";
  }
}
export class VerusWaitTimeoutError extends Error {
  constructor(
    readonly scanId: string,
    readonly timeoutMs: number,
  ) {
    super("Timed out waiting for the scan to reach a terminal state.");
    this.name = "VerusWaitTimeoutError";
  }
}
export class VerusConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerusConfigurationError";
  }
}

export interface VerusClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly workspaceId: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly retries?: number;
  readonly requestTimeoutMs?: number;
  readonly maximumRetryDelayMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly telemetry?: (event: SdkTelemetryEvent) => void;
}
export interface SdkTelemetryEvent {
  readonly operation: string;
  readonly outcome: "success" | "error";
  readonly durationMs: number;
  readonly status?: number;
  readonly code?: string;
}
export interface RequestOptions {
  readonly signal?: AbortSignal;
}
export interface WaitOptions extends RequestOptions {
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
}
export interface IterateOptions extends RequestOptions {
  readonly limit?: number;
}

const TERMINAL_STATES = new Set<ScanState>(["allowed", "blocked", "cancelled", "failed", "review"]);
const CAPSULE_STATES = new Set<ScanState>(["allowed", "blocked", "review"]);
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_MAXIMUM_RETRY_DELAY_MS = 4_000;

function unwrap<T>(value: unknown): T {
  const envelope = value as { data?: T };
  return (Object.hasOwn(envelope, "data") ? envelope.data : value) as T;
}
function localHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
function apiBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new VerusConfigurationError("VERUS_API_URL must be an absolute URL.");
  }
  if (url.username || url.password)
    throw new VerusConfigurationError("VERUS_API_URL must not contain credentials.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost(url.hostname)))
    throw new VerusConfigurationError("VERUS_API_URL must use HTTPS outside loopback.");
  return url;
}
function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new VerusConfigurationError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}
function retryAfter(response: Response, fallback: number, maximum: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, maximum);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), maximum);
  }
  return Math.min(fallback, maximum);
}
function abortSignal(timeoutMs: number, caller?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return caller === undefined ? timeout : AbortSignal.any([timeout, caller]);
}
function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
function operationName(path: string, method = "GET"): string {
  const route = path.split("?", 1)[0]?.replace(/\/v1\/scans\/[^/]+/u, "/v1/scans/:scan_id");
  return `${method} ${route ?? "/v1/unknown"}`;
}

/** Verifies a capsule without network access or API credentials. */
export function verifyCapsuleOffline(
  capsule: ContextCapsule,
  keys: readonly PublicSigningKey[],
): VerificationResult {
  const key = keys.find(
    (candidate) =>
      candidate.keyId === capsule.signature.key_id && candidate.algorithm === "Ed25519",
  );
  if (!key) return Object.freeze({ valid: false, reason: "SIGNING_KEY_UNAVAILABLE" });
  const { signature: _signature, ...unsigned } = capsule;
  void _signature;
  const bytes = canonicalizeJson(unsigned);
  if (!verifyEd25519Signature(bytes, capsule.signature.value, key.publicKey))
    return Object.freeze({ valid: false, key_id: key.keyId, reason: "SIGNATURE_INVALID" });
  return Object.freeze({
    valid: true,
    artifact_digest: sha256Digest(bytes),
    key_id: key.keyId,
  });
}

/** Typed client for the versioned Verus API. Credentials are kept private and never serialized. */
export class VerusClient {
  readonly #baseUrl: URL;
  readonly #apiKey: string;
  readonly #workspaceId: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #retries: number;
  readonly #requestTimeoutMs: number;
  readonly #maximumRetryDelayMs: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #telemetry: ((event: SdkTelemetryEvent) => void) | undefined;

  constructor(options: VerusClientOptions) {
    this.#baseUrl = apiBaseUrl(options.baseUrl);
    if (!options.apiKey) throw new VerusConfigurationError("VERUS_API_KEY is required.");
    if (!options.workspaceId) throw new VerusConfigurationError("VERUS_WORKSPACE_ID is required.");
    this.#apiKey = options.apiKey;
    this.#workspaceId = options.workspaceId;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#retries = boundedInteger(options.retries ?? 2, "retries", 0, 10);
    this.#requestTimeoutMs = boundedInteger(
      options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      "requestTimeoutMs",
      1,
      300_000,
    );
    this.#maximumRetryDelayMs = boundedInteger(
      options.maximumRetryDelayMs ?? DEFAULT_MAXIMUM_RETRY_DELAY_MS,
      "maximumRetryDelayMs",
      0,
      60_000,
    );
    this.#sleep = options.sleep ?? defaultSleep;
    this.#telemetry = options.telemetry;
  }

  async scan(request: IngestionRequest, options: RequestOptions = {}): Promise<IngestionAccepted> {
    return unwrap(
      await this.#request("/v1/ingestions", {
        method: "POST",
        body: request,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    );
  }

  async replay(
    request: IngestionRequest,
    options: RequestOptions = {},
  ): Promise<IngestionAccepted> {
    const result = await this.scan(request, options);
    if (!result.idempotent_replay)
      throw new VerusApiError(
        409,
        "IDEMPOTENT_REPLAY_NOT_FOUND",
        "The request was accepted as a new scan instead of replaying an existing submission.",
      );
    return result;
  }

  async status(scanId: string, options: RequestOptions = {}): Promise<ScanRecord> {
    return unwrap(
      await this.#request(`/v1/scans/${encodeURIComponent(scanId)}`, {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    );
  }

  async findings(scanId: string, options: RequestOptions = {}): Promise<readonly FindingRecord[]> {
    return unwrap(
      await this.#request(`/v1/scans/${encodeURIComponent(scanId)}/findings`, {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    );
  }

  async evidence(scanId: string, options: RequestOptions = {}): Promise<readonly EvidenceRecord[]> {
    return unwrap(
      await this.#request(`/v1/scans/${encodeURIComponent(scanId)}/evidence`, {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    );
  }

  async capsule(scanId: string, options: RequestOptions = {}): Promise<ContextCapsule> {
    return parseContextCapsule(
      unwrap(
        await this.#request(`/v1/scans/${encodeURIComponent(scanId)}/capsule`, {
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
      ),
    );
  }

  async inspect(scanId: string, options: RequestOptions = {}): Promise<ScanInspection> {
    const scan = await this.status(scanId, options);
    const [findings, evidence, capsule] = await Promise.all([
      this.findings(scanId, options),
      this.evidence(scanId, options),
      CAPSULE_STATES.has(scan.state) ? this.capsule(scanId, options) : undefined,
    ]);
    return Object.freeze({
      scan,
      findings,
      evidence,
      ...(capsule === undefined ? {} : { capsule }),
    });
  }

  async policy(scanId: string, options: RequestOptions = {}): Promise<PolicyResult> {
    const capsule = await this.capsule(scanId, options);
    return Object.freeze({
      scan_id: capsule.scan_id,
      disposition: capsule.disposition,
      policy: capsule.policy,
      reason_codes: Object.freeze(
        [...new Set(capsule.findings.map((item) => item.reason_code))].sort(),
      ),
    });
  }

  async wait(scanId: string, options: WaitOptions = {}): Promise<ScanRecord> {
    const intervalMs = boundedInteger(options.intervalMs ?? 1_000, "intervalMs", 1, 60_000);
    const timeoutMs = boundedInteger(options.timeoutMs ?? 120_000, "timeoutMs", 1, 86_400_000);
    const started = Date.now();
    while (true) {
      const result = await this.status(scanId, options);
      if (TERMINAL_STATES.has(result.state)) return result;
      const elapsed = Date.now() - started;
      if (elapsed >= timeoutMs) throw new VerusWaitTimeoutError(scanId, timeoutMs);
      await this.#sleep(Math.min(intervalMs, timeoutMs - elapsed));
    }
  }

  async scans(after?: string, limit = 25, options: RequestOptions = {}): Promise<Page<ScanRecord>> {
    boundedInteger(limit, "limit", 1, 100);
    return (await this.#request(
      `/v1/scans?limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
      { ...(options.signal === undefined ? {} : { signal: options.signal }) },
    )) as Page<ScanRecord>;
  }

  async *iterateScans(options: IterateOptions = {}): AsyncGenerator<ScanRecord> {
    let after: string | undefined;
    do {
      const page = await this.scans(after, options.limit, options);
      yield* page.data;
      after = page.next;
    } while (after);
  }

  async verifyOffline(
    capsule: ContextCapsule,
    keys: readonly PublicSigningKey[],
  ): Promise<VerificationResult> {
    return verifyCapsuleOffline(capsule, keys);
  }

  async #request(
    path: string,
    init: Readonly<{ method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal }> = {},
  ): Promise<unknown> {
    const started = Date.now();
    try {
      const result = await this.#executeRequest(path, init);
      this.#record({
        operation: operationName(path, init.method),
        outcome: "success",
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      this.#record({
        operation: operationName(path, init.method),
        outcome: "error",
        durationMs: Date.now() - started,
        ...(error instanceof VerusApiError
          ? { status: error.status, code: error.code }
          : { code: "NETWORK_ERROR" }),
      });
      throw error;
    }
  }

  async #executeRequest(
    path: string,
    init: Readonly<{ method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal }> = {},
  ): Promise<unknown> {
    for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
      let response: Response;
      try {
        response = await this.#fetch(new URL(path, this.#baseUrl), {
          method: init.method ?? "GET",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${this.#apiKey}`,
            "x-verus-workspace-id": this.#workspaceId,
            ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          signal: abortSignal(this.#requestTimeoutMs, init.signal),
        });
      } catch (error) {
        if (init.signal?.aborted) throw error;
        if (attempt === this.#retries) break;
        await this.#sleep(
          Math.min(DEFAULT_RETRY_DELAY_MS * 2 ** attempt, this.#maximumRetryDelayMs),
        );
        continue;
      }
      const text = await response.text();
      let body: {
        readonly code?: string;
        readonly title?: string;
        readonly retryable?: boolean;
        readonly data?: unknown;
      };
      try {
        body = text ? (JSON.parse(text) as typeof body) : {};
      } catch {
        throw new VerusApiError(
          response.status,
          "INVALID_API_RESPONSE",
          "Verus returned invalid JSON.",
        );
      }
      if (response.ok) return body;
      const retryable =
        body.retryable === true || response.status === 429 || response.status >= 500;
      const error = new VerusApiError(
        response.status,
        body.code ?? "API_ERROR",
        body.title ?? "Verus API request failed.",
        retryable,
      );
      if (!retryable || attempt === this.#retries) throw error;
      await this.#sleep(
        retryAfter(response, DEFAULT_RETRY_DELAY_MS * 2 ** attempt, this.#maximumRetryDelayMs),
      );
    }
    throw new VerusApiError(0, "NETWORK_ERROR", "Verus API request failed.", true);
  }

  #record(event: SdkTelemetryEvent): void {
    try {
      this.#telemetry?.(Object.freeze(event));
    } catch {
      // Consumer observability must never change request behavior.
    }
  }
}
