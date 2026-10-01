import { ContractValidationError, UnsupportedContractVersionError } from "@verus/contracts";
import { describe, expect, it } from "vitest";

import { VerusError, toProblemDetails } from "../src/index.js";

describe("public problem details", () => {
  it("maps stable error codes to stable HTTP semantics", () => {
    expect(
      toProblemDetails(new VerusError("RATE_LIMITED", "internal quota details"), "req_12345678"),
    ).toEqual({
      type: "https://verus.security/problems/rate-limited",
      title: "Rate limit exceeded",
      status: 429,
      code: "RATE_LIMITED",
      retryable: true,
      correlation_id: "req_12345678",
    });
  });

  it("never reflects internal messages, causes, or unsafe correlation IDs", () => {
    const secret = "sk-live-super-secret";
    const error = new VerusError("INTERNAL_ERROR", `raw hostile content: ${secret}`, {
      cause: new Error(`password=${secret}`),
    });
    const serialized = JSON.stringify(toProblemDetails(error, `<script>${secret}</script>`));

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("hostile");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("correlation_id");
  });

  it("maps unknown errors to a generic non-retryable response", () => {
    expect(toProblemDetails(new Error("database host and token"))).toEqual({
      type: "https://verus.security/problems/internal-error",
      title: "Internal error",
      status: 500,
      code: "INTERNAL_ERROR",
      retryable: false,
    });
  });

  it("exposes bounded structural validation details without the rejected value", () => {
    const secret = "do-not-reflect-this-input";
    const error = new ContractValidationError("IngestionRequest", [
      { path: `/input/<script>${secret}`, keyword: `<script>${secret}`, message: secret },
      ...Array.from({ length: 25 }, () => ({
        path: "/input",
        keyword: "type",
        message: "must be object",
      })),
    ]);
    const problem = toProblemDetails(error);
    const serialized = JSON.stringify(problem);

    expect(problem.code).toBe("CONTRACT_VALIDATION_FAILED");
    expect(problem.errors).toHaveLength(20);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("raw_content");
    expect(problem.errors?.[0]).toEqual({
      path: "/",
      keyword: "validation",
      message: "does not satisfy validation",
    });
  });

  it("maps incompatible versions without returning the offered value", () => {
    const problem = toProblemDetails(new UnsupportedContractVersionError(["1.0"]));
    expect(problem.code).toBe("UNSUPPORTED_CONTRACT_VERSION");
    expect(problem.status).toBe(406);
  });
});
