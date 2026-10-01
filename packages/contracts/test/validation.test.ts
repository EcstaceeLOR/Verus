import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  ContractValidationError,
  UnsupportedContractVersionError,
  negotiateContractVersion,
  parseContextCapsule,
  parseIngestionRequest,
  parsePolicyVerdict,
  parseSourceRecord,
} from "../src/index.js";

const fixtures = new URL("../../../contracts/v1/fixtures/", import.meta.url);

async function fixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, fixtures), "utf8")) as unknown;
}

describe("contract constructors", () => {
  const cases = [
    ["context-capsule.json", parseContextCapsule],
    ["ingestion-request.json", parseIngestionRequest],
    ["policy-verdict.json", parsePolicyVerdict],
    ["source-record.json", parseSourceRecord],
  ] as const;

  it.each(cases)("round-trips valid/%s without semantic drift", async (filename, parse) => {
    const input = await fixture(`valid/${filename}`);
    const output = parse(input);

    expect(output).toEqual(input);
    expect(JSON.parse(JSON.stringify(output))).toEqual(input);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(Object.values(output)[0])).toBe(true);
    expect(input).not.toBe(output);
  });

  it("rejects unknown fields at the construction boundary", async () => {
    const input = await fixture("invalid/unknown-field.json");
    expect(() => parseIngestionRequest(input)).toThrow(ContractValidationError);
  });

  it("rejects incompatible versions before accepting a contract", async () => {
    const input = await fixture("invalid/incompatible-version.json");
    expect(() => parseIngestionRequest(input)).toThrow(UnsupportedContractVersionError);
  });

  it("does not mutate caller-owned input", async () => {
    const input = await fixture("valid/ingestion-request.json");
    const before = structuredClone(input);
    parseIngestionRequest(input);
    expect(input).toEqual(before);
  });
});

describe("contract version negotiation", () => {
  it("uses caller preference and requires an exact supported version", () => {
    expect(negotiateContractVersion(["2.0", "1.0"])).toBe("1.0");
  });

  for (const offer of [[], ["2.0"], ["1"], ["*"]]) {
    it(`rejects an incompatible offer: ${JSON.stringify(offer)}`, () => {
      expect(() => negotiateContractVersion(offer)).toThrow(UnsupportedContractVersionError);
    });
  }
});
