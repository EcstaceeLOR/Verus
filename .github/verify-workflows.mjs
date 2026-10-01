import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workflowDirectory = resolve(here, "workflows");
const workflowNames = (await readdir(workflowDirectory)).filter((name) => /\.ya?ml$/.test(name));

if (workflowNames.length < 2) throw new Error("Quality and integration workflows are required.");

for (const name of workflowNames) {
  const contents = await readFile(resolve(workflowDirectory, name), "utf8");
  if (/pull_request_target\s*:/.test(contents)) {
    throw new Error(`${name} must not execute privileged pull_request_target workflows.`);
  }
  if (!/^permissions:\s*\r?\n\s+contents:\s*read\s*$/m.test(contents)) {
    throw new Error(`${name} must declare top-level contents: read permissions.`);
  }
  if (/^\s+[A-Za-z_-]+:\s*write\s*$/m.test(contents)) {
    throw new Error(`${name} grants write permission.`);
  }
  if (!/timeout-minutes:\s*\d+/.test(contents)) {
    throw new Error(`${name} has no bounded job timeout.`);
  }
  if (/\$\{\{\s*secrets\./.test(contents)) {
    throw new Error(`${name} exposes repository secrets to a workflow.`);
  }
  for (const match of contents.matchAll(/uses:\s*([^@\s]+)@([^\s#]+)/g)) {
    const action = match[1];
    const reference = match[2];
    if (!action.startsWith("./") && !/^[0-9a-f]{40}$/.test(reference)) {
      throw new Error(`${name} does not pin ${action} to a commit SHA.`);
    }
  }
}

console.log(`Verified least-privilege policy for ${workflowNames.length} workflows.`);
