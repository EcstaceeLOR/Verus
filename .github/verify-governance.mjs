import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const policy = JSON.parse(await readFile(resolve(here, "governance-policy.json"), "utf8"));

for (const file of policy.required_files) await access(resolve(root, file));

const license = await readFile(resolve(root, "LICENSE"), "utf8");
if (!license.includes("Apache License") || !license.includes("Version 2.0")) {
  throw new Error("LICENSE does not identify Apache-2.0");
}

const security = await readFile(resolve(root, "SECURITY.md"), "utf8");
if (!security.includes("/security/advisories/new")) {
  throw new Error("SECURITY.md has no private reporting route");
}
if (!security.includes("90 days") || !security.includes("embargo")) {
  throw new Error("SECURITY.md has no coordinated-disclosure policy");
}

const owners = await readFile(resolve(here, "CODEOWNERS"), "utf8");
for (const path of policy.sensitive_paths) {
  if (!owners.includes(path)) throw new Error(`CODEOWNERS misses ${path}`);
}

const template = await readFile(resolve(here, "PULL_REQUEST_TEMPLATE.md"), "utf8");
for (const section of policy.required_pr_sections) {
  if (!template.includes(section)) throw new Error(`PR template misses ${section}`);
}

const issueConfig = await readFile(resolve(here, "ISSUE_TEMPLATE/config.yml"), "utf8");
if (!issueConfig.includes("blank_issues_enabled: false")) {
  throw new Error("Blank issues must remain disabled");
}
if (!issueConfig.includes("/security/advisories/new")) {
  throw new Error("Issue chooser has no private vulnerability route");
}

console.log(`Verified ${policy.required_files.length} governance files and policies.`);
