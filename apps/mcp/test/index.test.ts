import { describe, expect, it } from "vitest";
import { createMcpServer } from "../src/index.js";
const server = createMcpServer({
  submit: async () => ({ scan_id: "scan_1" }),
  status: async () => ({ state: "review", raw_content: "never" }),
  capsule: async () => ({ capsule_id: "cap_1" }),
  verify: async () => ({ valid: true }),
});
const call = (name: string, args: Record<string, unknown> = {}) =>
  server({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: { authorization: { workspaceId: "ws_1", token: "token" }, ...args },
    },
  });
describe("Verus MCP server", () => {
  it("publishes a fixed safe tool profile", async () =>
    expect(await server({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toMatchObject({
      tools: [
        { name: "verus_submit" },
        { name: "verus_status" },
        { name: "verus_capsule" },
        { name: "verus_verify" },
      ],
    }));
  it("uses authorization and keeps raw content out of tool descriptions", async () => {
    expect(JSON.stringify(await call("verus_status", { scan_id: "scan_1" }))).not.toContain(
      "raw_content",
    );
    expect(
      (await server({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "verus_status", arguments: {} },
      })) as { isError: boolean },
    ).toMatchObject({ isError: true });
  });
});
