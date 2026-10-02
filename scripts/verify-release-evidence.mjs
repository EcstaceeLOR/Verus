import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2)
  options.set(process.argv[index], process.argv[index + 1]);
const directory = options.get("--directory");
const revision = options.get("--revision");
if (!directory || !/^[0-9a-f]{40}$/.test(revision ?? "")) {
  throw new Error(
    "Usage: node scripts/verify-release-evidence.mjs --revision <40-char SHA> --directory <directory>",
  );
}
const sbomBytes = await readFile(resolve(directory, "verus-sbom.cdx.json"));
const provenance = JSON.parse(
  await readFile(resolve(directory, "verus-provenance.intoto.json"), "utf8"),
);
const digest = createHash("sha256").update(sbomBytes).digest("hex");
if (
  provenance?._type !== "https://in-toto.io/Statement/v1" ||
  provenance?.predicateType !== "https://slsa.dev/provenance/v1"
)
  throw new Error("Invalid in-toto SLSA provenance statement.");
if (provenance?.subject?.[0]?.digest?.sha256 !== digest)
  throw new Error("SBOM digest does not match provenance.");
if (provenance?.predicate?.buildDefinition?.externalParameters?.revision !== revision)
  throw new Error("Provenance revision does not match requested release.");
if (!Array.isArray(JSON.parse(sbomBytes).components))
  throw new Error("SBOM components are missing.");
console.log(`Verified SBOM and SLSA provenance for ${revision}.`);
