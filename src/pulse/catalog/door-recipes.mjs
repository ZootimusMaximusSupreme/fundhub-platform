const ROUTE_FILES = new Set([
  "routes-0.json",
  "routes-1.json",
  "routes-2.json",
  "routes-3.json",
]);

const SUPPORTED_FILES = new Set([
  ...ROUTE_FILES,
  "jobs.json",
  "webhooks.json",
  "keys.json",
]);

function fileName(sourceFile) {
  return String(sourceFile || "").split(/[\\/]/).at(-1);
}

function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function surfaceOf(row) {
  return text(row?.surface, "unmapped-door");
}

function routeRecipe(sourceFile, row) {
  const surface = surfaceOf(row);
  const target = text(row.route, surface.replace(/^route:/, ""));
  const methods = Array.isArray(row.methods)
    ? row.methods.map((method) => String(method).toUpperCase())
    : [];
  const kind = text(row.kind, "unknown-route");
  const isReadOnly =
    methods.length > 0
      ? methods.every((method) => ["GET", "HEAD", "OPTIONS"].includes(method))
      : /(?:^|-)read$/.test(kind);
  const hasKnownContract = methods.length > 0 || kind !== "unknown-route";

  return {
    family: "route",
    mode: !hasKnownContract ? "manual-red" : isReadOnly ? "read-only" : "test",
    target,
    expected:
      methods.length > 0
        ? `${methods.join(",")} matches the declared route contract`
        : `${kind} matches the declared route contract`,
    schedule: "on-command",
    safe: isReadOnly,
    sourceFile,
    surface,
  };
}

function jobRecipe(sourceFile, row) {
  const surface = surfaceOf(row);
  const trigger = text(row.trigger, "");
  const schedule = text(row.schedule, trigger || "on-demand");

  return {
    family: "job",
    mode: "receipt",
    target: text(row.file, surface),
    expected: trigger ? `run receipt after ${trigger}` : "run receipt after invocation",
    schedule,
    safe: true,
    sourceFile,
    surface,
  };
}

function webhookRecipe(sourceFile, row) {
  const surface = surfaceOf(row);
  const signature = text(row.signature, "unknown signature");
  const isUnverified = /unverified|unknown/i.test(signature);

  return {
    family: "webhook",
    mode: isUnverified ? "manual-red" : "test",
    target: text(row.door, surface),
    expected: `door honors ${signature}`,
    schedule: "on-command",
    safe: !isUnverified,
    sourceFile,
    surface,
  };
}

function keyRecipe(sourceFile, row) {
  const surface = surfaceOf(row);
  const keyName = text(row.env_name, surface.replace(/^env:/, ""));

  return {
    family: "key",
    mode: "manual-red",
    target: keyName,
    expected: `${keyName} must be proved without reading its value`,
    schedule: "on-change",
    safe: true,
    sourceFile,
    surface,
  };
}

export function supports(sourceFile, row) {
  return SUPPORTED_FILES.has(fileName(sourceFile)) && Boolean(row && typeof row === "object");
}

export function makeRecipe(sourceFile, row) {
  if (!supports(sourceFile, row)) {
    throw new TypeError(`Unsupported door recipe source: ${fileName(sourceFile) || "unknown"}`);
  }

  const name = fileName(sourceFile);
  if (ROUTE_FILES.has(name)) return routeRecipe(sourceFile, row);
  if (name === "jobs.json") return jobRecipe(sourceFile, row);
  if (name === "webhooks.json") return webhookRecipe(sourceFile, row);
  return keyRecipe(sourceFile, row);
}
