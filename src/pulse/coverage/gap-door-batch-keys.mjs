const KEY_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const MASK_RE = /^(?:\*{4,}|x{4,}|redacted|masked)$/i;
const KEY_HEALTH_TEST = "src/pulse/catalog/proofs/door-batch-key-health.test.mjs";

export const KEY_HEALTH_EVIDENCE =
  "src/pulse/coverage/gap-door-batch-keys.mjs " +
  "src/pulse/catalog/proofs/door-batch-key-health.test.mjs";

export const CHECK_IDS = Object.freeze(["door-batch:keys-live-proof"]);

export function keyNamesFromCatalog(catalog) {
  return [...new Set(
    (Array.isArray(catalog?.items) ? catalog.items : [])
    .filter((item) => item?.family === "key" && item?.proof?.tests?.includes(KEY_HEALTH_TEST))
    .map((item) => String(item.target || "").trim())
    .filter((name) => KEY_NAME_RE.test(name))
  )].sort();
}

async function compiledCatalog() {
  return (await import("../catalog/generated.json", { with: { type: "json" } })).default;
}

function valueShape(name, value) {
  if (/(?:^|_)(?:URL|URI|ORIGIN)$/.test(name)) {
    try {
      const parsed = new URL(value);
      const protocols = /(?:^|_)DATABASE_URL$/.test(name)
        ? ["postgres:", "postgresql:"]
        : ["http:", "https:"];
      return protocols.includes(parsed.protocol)
        ? null
        : `url must use ${protocols.map((protocol) => protocol.slice(0, -1)).join(" or ")}`;
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

function liveValueProblems(name, env) {
  const value = String(env?.[name] ?? "").trim();
  if (!value) return ["value is missing"];
  if (MASK_RE.test(value) || /\*{4,}/.test(value)) return ["value is masked"];
  const shapeProblem = valueShape(name, value);
  return shapeProblem ? [shapeProblem] : [];
}

export function evaluateKeyHealth(row, env = {}, references = []) {
  const name = String(row?.env_name || "").trim();
  const problems = [];
  if (!KEY_NAME_RE.test(name)) problems.push("invalid env name");
  if (row?.surface !== `env:${name}`) problems.push("surface does not match env name");
  if (!String(row?.control || "").startsWith(`${name}:`)) problems.push("control does not name the key");
  if (!Number.isInteger(row?.read_by_files) || row.read_by_files < 1) problems.push("map names no reader");
  if (!Array.isArray(references) || references.length < 1) problems.push("repo code has no reader");

  problems.push(...liveValueProblems(name, env));

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

export async function gapChecks(ctx = {}) {
  const env = ctx.env && typeof ctx.env === "object" ? ctx.env : process.env;
  const keyNames = keyNamesFromCatalog(ctx.catalog || await compiledCatalog());
  const failures = keyNames.flatMap((name) => {
    const problems = liveValueProblems(name, env);
    return problems.length ? [{ name, problems }] : [];
  });
  const status = failures.length === 0 ? "PASS" : "FAIL";
  const detail = failures.length === 0
    ? `${keyNames.length}/${keyNames.length} sensitive live keys are present and correctly shaped. No values were returned.`
    : `${failures.length}/${keyNames.length} sensitive live keys need attention: ${failures.map(({ name, problems }) => `${name} (${problems.join(", ")})`).join("; ")}. No values were returned.`;

  return [{
    id: CHECK_IDS[0],
    status,
    detail,
    suggestedFix: failures.length
      ? "Set or repair only the named live variables. Never paste their values into logs."
      : null,
  }];
}
