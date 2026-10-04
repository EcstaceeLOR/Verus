export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Webhook values must be finite JSON numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Webhook values must be JSON serializable.");
}

const forbiddenPayloadKeys = new Set([
  "authorization",
  "content",
  "cookie",
  "password",
  "private_key",
  "raw_content",
  "rawcontent",
  "secret",
  "source_bytes",
  "token",
]);

/** Rejects source content and credentials before they enter a durable webhook record. */
export function assertSafeWebhookData(value: unknown, depth = 0): void {
  if (depth > 32) throw new TypeError("Webhook data exceeds the maximum nesting depth.");
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Webhook data contains a non-finite number.");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeWebhookData(item, depth + 1);
    return;
  }
  if (typeof value !== "object") throw new TypeError("Webhook data must be JSON serializable.");
  for (const [key, nested] of Object.entries(value as Readonly<Record<string, unknown>>)) {
    if (forbiddenPayloadKeys.has(key.toLowerCase()))
      throw new TypeError(`Webhook data contains forbidden field: ${key}.`);
    assertSafeWebhookData(nested, depth + 1);
  }
}
