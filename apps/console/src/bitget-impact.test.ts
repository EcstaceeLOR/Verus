import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("Bitget portfolio-impact judge surface", () => {
  it("documents the same closed read boundary as the production Bitget package", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./BitgetImpactPanel.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("/api/v2/spot/account/assets");
    expect(source).toContain("/api/v3/account/assets");
    expect(source).toContain("/api/v3/market/instruments?category=SPOT");
    expect(source).toContain("trade · transfer · withdraw");
    expect(source).toContain("rtoken_underlying");
  });
});
