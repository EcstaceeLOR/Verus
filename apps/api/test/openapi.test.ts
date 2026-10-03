import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseIngestionRequest } from "@verus/contracts";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

describe("published OpenAPI examples", () => {
  it("keeps the public ingestion example executable against the v1 contract", async () => {
    const examplePath = resolve(root, "docs/api/examples/ingestion-text.json");
    const example = JSON.parse(await readFile(examplePath, "utf8")) as unknown;
    expect(parseIngestionRequest(example)).toMatchObject({ input: { kind: "text" } });

    const openapi = await readFile(resolve(root, "docs/api/openapi.v1.yaml"), "utf8");
    expect(openapi).toContain("/v1/ingestions:");
    expect(openapi).toContain("x-verus-example-file: ./examples/ingestion-text.json");
  });
});
