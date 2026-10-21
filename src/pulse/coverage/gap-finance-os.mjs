// Finance OS read doors past the bank link. Report only.
// slice-07-finance.mjs already names the six Finance OS jobs. This file does
// not repeat those jobs.
//
// One client with an active bank link is enough. These reads must answer for
// that client. A 400, a 500, an error body, or a throw is a fail.
// Plaid items and empty accounts belong to another lane. This file does not
// call Plaid and does not move money.
// Recon (AG-07) is the one tripwire. Do not add another watcher.
//
// Review notes (Claude, 2026-10-08):
//   * Each door used to be opened by importing its file from a path built at run
//     time. The morning check runs inside the bundled Netlify function, which
//     carries only files the code names, so those imports would have failed and
//     every door would have read FAIL "cannot find module" every morning. Each
//     door now names its handler with a literal import so the bundler packs it.
//   * The seven doors ran one after another (about 12 to 20 seconds). The step
//     is cut at 26 seconds, so they now run side by side.
//   * The skip line said "no database" even when the org id was the missing part.
//
// ONE VERDICT, TWO CLOCKS (2026-10-20). The linked-client read, the door verdict and the money
// helper's read-only payload live in src/pulse/beats/lib/ (money-helper-door.mjs and
// money-helper-read.mjs), so the hourly beat money-tasks judges finance-os:helper with the same
// client pick, the same read and the same words. This lane still opens the real handlers.

import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  HELPER_DOOR, row, clip, fix, scoreDoor, linkedClientId
} from "../beats/lib/money-helper-door.mjs";
import { helperView } from "../beats/lib/money-helper-read.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const DOORS = Object.freeze([
  { id: "finance-os:credit", route: "money/credit", page: "/app/money-credit.html", label: "credit page", file: "api/money/credit.mjs", load: () => import("../../../api/money/credit.mjs") },
  { id: "finance-os:plan", route: "money/plan", page: "/app/money-plan.html", label: "plan", file: "api/money/plan.mjs", load: () => import("../../../api/money/plan.mjs") },
  { id: "finance-os:declines", route: "blueprint/declines", page: "/app/money-declines.html", label: "declines", file: "api/blueprint/declines.mjs", load: () => import("../../../api/blueprint/declines.mjs") },
  { id: "finance-os:vault", route: "money/vault", page: "/app/money-vault.html", label: "vault", file: "api/money/vault.mjs", load: () => import("../../../api/money/vault.mjs") },
  { id: "finance-os:transfers", route: "money/transfers", page: "/app/money-transfers.html", label: "transfers", file: "api/money/transfers.mjs", load: () => import("../../../api/money/transfers.mjs") },
  { id: "finance-os:payments", route: "money/payments", page: "/app/money-payments.html", label: "payments schedule", file: "api/money/payments.mjs", load: () => import("../../../api/money/payments.mjs") },
  { ...HELPER_DOOR, load: () => import("../../../api/money/helper.mjs") }
]);

export const CHECK_IDS = Object.freeze(DOORS.map((door) => door.id));

const handlers = new Map();

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

function staffGate(orgId) {
  return async () => ({
    kind: "staff",
    role: "owner",
    orgId,
    staffId: null,
    name: "Morning pulse",
    email: "pulse@fundhub.ai",
    staff: { role: "owner", org_id: orgId, id: null, name: "Morning pulse", email: "pulse@fundhub.ai" }
  });
}

/**
 * The helper GET also answers queued turns. That write stays off here.
 * The same selects the page uses still run, so a broken read still fails:
 * this is the page's own payload read (helperView) with no step before the reads.
 */
export async function readOnlyHelperPayload(database, {
  orgId, clientId, staff = false, env = process.env, now = new Date()
} = {}) {
  return helperView(database, { orgId, clientId, staff, env, now });
}

async function loadHandler(door) {
  if (handlers.has(door.file)) return handlers.get(door.file);
  // door.load is a literal import, so the server bundle packs the handler. The
  // path import is only a fallback for a door that has no loader.
  const mod = typeof door.load === "function"
    ? await door.load()
    : await import(pathToFileURL(path.join(ROOT, door.file)).href);
  const handler = mod.default;
  handlers.set(door.file, handler);
  return handler;
}

/** GET one door for one linked client. No Plaid call. No money move. */
export async function openReadDoor(door, {
  db, orgId, clientId, now = new Date(), handler, env = process.env
} = {}) {
  if (typeof handler !== "function") {
    return { status: 0, body: null, thrown: new Error("read door has no handler"), method: "GET" };
  }
  const res = mockRes();
  const req = { method: "GET", headers: {}, query: { client_id: clientId } };
  const deps = {
    db,
    env,
    now: () => now,
    requirePrincipal: staffGate(orgId)
  };
  if (door.id === "finance-os:helper") deps.helperPayload = readOnlyHelperPayload;
  try {
    await handler(req, res, deps);
    return { status: res.statusCode, body: res.body, thrown: null, method: req.method };
  } catch (err) {
    return { status: res.statusCode, body: res.body, thrown: err, method: req.method };
  }
}

async function runDoor(door, args, ctx) {
  if (typeof ctx.callDoor === "function") return ctx.callDoor(door, args);
  const handler = ctx.handlers && typeof ctx.handlers[door.id] === "function"
    ? ctx.handlers[door.id]
    : await loadHandler(door);
  return openReadDoor(door, { ...args, handler, env: ctx.env || process.env });
}

/**
 * Seven read-only checks. ctx: { db, orgId, now, env, callDoor, handlers }.
 * Each row is { id, status, detail, suggestedFix }. Status is PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  if (!db || !orgId) {
    return DOORS.map((door) => row(
      door.id,
      "skip",
      !db
        ? "no database in this run — finance read doors not opened"
        : "no org id in this run — finance read doors not opened"
    ));
  }

  let clientId;
  try {
    clientId = await linkedClientId(db, orgId);
  } catch (err) {
    return DOORS.map((door) => row(
      door.id,
      "FAIL",
      `could not read a linked client: ${clip(err)}`,
      fix(door)
    ));
  }
  if (!clientId) {
    return DOORS.map((door) => row(
      door.id,
      "skip",
      `no client with an active bank link — ${door.label} was not opened`
    ));
  }

  const args = { db, orgId, clientId, now };
  // Side by side. Rows keep the order of DOORS.
  return Promise.all(DOORS.map(async (door) => {
    try {
      const outcome = await runDoor(door, args, ctx);
      return scoreDoor(door, clientId, outcome);
    } catch (err) {
      return row(
        door.id,
        "FAIL",
        `${door.label} (GET /api/${door.route}) threw for linked client ${clientId}: ${clip(err)}`,
        fix(door)
      );
    }
  }));
}
