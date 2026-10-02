import { describe, expect, it } from "vitest";
import { WebhookDispatcher, signWebhook, verifyWebhook } from "../src/index.js";
describe("webhooks", () => {
  it("signs, rotates, and deduplicates", async () => {
    const body = '{"a":1}';
    expect(verifyWebhook(body, signWebhook(body, "old"), ["new", "old"])).toBe(true);
    const dispatcher = new WebhookDispatcher({ send: async () => ({ ok: true }) }, ["new", "old"]);
    expect(
      await dispatcher.dispatch({
        id: "d1",
        event: "capsule.created",
        occurredAt: "2026-01-01T00:00:00Z",
        data: {},
      }),
    ).toBe("delivered");
    expect(
      await dispatcher.dispatch({
        id: "d1",
        event: "capsule.created",
        occurredAt: "2026-01-01T00:00:00Z",
        data: {},
      }),
    ).toBe("duplicate");
  });
});
