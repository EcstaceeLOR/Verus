import type { IncomingMessage, ServerResponse } from "node:http";

import { toProblemDetails, VerusError, type AuthorizationAction } from "@verus/domain";
import type { TelemetryContext } from "@verus/observability";

export interface ApiPrincipal {
  readonly workspaceId: string;
  readonly keyId: string;
  readonly scopes: readonly AuthorizationAction[];
}
export interface ApiAuthenticator {
  authenticate(request: IncomingMessage, action: AuthorizationAction): Promise<ApiPrincipal>;
}
export interface ApiRateLimiter {
  check(
    principal: ApiPrincipal,
  ): Promise<Readonly<{ allowed: boolean; retryAfterSeconds?: number }>>;
}
export interface PublicApiData {
  getScan(
    workspaceId: string,
    scanId: string,
  ): Promise<Readonly<Record<string, unknown>> | undefined>;
  listScans(
    input: Readonly<{ workspaceId: string; after?: string; limit: number }>,
  ): Promise<Readonly<{ items: readonly Readonly<Record<string, unknown>>[]; next?: string }>>;
  getFindings(
    workspaceId: string,
    scanId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  getEvidence(
    workspaceId: string,
    scanId: string,
  ): Promise<readonly Readonly<Record<string, unknown>>[]>;
  getCapsule(
    workspaceId: string,
    scanId: string,
  ): Promise<Readonly<Record<string, unknown>> | undefined>;
}

const MAX_PAGE_SIZE = 100;
function page(url: URL): Readonly<{ after?: string; limit: number }> {
  const raw = url.searchParams.get("limit") ?? "25";
  if (!/^\d+$/u.test(raw) || Number(raw) < 1 || Number(raw) > MAX_PAGE_SIZE)
    throw new VerusError("CONTRACT_VALIDATION_FAILED", "Invalid page limit.");
  const after = url.searchParams.get("after") ?? undefined;
  if (after !== undefined && !/^[A-Za-z0-9_-]{1,128}$/u.test(after))
    throw new VerusError("CONTRACT_VALIDATION_FAILED", "Invalid page cursor.");
  return { limit: Number(raw), ...(after === undefined ? {} : { after }) };
}
function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  extra: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...extra,
  });
  response.end(JSON.stringify(body));
}
function safeRecord(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const forbidden = new Set(["content", "raw_content", "rawContent", "parsed_text", "excerpt"]);
  return Object.freeze(
    Object.fromEntries(Object.entries(value).filter(([key]) => !forbidden.has(key))),
  );
}

/** Versioned public API. Deliberately returns derived records only; hostile source bytes are never serialized. */
export function createPublicApiHandler(
  input: Readonly<{
    authenticator: ApiAuthenticator;
    data: PublicApiData;
    limiter: ApiRateLimiter;
  }>,
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    context: TelemetryContext,
  ): Promise<boolean> => {
    const url = new URL(request.url ?? "/", "http://verus.local");
    if (!url.pathname.startsWith("/v1/")) return false;
    try {
      const match = /^\/v1\/scans(?:\/([A-Za-z0-9_-]+)(?:\/(findings|evidence|capsule))?)?$/u.exec(
        url.pathname,
      );
      if (!match || request.method !== "GET")
        throw new VerusError("NOT_FOUND", "Route does not exist.");
      const action: AuthorizationAction =
        match[2] === "findings"
          ? "finding.read"
          : match[2] === "evidence"
            ? "evidence.read"
            : match[2] === "capsule"
              ? "capsule.read"
              : "scan.read";
      const principal = await input.authenticator.authenticate(request, action);
      const rate = await input.limiter.check(principal);
      if (!rate.allowed) {
        response.setHeader("retry-after", String(rate.retryAfterSeconds ?? 1));
        throw new VerusError("RATE_LIMITED", "Request limit exceeded.");
      }
      const scanId = match[1];
      if (scanId === undefined) {
        const listed = await input.data.listScans({
          workspaceId: principal.workspaceId,
          ...page(url),
        });
        json(response, 200, {
          data: listed.items.map(safeRecord),
          ...(listed.next ? { next: listed.next } : {}),
          correlation_id: context.correlationId,
        });
      } else if (match[2] === "findings") {
        json(response, 200, {
          data: (await input.data.getFindings(principal.workspaceId, scanId)).map(safeRecord),
          correlation_id: context.correlationId,
        });
      } else if (match[2] === "evidence") {
        json(response, 200, {
          data: (await input.data.getEvidence(principal.workspaceId, scanId)).map(safeRecord),
          correlation_id: context.correlationId,
        });
      } else {
        const value =
          match[2] === "capsule"
            ? await input.data.getCapsule(principal.workspaceId, scanId)
            : await input.data.getScan(principal.workspaceId, scanId);
        if (!value) throw new VerusError("NOT_FOUND", "Record does not exist.");
        json(response, 200, { data: safeRecord(value), correlation_id: context.correlationId });
      }
    } catch (error) {
      const problem = toProblemDetails(error, context.correlationId);
      response.writeHead(problem.status, {
        "cache-control": "no-store",
        "content-type": "application/problem+json; charset=utf-8",
      });
      response.end(JSON.stringify(problem));
    }
    return true;
  };
}

/** Bounded in-process limiter for single-node deployments; clustered deployments provide the same interface with shared storage. */
export class FixedWindowRateLimiter implements ApiRateLimiter {
  readonly #entries = new Map<string, { count: number; expiresAt: number }>();
  constructor(
    readonly maximum: number,
    readonly windowMs: number,
    readonly now: () => number = Date.now,
  ) {}
  async check(
    principal: ApiPrincipal,
  ): Promise<Readonly<{ allowed: boolean; retryAfterSeconds?: number }>> {
    const key = `${principal.workspaceId}:${principal.keyId}`;
    const current = this.#entries.get(key);
    const time = this.now();
    const entry =
      !current || current.expiresAt <= time
        ? { count: 0, expiresAt: time + this.windowMs }
        : current;
    entry.count += 1;
    this.#entries.set(key, entry);
    return entry.count <= this.maximum
      ? Object.freeze({ allowed: true })
      : Object.freeze({
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((entry.expiresAt - time) / 1000)),
        });
  }
}
