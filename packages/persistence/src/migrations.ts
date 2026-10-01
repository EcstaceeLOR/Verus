import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";

import type { Pool, PoolClient } from "pg";

import {
  NOOP_PERSISTENCE_TELEMETRY,
  type PersistenceEventName,
  type PersistenceTelemetry,
} from "./telemetry.js";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
  readonly down: string;
  readonly checksum: string;
}

export interface MigrationResult {
  readonly direction: "down" | "up";
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly appliedVersions: readonly number[];
}

export class MigrationError extends Error {
  readonly code: "MIGRATION_CHECKSUM_MISMATCH" | "MIGRATION_FAILED" | "MIGRATION_TARGET_INVALID";

  constructor(code: MigrationError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MigrationError";
    this.code = code;
  }
}

function migrationDirectory(): URL {
  const bundled = new URL("./migrations/", import.meta.url);
  return existsSync(bundled) ? bundled : new URL("../migrations/", import.meta.url);
}

export async function loadMigrations(): Promise<readonly Migration[]> {
  const directory = migrationDirectory();
  const files = await readdir(directory);
  const upFiles = files.filter((file) => /^\d{4}_[a-z0-9_]+\.up\.sql$/.test(file)).sort();
  const migrations = await Promise.all(
    upFiles.map(async (upFile) => {
      const match = /^(\d{4})_([a-z0-9_]+)\.up\.sql$/.exec(upFile);
      if (match === null) throw new MigrationError("MIGRATION_FAILED", "Invalid migration name.");
      const version = Number(match[1]);
      const name = match[2] as string;
      const downFile = `${match[1]}_${name}.down.sql`;
      if (!files.includes(downFile)) {
        throw new MigrationError("MIGRATION_FAILED", `Migration ${version} has no rollback file.`);
      }
      const [rawUp, rawDown] = await Promise.all([
        readFile(new URL(upFile, directory), "utf8"),
        readFile(new URL(downFile, directory), "utf8"),
      ]);
      const up = rawUp.replaceAll("\r\n", "\n");
      const down = rawDown.replaceAll("\r\n", "\n");
      return Object.freeze({
        version,
        name,
        up,
        down,
        checksum: createHash("sha256").update(up).update("\0").update(down).digest("hex"),
      });
    }),
  );
  const versions = migrations.map(({ version }) => version);
  if (new Set(versions).size !== versions.length) {
    throw new MigrationError("MIGRATION_FAILED", "Migration versions must be unique.");
  }
  return Object.freeze(migrations);
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS verus_schema_migrations (
      version integer PRIMARY KEY CHECK (version > 0),
      name text NOT NULL,
      checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
}

function emitMigration(
  telemetry: PersistenceTelemetry,
  name: PersistenceEventName,
  operation: string,
  version: number,
  startedAt: number,
): void {
  try {
    telemetry.emit({
      name,
      operation,
      version,
      outcome: name.endsWith("completed") ? "success" : "failure",
      durationMs: performance.now() - startedAt,
    });
  } catch {
    // Telemetry must never change a committed migration outcome.
  }
}

async function applyMigration(
  client: PoolClient,
  migration: Migration,
  direction: "down" | "up",
  telemetry: PersistenceTelemetry,
): Promise<void> {
  const startedAt = performance.now();
  try {
    await client.query("BEGIN");
    await client.query(direction === "up" ? migration.up : migration.down);
    if (direction === "up") {
      await client.query(
        "INSERT INTO verus_schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
        [migration.version, migration.name, migration.checksum],
      );
    } else {
      await client.query("DELETE FROM verus_schema_migrations WHERE version = $1", [
        migration.version,
      ]);
    }
    await client.query("COMMIT");
    emitMigration(
      telemetry,
      "persistence.migration.completed",
      direction,
      migration.version,
      startedAt,
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    emitMigration(
      telemetry,
      "persistence.migration.failed",
      direction,
      migration.version,
      startedAt,
    );
    throw new MigrationError(
      "MIGRATION_FAILED",
      `Migration ${migration.version} ${direction} failed.`,
      { cause: error },
    );
  }
}

export async function migrate(
  pool: Pool,
  options: {
    readonly targetVersion?: number;
    readonly telemetry?: PersistenceTelemetry;
    readonly migrations?: readonly Migration[];
  } = {},
): Promise<Readonly<MigrationResult>> {
  const migrations = options.migrations ?? (await loadMigrations());
  const latest = migrations.at(-1)?.version ?? 0;
  const target = options.targetVersion ?? latest;
  if (
    !Number.isSafeInteger(target) ||
    target < 0 ||
    target > latest ||
    (target !== 0 && !migrations.some(({ version }) => version === target))
  ) {
    throw new MigrationError(
      "MIGRATION_TARGET_INVALID",
      "Migration target is outside the known range.",
    );
  }
  const telemetry = options.telemetry ?? NOOP_PERSISTENCE_TELEMETRY;
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [1_441_718_893]);
    await ensureMigrationTable(client);
    const applied = await client.query<{ checksum: string; name: string; version: number }>(
      "SELECT version, name, checksum FROM verus_schema_migrations ORDER BY version",
    );
    const knownByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
    for (const row of applied.rows) {
      const known = knownByVersion.get(row.version);
      if (known === undefined || known.name !== row.name || known.checksum !== row.checksum) {
        throw new MigrationError(
          "MIGRATION_CHECKSUM_MISMATCH",
          `Applied migration ${row.version} does not match this release.`,
        );
      }
    }
    const expectedAppliedVersions = migrations
      .slice(0, applied.rows.length)
      .map(({ version }) => version);
    if (applied.rows.some((row, index) => row.version !== expectedAppliedVersions[index])) {
      throw new MigrationError(
        "MIGRATION_CHECKSUM_MISMATCH",
        "Applied migrations are not a contiguous known prefix.",
      );
    }
    const current = applied.rows.at(-1)?.version ?? 0;
    const selected =
      target >= current
        ? migrations.filter(({ version }) => version > current && version <= target)
        : [...migrations]
            .filter(({ version }) => version > target && version <= current)
            .sort((left, right) => right.version - left.version);
    const direction = target >= current ? "up" : "down";
    for (const migration of selected) {
      await applyMigration(client, migration, direction, telemetry);
    }
    return Object.freeze({
      direction,
      fromVersion: current,
      toVersion: target,
      appliedVersions: Object.freeze(selected.map(({ version }) => version)),
    });
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [1_441_718_893]).catch(() => undefined);
    client.release();
  }
}
