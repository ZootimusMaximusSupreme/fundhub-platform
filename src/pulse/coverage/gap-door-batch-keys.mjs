const KEY_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const MASK_RE = /^(?:\*{4,}|x{4,}|redacted|masked)$/i;

export const KEY_HEALTH_EVIDENCE =
  "src/pulse/coverage/gap-door-batch-keys.mjs " +
  "src/pulse/catalog/proofs/door-batch-key-health.test.mjs";

function valueShape(name, value) {
  if (/(?:^|_)(?:URL|URI|ORIGIN)$/.test(name)) {
    try {
      const parsed = new URL(value);
      return ["http:", "https:"].includes(parsed.protocol) ? null : "url must use http or https";
    } catch {
      return "value is not a valid url";
    }
  }
  if (/(?:^|_)HOST$/.test(name)) {
    return /^(?:https?:\/\/)?[A-Za-z0-9.-]+(?::\d+)?(?:\/.*)?$/.test(value)
      ? null
      : "value is not a valid host";
  }
  if (/(?:^|_)(?:CENTS|PORT|TIMEOUT_MS|LIMIT|MAX|DAYS|HOURS|MINUTES)$/.test(name)) {
    return /^\d+$/.test(value) ? null : "value must be a whole number";
  }
  if (/(?:^|_)(?:EMAIL)$/.test(name)) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : "value is not an email";
  }
  if (/(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD)$/.test(name)) {
    return value.length >= 8 ? null : "credential is too short";
  }
  return null;
}

export function evaluateKeyHealth(row, env = {}, references = []) {
  const name = String(row?.env_name || "").trim();
  const problems = [];
  if (!KEY_NAME_RE.test(name)) problems.push("invalid env name");
  if (row?.surface !== `env:${name}`) problems.push("surface does not match env name");
  if (!String(row?.control || "").startsWith(`${name}:`)) problems.push("control does not name the key");
  if (!Number.isInteger(row?.read_by_files) || row.read_by_files < 1) problems.push("map names no reader");
  if (!Array.isArray(references) || references.length < 1) problems.push("repo code has no reader");

  const value = String(env?.[name] ?? "").trim();
  if (!value) problems.push("value is missing");
  else if (MASK_RE.test(value) || /\*{4,}/.test(value)) problems.push("value is masked");
  else {
    const shapeProblem = valueShape(name, value);
    if (shapeProblem) problems.push(shapeProblem);
  }

  return {
    ok: problems.length === 0,
    name,
    problems,
    referenceCount: Array.isArray(references) ? references.length : 0,
  };
}

export function keyHealthProof(row) {
  if (!["money", "customerMessage", "customerData"].includes(row?.impact)) return null;
  if (!KEY_NAME_RE.test(String(row?.env_name || "").trim())) return null;
  if (!Number.isInteger(row?.read_by_files) || row.read_by_files < 1) return null;
  return {
    depth: "deep",
    evidence: KEY_HEALTH_EVIDENCE,
    asserts: row.control,
  };
}

export async function gapChecks() {
  return [];
}
