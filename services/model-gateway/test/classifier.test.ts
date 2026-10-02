import { describe, expect, it } from "vitest";
import { IsolatedClassifier, type ClassifierProvider } from "../src/index.js";
const identity = {
  provider: "test",
  model: "classifier",
  promptVersion: "v1",
  classifierVersion: "v1",
};
const provider = (output: unknown): ClassifierProvider => ({
  identity,
  classify: async () => output,
});
describe("isolated classifier", () => {
  it("accepts only constrained review or block signals and records version identity", async () => {
    await expect(
      new IsolatedClassifier(
        provider({ disposition: "block", confidence: 0.9, categories: ["tool_coercion"] }),
      ).classify("untrusted"),
    ).resolves.toMatchObject({ disposition: "block", safeFallback: false, ...identity });
  });
  it("fails safely when the provider is unavailable or tries to allow content", async () => {
    await expect(
      new IsolatedClassifier(
        provider({ disposition: "allow", confidence: 1, categories: [] }),
      ).classify("untrusted"),
    ).resolves.toMatchObject({ disposition: "review", safeFallback: true });
    await expect(
      new IsolatedClassifier({
        identity,
        classify: async () => Promise.reject(new Error("offline")),
      }).classify("untrusted"),
    ).resolves.toMatchObject({ disposition: "review", safeFallback: true });
  });
  it("allows provider substitution through the shared provider contract", async () => {
    const first = await new IsolatedClassifier(
      provider({ disposition: "review", confidence: 0.4, categories: ["encoded_evasion"] }),
    ).classify("input");
    const second = await new IsolatedClassifier({
      identity: { ...identity, provider: "replacement" },
      classify: async () => ({
        disposition: "review",
        confidence: 0.4,
        categories: ["encoded_evasion"],
      }),
    }).classify("input");
    expect([first.disposition, second.disposition]).toEqual(["review", "review"]);
  });
});
