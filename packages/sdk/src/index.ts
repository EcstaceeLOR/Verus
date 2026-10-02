import type { ContextCapsule } from "@verus/contracts";
import { canonicalizeJson, verifyEd25519Signature, type PublicSigningKey } from "@verus/crypto";

export class VerusApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VerusApiError";
  }
}
export interface VerusClientOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly workspaceId: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly retries?: number;
}
export interface Page<T> {
  readonly data: readonly T[];
  readonly next?: string;
}
function data(value: unknown): unknown {
  return (value as { data?: unknown }).data ?? value;
}
export class VerusClient {
  readonly #fetch: typeof globalThis.fetch;
  readonly #retries: number;
  constructor(readonly options: VerusClientOptions) {
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#retries = options.retries ?? 2;
  }
  async scan(request: unknown): Promise<unknown> {
    return data(await this.#request("/v1/ingestions", { method: "POST", body: request }));
  }
  async status(scanId: string): Promise<unknown> {
    return data(await this.#request(`/v1/scans/${encodeURIComponent(scanId)}`));
  }
  async capsule(scanId: string): Promise<ContextCapsule> {
    return data(
      await this.#request(`/v1/scans/${encodeURIComponent(scanId)}/capsule`),
    ) as ContextCapsule;
  }
  async scans(after?: string, limit = 25): Promise<Page<unknown>> {
    return (await this.#request(
      `/v1/scans?limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
    )) as Page<unknown>;
  }
  async *iterateScans(): AsyncGenerator<unknown> {
    let after: string | undefined;
    do {
      const page = await this.scans(after);
      yield* page.data;
      after = page.next;
    } while (after);
  }
  async verifyOffline(capsule: ContextCapsule, keys: readonly PublicSigningKey[]) {
    const key = keys.find((candidate) => candidate.keyId === capsule.signature.key_id);
    if (!key) return Object.freeze({ valid: false, reason: "SIGNING_KEY_UNAVAILABLE" as const });
    const { signature: _signature, ...unsigned } = capsule;
    void _signature;
    return Object.freeze({
      valid: verifyEd25519Signature(
        canonicalizeJson(unsigned),
        capsule.signature.value,
        key.publicKey,
      ),
    });
  }
  async #request(
    path: string,
    init: Readonly<{ method?: string; body?: unknown }> = {},
  ): Promise<unknown> {
    let last: unknown;
    for (let attempt = 0; attempt <= this.#retries; attempt += 1) {
      try {
        const response = await this.#fetch(new URL(path, this.options.baseUrl), {
          method: init.method ?? "GET",
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            "x-verus-workspace-id": this.options.workspaceId,
            ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        });
        const body = (await response.json()) as {
          code?: string;
          title?: string;
          retryable?: boolean;
          data?: unknown;
        };
        if (response.ok) return body;
        const error = new VerusApiError(
          response.status,
          body.code ?? "API_ERROR",
          body.title ?? "Verus API request failed.",
        );
        if (!body.retryable || attempt === this.#retries) throw error;
        last = error;
      } catch (error) {
        if (error instanceof VerusApiError && error.status < 500 && error.status !== 429)
          throw error;
        last = error;
      }
    }
    throw last;
  }
}
