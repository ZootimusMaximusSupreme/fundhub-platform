// Pulse registry coverage — same idea as src/http/routes.test.mjs.
// A new routed api/ handler, live public/app desk, or public HTML page fails
// this until it is in PULSE_REGISTRY or ALLOWED_UNMONITORED with a written reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_UNMONITORED,
  PULSE_REGISTRY,
  SEND_PATHS,
  checkRegistry,
  coverageKey,
  missingFromRegistry
} from "./registry.mjs";
import { JOBS } from "./heartbeats.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(HERE, "../../api");
const APP_DIR = path.resolve(HERE, "../../public/app");
const PUBLIC_DIR = path.resolve(HERE, "../../public");

function publicStaticFiles() {
  return fs
    .readdirSync(PUBLIC_DIR, { recursive: true })
    .filter((name) => typeof name === "string" && name.endsWith(".html") && !name.startsWith("app/"))
    .map((name) => name.replace(/\\/g, "/"))
    .filter((name) => !name.startsWith("app/"))
    .sort();
}

function handlerKeys(dir = API_DIR, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...handlerKeys(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith(".mjs") && !entry.name.endsWith(".test.mjs")) out.push(rel.slice(0, -".mjs".length));
  }
  return out;
}

function deskFiles() {
  return fs.readdirSync(APP_DIR).filter((name) => name.endsWith(".html")).sort();
}

const KEYS = handlerKeys();
const DESKS = deskFiles();
const PUBLIC_STATICS = publicStaticFiles();

test("registry: every routed api handler, live desk, and public page is listed or explicitly unmonitored", () => {
  const missing = missingFromRegistry({
    handlerKeys: KEYS,
    deskFiles: DESKS,
    publicFiles: PUBLIC_STATICS
  });
  assert.deepEqual(
    missing,
    [],
    `live paths missing from the pulse registry:\n  ${missing.join("\n  ")}\n` +
    `Add each to PULSE_REGISTRY in src/pulse/registry.mjs, or to ALLOWED_UNMONITORED ` +
    `with a written reason (same change as the feature).`
  );
});

test("registry: omitting a known live route fails coverage", () => {
  const truncated = PULSE_REGISTRY.filter((row) => coverageKey(row) !== "health");
  const missing = missingFromRegistry({
    handlerKeys: KEYS,
    deskFiles: DESKS,
    publicFiles: PUBLIC_STATICS,
    registry: truncated
  });
  assert.ok(
    missing.includes("health"),
    `expected omitting /api/health to fail coverage, got: ${missing.join(", ") || "(empty)"}`
  );
});

test("registry: no ALLOWED_UNMONITORED entry is stale", () => {
  const live = new Set([...KEYS, ...DESKS, ...PUBLIC_STATICS]);
  const covered = new Set(PULSE_REGISTRY.map(coverageKey));
  for (const key of Object.keys(ALLOWED_UNMONITORED)) {
    assert.ok(live.has(key), `ALLOWED_UNMONITORED names "${key}" but that file is gone — drop the entry.`);
    assert.ok(!covered.has(key), `"${key}" is in the registry and in ALLOWED_UNMONITORED. Pick one.`);
  }
});

test("registry: every ALLOWED_UNMONITORED entry carries a written reason", () => {
  for (const [key, reason] of Object.entries(ALLOWED_UNMONITORED)) {
    assert.ok(
      typeof reason === "string" && reason.trim().length >= 40,
      `ALLOWED_UNMONITORED["${key}"] needs a written reason, not "${reason}".`
    );
  }
});

test("registry: every registry row names a real handler or desk file", () => {
  const live = new Set([...KEYS, ...DESKS, ...PUBLIC_STATICS]);
  for (const row of PULSE_REGISTRY) {
    const key = coverageKey(row);
    assert.ok(live.has(key), `PULSE_REGISTRY has "${key}" (${row.path}) but that file is gone.`);
  }
});

/* A handler file is not a route (CLAUDE.md §12). A row for a file that is on
   disk but not in ROUTES answers 404 every morning — measured on live: the
   shelved public/decline-autopsy was "down" in every pulse from 2026-09-18 to
   2026-10-05, and it was the first failure in Chris's text each day. A shelved
   or unrouted door goes in ALLOWED_UNMONITORED with its reason instead. */
test("registry: every api row the pulse pings is actually routed", () => {
  const unrouted = PULSE_REGISTRY
    .filter((row) => row.kind === "api")
    .map(coverageKey)
    .filter((key) => !Object.prototype.hasOwnProperty.call(ROUTES, key));
  assert.deepEqual(
    unrouted,
    [],
    `the pulse pings these, but netlify/functions/api.mjs does not route them, so they answer 404 every day:\n  ${unrouted.join("\n  ")}`
  );
});

test("registry: a GET ping writes up or down and never auto-fixes", async () => {
  const rows = [
    ...PULSE_REGISTRY.filter((row) => row.id === "health" || row.id === "pipeline"),
    { id: "public/unsubscribe", kind: "api", path: "/api/public/unsubscribe" }
  ];
  const checks = await checkRegistry({
    rows,
    baseUrl: "https://fundhub.ai",
    fetchImpl: async (url) => {
      if (String(url).includes("/api/health")) return { status: 200 };
      if (String(url).includes("/app/pipeline.html")) return { status: 503 };
      if (String(url).includes("/api/public/unsubscribe")) return { status: 400 };
      return { status: 404 };
    }
  });
  const health = checks.find((c) => c.id === "reg:health");
  const pipeline = checks.find((c) => c.id === "reg:pipeline");
  const unsub = checks.find((c) => c.id === "reg:public/unsubscribe");
  assert.equal(health.status, "up");
  assert.equal(unsub.status, "up");
  assert.equal(pipeline.status, "down");
  assert.match(pipeline.suggestedFix, /Do not auto-fix/);
  assert.ok(checks.every((c) => c.kind === "registry"));
});

const SEND_PROVIDERS = /messaging\/providers\/(?:twilio|twilio-whatsapp|resend|mailgun|mail-letter|web-push|ntfy)\.mjs$/;
const ROOT = path.resolve(HERE, "../..");

function filesThatSend(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "providers") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      filesThatSend(abs, out);
      continue;
    }
    if (!entry.name.endsWith(".mjs") || entry.name.endsWith(".test.mjs")) continue;
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (rel.startsWith("src/messaging/providers/")) continue;
    const src = fs.readFileSync(abs, "utf8");
    if (fileImportsSend(src)) out.push(rel);
  }
  return out;
}

function fileImportsSend(src) {
  const re = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  let match;
  while ((match = re.exec(src))) {
    if (!SEND_PROVIDERS.test(match[2])) continue;
    const clause = match[1];
    if (clause.includes("*") || /\bsend\b/.test(clause) || /\bsendLetter\b/.test(clause)) return true;
  }
  return false;
}

test("registry: a live SMS, email, or mail send names a pulse row or a written skip", () => {
  const found = [
    ...filesThatSend(path.join(ROOT, "src")),
    ...filesThatSend(path.join(ROOT, "api")),
    ...filesThatSend(path.join(ROOT, "netlify"))
  ].sort();
  const listed = Object.keys(SEND_PATHS).sort();
  assert.deepEqual(
    found,
    listed,
    `send files missing from SEND_PATHS, or SEND_PATHS names a file that no longer sends:\n  scan: ${found.join(", ")}\n  list: ${listed.join(", ")}`
  );
  const watched = new Set([
    ...PULSE_REGISTRY.map(coverageKey),
    ...JOBS.map((row) => row.job)
  ]);
  for (const [file, row] of Object.entries(SEND_PATHS)) {
    const watch = row && row.watch;
    const reason = row && row.reason;
    const hasWatch = typeof watch === "string" && watch.length > 0;
    const hasReason = typeof reason === "string" && reason.trim().length >= 40;
    assert.ok(hasWatch !== hasReason, `${file} needs a watch or a 40+ character reason, not both`);
    if (hasWatch) {
      assert.ok(watched.has(watch), `${file} watches "${watch}", which is not a registry key or a job`);
    }
  }
});
