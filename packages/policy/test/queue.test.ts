import { expect, it } from "vitest";
import { approve, assign } from "../src/queue.js";
const item = {
  id: "r",
  capsuleVersion: "cap:1",
  priority: "high" as const,
  status: "open" as const,
  version: 1,
  approvals: [],
};
it("requires distinct dual approval for high risk", () => {
  const first = approve(item, "a", 1);
  expect(first.status).toBe("open");
  expect(approve(first, "b", 2).status).toBe("resolved");
});
it("rejects concurrent assignment", () =>
  expect(() => assign(item, "a", 2)).toThrow("REVIEW_CONFLICT"));
