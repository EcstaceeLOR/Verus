import { createHmac, timingSafeEqual } from "node:crypto";
export interface Webhook {
  readonly id: string;
  readonly event: string;
  readonly occurredAt: string;
  readonly data: unknown;
}
export interface Delivery {
  send(
    input: Readonly<{ body: string; headers: Readonly<Record<string, string>> }>,
  ): Promise<Readonly<{ ok: boolean }>>;
}
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value as Record<string, unknown>)
          .sort()
          .map(
            (key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
          )
          .join(",")}}`
      : JSON.stringify(value);
export function signWebhook(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}
export function verifyWebhook(
  body: string,
  signature: string,
  secrets: readonly string[],
): boolean {
  return secrets.some((secret) => {
    const actual = Buffer.from(signWebhook(body, secret), "hex");
    const expected = Buffer.from(signature, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
export class WebhookDispatcher {
  readonly #delivered = new Set<string>();
  constructor(
    readonly delivery: Delivery,
    readonly secrets: readonly string[],
  ) {}
  async dispatch(webhook: Webhook): Promise<"delivered" | "duplicate" | "failed"> {
    if (this.#delivered.has(webhook.id)) return "duplicate";
    const body = canonical(webhook);
    const result = await this.delivery.send({
      body,
      headers: {
        "content-type": "application/json",
        "x-verus-event": webhook.event,
        "x-verus-delivery-id": webhook.id,
        "x-verus-signature-sha256": signWebhook(body, this.secrets[0] ?? ""),
      },
    });
    if (!result.ok) return "failed";
    this.#delivered.add(webhook.id);
    return "delivered";
  }
}
