// Containers — each business is a container, each person is a container
// (owner direction, docs/finance/finance-os-direction-2026-10-06.md).
//
// A container IS an `entities` row (db/migrations/106_entities.sql). This module
// does not add a second table: "container" is the word Chris uses, `entities` is
// the table that already holds it. api/finance/entities.mjs stays the plain
// create/rename/archive door; this module adds the two things that door lacks —
// putting a bank account INTO a container, and counting containers for billing.
//
// WHAT A CONTAINER HOLDS
//   accounts — bank_accounts rows that are not credit and not loans (checking,
//              savings, investment, other, or a type the bank never told us)
//   cards    — bank_accounts rows with account_type 'credit' (a Plaid card), and
//              tradelines rows (hand-added or CRS cards) carrying this entity_id
//   loans    — bank_accounts rows with account_type 'loan'
//   bills    — recurring_bills rows whose own entity_id is this container, or,
//              when the bill has none, whose bank account sits in this container
//
// THE ONE RULE: entity_id AND entity_kind NEVER DISAGREE.
// bank_accounts carries two answers to "whose money": entity_kind
// (personal | business | unknown, migration 082) and entity_id (which
// container, migration 106). Putting an account in a business container while
// its entity_kind still says personal would make the banking surface and the
// container view tell two stories. So assign writes both in one statement, and
// unassign sends both back: entity_id NULL, entity_kind 'unknown', and the
// provenance (entity_kind_source, entity_kind_set_at) cleared — 082's rule that
// NULL provenance is the correct state for every 'unknown' row.
//
// PROVENANCE ON ASSIGN. 082's provenance CHECK refuses a non-unknown kind with
// no source. Staff putting an account in a container is 'staff_reviewed'. When
// the account already carried the SAME kind with a source (say
// 'document_verified'), that stronger, older basis is kept along with its date:
// moving it into a container of the same kind did not change what we know.
//
// BILLING COUNT. A container counts when it is not archived and holds at least
// one open bank account (closed_at IS NULL, any type — checking, card or loan)
// or at least one tradeline. An empty container is a name, not something we
// look after, so it is not billed. Price per container comes from
// FINANCE_OS_PRICE_PER_CONTAINER_CENTS (integer cents). Unset or not a whole
// number of cents → null, and monthly_cents is null too: an unset price is
// "price not set", never $0. Nothing here charges anyone.
//
// CLIENT PIN. rename / assign / unassign take an optional clientId. Staff pass
// none and keep the org-wide scope they always had. The client's own page
// (api/money/accounts.mjs) passes the session's clientId, and then a row that
// belongs to another client answers exactly like a row that does not exist.
//
// NO DELETES. Nothing in this module removes a row. Unassign clears two
// columns; a container is never deleted (api/finance/entities.mjs archives).

export const CONTAINER_KINDS = ["personal", "business"];
export const ASSIGN_SOURCES = ["client_stated", "staff_reviewed", "document_verified"];
export const PRICE_ENV = "FINANCE_OS_PRICE_PER_CONTAINER_CENTS";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v.trim());

/** node-postgres hands bigints over as strings. null stays null. */
function cents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function need(v, name) {
  if (!isUuid(v)) throw new TypeError(`${name} must be a uuid`);
  return String(v).trim();
}

function readName(v) {
  const s = String(v ?? "").trim();
  if (!s) throw new TypeError("name is required");
  if (s.length > 120) throw new TypeError("name must be 120 characters or fewer");
  return s;
}

/** Which list a bank_accounts row belongs in. */
export function slotFor(accountType) {
  if (accountType === "credit") return "cards";
  if (accountType === "loan") return "loans";
  return "accounts";
}

function accountView(r) {
  return {
    id: r.id,
    source: "bank_account",
    name: r.name ?? null,
    mask: r.mask ?? null,
    type: r.account_type ?? null,
    subtype: r.account_subtype ?? null,
    kind: r.entity_kind,
    kind_source: r.entity_kind_source ?? null,
    container_id: r.entity_id ?? null,
    current_cents: cents(r.current_balance_cents),
    available_cents: cents(r.available_balance_cents),
    limit_cents: cents(r.credit_limit_cents),
    provider: r.plaid_item_id ? "plaid" : "manual",
    closed_at: r.closed_at ?? null
  };
}

function tradelineView(r) {
  return {
    id: r.id,
    source: "tradeline",
    name: r.lender ?? null,
    mask: r.last4 ?? null,
    type: r.kind ?? null,
    container_id: r.entity_id ?? null,
    current_cents: cents(r.balance_cents),
    limit_cents: cents(r.credit_limit_cents)
  };
}

function billView(r) {
  const amt = cents(r.typical_amount_cents);
  return {
    id: r.id,
    name: r.merchant_display ?? r.merchant_key ?? null,
    /* 086 stores outflows as negative cents; a bill is shown as what it costs. */
    amount_cents: amt === null ? null : Math.abs(amt),
    cadence: r.cadence ?? null,
    next_on: r.next_expected_on ?? null,
    bank_account_id: r.bank_account_id ?? null,
    container_id: r.container_id ?? null
  };
}

const emptyHoldings = () => ({ accounts: [], cards: [], loans: [], bills: [] });

/**
 * listContainers(db, { orgId, clientId }) → { containers, unassigned }
 *
 * containers: every entities row for the client (archived ones too, flagged),
 * each with its accounts / cards / loans / bills. unassigned: the same lists
 * for rows with no container yet, so a screen can offer "put this somewhere".
 */
export async function listContainers(db, { orgId, clientId }) {
  if (!orgId) throw new TypeError("orgId is required");
  const cid = need(clientId, "client_id");

  const [ents, accts, lines, bills] = await Promise.all([
    db.query(
      `SELECT id, kind, name, archived_at, created_at
         FROM entities
        WHERE org_id = $1 AND client_id = $2
        ORDER BY archived_at NULLS FIRST, kind DESC, name, id`,
      [orgId, cid]
    ),
    db.query(
      `SELECT id, name, mask, account_type, account_subtype,
              current_balance_cents, available_balance_cents, credit_limit_cents,
              entity_kind, entity_kind_source, entity_id, plaid_item_id, closed_at
         FROM bank_accounts
        WHERE org_id = $1 AND client_id = $2
        ORDER BY name NULLS LAST, id`,
      [orgId, cid]
    ),
    db.query(
      `SELECT id, lender, last4, kind, balance_cents, credit_limit_cents, entity_id
         FROM tradelines
        WHERE org_id = $1 AND client_id = $2
        ORDER BY lender, id`,
      [orgId, cid]
    ),
    db.query(
      `SELECT rb.id, rb.merchant_display, rb.merchant_key, rb.typical_amount_cents,
              rb.cadence, rb.next_expected_on, rb.bank_account_id,
              COALESCE(rb.entity_id, ba.entity_id) AS container_id
         FROM recurring_bills rb
         LEFT JOIN bank_accounts ba ON ba.id = rb.bank_account_id AND ba.org_id = rb.org_id
        WHERE rb.org_id = $1 AND rb.client_id = $2
        ORDER BY rb.next_expected_on NULLS LAST, rb.id`,
      [orgId, cid]
    )
  ]);

  const byId = new Map();
  const containers = ents.rows.map((e) => {
    const c = {
      id: e.id, kind: e.kind, name: e.name,
      archived_at: e.archived_at ?? null, created_at: e.created_at ?? null,
      ...emptyHoldings()
    };
    byId.set(String(e.id), c);
    return c;
  });
  const unassigned = emptyHoldings();
  const home = (containerId) => (containerId && byId.get(String(containerId))) || unassigned;

  for (const r of accts.rows) home(r.entity_id)[slotFor(r.account_type)].push(accountView(r));
  for (const r of lines.rows) {
    const target = home(r.entity_id);
    (r.kind === "installment" ? target.loans : target.cards).push(tradelineView(r));
  }
  for (const r of bills.rows) home(r.container_id).bills.push(billView(r));

  return { containers, unassigned };
}

/** createContainer(db, { orgId, clientId, kind, name }) → the new row. */
export async function createContainer(db, { orgId, clientId, kind, name }) {
  if (!orgId) throw new TypeError("orgId is required");
  const cid = need(clientId, "client_id");
  const k = String(kind ?? "").trim().toLowerCase();
  if (!CONTAINER_KINDS.includes(k)) {
    throw new TypeError(`kind must be one of ${CONTAINER_KINDS.join(", ")}`);
  }
  const n = readName(name);
  const owns = await db.query(`SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`, [cid, orgId]);
  if (owns.rows.length === 0) return { ok: false, reason: "client_not_found" };
  const row = (await db.query(
    `INSERT INTO entities (org_id, client_id, kind, name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, client_id, kind, name, archived_at, created_at`,
    [orgId, cid, k, n]
  )).rows[0];
  return { ok: true, container: row };
}

/** renameContainer(db, { orgId, containerId, name, clientId? }) */
export async function renameContainer(db, { orgId, containerId, name, clientId = null }) {
  if (!orgId) throw new TypeError("orgId is required");
  const id = need(containerId, "container_id");
  const n = readName(name);
  const pin = clientId === null ? null : need(clientId, "client_id");
  const row = (await db.query(
    `UPDATE entities SET name = $3, updated_at = now()
      WHERE id = $1 AND org_id = $2 AND ($4::uuid IS NULL OR client_id = $4::uuid)
      RETURNING id, client_id, kind, name, archived_at, created_at`,
    [id, orgId, n, pin]
  )).rows[0];
  if (!row) return { ok: false, reason: "container_not_found" };
  return { ok: true, container: row };
}

/**
 * assignAccount(db, { orgId, accountId, containerId, source?, at? })
 *
 * Puts one bank_accounts row in a container and sets entity_kind to the
 * container's kind in the same statement. The account and the container must
 * belong to the same client in the same org, and the container must not be
 * archived.
 */
export async function assignAccount(db, { orgId, accountId, containerId, source = "staff_reviewed", at = null, clientId = null }) {
  if (!orgId) throw new TypeError("orgId is required");
  const aid = need(accountId, "account_id");
  const eid = need(containerId, "container_id");
  const pin = clientId === null ? null : need(clientId, "client_id");
  const src = String(source ?? "").trim().toLowerCase();
  if (!ASSIGN_SOURCES.includes(src)) {
    throw new TypeError(`source must be one of ${ASSIGN_SOURCES.join(", ")}`);
  }

  const acct = (await db.query(
    `SELECT id, client_id, entity_id, entity_kind, entity_kind_source, entity_kind_set_at
       FROM bank_accounts WHERE id = $1 AND org_id = $2`,
    [aid, orgId]
  )).rows[0];
  if (!acct) return { ok: false, reason: "account_not_found" };
  if (pin && String(acct.client_id) !== pin) return { ok: false, reason: "account_not_found" };

  const ent = (await db.query(
    `SELECT id, client_id, kind, archived_at FROM entities WHERE id = $1 AND org_id = $2`,
    [eid, orgId]
  )).rows[0];
  if (!ent) return { ok: false, reason: "container_not_found" };
  if (pin && String(ent.client_id) !== pin) return { ok: false, reason: "container_not_found" };
  if (String(ent.client_id) !== String(acct.client_id)) {
    return { ok: false, reason: "container_belongs_to_another_client" };
  }
  if (ent.archived_at) return { ok: false, reason: "container_archived" };

  /* Same kind and already sourced → keep the older basis and its date. */
  const keep = acct.entity_kind === ent.kind && acct.entity_kind_source;
  const nextSource = keep ? acct.entity_kind_source : src;
  const nextSetAt = keep ? acct.entity_kind_set_at : (at ?? new Date().toISOString());

  if (String(acct.entity_id ?? "") === String(ent.id) && keep) {
    return { ok: true, changed: false, account_id: acct.id, client_id: acct.client_id, container_id: ent.id, kind: ent.kind };
  }

  const row = (await db.query(
    `UPDATE bank_accounts
        SET entity_id = $3,
            entity_kind = $4,
            entity_kind_source = $5,
            entity_kind_set_at = $6,
            updated_at = now()
      WHERE id = $1 AND org_id = $2
      RETURNING id, client_id, entity_id, entity_kind`,
    [acct.id, orgId, ent.id, ent.kind, nextSource, nextSetAt]
  )).rows[0];
  if (!row) return { ok: false, reason: "account_not_found" };
  return { ok: true, changed: true, account_id: row.id, client_id: row.client_id, container_id: row.entity_id, kind: row.entity_kind };
}

/**
 * unassignAccount(db, { orgId, accountId }) — out of its container, back to
 * 'unknown' with provenance cleared (082: NULL source is correct for unknown).
 */
export async function unassignAccount(db, { orgId, accountId, clientId = null }) {
  if (!orgId) throw new TypeError("orgId is required");
  const aid = need(accountId, "account_id");
  const pin = clientId === null ? null : need(clientId, "client_id");
  const row = (await db.query(
    `UPDATE bank_accounts
        SET entity_id = NULL,
            entity_kind = 'unknown',
            entity_kind_source = NULL,
            entity_kind_set_at = NULL,
            updated_at = now()
      WHERE id = $1 AND org_id = $2 AND ($3::uuid IS NULL OR client_id = $3::uuid)
      RETURNING id, client_id`,
    [aid, orgId, pin]
  )).rows[0];
  if (!row) return { ok: false, reason: "account_not_found" };
  return { ok: true, account_id: row.id, client_id: row.client_id };
}

/** readPricePerContainer(env) → integer cents, or null when unset / not whole cents. */
export function readPricePerContainer(env = {}) {
  const raw = env?.[PRICE_ENV];
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * containerBilling(db, { orgId, clientId, env }) →
 *   { containers, price_per_container_cents, monthly_cents }
 *
 * containers = non-archived containers holding at least one open bank account
 * (any type) or at least one tradeline. See the header for why empty ones do
 * not count.
 */
export async function containerBilling(db, { orgId, clientId, env = {} }) {
  if (!orgId) throw new TypeError("orgId is required");
  const cid = need(clientId, "client_id");
  const r = (await db.query(
    `SELECT count(*)::int AS n
       FROM entities e
      WHERE e.org_id = $1 AND e.client_id = $2 AND e.archived_at IS NULL
        AND (
          EXISTS (SELECT 1 FROM bank_accounts ba
                   WHERE ba.entity_id = e.id AND ba.org_id = e.org_id AND ba.closed_at IS NULL)
          OR EXISTS (SELECT 1 FROM tradelines t
                   WHERE t.entity_id = e.id AND t.org_id = e.org_id)
        )`,
    [orgId, cid]
  )).rows[0];
  const count = Number(r?.n ?? 0);
  const price = readPricePerContainer(env);
  return {
    containers: count,
    price_per_container_cents: price,
    monthly_cents: price === null ? null : count * price
  };
}
