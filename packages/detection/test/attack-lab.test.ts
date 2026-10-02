import { expect, it } from "vitest";
import { benchmarkSummary } from "../src/attack-lab.js";
it("keeps results linked to their artifact", () =>
  expect(
    benchmarkSummary({
      runId: "r",
      corpusVersion: "v1",
      protectedBlocked: 8,
      baselineBlocked: 1,
      total: 10,
      artifact: "artifact://run/r",
    }),
  ).toEqual(expect.objectContaining({ delta: 0.7, artifact: "artifact://run/r" })));
