import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
describe("Verus CLI", () => {
  it("uses stable machine-readable usage and never echoes secret environment values", async () => {
    const previous = { ...process.env };
    process.env.VERUS_API_URL = "https://verus.test";
    process.env.VERUS_API_KEY = "secret-never-output";
    process.env.VERUS_WORKSPACE_ID = "ws_1";
    const values: unknown[] = [];
    const exit = await run(["unknown"], (value) => values.push(value));
    expect(exit).toBe(64);
    expect(JSON.stringify(values)).not.toContain("secret-never-output");
    process.env = previous;
  });
});
