import { Pool } from "pg";

import { migrate } from "./migrations.js";

const command = process.argv[2];
if (command !== "up" && command !== "down") {
  throw new Error("Usage: pnpm --filter @verus/persistence migrate|migrate:down");
}
const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error("DATABASE_URL is required.");
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
try {
  const result = await migrate(pool, command === "down" ? { targetVersion: 0 } : {});
  process.stdout.write(
    `Database migration ${result.direction}: ${result.fromVersion} -> ${result.toVersion}\n`,
  );
} finally {
  await pool.end();
}
