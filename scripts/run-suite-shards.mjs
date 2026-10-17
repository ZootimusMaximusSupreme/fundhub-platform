import { createHash } from "node:crypto";

// Keep this in sync with both unit matrices in .github/workflows/tests.yml.
export const UNIT_SHARD_COUNT = 6;

export function unitShardFor(relativeFile, count = UNIT_SHARD_COUNT) {
  if (!Number.isInteger(count) || count < 1) throw new Error("unit shard count must be positive");
  return createHash("sha256").update(relativeFile).digest().readUInt32BE(0) % count;
}
