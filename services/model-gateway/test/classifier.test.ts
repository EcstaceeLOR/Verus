import { describe, expect, it } from "vitest";
import {
  DeterministicFakeProvider,
  IsolatedClassifier,
  QwenProvider,
  type ClassifierProvider,
} from "../src/index.js";
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
describe("provider adapters", () => {
  it("provides deterministic structured output for tests", async () =>
    expect(
      await new DeterministicFakeProvider({ disposition: "review" }).complete({
        task: "classification",
        promptVersion: "v1",
        content: "x",
        maximumTokens: 20,
      }),
    ).toMatchObject({ provider: "fake", output: { disposition: "review" } }));
  it("bounds Qwen requests and rejects sensitive content before transport", async () => {
    const fetch = async () =>
      new Response(
        JSON.stringify({
          id: "req",
          choices: [{ message: { content: '{"disposition":"review"}' } }],
        }),
      );
    const qwen = new QwenProvider({
      apiKey: "not-logged",
      baseUrl: "https://dashscope.aliyuncs.com",
      model: "qwen-plus",
      timeoutMs: 100,
      maximumRetries: 0,
      fetch,
      allowSensitiveContent: false,
    });
    await expect(
      qwen.complete({
        task: "classification",
        promptVersion: "v1",
        content: "api key=secret",
        maximumTokens: 20,
      }),
    ).rejects.toThrow("SENSITIVE");
    await expect(
      qwen.complete({
        task: "classification",
        promptVersion: "v1",
        content: "safe",
        maximumTokens: 20,
      }),
    ).resolves.toMatchObject({ provider: "qwen", requestId: "req" });
  });
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
