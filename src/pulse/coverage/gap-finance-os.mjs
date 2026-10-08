// Finance OS read doors past the bank link. Report only.
// slice-07-finance.mjs already names the six Finance OS jobs. This file does
// not repeat those jobs.
//
// One client with an active bank link is enough. These reads must answer for
// that client. A 400, a 500, an error body, or a throw is a fail.
// Plaid items and empty accounts belong to another lane. This file does not
// call Plaid and does not move money.
// Recon (AG-07) is the one tripwire. Do not add another watcher.

import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const DOORS = Object.freeze([
  { id: "finance-os:credit", route: "money/credit", page: "/app/money-credit.html", label: "credit page", file: "api/money/credit.mjs" },
  { id: "finance-os:plan", route: "money/plan", page: "/app/money-plan.html", label: "plan", file: "api/money/plan.mjs" },
  { id: "finance-os:declines", route: "blueprint/declines", page: "/app/money-declines.html", label: "declines", file: "api/blueprint/declines.mjs" },
  { id: "finance-os:vault", route: "money/vault", page: "/app/money-vault.html", label: "vault", file: "api/money/vault.mjs" },
  { id: "finance-os:transfers", route: "money/transfers", page: "/app/money-transfers.html", label: "transfers", file: "api/money/transfers.mjs" },
  { id: "finance-os:payments", route: "money/payments", page: "/app/money-payments.html", label: "payments schedule", file: "api/money/payments.mjs" },
  { id: "finance-os:helper", route: "money/helper", page: "/app/money-helper.html", label: "money helper", file: "api/money/helper.mjs" }
]);

export const CHECK_IDS = Object.freeze(DOORS.map((door) => door.id));

const RECON =
  "Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. " +
  "Do not auto-fix. Do not call Plaid. Do not move money. Do not add another watcher.";

const LINKED_CLIENT_SQL = `
  /* gap:finance-os-linked-client */
  SELECT c.id::text AS id
    FROM clients c
   WHERE c.org_id = $1::uuid
     AND EXISTS (
       SELECT 1
         FROM plaid_items p
        WHERE p.org_id = c.org_id
          AND p.client_id = c.id
          AND p.link_state = 'active'
     )
   ORDER BY c.created_at DESC
   LIMIT 1
`;

const handlers = new Map();

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err, n = 180) {
  const msg = err && err.message ? err.message : err;
  return String(msg == null ? "" : msg).replace(/\s+/g, " ").trim().slice(0, n);
}

function fix(door) {
  return `${RECON} Open GET /api/${door.route} for that linked client (${door.page}).`;
}

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
 * The same selects the page uses still run, so a broken read still fails.
 */
export async function readOnlyHelperPayload(database, {
  orgId, clientId, staff = false, env = process.env, now = new Date()
} = {}) {
  const helper = await import("../../finance/money-helper.mjs");
  const { runnerMode } = await import("../../finance/money-agent-ai.mjs");
  const found = await database.query(
    `SELECT id, first_name, last_name FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const client = found.rows[0];
  if (!client) return null;
  const [agent, state, turns, bridge] = await Promise.all([
    helper.loadAgent(database, { orgId }),
    helper.threadState(database, { orgId, clientId }),
    helper.readThread(database, { orgId, clientId, limit: 60 }),
    helper.bridgeStatus(database, { now })
  ]);
  const view = turns.map((turn) => helper.viewTurn(turn, { staff }));
  const name = [client.first_name, client.last_name].filter((part) => part && String(part).trim()).join(" ") || null;
  return {
    ok: true,
    client: { id: String(client.id), name },
    viewer: staff ? "staff" : "client",
    today: new Date(now).toISOString().slice(0, 10),
    helper: {
      code: agent.code,
      name: agent.name,
      status: agent.status,
      on: helper.helperIsOn(agent),
      sends_texts: false,
      brain: runnerMode(env),
      bridge_on: bridge.on,
      halted: !!state.halted_at,
      halt_reason: state.halt_reason
    },
    turns: view,
    pending: view.filter((turn) => turn.status === "queued" || turn.status === "running").length
  };
}

async function loadHandler(door) {
  if (handlers.has(door.file)) return handlers.get(door.file);
  const mod = await import(pathToFileURL(path.join(ROOT, door.file)).href);
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

function scoreDoor(door, clientId, outcome) {
  const name = `${door.label} (GET /api/${door.route})`;
  const who = `linked client ${clientId}`;
  if (outcome && outcome.thrown) {
    return row(door.id, "FAIL", `${name} threw for ${who}: ${clip(outcome.thrown)}`, fix(door));
  }
  const status = Number(outcome && outcome.status) || 0;
  const body = outcome ? outcome.body : null;
  const errorText = body && (body.error || body.message) ? clip(body.error || body.message, 120) : "";
  const bad = status === 0 || status >= 400 || (body && body.ok === false) || (body && body.error);
  if (!bad && status >= 200 && status < 300) {
    return row(door.id, "PASS", `${name} answered ${status} for ${who}`);
  }
  const why = errorText ? ` (${errorText})` : "";
  const detail = status
    ? `${name} answered ${status} for ${who}${why}`
    : `${name} returned no status for ${who}${why}`;
  return row(door.id, "FAIL", detail, fix(door));
}

async function linkedClientId(db, orgId) {
  const result = await db.query(LINKED_CLIENT_SQL, [orgId]);
  const id = result?.rows?.[0]?.id;
  return id ? String(id) : null;
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
      "no database in this run — finance read doors not opened"
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
  const out = [];
  for (const door of DOORS) {
    try {
      const outcome = await runDoor(door, args, ctx);
      out.push(scoreDoor(door, clientId, outcome));
    } catch (err) {
      out.push(row(
        door.id,
        "FAIL",
        `${door.label} (GET /api/${door.route}) threw for linked client ${clientId}: ${clip(err)}`,
        fix(door)
      ));
    }
  }
  return out;
}
