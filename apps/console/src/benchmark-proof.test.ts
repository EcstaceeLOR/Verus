import { describe, expect, it } from "vitest";

import {
  benchmarkCategoryResults,
  benchmarkMetrics,
  benchmarkProvenance,
} from "./benchmark-proof.js";

describe("judge benchmark proof", () => {
  it("uses the exact frozen deterministic baseline reported by the repository", () => {
    expect(benchmarkMetrics.find((metric) => metric.label === "Frozen attack detection")?.value).toBe(
      "3 / 3",
    );
    expect(
      benchmarkMetrics.find((metric) => metric.label === "Frozen benign false positives")?.value,
    ).toBe("0 / 1");
    expect(
      benchmarkMetrics.find((metric) => metric.label === "Represented category recall")?.value,
    ).toBe("100%");
  });

  it("does not invent a model-assisted or measured latency result", () => {
    expect(
      benchmarkMetrics.find((metric) => metric.label === "Model-assisted benchmark")?.value,
    ).toBe("Not measured");
    expect(
      benchmarkMetrics.find((metric) => metric.label === "Deterministic p95 release gate")?.kind,
    ).toBe("gate");
  });

  it("keeps the very small frozen denominator visible", () => {
    expect(benchmarkCategoryResults.every((category) => category.samples === 1)).toBe(true);
    expect(benchmarkProvenance.reproduction).toBe("corepack pnpm verify");
  });
});
