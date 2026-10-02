import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2)
  options.set(process.argv[index], process.argv[index + 1]);
const output = options.get("--output");
const revision = options.get("--revision");
if (!output || !/^[0-9a-f]{40}$/.test(revision ?? "")) {
  throw new Error(
    "Usage: node scripts/generate-release-evidence.mjs --revision <40-char SHA> --output <directory>",
  );
}

const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const manifestFiles = [
  "package.json",
  ...(await readFile(resolve(root, "pnpm-workspace.yaml"), "utf8"))
    .split("\n")
    .filter((line) => line.trim().startsWith("- "))
    .map(
      (line) =>
        `${line
          .trim()
          .slice(2)
          .replace(/\\/g, "/")
          .replace(/\*\*?$/, "")}/package.json`,
    )
    .filter((value) => !value.includes("*")),
];
const components = [];
for (const path of manifestFiles) {
  try {
    const manifest = JSON.parse(await readFile(resolve(root, path), "utf8"));
    for (const [name, version] of Object.entries({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    })) {
      components.push({
        type: "library",
        name,
        version,
        properties: [{ name: "verus:declared-in", value: path }],
      });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
const lockfile = await readFile(resolve(root, "pnpm-lock.yaml"));
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${sha256(lockfile).slice(7, 39)}`,
  metadata: { component: { type: "application", name: "verus", version: revision } },
  components: components.sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  ),
};
const sbomBytes = Buffer.from(`${JSON.stringify(sbom, null, 2)}\n`);
const provenance = {
  _type: "https://in-toto.io/Statement/v1",
  subject: [{ name: "verus-sbom.cdx.json", digest: { sha256: sha256(sbomBytes).slice(7) } }],
  predicateType: "https://slsa.dev/provenance/v1",
  predicate: {
    buildDefinition: {
      externalParameters: { revision },
      resolvedDependencies: [
        { uri: "git+https://github.com/EcstaceeLOR/Verus", digest: { sha1: revision } },
        { uri: "file:pnpm-lock.yaml", digest: { sha256: sha256(lockfile).slice(7) } },
      ],
    },
    runDetails: { builder: { id: "verus/release-evidence" } },
  },
};
const outputDirectory = resolve(root, output);
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "verus-sbom.cdx.json"), sbomBytes);
await writeFile(
  resolve(outputDirectory, "verus-provenance.intoto.json"),
  `${JSON.stringify(provenance, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    output: relative(root, outputDirectory),
    sbomDigest: sha256(sbomBytes),
    components: components.length,
  }),
);
