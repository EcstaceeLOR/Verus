import { readFile } from "node:fs/promises";

const inventoryUrl = new URL("./data-handling-matrix.v1.json", import.meta.url);
const inventory = JSON.parse(await readFile(inventoryUrl, "utf8"));

const requiredAssets = new Set([
  "raw_untrusted_content",
  "portfolio_data",
  "recoverable_credentials",
  "audit_events",
  "derived_claims_findings",
  "context_capsules_verdicts",
]);
const classRanks = new Map(inventory.classes.map(({ id, rank }) => [id, rank]));
const ids = new Set();

if (inventory.schema_version !== "1.0") {
  throw new Error("Unsupported data-handling matrix version");
}

for (const asset of inventory.assets) {
  if (ids.has(asset.id)) throw new Error(`Duplicate asset: ${asset.id}`);
  ids.add(asset.id);
  requiredAssets.delete(asset.id);

  const rank = classRanks.get(asset.class);
  if (rank === undefined) throw new Error(`${asset.id}: unknown class`);
  if (!asset.encryption_at_rest) throw new Error(`${asset.id}: encryption is required`);
  if (asset.default_retention_days > asset.maximum_retention_days) {
    throw new Error(`${asset.id}: default retention exceeds maximum`);
  }
  if (asset.active_deletion_sla_days > asset.backup_expiry_days) {
    throw new Error(`${asset.id}: backup expiry precedes active deletion objective`);
  }
  if (rank >= classRanks.get("restricted") && asset.log_mode !== "never") {
    throw new Error(`${asset.id}: restricted or secret data cannot enter logs`);
  }
  if (rank >= classRanks.get("restricted") && asset.analytics !== "never") {
    throw new Error(`${asset.id}: restricted or secret data cannot enter analytics`);
  }
  if (asset.class === "secret" && asset.export !== "never") {
    throw new Error(`${asset.id}: secret values cannot be exported`);
  }
  if (asset.class === "secret" && asset.legal_hold_allowed) {
    throw new Error(`${asset.id}: generic legal hold cannot retain secrets`);
  }
}

if (requiredAssets.size > 0) {
  throw new Error(`Missing required assets: ${[...requiredAssets].sort().join(", ")}`);
}

console.log(`Verified handling rules for ${inventory.assets.length} data assets.`);
