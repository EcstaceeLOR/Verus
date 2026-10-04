import { randomUUID } from "node:crypto";
import { assertSafeWebhookData, canonicalJson } from "./canonical.js";
import { createSignatureHeaders, type SigningKey } from "./signature.js";
import type { DeliveryRecord, DeliveryStore } from "./store.js";
import { validateWebhookEndpoint, type WebhookTransport } from "./transport.js";

export interface WebhookEvent {
  readonly data: unknown;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly orderingKey?: string;
  readonly sequence?: number;
}
export interface WebhookTelemetryEvent {
  readonly attempt: number;
  readonly eventType: string;
  readonly name:
    "webhook.dead_lettered" | "webhook.delivered" | "webhook.delivery_failed" | "webhook.queued";
  readonly outcome: "failure" | "success";
  readonly status?: number;
}
export interface DispatcherOptions {
  readonly audience: string;
  readonly endpointUrl: string;
  readonly endpointId: string;
  readonly key: SigningKey;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
  readonly onTelemetry?: (event: WebhookTelemetryEvent) => void;
  readonly random?: () => number;
  readonly store: DeliveryStore;
  readonly transport: WebhookTransport;
  readonly workspaceId: string;
}
function validId(value: string): boolean {
  return /^[A-Za-z0-9_.:-]{3,128}$/u.test(value);
}

export class WebhookDispatcher {
  readonly #now: () => Date;
  constructor(readonly options: DispatcherOptions) {
    if (!validId(options.workspaceId) || !validId(options.audience) || !validId(options.endpointId))
      throw new TypeError("Invalid webhook workspace, endpoint, or audience.");
    if (
      !Number.isInteger(options.maxAttempts ?? 8) ||
      (options.maxAttempts ?? 8) < 1 ||
      (options.maxAttempts ?? 8) > 32
    )
      throw new TypeError("Webhook maximum attempts must be between 1 and 32.");
    validateWebhookEndpoint(options.endpointUrl);
    this.#now = options.now ?? (() => new Date());
  }
  async enqueue(
    event: WebhookEvent,
    input: Readonly<{
      deliveryId?: string;
      idempotencyKey?: string;
      replayOf?: string;
      replayReason?: string;
    }> = {},
  ): Promise<Readonly<{ deliveryId: string; status: "duplicate" | "queued" }>> {
    if (!validId(event.eventId) || !/^[a-z][a-z0-9_.-]{2,127}$/u.test(event.eventType))
      throw new TypeError("Invalid webhook event identity.");
    if (
      event.sequence !== undefined &&
      (!Number.isSafeInteger(event.sequence) || event.sequence < 0)
    )
      throw new TypeError("Webhook sequence must be a non-negative safe integer.");
    if (!Number.isFinite(Date.parse(event.occurredAt)))
      throw new TypeError("Invalid event timestamp.");
    assertSafeWebhookData(event.data);
    const deliveryId = input.deliveryId ?? `whd_${randomUUID()}`;
    const now = this.#now();
    const body = canonicalJson({
      audience: this.options.audience,
      data: event.data,
      delivery_id: deliveryId,
      event_id: event.eventId,
      event_type: event.eventType,
      occurred_at: event.occurredAt,
      ...(event.orderingKey === undefined ? {} : { ordering_key: event.orderingKey }),
      schema_version: "1.0",
      ...(event.sequence === undefined ? {} : { sequence: event.sequence }),
    });
    const record: DeliveryRecord = Object.freeze({
      attempt: 0,
      audience: this.options.audience,
      body,
      createdAt: now,
      deliveryId,
      endpointId: this.options.endpointId,
      endpointUrl: this.options.endpointUrl,
      eventId: event.eventId,
      eventType: event.eventType,
      idempotencyKey: input.idempotencyKey ?? `${this.options.endpointId}:${event.eventId}`,
      maxAttempts: this.options.maxAttempts ?? 8,
      nextAttemptAt: now,
      ...(event.orderingKey === undefined ? {} : { orderingKey: event.orderingKey }),
      ...(input.replayOf === undefined ? {} : { replayOf: input.replayOf }),
      ...(input.replayReason === undefined ? {} : { replayReason: input.replayReason }),
      ...(event.sequence === undefined ? {} : { sequence: event.sequence }),
      state: "pending",
      workspaceId: this.options.workspaceId,
    });
    const status = await this.options.store.enqueue(record);
    if (status === "queued")
      this.#emit({
        name: "webhook.queued",
        eventType: event.eventType,
        attempt: 0,
        outcome: "success",
      });
    return Object.freeze({ deliveryId, status });
  }
  /** Claims and processes at most one durable delivery. Workers call this until it returns idle. */
  async runOnce(): Promise<"dead_letter" | "delivered" | "idle" | "retry"> {
    const now = this.#now();
    const record = await this.options.store.claim(
      this.options.workspaceId,
      now,
      new Date(now.getTime() + 30_000),
    );
    if (record === undefined) return "idle";
    const headers = {
      "content-type": "application/json",
      "user-agent": "Verus-Webhooks/1",
      "x-verus-event": record.eventType,
      ...createSignatureHeaders({
        attempt: record.attempt,
        body: record.body,
        deliveryId: record.deliveryId,
        key: this.options.key,
        now,
      }),
    };
    try {
      const response = await this.options.transport.send(record, { body: record.body, headers });
      if (response.status >= 200 && response.status < 300) {
        await this.options.store.delivered(
          record.workspaceId,
          record.deliveryId,
          this.#now(),
          response.status,
        );
        this.#emit({
          name: "webhook.delivered",
          eventType: record.eventType,
          attempt: record.attempt,
          outcome: "success",
          status: response.status,
        });
        return "delivered";
      }
      const retryable =
        response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;
      return this.#fail(
        record,
        retryable,
        `HTTP_${response.status}`,
        response.status,
        response.retryAfterSeconds,
      );
    } catch {
      return this.#fail(record, true, "TRANSPORT_FAILED");
    }
  }
  /** Creates a separately auditable delivery while retaining the original event identity. */
  async replay(
    deliveryId: string,
    reason: string,
  ): Promise<Readonly<{ deliveryId: string; status: "duplicate" | "queued" }>> {
    if (reason.trim().length < 8 || reason.length > 256)
      throw new TypeError("Replay reason must contain 8-256 characters.");
    const original = await this.options.store.get(this.options.workspaceId, deliveryId);
    if (
      original === undefined ||
      original.endpointId !== this.options.endpointId ||
      (original.state !== "dead_letter" && original.state !== "delivered")
    )
      throw new Error("Only completed or dead-lettered webhook deliveries can be replayed.");
    const parsed = JSON.parse(original.body) as Record<string, unknown>;
    const replayId = `whd_${randomUUID()}`;
    return this.enqueue(
      {
        data: parsed["data"],
        eventId: original.eventId,
        eventType: original.eventType,
        occurredAt: String(parsed["occurred_at"]),
        ...(original.orderingKey === undefined ? {} : { orderingKey: original.orderingKey }),
        ...(original.sequence === undefined ? {} : { sequence: original.sequence }),
      },
      {
        deliveryId: replayId,
        idempotencyKey: `${original.deliveryId}:replay:${replayId}`,
        replayOf: original.deliveryId,
        replayReason: reason.trim(),
      },
    );
  }
  async #fail(
    record: DeliveryRecord,
    retryable: boolean,
    errorCode: string,
    status?: number,
    retryAfterSeconds?: number,
  ): Promise<"dead_letter" | "retry"> {
    const terminal = !retryable || record.attempt >= record.maxAttempts;
    const jitter = 0.8 + (this.options.random ?? Math.random)() * 0.4;
    const seconds = Math.min(
      3_600,
      retryAfterSeconds ?? Math.ceil(2 ** Math.max(0, record.attempt - 1) * jitter),
    );
    await this.options.store.failed(record.workspaceId, record.deliveryId, {
      errorCode,
      ...(terminal ? {} : { nextAttemptAt: new Date(this.#now().getTime() + seconds * 1_000) }),
      ...(status === undefined ? {} : { status }),
      terminal,
    });
    this.#emit({
      name: terminal ? "webhook.dead_lettered" : "webhook.delivery_failed",
      eventType: record.eventType,
      attempt: record.attempt,
      outcome: "failure",
      ...(status === undefined ? {} : { status }),
    });
    return terminal ? "dead_letter" : "retry";
  }
  #emit(event: WebhookTelemetryEvent): void {
    try {
      this.options.onTelemetry?.(Object.freeze(event));
    } catch {
      /* Observability receives no payload, URL, tenant, secret, or delivery identity. */
    }
  }
}
