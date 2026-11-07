// Bank logos — every bank the product shows carries that bank's own logo.
//
// OWNER RULE (Chris, 2026-11-07): "MAKE SURE THE BANKS HAVE THE CORRESPONDING
// BANK LOGO WITH IT, THATS A RULE. AND THEN YEAH THATLL BE FROM PLAID."
//
// WHERE A LOGO COMES FROM, IN THIS ORDER, AND NOTHING ELSE:
//   1. Plaid's own logo for the bank (/institutions/get_by_id with optional
//      metadata), saved once per bank in plaid_institutions (migration 575).
//   2. The bank book's own file for a matching bank (lenders.logo_path,
//      migration 254 — the files in public/assets/lenders/).
//   3. null. A null logo shows the bank's name only. Nothing here draws, guesses
//      or invents a logo, and the bank book's placeholder tile is not a logo.
//
// MATCHING. By id first (the Plaid institution id on the login, the lender id on a
// bank-book row). Then by name, through bankKey(): "Bank of America" and
// "BANK OF AMERICA" are one bank. A name that points at two DIFFERENT logos (two
// banks called "First National Bank") is not a match — the logo stays null
// rather than showing one bank's logo on another bank.
//
// NOTHING HERE TRANSMITS. The one Plaid call goes through
// ./providers/plaid-http.mjs (CLAUDE.md §12). It reads public bank facts with no
// access token: no person's account is read and no money moves. Keys come from
// env the way every Plaid call here reads them, and none is logged or returned.
//
// NEVER A REASON TO FAIL A LINK. Saving a logo is a side job. Every caller in a
// link or refresh path uses saveLogoQuietly(), which reports and never throws.

import { plaidConfigFromEnv } from "./plaid.mjs";

/** The tail completeLink adds to a sandbox login's name (plaid-link.mjs). It is
 *  not part of the bank's name, so it is cut before matching or alt text. */
const SANDBOX_TAIL = /\s*\(Plaid sandbox — test data\)\s*$/;

/** A logo is re-read from Plaid at most this often per bank. */
export const LOGO_MAX_AGE_DAYS = 30;

const DAY_MS = 86_400_000;
const PNG_B64 = /^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/;
const MAX_LOGO_B64 = 400_000;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const BOOK_PATH = /^\/assets\/lenders\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|svg|jpe?g|webp)$/i;
const BOOK_PLACEHOLDER = "/assets/lenders/placeholder.svg";

/* The same rule in SQL, for the bank book's own names. Keep the two in step:
   lower case, "&" read as "and", then everything but a-z and 0-9 removed. */
const BOOK_KEY_SQL = `regexp_replace(replace(lower(name), '&', ' and '), '[^a-z0-9]+', '', 'g')`;

/** The bank's name as a person reads it: the sandbox tail cut, spaces tidied. */
export function bankName(name) {
  if (name === null || name === undefined) return null;
  const s = String(name).replace(SANDBOX_TAIL, "").replace(/\s+/g, " ").trim();
  return s || null;
}

/**
 * bankKey(name) → "bankofamerica" | null
 * Lower case, "&" as "and", everything but letters and digits removed.
 */
export function bankKey(name) {
  const n = bankName(name);
  if (!n) return null;
  const k = n.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "");
  return k ? k.slice(0, 300) : null;
}

/** Plaid's base64 PNG, or null. Anything that is not a PNG in base64 is refused. */
export function cleanLogoBase64(v) {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, "");
  return s.length >= 12 && s.length <= MAX_LOGO_B64 && PNG_B64.test(s) ? s : null;
}

/** A Plaid answer → the row this module saves. Bad values become null. */
export function cleanInstitution(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.institutionId === "string" ? raw.institutionId.trim() : "";
  if (!id || id.length > 100) return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 300) : null;
  const color = typeof raw.primaryColor === "string" && HEX.test(raw.primaryColor.trim()) ? raw.primaryColor.trim() : null;
  let url = null;
  if (typeof raw.url === "string") {
    const u = raw.url.trim();
    if (u.length <= 500 && /^https?:\/\/\S+$/i.test(u)) url = u;
  }
  return {
    institutionId: id,
    name,
    nameKey: bankKey(name),
    logoBase64: cleanLogoBase64(raw.logo),
    primaryColor: color,
    url
  };
}

/** Plaid's stored base64 → the data URI a screen can put in <img src>. */
export function logoDataUri(base64) {
  const b = cleanLogoBase64(base64);
  return b ? `data:image/png;base64,${b}` : null;
}

/** A bank-book logo path, or null. The placeholder tile is not a logo. */
export function bookLogoPath(p) {
  if (typeof p !== "string") return null;
  const s = p.trim();
  if (!s || s === BOOK_PLACEHOLDER || s.includes("..") || !BOOK_PATH.test(s)) return null;
  return s;
}

/**
 * pickLogo({ plaidLogoBase64, bookLogoPath }) → { logo, logo_source }
 * Plaid first, then the bank book, then null.
 */
export function pickLogo({ plaidLogoBase64 = null, bookLogoPath: book = null } = {}) {
  const plaid = logoDataUri(plaidLogoBase64);
  if (plaid) return { logo: plaid, logo_source: "plaid" };
  const path = bookLogoPath(book);
  if (path) return { logo: path, logo_source: "bank_book" };
  return { logo: null, logo_source: null };
}

/* One value per key, or nothing when the key points at two different values. */
function uniqueByKey(rows, keyOf, valueOf) {
  const seen = new Map();
  const clash = new Set();
  for (const r of rows) {
    const k = keyOf(r);
    const v = valueOf(r);
    if (!k || !v) continue;
    if (seen.has(k) && seen.get(k) !== v) clash.add(k);
    else seen.set(k, v);
  }
  for (const k of clash) seen.delete(k);
  return seen;
}

const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * findLogos(db, { orgId, banks }) → [{ logo, logo_source }] in the same order.
 *
 * banks: [{ institutionId?, lenderId?, name }]. Two reads at most: Plaid's saved
 * logos (by institution id or by name) and the org's bank book (by lender id or
 * by name). Never throws: a read that fails leaves the logos null, which shows
 * the name only — the honest answer when we could not look.
 */
export async function findLogos(db, { orgId, banks = [] } = {}) {
  const list = Array.isArray(banks) ? banks : [];
  const none = () => list.map(() => ({ logo: null, logo_source: null }));
  if (!list.length || !db || typeof db.query !== "function") return none();

  const insIds = [...new Set(list.map((b) => (typeof b.institutionId === "string" ? b.institutionId.trim() : "")).filter(Boolean))];
  const lenderIds = [...new Set(list.map((b) => (isUuid(b.lenderId) ? b.lenderId : null)).filter(Boolean))];
  const keys = [...new Set(list.map((b) => bankKey(b.name)).filter(Boolean))];

  let plaidRows = [];
  let bookRows = [];
  try {
    if (insIds.length || keys.length) {
      plaidRows = (await db.query(
        `SELECT plaid_institution_id, name_key, logo_base64
           FROM plaid_institutions
          WHERE logo_base64 IS NOT NULL
            AND (plaid_institution_id = ANY($1::text[]) OR name_key = ANY($2::text[]))`,
        [insIds, keys]
      )).rows || [];
    }
    if (orgId && (lenderIds.length || keys.length)) {
      bookRows = (await db.query(
        `SELECT id, ${BOOK_KEY_SQL} AS name_key, logo_path
           FROM lenders
          WHERE org_id = $1::uuid AND logo_path IS NOT NULL AND COALESCE(is_demo, false) = false
            AND (id = ANY($2::uuid[]) OR ${BOOK_KEY_SQL} = ANY($3::text[]))`,
        [orgId, lenderIds, keys]
      )).rows || [];
    }
  } catch {
    return none();
  }
  if (!Array.isArray(plaidRows)) plaidRows = [];
  if (!Array.isArray(bookRows)) bookRows = [];

  const plaidById = new Map(plaidRows.map((r) => [String(r.plaid_institution_id), r.logo_base64]));
  const plaidByKey = uniqueByKey(plaidRows, (r) => r.name_key, (r) => cleanLogoBase64(r.logo_base64));
  const bookById = new Map(bookRows.map((r) => [String(r.id), r.logo_path]));
  const bookByKey = uniqueByKey(bookRows, (r) => r.name_key, (r) => bookLogoPath(r.logo_path));

  return list.map((b) => {
    const key = bankKey(b.name);
    const insId = typeof b.institutionId === "string" ? b.institutionId.trim() : "";
    const plaid = (insId && cleanLogoBase64(plaidById.get(insId))) || (key && plaidByKey.get(key)) || null;
    const book = (isUuid(b.lenderId) && bookLogoPath(bookById.get(b.lenderId))) || (key && bookByKey.get(key)) || null;
    return pickLogo({ plaidLogoBase64: plaid, bookLogoPath: book });
  });
}

/* ── the accounts read (/api/money/accounts) ─────────────────────────────── */

const ACCOUNT_BANK_SQL = `
  SELECT ba.id AS bank_account_id, p.plaid_institution_id, p.institution_name
    FROM bank_accounts ba
    JOIN plaid_items p ON p.id = ba.plaid_item_id AND p.org_id = ba.org_id AND p.client_id = ba.client_id
   WHERE ba.org_id = $1 AND ba.client_id = $2`;

function holdingRows(h) {
  if (!h || typeof h !== "object") return [];
  return ["accounts", "cards", "loans"].flatMap((k) => (Array.isArray(h[k]) ? h[k] : []));
}

/**
 * attachAccountLogos(db, { orgId, clientId, view }) → the same view, every
 * account, card and loan carrying `institution` (the bank's name, when known),
 * `logo` and `logo_source`.
 *
 * A bank-linked row is matched by its login's Plaid institution id. A row typed
 * in by hand, or read from the credit report, is matched by its own name only
 * when that name IS a bank's name. Scoped to the org and the client.
 */
export async function attachAccountLogos(db, { orgId, clientId, view } = {}) {
  if (!view || typeof view !== "object") return view;
  const groups = [...(Array.isArray(view.containers) ? view.containers : []), view.unassigned].filter(Boolean);
  const rows = groups.flatMap(holdingRows);
  if (!rows.length) return view;

  let banks = new Map();
  try {
    if (orgId && clientId && db && typeof db.query === "function") {
      const r = await db.query(ACCOUNT_BANK_SQL, [orgId, clientId]);
      banks = new Map((Array.isArray(r && r.rows) ? r.rows : []).map((b) => [String(b.bank_account_id), b]));
    }
  } catch {
    banks = new Map();
  }

  const asks = rows.map((row) => {
    const b = row.source === "bank_account" ? banks.get(String(row.id)) : null;
    const institution = b ? bankName(b.institution_name) : null;
    return { institutionId: b ? b.plaid_institution_id : null, name: institution || row.name, institution };
  });
  const found = await findLogos(db, { orgId, banks: asks });
  const byRow = new Map(rows.map((row, i) => [row, { institution: asks[i].institution, ...found[i] }]));
  const dress = (list) => (Array.isArray(list) ? list.map((row) => (byRow.has(row) ? { ...row, ...byRow.get(row) } : row)) : list);
  const dressGroup = (g) => (g ? { ...g, accounts: dress(g.accounts), cards: dress(g.cards), loans: dress(g.loans) } : g);
  return {
    ...view,
    containers: Array.isArray(view.containers) ? view.containers.map(dressGroup) : view.containers,
    unassigned: dressGroup(view.unassigned)
  };
}

/* ── the overview read (/api/money/overview) ─────────────────────────────── */

/**
 * attachOverviewLogos(db, { orgId, clientId, payload }) → the same payload, each
 * account (payload.accounts) and each card and loan under payload.debt carrying
 * `logo` and `logo_source`. Matched like the accounts read: the login's Plaid
 * institution id first, then the account's bank name. Cards and loans take the
 * logo of the account they belong to (account_id). Scoped to the org and client.
 */
export async function attachOverviewLogos(db, { orgId, clientId, payload } = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  if (!accounts.length) return payload;

  let banks = new Map();
  try {
    if (orgId && clientId && db && typeof db.query === "function") {
      const r = await db.query(ACCOUNT_BANK_SQL, [orgId, clientId]);
      banks = new Map((Array.isArray(r && r.rows) ? r.rows : []).map((b) => [String(b.bank_account_id), b]));
    }
  } catch {
    banks = new Map();
  }

  const asks = accounts.map((a) => {
    const b = banks.get(String(a.id));
    return { institutionId: b ? b.plaid_institution_id : null, name: bankName(a.institution) || (b ? bankName(b.institution_name) : null) };
  });
  const found = await findLogos(db, { orgId, banks: asks });
  const byId = new Map(accounts.map((a, i) => [String(a.id), found[i]]));
  const none = { logo: null, logo_source: null };
  const dress = (list) => (Array.isArray(list) ? list.map((row) => ({ ...row, ...(byId.get(String(row.account_id)) || none) })) : list);
  const out = { ...payload, accounts: accounts.map((a, i) => ({ ...a, ...found[i] })) };
  if (payload.debt && typeof payload.debt === "object") {
    out.debt = { ...payload.debt, cards: dress(payload.debt.cards), loans: dress(payload.debt.loans) };
  }
  return out;
}

/* ── the credit read (/api/money/credit) ─────────────────────────────────── */

/**
 * attachCreditLogos(db, { orgId, payload }) → the same payload, each account on
 * the credit report (payload.accounts.list) carrying `logo` and `logo_source`.
 * The report names the lender only, so the match is by name: a lender whose
 * name is not a bank's own name gets no logo, never a near match.
 */
export async function attachCreditLogos(db, { orgId, payload } = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const rows = payload.accounts && Array.isArray(payload.accounts.list) ? payload.accounts.list : [];
  if (!rows.length) return payload;
  const found = await findLogos(db, { orgId, banks: rows.map((a) => ({ name: a.lender })) });
  return { ...payload, accounts: { ...payload.accounts, list: rows.map((a, i) => ({ ...a, ...found[i] })) } };
}

/* ── the banks read (/api/money/banks) ───────────────────────────────────── */

/**
 * attachBankLogos(db, { orgId, payload }) → the same payload, each recommended
 * bank, each card-stacking line and each bank relationship carrying `logo` and
 * `logo_source`. Bank-book rows are matched by their lender id, then by name.
 */
export async function attachBankLogos(db, { orgId, payload } = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const recommended = Array.isArray(payload.recommended_banks) ? payload.recommended_banks : [];
  const stacking = payload.card_stacking && Array.isArray(payload.card_stacking.items) ? payload.card_stacking.items : [];
  const rels = Array.isArray(payload.relationships) ? payload.relationships : [];
  /* The bank plan (deposit_plan, src/waypoints/blueprint-path.mjs) arrives with
     the bank book's file or null; Plaid's logo goes first here too. When this
     read finds nothing the plan keeps the book file it already had. */
  const plan = Array.isArray(payload.deposit_plan) ? payload.deposit_plan : [];
  const asks = [
    ...recommended.map((b) => ({ lenderId: b.lender_id, name: b.name })),
    ...stacking.map((s) => ({ lenderId: s.lender_id, name: s.issuer })),
    ...rels.map((r) => ({ lenderId: r.lender_id, name: r.bank })),
    ...plan.map((p) => ({ lenderId: p.lender_id, name: p.name }))
  ];
  if (!asks.length) return payload;
  const found = await findLogos(db, { orgId, banks: asks });
  let i = 0;
  const next = () => found[i++];
  const out = { ...payload };
  if (recommended.length) out.recommended_banks = recommended.map((b) => ({ ...b, ...next() }));
  if (stacking.length) out.card_stacking = { ...payload.card_stacking, items: stacking.map((s) => ({ ...s, ...next() })) };
  if (rels.length) out.relationships = rels.map((r) => ({ ...r, ...next() }));
  if (plan.length) {
    out.deposit_plan = plan.map((p) => {
      const f = next();
      const kept = bookLogoPath(p.logo);
      const logo = f.logo || kept;
      return {
        ...p,
        logo,
        logo_source: f.logo ? f.logo_source : (kept ? "bank_book" : null),
        logo_alt: logo ? (p.logo_alt || `${bankName(p.name) || "Bank"} logo`) : null
      };
    });
  }
  return out;
}

/* ── saving a bank's logo (link, refresh, backfill) ──────────────────────── */

const SAVE_SQL = `
  INSERT INTO plaid_institutions
    (plaid_institution_id, name, name_key, logo_base64, primary_color, url, logo_fetched_at, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $7::timestamptz)
  ON CONFLICT (plaid_institution_id) DO UPDATE SET
    name = COALESCE(EXCLUDED.name, plaid_institutions.name),
    name_key = COALESCE(EXCLUDED.name_key, plaid_institutions.name_key),
    logo_base64 = EXCLUDED.logo_base64,
    primary_color = EXCLUDED.primary_color,
    url = EXCLUDED.url,
    logo_fetched_at = EXCLUDED.logo_fetched_at,
    updated_at = EXCLUDED.updated_at
  RETURNING plaid_institution_id`;

/**
 * saveInstitution(db, institution, { now }) — one row per bank, upserted on the
 * Plaid institution id. A second client at the same bank updates that row; it
 * never adds a second one. A logo Plaid no longer has is stored as null.
 */
export async function saveInstitution(db, institution, { now = new Date() } = {}) {
  const inst = cleanInstitution(institution);
  if (!inst) return { ok: false, reason: "bad_institution" };
  await db.query(SAVE_SQL, [
    inst.institutionId, inst.name, inst.nameKey, inst.logoBase64, inst.primaryColor, inst.url,
    new Date(now).toISOString()
  ]);
  return { ok: true, institutionId: inst.institutionId, hasLogo: inst.logoBase64 !== null };
}

/**
 * refreshInstitutionLogo(db, { institutionId, env, fetchImpl, now, force, maxAgeDays, read })
 *   → { ok, reason, saved, skipped, hasLogo, errorCode }
 *
 * Asks Plaid for one bank's logo and saves it — unless that bank was asked
 * within maxAgeDays (then skipped, no call). `read` is the Plaid call
 * (getInstitutionById), injectable for tests.
 */
export async function refreshInstitutionLogo(db, {
  institutionId, env = process.env, fetchImpl = undefined, now = new Date(),
  force = false, maxAgeDays = LOGO_MAX_AGE_DAYS, read = null
} = {}) {
  const id = typeof institutionId === "string" ? institutionId.trim() : "";
  if (!id || id.length > 100) return { ok: false, reason: "no_institution_id", saved: false, skipped: false };
  const cfg = plaidConfigFromEnv(env);
  if (!cfg.ready) return { ok: false, reason: "not_configured", saved: false, skipped: false };

  if (!force) {
    const had = (await db.query(
      `SELECT logo_fetched_at FROM plaid_institutions WHERE plaid_institution_id = $1`, [id]
    )).rows?.[0];
    const at = had && had.logo_fetched_at ? Date.parse(had.logo_fetched_at) : NaN;
    if (Number.isFinite(at) && new Date(now).getTime() - at < maxAgeDays * DAY_MS) {
      return { ok: true, reason: "fresh", saved: false, skipped: true };
    }
  }

  const call = read || (await import("./providers/plaid-http.mjs")).getInstitutionById;
  const r = await call(id, {}, {
    environment: cfg.environment, clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET,
    env, fetchImpl, timeoutMs: 8_000
  });
  if (!r || !r.ok) {
    return {
      ok: false, reason: r && r.blocked ? "held" : "upstream_error", saved: false, skipped: false,
      errorCode: (r && (r.errorCode || r.errorType)) || null
    };
  }
  const saved = await saveInstitution(db, r.institution, { now });
  if (!saved.ok) return { ok: false, reason: saved.reason, saved: false, skipped: false };
  return { ok: true, reason: null, saved: true, skipped: false, hasLogo: saved.hasLogo };
}

/**
 * saveLogoQuietly — the link and refresh paths' call. Same as
 * refreshInstitutionLogo, but it never throws: a logo is never a reason for a
 * bank link or a balance refresh to fail.
 */
export async function saveLogoQuietly(db, opts = {}) {
  try {
    return await refreshInstitutionLogo(db, opts);
  } catch {
    return { ok: false, reason: "failed", saved: false, skipped: false };
  }
}

/**
 * backfillInstitutionLogos(db, { env, fetchImpl, confirm, force, limit, now, read })
 *
 * For banks linked before plaid_institutions existed. Reads every distinct Plaid
 * institution id on plaid_items. Without `confirm` it only lists them: no Plaid
 * call, no write. With `confirm` it asks Plaid for each (skipping banks asked
 * within the month unless `force`) and writes ONLY plaid_institutions.
 */
export async function backfillInstitutionLogos(db, {
  env = process.env, fetchImpl = undefined, confirm = false, force = false,
  limit = 500, now = new Date(), read = null
} = {}) {
  const bounded = Math.max(1, Math.min(Number(limit) || 500, 5000));
  const ids = (await db.query(
    `SELECT DISTINCT btrim(plaid_institution_id) AS plaid_institution_id
       FROM plaid_items
      WHERE plaid_institution_id IS NOT NULL AND btrim(plaid_institution_id) <> ''
      ORDER BY 1
      LIMIT $1`,
    [bounded]
  )).rows.map((r) => r.plaid_institution_id);

  const report = { confirm: !!confirm, institutions: ids.length, saved: 0, withLogo: 0, skipped: 0, failed: [] };
  if (!confirm) return { ...report, ids };
  for (const id of ids) {
    const r = await saveLogoQuietly(db, { institutionId: id, env, fetchImpl, now, force, read });
    if (r.saved) { report.saved += 1; if (r.hasLogo) report.withLogo += 1; }
    else if (r.skipped) report.skipped += 1;
    else report.failed.push({ institutionId: id, reason: r.reason, errorCode: r.errorCode ?? null });
  }
  return report;
}

export default {
  LOGO_MAX_AGE_DAYS, bankName, bankKey, cleanLogoBase64, cleanInstitution, logoDataUri, bookLogoPath, pickLogo,
  findLogos, attachAccountLogos, attachOverviewLogos, attachCreditLogos, attachBankLogos, saveInstitution, refreshInstitutionLogo, saveLogoQuietly,
  backfillInstitutionLogos
};
