import type { ApiPrincipal, ApiRateLimiter } from "./public-api.js";

export type TenantAdmissionReason = "quota" | "suspended";

export interface TenantAdmissionDecision {
  readonly allowed: boolean;
  readonly reason?: TenantAdmissionReason;
  readonly retryAfterSeconds?: number;
}

export interface TenantAdmission {
  admit(principal: ApiPrincipal): Promise<TenantAdmissionDecision>;
}

interface Window {
  count: number;
  expiresAt: number;
}

/**
 * Bounded tenant-local admission control. Clustered implementations retain this contract but store
 * counters and suspensions in a shared, tenant-scoped store.
 */
export class TenantQuotaAdmission implements ApiRateLimiter, TenantAdmission {
  readonly #keyWindows = new Map<string, Window>();
  readonly #suspended = new Set<string>();
  readonly #workspaceWindows = new Map<string, Window>();

  constructor(
    readonly maximumPerKey: number,
    readonly maximumPerWorkspace: number,
    readonly windowMs: number,
    readonly now: () => number = Date.now,
  ) {
    for (const value of [maximumPerKey, maximumPerWorkspace, windowMs]) {
      if (!Number.isSafeInteger(value) || value < 1)
        throw new TypeError("Tenant admission limits must be positive integers.");
    }
  }

  suspend(workspaceId: string): void {
    this.#suspended.add(workspaceId);
  }

  resume(workspaceId: string): void {
    this.#suspended.delete(workspaceId);
  }

  async check(
    principal: ApiPrincipal,
  ): Promise<Readonly<{ allowed: boolean; retryAfterSeconds?: number }>> {
    const decision = await this.admit(principal);
    return decision.allowed
      ? Object.freeze({ allowed: true })
      : Object.freeze({ allowed: false, retryAfterSeconds: decision.retryAfterSeconds ?? 60 });
  }

  async admit(principal: ApiPrincipal): Promise<TenantAdmissionDecision> {
    if (this.#suspended.has(principal.workspaceId))
      return Object.freeze({ allowed: false, reason: "suspended" });
    const time = this.now();
    const workspace = this.#increment(
      this.#workspaceWindows,
      principal.workspaceId,
      this.maximumPerWorkspace,
      time,
    );
    const key = this.#increment(
      this.#keyWindows,
      `${principal.workspaceId}:${principal.keyId}`,
      this.maximumPerKey,
      time,
    );
    if (workspace.allowed && key.allowed) return Object.freeze({ allowed: true });
    return Object.freeze({
      allowed: false,
      reason: "quota",
      retryAfterSeconds: Math.max(workspace.retryAfterSeconds ?? 0, key.retryAfterSeconds ?? 0, 1),
    });
  }

  #increment(
    collection: Map<string, Window>,
    key: string,
    maximum: number,
    time: number,
  ): Readonly<{ allowed: boolean; retryAfterSeconds?: number }> {
    const previous = collection.get(key);
    const window =
      previous === undefined || previous.expiresAt <= time
        ? { count: 0, expiresAt: time + this.windowMs }
        : previous;
    window.count += 1;
    collection.set(key, window);
    return window.count <= maximum
      ? Object.freeze({ allowed: true })
      : Object.freeze({
          allowed: false,
          retryAfterSeconds: Math.ceil((window.expiresAt - time) / 1000),
        });
  }
}
