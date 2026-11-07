// Business gas and fuel cards — business primaries, listed under each business
// on the Accounts tab, from the bank book only. Finance OS wave 4, unit GAS
// (ops/workflows/finance-os-wave4-brief.txt).
//
// THE LIST. business_fuel_cards (migration 587): a staff-set list of bank-book
// rows (`lenders`). A card that is not in the bank book cannot be listed, and
// nothing is guessed from a merchant name here. On 2026-11-07 the lenders data
// held one gas-brand card, CHEVRON; 587 lists it where that row exists. Every
// field shown comes from the lenders row: its name, its logo file (the bank
// book's logo_path — never drawn), its own apply link and the states it names.
//
// TRACK IT LIKE OTHER CARDS. "Track it" adds the card to that business as an
// ordinary hand-entered credit card with its due day — the same writer the
// "Add account" form uses (src/finance/money-accounts.mjs addHandAccount) — and
// records which list card it is (business_fuel_card_accounts). A card with a
// due day gets the same phone alerts and texts as every other card. Both writes
// run in one transaction.
//
// THE RISK LINE travels with every listed card, word for word:
//   "Miss a payment and it hurts your business credit."
//
// UNKNOWN IS NULL. A list card the business's state cannot get (the bank book
// names states and the business's state is not one of them) is left out for
// that business; an unknown state never hides a card. org_id and client_id are
// bound on every client statement; the list itself is the org's own.

import { readHandAccount as defaultReadHand, addHandAccount as defaultAddHand } from "./money-accounts.mjs";
import { listBusinessInfo as defaultBusinessInfo } from "./business-info.mjs";
import { withTransaction as defaultTransaction } from "../db/with-transaction.mjs";

export const RISK_LINE = "Miss a payment and it hurts your business credit.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE = /^[A-Z]{2}$/;
export const isUuid = (v) => typeof v === "string" && UUID.test(v.trim());
const text = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const list = (v) => (Array.isArray(v) ? v : []);

/** The bank book's logo file, or null (name only). Never a drawn mark. */
export function bookLogo(path) {
  const p = text(path);
  return p && /^\/assets\/lenders\/[a-z0-9._-]+\.(png|svg|webp|jpg|jpeg)$/i.test(p) ? p : null;
}

/** A link a person can open: https only, or null. */
export function safeLink(url) {
  const s = text(url);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * statesOf(eligible_states) → null (every state, or not stated) or a Set of
 * two-letter codes. "All States", blank, or anything unreadable is null.
 */
export function statesOf(raw) {
  const s = text(raw);
  if (!s || /all\s*states/i.test(s)) return null;
  const codes = s.toUpperCase().split(/[\s,;/|]+/).map((x) => x.trim()).filter(Boolean);
  if (!codes.length || !codes.every((c) => STATE.test(c))) return null;
  return new Set(codes);
}

/** One list row (joined to its lender) → what the card shows. PURE. */
export function cardView(row) {
  const name = text(row.product_name) ? `${text(row.name)} ${text(row.product_name)}` : text(row.name);
  return {
    id: String(row.id),
    lender_id: String(row.lender_id),
    name,
    logo: bookLogo(row.logo_path),
    apply_url: safeLink(row.application_url),
    business_bureaus: text(row.business_bureau_pulled),
    states: text(row.eligible_states),
    risk: RISK_LINE
  };
}

/**
 * buildFuelCards({ cards, tracked, businesses, viewer }) → the block the
 * Accounts tab draws. PURE.
 *
 * cards       business_fuel_cards rows joined to lenders (active only)
 * tracked     business_fuel_card_accounts rows joined to the open card
 * businesses  { container_id, state } for each open business container
 */
export function buildFuelCards({ cards = [], tracked = [], businesses = [], viewer = "client" } = {}) {
  const views = list(cards).filter((c) => c && c.id && c.lender_id && text(c.name)).map(cardView)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const byKey = new Map(list(tracked).map((t) => [`${t.entity_id} ${t.fuel_card_id}`, t]));
  const per = {};
  for (const b of list(businesses)) {
    if (!b || !b.container_id) continue;
    const st = text(b.state) ? String(b.state).trim().toUpperCase() : null;
    per[b.container_id] = views
      .filter((c) => {
        const allowed = statesOf(c.states);
        return !allowed || !st || allowed.has(st);
      })
      .map((c) => {
        const t = byKey.get(`${b.container_id} ${c.id}`);
        return {
          ...c,
          tracked: t ? {
            bank_account_id: String(t.bank_account_id),
            name: text(t.account_name),
            mask: text(t.mask),
            due_day: Number.isInteger(t.payment_due_day) ? t.payment_due_day : null
          } : null
        };
      });
  }
  return { ok: true, viewer: viewer === "staff" ? "staff" : "client", risk: RISK_LINE, count: views.length, by_business: per };
}

/* ── the reads ───────────────────────────────────────────────────────────── */

const CARDS_SQL = `
  SELECT f.id::text AS id, f.lender_id::text AS lender_id, l.name, l.product_name, l.logo_path,
         l.application_url, l.business_bureau_pulled, l.eligible_states
    FROM business_fuel_cards f
    JOIN lenders l ON l.id = f.lender_id AND l.org_id = f.org_id
   WHERE f.org_id = $1 AND f.active
   ORDER BY l.name ASC, f.id ASC
   LIMIT 50`;

const TRACKED_SQL = `
  SELECT t.fuel_card_id::text AS fuel_card_id, t.bank_account_id::text AS bank_account_id,
         t.entity_id::text AS entity_id, a.name AS account_name, a.mask,
         (SELECT s.payment_due_day FROM account_statement_cycles s
           WHERE s.bank_account_id = a.id AND s.org_id = a.org_id
           ORDER BY s.updated_at DESC NULLS LAST LIMIT 1) AS payment_due_day
    FROM business_fuel_card_accounts t
    JOIN bank_accounts a ON a.id = t.bank_account_id AND a.org_id = t.org_id AND a.closed_at IS NULL
   WHERE t.org_id = $1 AND t.client_id = $2`;

/* The client's open business containers. Each one's state comes from its saved
   business info (listBusinessInfo, src/finance/business-info.mjs). */
const BUSINESSES_SQL = `
  SELECT e.id::text AS container_id
    FROM entities e
   WHERE e.org_id = $1 AND e.client_id = $2 AND e.kind = 'business' AND e.archived_at IS NULL`;

/**
 * readFuelCards(db, { orgId, clientId, viewer }) → buildFuelCards()'s block,
 * or { ok: false, reason } when a read failed. Never throws: the rest of the
 * Accounts tab still loads.
 */
export async function readFuelCards(db, { orgId, clientId, viewer = "client", deps = {} } = {}) {
  if (!orgId || !clientId) throw new TypeError("readFuelCards: orgId and clientId are required");
  const businessInfo = deps.listBusinessInfo || defaultBusinessInfo;
  try {
    const cards = await db.query(CARDS_SQL, [orgId]);
    if (!(cards.rows || []).length) return buildFuelCards({ viewer });
    const [tracked, containers, infos] = await Promise.all([
      db.query(TRACKED_SQL, [orgId, clientId]),
      db.query(BUSINESSES_SQL, [orgId, clientId]),
      businessInfo(db, { orgId, clientId })
    ]);
    const businesses = (containers.rows || []).map((c) => {
      const info = (infos && typeof infos.get === "function" && infos.get(String(c.container_id))) || {};
      return { container_id: String(c.container_id), state: text(info.state) || text(info.formation_state) };
    });
    return buildFuelCards({ cards: cards.rows, tracked: tracked.rows || [], businesses, viewer });
  } catch {
    return { ok: false, reason: "read_failed" };
  }
}

/**
 * trackFuelCard(db, { orgId, clientId, fuelCardId, containerId, input, by })
 *   → { ok: true, account_id } | { ok: false, reason } ; throws TypeError on a
 *   bad field (the handler answers 400 with its words).
 *
 * The card must be on the org's list, the container one of this client's open
 * businesses, and not already tracked there. The account is the list card's own
 * name; the due day is required, because without it there is nothing to alert.
 */
export async function trackFuelCard(db, {
  orgId, clientId, fuelCardId, containerId, input = {}, by = {}, deps = {}
} = {}) {
  if (!orgId || !clientId) throw new TypeError("trackFuelCard: orgId and clientId are required");
  if (!isUuid(fuelCardId)) return { ok: false, reason: "fuel_card_not_found" };
  if (!isUuid(containerId)) return { ok: false, reason: "container_not_found" };
  const readHand = deps.readHandAccount || defaultReadHand;
  const addHand = deps.addHandAccount || defaultAddHand;
  const transaction = deps.withTransaction || defaultTransaction;

  const card = (await db.query(
    `SELECT f.id::text AS id, l.name, l.product_name
       FROM business_fuel_cards f
       JOIN lenders l ON l.id = f.lender_id AND l.org_id = f.org_id
      WHERE f.org_id = $1 AND f.id = $2::uuid AND f.active`,
    [orgId, fuelCardId]
  )).rows[0];
  if (!card) return { ok: false, reason: "fuel_card_not_found" };

  const ent = (await db.query(
    `SELECT id, kind, archived_at FROM entities WHERE id = $1::uuid AND org_id = $2 AND client_id = $3`,
    [containerId, orgId, clientId]
  )).rows[0];
  if (!ent) return { ok: false, reason: "container_not_found" };
  if (ent.archived_at) return { ok: false, reason: "container_archived" };
  if (ent.kind !== "business") return { ok: false, reason: "not_a_business_container" };

  const already = (await db.query(
    `SELECT t.id FROM business_fuel_card_accounts t
       JOIN bank_accounts a ON a.id = t.bank_account_id AND a.org_id = t.org_id AND a.closed_at IS NULL
      WHERE t.org_id = $1 AND t.client_id = $2 AND t.fuel_card_id = $3::uuid AND t.entity_id = $4::uuid
      LIMIT 1`,
    [orgId, clientId, fuelCardId, containerId]
  )).rows[0];
  if (already) return { ok: false, reason: "already_tracked" };

  const name = text(card.product_name) ? `${text(card.name)} ${text(card.product_name)}` : text(card.name);
  const parsed = readHand({
    name, type: "credit_card", last4: input.last4, limit: input.limit, due_day: input.due_day, container_id: containerId
  });
  if (parsed.dueDay === null) throw new TypeError("due day is required — the day of the month this card is due, 1 to 31");

  return transaction(db, async (tx) => {
    const r = await addHand(tx, { orgId, clientId, input: parsed, by });
    if (!r || !r.ok) return r || { ok: false, reason: "not_saved" };
    await tx.query(
      `INSERT INTO business_fuel_card_accounts (org_id, client_id, fuel_card_id, bank_account_id, entity_id)
       VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid)`,
      [orgId, clientId, fuelCardId, String(r.account_id), containerId]
    );
    return { ok: true, account_id: String(r.account_id) };
  });
}

/**
 * setFuelCard(db, { orgId, lenderId, active, staffId }) → { ok, card } |
 * { ok: false, reason }. STAFF ONLY (the handler checks). Puts a bank-book row
 * on the gas card list, or takes it off (active false). Never deletes a row and
 * never adds a card that is not in the bank book.
 */
export async function setFuelCard(db, { orgId, lenderId, active = true, staffId = null, note = null } = {}) {
  if (!orgId) throw new TypeError("setFuelCard: orgId is required");
  if (!isUuid(lenderId)) return { ok: false, reason: "lender_not_found" };
  const lender = (await db.query(`SELECT id FROM lenders WHERE id = $1::uuid AND org_id = $2`, [lenderId, orgId])).rows[0];
  if (!lender) return { ok: false, reason: "lender_not_found" };
  const r = await db.query(
    `INSERT INTO business_fuel_cards (org_id, lender_id, active, set_by, set_by_staff_id, note)
     VALUES ($1, $2::uuid, $3, 'staff', $4, $5)
     ON CONFLICT (org_id, lender_id)
     DO UPDATE SET active = EXCLUDED.active, set_by = 'staff', set_by_staff_id = EXCLUDED.set_by_staff_id,
                   note = COALESCE(EXCLUDED.note, business_fuel_cards.note), set_at = now()
     RETURNING id::text AS id, lender_id::text AS lender_id, active`,
    [orgId, lenderId, active !== false, isUuid(String(staffId || "")) ? staffId : null, text(note) ? String(note).trim().slice(0, 500) : null]
  );
  return { ok: true, card: r.rows[0] || null };
}

export default { readFuelCards, trackFuelCard, setFuelCard, buildFuelCards, cardView, statesOf, RISK_LINE };
