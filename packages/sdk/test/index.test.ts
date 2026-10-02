import { describe, expect, it, vi } from "vitest";
import { VerusClient } from "../src/index.js";
describe("Verus client", () => {
  it("sends tenant headers and paginates", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ scan_id: "one" }], next: "two" })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ scan_id: "two" }] })));
    const client = new VerusClient({
      baseUrl: "https://verus.test",
      apiKey: "vrk.key",
      workspaceId: "ws_1",
      fetch,
    });
    const scans: unknown[] = [];
    for await (const scan of client.iterateScans()) scans.push(scan);
    expect(scans).toEqual([{ scan_id: "one" }, { scan_id: "two" }]);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ "x-verus-workspace-id": "ws_1" });
  });
  it("retries transient failures but not authorization errors", async () => {
    const retry = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "SERVICE_UNAVAILABLE", retryable: true }), {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { state: "review" } })));
    await expect(
      new VerusClient({
        baseUrl: "https://verus.test",
        apiKey: "x",
        workspaceId: "ws_1",
        fetch: retry,
      }).status("scan_1"),
    ).resolves.toEqual({ state: "review" });
    const denied = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "AUTHORIZATION_DENIED", title: "Access denied" }), {
        status: 403,
      }),
    );
    await expect(
      new VerusClient({
        baseUrl: "https://verus.test",
        apiKey: "x",
        workspaceId: "ws_1",
        fetch: denied,
      }).status("scan_1"),
    ).rejects.toMatchObject({ status: 403 });
    expect(denied).toHaveBeenCalledTimes(1);
  });
});
