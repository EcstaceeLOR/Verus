import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shimDirectory = resolve(root, ".turbo", "corepack-bin");
await mkdir(shimDirectory, { recursive: true });

if (process.platform === "win32") {
  await writeFile(resolve(shimDirectory, "pnpm.cmd"), "@echo off\r\ncorepack pnpm %*\r\n", "utf8");
} else {
  const shim = resolve(shimDirectory, "pnpm");
  await writeFile(shim, '#!/usr/bin/env sh\nexec corepack pnpm "$@"\n', "utf8");
  await chmod(shim, 0o755);
}

const binary = resolve(root, "node_modules", "turbo", "bin", "turbo");
const child = spawn(process.execPath, [binary, ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, PATH: `${shimDirectory}${delimiter}${process.env.PATH ?? ""}` },
  stdio: "inherit",
});

child.once("error", (error) => {
  process.stderr.write(`Unable to start Turbo: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`Turbo stopped by ${signal}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
