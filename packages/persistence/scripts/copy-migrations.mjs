import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(packageRoot, "dist", "migrations");

await rm(destination, { force: true, recursive: true });
await mkdir(destination, { recursive: true });
await cp(resolve(packageRoot, "migrations"), destination, { recursive: true });
