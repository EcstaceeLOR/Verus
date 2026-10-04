import { createHmac, timingSafeEqual } from "node:crypto";

const HEX_256 = /^[0-9a-f]{64}$/u;
const KEY_ID = /^[A-Za-z0-9_.:-]{3,128}$/u;
const DELIVERY_ID = /^[A-Za-z0-9_.:-]{3,128}$/u;

export interface SigningKey {
  readonly keyId: string;
  readonly secret: string;
  readonly notBefore?: Date;
  readonly expiresAt?: Date;
}
export interface WebhookSignatureHeaders extends Readonly<Record<string, string>> {
  readonly "x-verus-attempt": string;
  readonly "x-verus-delivery-id": string;
  readonly "x-verus-key-id": string;
  readonly "x-verus-signature": string;
  readonly "x-verus-timestamp": string;
  readonly "x-verus-webhook-version": "1";
}
function signingInput(timestamp: string, deliveryId: string, body: string): string {
  return `${timestamp}.${deliveryId}.${body}`;
}
export function signWebhook(
  input: Readonly<{ body: string; deliveryId: string; secret: string; timestamp: string }>,
): string {
  if (!DELIVERY_ID.test(input.deliveryId)) throw new TypeError("Invalid delivery identifier.");
  if (!/^\d{10,11}$/u.test(input.timestamp)) throw new TypeError("Invalid signature timestamp.");
  if (input.secret.length < 32)
    throw new TypeError("Webhook secrets must contain at least 32 characters.");
  return createHmac("sha256", input.secret)
    .update(signingInput(input.timestamp, input.deliveryId, input.body))
    .digest("hex");
}
export function createSignatureHeaders(
  input: Readonly<{
    attempt: number;
    body: string;
    deliveryId: string;
    key: SigningKey;
    now: Date;
  }>,
): WebhookSignatureHeaders {
  if (!KEY_ID.test(input.key.keyId)) throw new TypeError("Invalid webhook key identifier.");
  if (!Number.isInteger(input.attempt) || input.attempt < 1 || input.attempt > 999)
    throw new TypeError("Webhook attempt must be an integer from 1 to 999.");
  if (
    (input.key.notBefore !== undefined && input.now < input.key.notBefore) ||
    (input.key.expiresAt !== undefined && input.now > input.key.expiresAt)
  )
    throw new TypeError("Webhook signing key is not valid at the current time.");
  const timestamp = String(Math.floor(input.now.getTime() / 1_000));
  const signature = signWebhook({
    body: input.body,
    deliveryId: input.deliveryId,
    secret: input.key.secret,
    timestamp,
  });
  return Object.freeze({
    "x-verus-attempt": String(input.attempt),
    "x-verus-delivery-id": input.deliveryId,
    "x-verus-key-id": input.key.keyId,
    "x-verus-signature": `v1=${signature}`,
    "x-verus-timestamp": timestamp,
    "x-verus-webhook-version": "1",
  });
}
export interface ReplayWindow {
  /** Atomically consumes a delivery identifier. False means it was already consumed. */
  consume(audience: string, deliveryId: string, expiresAt: Date): Promise<boolean>;
}
export interface VerifiedWebhook {
  readonly attempt: number;
  readonly body: Readonly<Record<string, unknown>>;
  readonly deliveryId: string;
  readonly keyId: string;
  readonly receivedAt: Date;
}
function header(headers: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  if (value === undefined) throw new WebhookVerificationError("MISSING_HEADER", `Missing ${name}.`);
  return value;
}
export class WebhookVerificationError extends Error {
  constructor(
    readonly code:
      | "AUDIENCE_MISMATCH"
      | "EXPIRED_SIGNATURE"
      | "INVALID_BODY"
      | "INVALID_HEADER"
      | "INVALID_SIGNATURE"
      | "MISSING_HEADER"
      | "REPLAYED_DELIVERY"
      | "UNKNOWN_KEY",
    message: string,
  ) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
/** Verifies authenticity, freshness, audience binding, and replay protection before returning data. */
export async function verifyWebhook(
  input: Readonly<{
    audience: string;
    body: string;
    headers: Readonly<Record<string, string | undefined>>;
    keys: readonly SigningKey[];
    now?: Date;
    replayWindow: ReplayWindow;
    toleranceSeconds?: number;
  }>,
): Promise<VerifiedWebhook> {
  const now = input.now ?? new Date();
  const tolerance = input.toleranceSeconds ?? 300;
  if (!Number.isInteger(tolerance) || tolerance < 1 || tolerance > 3_600)
    throw new TypeError("Webhook signature tolerance must be between 1 and 3600 seconds.");
  const version = header(input.headers, "x-verus-webhook-version");
  const timestamp = header(input.headers, "x-verus-timestamp");
  const deliveryId = header(input.headers, "x-verus-delivery-id");
  const keyId = header(input.headers, "x-verus-key-id");
  const attemptText = header(input.headers, "x-verus-attempt");
  const signatureHeader = header(input.headers, "x-verus-signature");
  if (
    version !== "1" ||
    !/^\d{10,11}$/u.test(timestamp) ||
    !DELIVERY_ID.test(deliveryId) ||
    !KEY_ID.test(keyId) ||
    !/^[1-9]\d{0,2}$/u.test(attemptText) ||
    !signatureHeader.startsWith("v1=") ||
    !HEX_256.test(signatureHeader.slice(3))
  )
    throw new WebhookVerificationError("INVALID_HEADER", "Webhook headers are malformed.");
  const signedAtMs = Number(timestamp) * 1_000;
  if (!Number.isSafeInteger(signedAtMs) || Math.abs(now.getTime() - signedAtMs) > tolerance * 1_000)
    throw new WebhookVerificationError(
      "EXPIRED_SIGNATURE",
      "Webhook signature is outside the replay window.",
    );
  const key = input.keys.find((candidate) => candidate.keyId === keyId);
  if (key === undefined)
    throw new WebhookVerificationError("UNKNOWN_KEY", "Webhook key is not trusted.");
  if (
    (key.notBefore !== undefined && signedAtMs < key.notBefore.getTime()) ||
    (key.expiresAt !== undefined && signedAtMs > key.expiresAt.getTime())
  )
    throw new WebhookVerificationError(
      "UNKNOWN_KEY",
      "Webhook key is not valid at the signed time.",
    );
  const expected = Buffer.from(
    signWebhook({ body: input.body, deliveryId, secret: key.secret, timestamp }),
    "hex",
  );
  const actual = Buffer.from(signatureHeader.slice(3), "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new WebhookVerificationError("INVALID_SIGNATURE", "Webhook signature is invalid.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body) as unknown;
  } catch {
    throw new WebhookVerificationError("INVALID_BODY", "Webhook body is not JSON.");
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object")
    throw new WebhookVerificationError("INVALID_BODY", "Webhook body must be an object.");
  const record = parsed as Readonly<Record<string, unknown>>;
  if (record["audience"] !== input.audience || record["delivery_id"] !== deliveryId)
    throw new WebhookVerificationError(
      "AUDIENCE_MISMATCH",
      "Webhook audience or delivery does not match.",
    );
  if (
    record["schema_version"] !== "1.0" ||
    typeof record["event_id"] !== "string" ||
    !DELIVERY_ID.test(record["event_id"]) ||
    typeof record["event_type"] !== "string" ||
    !/^[a-z][a-z0-9_.-]{2,127}$/u.test(record["event_type"]) ||
    typeof record["occurred_at"] !== "string" ||
    !Number.isFinite(Date.parse(record["occurred_at"])) ||
    !Object.hasOwn(record, "data")
  )
    throw new WebhookVerificationError("INVALID_BODY", "Webhook envelope is malformed.");
  if (
    !(await input.replayWindow.consume(
      input.audience,
      deliveryId,
      new Date(signedAtMs + tolerance * 1_000),
    ))
  )
    throw new WebhookVerificationError(
      "REPLAYED_DELIVERY",
      "Webhook delivery was already consumed.",
    );
  return Object.freeze({
    attempt: Number(attemptText),
    body: Object.freeze(record),
    deliveryId,
    keyId,
    receivedAt: now,
  });
}
export class InMemoryReplayWindow implements ReplayWindow {
  readonly #consumed = new Map<string, number>();
  constructor(readonly now: () => number = Date.now) {}
  async consume(audience: string, deliveryId: string, expiresAt: Date): Promise<boolean> {
    const current = this.now();
    for (const [key, expiry] of this.#consumed) if (expiry <= current) this.#consumed.delete(key);
    const key = `${audience}\0${deliveryId}`;
    if (this.#consumed.has(key)) return false;
    this.#consumed.set(key, expiresAt.getTime());
    return true;
  }
}
