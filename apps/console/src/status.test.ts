import { describe, expect, it } from "vitest";

import { statusCopy } from "./status.js";

describe("console status copy", () => {
  it("gives the operator a concrete next action when unavailable", () => {
    expect(statusCopy("unavailable")).toEqual({
      label: "Unavailable",
      message: "Start the API, then check the connection again.",
    });
  });
});
