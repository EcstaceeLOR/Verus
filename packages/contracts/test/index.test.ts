import { describe, expect, it } from "vitest";

import { contractSchemaIds, VERUS_SCHEMA_VERSION } from "../src/index.js";

describe("contract package bootstrap", () => {
  it("publishes stable v1 identifiers", () => {
    expect(VERUS_SCHEMA_VERSION).toBe("1.0");
    expect(Object.values(contractSchemaIds)).toHaveLength(4);
    expect(Object.values(contractSchemaIds).every((id) => id.startsWith("https://"))).toBe(true);
  });
});
