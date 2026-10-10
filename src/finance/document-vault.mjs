// The application document vault — what is on file, what is missing, and
// whether the file is complete. Capital Blueprint unit B3.
//
// Offer line: "The agent collects bank statements, tax returns and ID ahead of
// time, so the file is complete when the closer calls."
//
// WHAT THIS FILE IS. The list of papers lives in document-vault-items.mjs (each
// with its source). The uploads live in the documents registry
// (src/documents/, client_upload). This file puts the two side by side and says,
// for every line, one of:
//
//   missing    nothing usable on file (or fewer than the line needs)
//   uploaded   a file came in and nobody has accepted it yet — needs review
//   accepted   enough accepted, current files
//   expired    accepted files are on file but too old (statements, good standing)
//   rejected   a file came in and a person said no (reason attached); nothing else
//   waived     staff said this line does not apply to this client or business
//
// THE FILE TYPE DECIDES THE LINE, NEVER THE FILE NAME. A document counts toward a
// line through its registry `subtype`, or through a person filing it there
// (document_vault_reviews.item_key). measured on the Blueprint sim client
// (2026-10-06): a file named proof-of-address-1.png sits on the record labelled
// dispute_mail_receipt. It is a mailing proof as far as the vault is concerned.
//
// WHO ACCEPTS. A person, in the vault (POST /api/money/vault, action accept). The
// one exception is the identity pair: when the document reader (DOC-CHECK, the
// agent behind src/handlers/doc-check.mjs) accepted a government ID or a proof of
// address, it recorded which document proved the name, date of birth and address
// (pii_identity.verified_field_sources). That is the existing accept, so the vault
// reads it instead of asking a person to approve the same ID twice.
//
// "COMPLETE" MEANS EVERY LINE IS ACCEPTED OR WAIVED. Not "a file was uploaded":
// the closer reads this, and an unreviewed file proves nothing yet.
//
// PER BUSINESS. Business lines repeat once per business container (an `entities`
// row of kind 'business', src/finance/containers.mjs). A client with no container
// but a `businesses` row (the $297 pull form) gets ONE business scope, so a file
// with a business on it cannot read "complete" with no business papers. A client
// with neither has personal lines only: personal-only funding is a real path.
//
// NOTHING HERE SENDS ANYTHING. The ask is document-vault-chase.mjs.

import {
  STANDARD_ITEMS, SCOPE, VAULT_DOCUMENT_KINDS, IGNORED_SUBTYPES,
  vaultSettings, expiryFor
} from "./document-vault-items.mjs";
import { signDocumentUrl } from "../documents/signed-url.mjs";
import { SUBTYPES } from "../documents/kinds.mjs";

export const ITEM_STATUS = Object.freeze({
  MISSING: "missing",
  UPLOADED: "uploaded",
  ACCEPTED: "accepted",
  EXPIRED: "expired",
  REJECTED: "rejected",
  WAIVED: "waived"
});

/** What counts as "done" for the closer. */
export const DONE_STATUSES = Object.freeze([ITEM_STATUS.ACCEPTED, ITEM_STATUS.WAIVED]);

export const UPLOAD_ENDPOINT = "/api/documents-upload";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID_RE.test(v.trim());
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/* ───────────────────────────── dates ───────────────────────────── */

function parseIso(iso) {
  const m = ISO_DATE_RE.exec(String(iso ?? ""));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, mo, d };
}

const pad = (n, w = 2) => String(n).padStart(w, "0");
const isoParts = ({ y, mo, d }) => `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;

/** 'YYYY-MM-DD' (UTC) of a Date, an ISO string, or null. */
export function isoDay(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDaysIso(iso, days) {
  const p = parseIso(iso);
  if (!p) return null;
  return isoDay(new Date(Date.UTC(p.y, p.mo - 1, p.d + days)));
}

/** Add whole months, keeping the day of the month, or the last day when it is shorter. */
export function addMonthsIso(iso, months) {
  const p = parseIso(iso);
  if (!p) return null;
  const total = p.y * 12 + (p.mo - 1) + months;
  const y = Math.floor(total / 12);
  const mo = (total % 12) + 1;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return isoParts({ y, mo, d: Math.min(p.d, last) });
}

/** The last day a document still counts, given when its clock started and the rule. */
export function validThrough(anchorIso, rule) {
  if (!rule || !parseIso(anchorIso)) return null;
  return rule.kind === "months" ? addMonthsIso(anchorIso, rule.value) : addDaysIso(anchorIso, rule.value);
}

/* ───────────────────────────── scopes and slots ───────────────────────────── */

const CLIENT_SCOPE = Object.freeze({ kind: SCOPE.CLIENT, id: null, name: null });

/**
 * buildScopes — the businesses a business line repeats for.
 *   containers      business containers: [{ id, name }]
 *   hasBusinessRow  the client has a `businesses` row (the $297 form) but no container
 *   businessRowName the name on that row, when there is exactly one
 */
export function buildScopes({ containers = [], hasBusinessRow = false, businessRowName = null } = {}) {
  const live = (Array.isArray(containers) ? containers : []).filter((c) => c && isUuid(String(c.id)));
  if (live.length) {
    return live.map((c) => ({ kind: SCOPE.BUSINESS, id: String(c.id), name: c.name ? String(c.name) : null }));
  }
  if (hasBusinessRow) {
    return [{ kind: SCOPE.BUSINESS, id: null, name: businessRowName ? String(businessRowName) : null }];
  }
  return [];
}

const slotId = (key, scope) => `${key}:${scope.kind === SCOPE.CLIENT ? "client" : (scope.id || "business")}`;

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * buildSlots — every line this client owes, standard first, then staff-added.
 * `waivers` and `customItems` are document_vault_items rows.
 */
export function buildSlots({ scopes = [], customItems = [], waivers = [], env = process.env } = {}) {
  const waiverFor = new Map();
  for (const w of waivers) {
    waiverFor.set(`${w.item_key}|${w.entity_id || ""}`, w);
  }
  const businessScopes = scopes.filter((s) => s.kind === SCOPE.BUSINESS);
  const slots = [];

  const push = (def, scope, extra = {}) => {
    const waiver = waiverFor.get(`${def.key}|${scope.id || ""}`) || null;
    slots.push({
      slot: slotId(def.key, scope),
      key: def.key,
      scope,
      priority: def.priority,
      title: def.title,
      ask: def.ask,
      why: def.why,
      subtypes: def.subtypes,
      need: def.need,
      unit: def.unit,
      expiry: expiryFor(def, env),
      doc_check: def.docCheck === true,
      sources: def.sources,
      custom: false,
      custom_id: null,
      waiver,
      ...extra
    });
  };

  for (const def of STANDARD_ITEMS) {
    if (def.scope === SCOPE.CLIENT) push(def, CLIENT_SCOPE);
    else for (const scope of businessScopes) push(def, scope);
  }

  customItems.forEach((it, i) => {
    const scope = it.entity_id
      ? businessScopes.find((s) => s.id === String(it.entity_id))
      : CLIENT_SCOPE;
    if (!scope) return; // its business container was archived
    push({
      key: it.item_key,
      priority: 1000 + i,
      title: it.title,
      ask: `your ${lowerFirst(String(it.title || "").trim())}`,
      why: it.note || null,
      subtypes: it.subtype ? Object.freeze([it.subtype]) : Object.freeze([]),
      need: Number(it.need) > 0 ? Number(it.need) : 1,
      unit: "file",
      expires: null,
      docCheck: false,
      sources: Object.freeze([{ ref: "staff", note: "Added by staff for this client.", local: false }])
    }, scope, { custom: true, custom_id: it.id || null });
  });

  return slots;
}

/* ───────────────────────────── documents → lines ───────────────────────────── */

/** Does a document that carries `docEntity` belong to this slot's scope? */
function scopeAccepts(scope, docEntity, businessCount) {
  if (scope.kind === SCOPE.CLIENT) return !docEntity;
  if (docEntity) return scope.id === String(docEntity);
  return businessCount === 1; // one business: an unlabelled business paper is that business's
}

function docEntityOf(doc, review) {
  const meta = doc && doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {};
  const v = (review && review.entity_id) || meta.entity_id || null;
  return v ? String(v) : null;
}

/** Which slots a document counts toward. Pure. */
export function slotsForDocument(doc, review, slots, businessCount) {
  const docEntity = docEntityOf(doc, review);
  const out = [];
  for (const slot of slots) {
    if (review && review.item_key) {
      if (slot.key !== review.item_key) continue;
    } else if (!slot.subtypes.includes(doc.subtype)) {
      continue;
    }
    if (!scopeAccepts(slot.scope, docEntity, businessCount)) continue;
    out.push(slot);
  }
  return out;
}

function filenameOf(doc) {
  const meta = doc && doc.metadata && typeof doc.metadata === "object" ? doc.metadata : {};
  return meta.original_filename || null;
}

function docStatusFor(doc, review, slot, docCheckIds) {
  if (review) {
    return {
      status: review.status === "rejected" ? ITEM_STATUS.REJECTED : ITEM_STATUS.ACCEPTED,
      accepted_by: review.status === "accepted" ? "staff" : null
    };
  }
  if (slot.doc_check && docCheckIds && docCheckIds.has(String(doc.id))) {
    return { status: ITEM_STATUS.ACCEPTED, accepted_by: "doc-check" };
  }
  return { status: ITEM_STATUS.UPLOADED, accepted_by: null };
}

/* ───────────────────────────── the whole vault ───────────────────────────── */

const scopeSuffix = (slot) => (slot.scope.kind === SCOPE.BUSINESS && slot.scope.name ? ` — ${slot.scope.name}` : "");

/** One line of plain words for a slot, scope included. */
export function slotLabel(slot) {
  return `${slot.title}${scopeSuffix(slot)}`;
}

/** What the person is asked for, with the business named when there is one. */
export function askText(slot) {
  const named = slot.scope.kind === SCOPE.BUSINESS && slot.scope.name ? ` for ${slot.scope.name}` : "";
  return `${slot.ask}${named}`;
}

function statusDetail(s) {
  switch (s.status) {
    case ITEM_STATUS.UPLOADED: return "sent, waiting for review";
    case ITEM_STATUS.EXPIRED: return "out of date, needs a new copy";
    case ITEM_STATUS.REJECTED: return "rejected, needs a new copy";
    default: return s.have > 0 ? `${s.have} of ${s.need} accepted` : "not sent";
  }
}

/**
 * buildVault — the pure core. No database, no clock but `now`.
 *
 * facts: { scopes, customItems, waivers, documents, reviews (Map document_id → review),
 *          docCheckDocIds (Set), now, env }
 */
export function buildVault({
  scopes = [], customItems = [], waivers = [], documents = [], reviews = new Map(),
  docCheckDocIds = new Set(), now = new Date(), env = process.env
} = {}) {
  const today = isoDay(now);
  const slots = buildSlots({ scopes, customItems, waivers, env });
  const businessCount = scopes.filter((s) => s.kind === SCOPE.BUSINESS).length;
  // Every subtype the vault has a line for — from the catalog, not from the slots
  // built today, so a business paper uploaded before any business exists is still
  // reported ("no business yet") instead of vanishing.
  const known = new Set(["other", ""]);
  for (const def of STANDARD_ITEMS) for (const t of def.subtypes) known.add(t);
  for (const it of customItems) if (it.subtype) known.add(it.subtype);

  const byslot = new Map(slots.map((s) => [s.slot, []]));
  const unfiled = [];

  for (const doc of documents) {
    if (!doc || !VAULT_DOCUMENT_KINDS.includes(doc.kind)) continue;
    const review = reviews instanceof Map ? reviews.get(String(doc.id)) : null;
    const hits = slotsForDocument(doc, review, slots, businessCount);
    if (hits.length) {
      for (const slot of hits) byslot.get(slot.slot).push({ doc, review, slot });
      continue;
    }
    const subtype = String(doc.subtype || "");
    if (IGNORED_SUBTYPES.includes(subtype)) continue;
    const docEntity = docEntityOf(doc, review);
    let reason = null;
    if (docEntity && !scopes.some((s) => s.id === docEntity)) reason = "unknown_business";
    else if (subtype === "other" || subtype === "") reason = "no_label";
    else if (!known.has(subtype) && !review) continue; // a paper the vault has no line for (pay stubs, etc.)
    else if (businessCount > 1 && !docEntity) reason = "choose_business";
    else if (businessCount === 0) reason = "no_business";
    else reason = "no_line";
    unfiled.push({
      id: String(doc.id),
      title: doc.title || null,
      subtype: subtype || null,
      filename: filenameOf(doc),
      uploaded_at: doc.generated_at ? new Date(doc.generated_at).toISOString() : null,
      reason
    });
  }

  const out = slots.map((slot) => {
    const entries = byslot.get(slot.slot);
    let have = 0;
    let expiredHave = 0;
    let pending = 0;
    let rejected = 0;
    const documents = entries.map(({ doc, review, slot: s }) => {
      const verdict = docStatusFor(doc, review, s, docCheckDocIds);
      const covers = review && review.status === "accepted" && Number(review.covers) > 0 ? Number(review.covers) : 1;
      const periodEnd = review && review.period_end ? String(review.period_end).slice(0, 10) : null;
      const anchor = periodEnd || isoDay(doc.generated_at);
      const through = s.expiry ? validThrough(anchor, s.expiry) : null;
      let expired = !!(through && today && today > through);
      if (!expired && doc.expires_at) expired = new Date(doc.expires_at).getTime() <= new Date(now).getTime();
      if (verdict.status === ITEM_STATUS.ACCEPTED) {
        if (expired) expiredHave += covers; else have += covers;
      } else if (verdict.status === ITEM_STATUS.UPLOADED) {
        pending += 1;
      } else {
        rejected += 1;
      }
      return {
        id: String(doc.id),
        title: doc.title || null,
        subtype: doc.subtype || null,
        filename: filenameOf(doc),
        uploaded_at: doc.generated_at ? new Date(doc.generated_at).toISOString() : null,
        status: verdict.status,
        accepted_by: verdict.accepted_by,
        covers: verdict.status === ITEM_STATUS.ACCEPTED ? covers : null,
        period_end: periodEnd,
        reason: review && review.status === "rejected" ? (review.reason || null) : null,
        reviewed_at: review && review.reviewed_at ? new Date(review.reviewed_at).toISOString() : null,
        reviewed_by: review ? (review.reviewed_by_name || null) : null,
        expired: verdict.status === ITEM_STATUS.ACCEPTED ? expired : false,
        // A rejected file counts toward nothing, so it has no "good until" date.
        valid_through: verdict.status === ITEM_STATUS.REJECTED ? null : through
      };
    });
    documents.sort((a, b) => String(a.uploaded_at).localeCompare(String(b.uploaded_at)));

    let status;
    if (slot.waiver) status = ITEM_STATUS.WAIVED;
    else if (have >= slot.need) status = ITEM_STATUS.ACCEPTED;
    else if (pending > 0) status = ITEM_STATUS.UPLOADED;
    else if (expiredHave > 0) status = ITEM_STATUS.EXPIRED;
    else if (rejected > 0 && have === 0) status = ITEM_STATUS.REJECTED;
    else status = ITEM_STATUS.MISSING;

    const waitingOn = DONE_STATUSES.includes(status) ? null : (status === ITEM_STATUS.UPLOADED ? "staff" : "client");
    // The newest thing that happened on this line. The chase reads it: a file that
    // arrived after the last ask answers that ask and starts a fresh count.
    const lastActivity = documents.reduce((m, d) => (d.uploaded_at && (!m || d.uploaded_at > m) ? d.uploaded_at : m), null);
    return {
      slot: slot.slot,
      key: slot.key,
      scope: slot.scope,
      priority: slot.priority,
      title: slot.title,
      ask: slot.ask,
      ask_text: askText(slot),
      label: slotLabel(slot),
      why: slot.why,
      custom: slot.custom,
      custom_id: slot.custom_id,
      subtypes: slot.subtypes,
      need: slot.need,
      unit: slot.unit,
      have,
      pending,
      expired_have: expiredHave,
      rejected,
      status,
      waiting_on: waitingOn,
      detail: statusDetail({ status, have, need: slot.need }),
      expires: slot.expiry,
      waived: slot.waiver
        ? { reason: slot.waiver.note || null, at: slot.waiver.created_at ? new Date(slot.waiver.created_at).toISOString() : null }
        : null,
      last_activity_at: lastActivity,
      sources: slot.sources,
      documents
    };
  });

  const summary = { required: out.length, accepted: 0, waived: 0, uploaded: 0, missing: 0, expired: 0, rejected: 0 };
  for (const s of out) summary[s.status] += 1;
  const open = out.filter((s) => !DONE_STATUSES.includes(s.status));

  return {
    complete: open.length === 0,
    summary,
    scopes,
    items: out,
    unfiled,
    missing: open.map((s) => ({
      slot: s.slot, key: s.key, title: s.title, label: s.label, scope: s.scope,
      status: s.status, have: s.have, need: s.need, waiting_on: s.waiting_on, detail: s.detail
    }))
  };
}

/**
 * vaultLine — one plain sentence for a task note. The closer reads this at ready
 * time. "N of M" counts lines, and waived lines count as done.
 */
export function vaultLine(result, { max = 6 } = {}) {
  if (!result || result.complete === null || result.complete === undefined) {
    return "Document vault: could not be checked just now. Open the client's vault.";
  }
  const s = result.summary || {};
  const required = Number(s.required || 0);
  const done = Number(s.accepted || 0) + Number(s.waived || 0);
  if (result.complete) {
    const waived = Number(s.waived || 0);
    return `Document vault: file complete — ${required} of ${required} items accepted${waived ? ` (${waived} waived by staff)` : ""}.`;
  }
  const open = (result.missing || []).slice(0, max).map((m) => `${m.label} (${m.detail})`);
  const more = (result.missing || []).length - open.length;
  return `Document vault: ${done} of ${required} items done. Still open: ${open.join("; ")}${more > 0 ? `; and ${more} more` : ""}.`;
}

/* ───────────────────────────── reading from the database ───────────────────────────── */

/** The document ids the document reader accepted for the identity pair. */
export function docCheckDocumentIds(verifiedFieldSources) {
  const out = new Set();
  const src = verifiedFieldSources && typeof verifiedFieldSources === "object" ? verifiedFieldSources : {};
  for (const v of Object.values(src)) {
    if (v && typeof v === "object" && isUuid(String(v.document_id || ""))) out.add(String(v.document_id));
  }
  return out;
}

/**
 * loadVaultFacts — every read the vault needs for one client, in one pass.
 * Returns null when the client is not in this org.
 */
export async function loadVaultFacts(db, { orgId, clientId }) {
  if (!orgId) throw new TypeError("orgId is required");
  if (!isUuid(clientId)) throw new TypeError("client_id must be a uuid");
  const cid = String(clientId).trim();

  const client = (await db.query(
    `SELECT id, first_name, last_name FROM clients WHERE id = $1 AND org_id = $2`, [cid, orgId]
  )).rows[0];
  if (!client) return null;

  const [containers, businessRows, documents, reviews, items, ident] = await Promise.all([
    db.query(
      `SELECT id, name FROM entities
        WHERE org_id = $1 AND client_id = $2 AND kind = 'business' AND archived_at IS NULL
        ORDER BY created_at, id`, [orgId, cid]),
    db.query(
      `SELECT name FROM businesses WHERE org_id = $1 AND client_id = $2 ORDER BY created_at, id LIMIT 5`,
      [orgId, cid]),
    db.query(
      `SELECT id, kind, subtype, title, mime_type, generated_at, expires_at, current_version_id, metadata
         FROM documents
        WHERE org_id = $1 AND client_id = $2 AND kind = ANY($3::text[])
        ORDER BY generated_at, id`, [orgId, cid, [...VAULT_DOCUMENT_KINDS]]),
    db.query(
      `SELECT r.document_id, r.status, r.item_key, r.entity_id, r.covers, r.period_end::text AS period_end,
              r.reason, r.reviewed_at, s.name AS reviewed_by_name
         FROM document_vault_reviews r
         LEFT JOIN staff s ON s.id = r.reviewed_by_staff_id
        WHERE r.org_id = $1 AND r.client_id = $2`, [orgId, cid]),
    db.query(
      `SELECT id, kind, item_key, entity_id, title, note, subtype, need, created_at
         FROM document_vault_items
        WHERE org_id = $1 AND client_id = $2 AND retired_at IS NULL
        ORDER BY created_at, id`, [orgId, cid]),
    db.query(
      `SELECT verified_field_sources FROM pii_identity WHERE org_id = $1 AND client_id = $2`, [orgId, cid])
  ]);

  const reviewMap = new Map(reviews.rows.map((r) => [String(r.document_id), r]));
  const rows = items.rows;
  return {
    client: { id: String(client.id), name: [client.first_name, client.last_name].filter(Boolean).join(" ").trim() || null },
    scopes: buildScopes({
      containers: containers.rows,
      hasBusinessRow: businessRows.rows.length > 0,
      businessRowName: businessRows.rows.length === 1 ? businessRows.rows[0].name : null
    }),
    customItems: rows.filter((r) => r.kind === "custom"),
    waivers: rows.filter((r) => r.kind === "waiver"),
    documents: documents.rows,
    reviews: reviewMap,
    docCheckDocIds: docCheckDocumentIds(ident.rows[0] && ident.rows[0].verified_field_sources)
  };
}

/** Facts → core. The one place the DB shape meets the pure engine. */
export function vaultFromFacts(facts, { now = new Date(), env = process.env } = {}) {
  return buildVault({
    scopes: facts.scopes, customItems: facts.customItems, waivers: facts.waivers,
    documents: facts.documents, reviews: facts.reviews, docCheckDocIds: facts.docCheckDocIds, now, env
  });
}

/**
 * vaultComplete(db, { orgId, clientId }) → { complete, missing, summary }
 *
 * What the closer-ready path reads. `complete` is true only when every line is
 * accepted or waived. `missing` names every line that is not, with where it stands.
 * Returns null when the client is not in this org. Throws on a database error —
 * the caller decides what a failed read means (closer-ready treats it as "could not
 * be checked", never as "complete").
 */
export async function vaultComplete(db, { orgId, clientId, now = new Date(), env = process.env } = {}) {
  const facts = await loadVaultFacts(db, { orgId, clientId });
  if (!facts) return null;
  const core = vaultFromFacts(facts, { now, env });
  return { complete: core.complete, missing: core.missing, summary: core.summary };
}

/* ───────────────────────────── the view a screen reads ───────────────────────────── */

function uploadFor(item) {
  const fields = { kind: "client_upload", subtype: item.subtypes[0] || "other" };
  if (item.scope.kind === SCOPE.BUSINESS && item.scope.id) fields.entity_id = item.scope.id;
  return { endpoint: UPLOAD_ENDPOINT, method: "POST", fields };
}

function downloadFor(docId, sign) {
  if (!sign) return null;
  try {
    const link = signDocumentUrl({ documentId: docId, ...sign });
    return { url: link.url, expires_at: link.expiresAtIso };
  } catch {
    return null; // no DOCUMENT_URL_SECRET here: no link, never a broken one
  }
}

/**
 * shapeVault — the JSON the vault endpoint answers. Documented in
 * docs/finance/document-vault.md. A client sees their own lines and files; the
 * `sources` (internal page paths) go to staff only.
 */
export function shapeVault({ client, core, audience = "client", now = new Date(), env = process.env, sign = null }) {
  const staff = audience === "staff";
  const items = core.items.map((it) => {
    const { sources, last_activity_at, expires, ...rest } = it; // eslint-disable-line no-unused-vars
    return {
      ...rest,
      // The rule that ages a file. The env var that moved it is staff's business.
      expires: expires
        ? { kind: expires.kind, value: expires.value, note: expires.note, ...(staff ? { from_env: expires.from_env } : {}) }
        : null,
      sources: staff ? sources : undefined,
      upload: uploadFor(it),
      // Which staff member decided is staff's business; a client sees the decision.
      documents: it.documents.map((d) => ({ ...d, reviewed_by: staff ? d.reviewed_by : undefined, download: downloadFor(d.id, sign) }))
    };
  });
  const settings = vaultSettings(env);
  return {
    ok: true,
    audience,
    client,
    as_of: new Date(now).toISOString(),
    complete: core.complete,
    summary: core.summary,
    scopes: core.scopes,
    items,
    unfiled: core.unfiled.map((u) => ({ ...u, download: downloadFor(u.id, sign) })),
    settings: {
      ask_every_days: settings.ask_every_days,
      statement_window_months: settings.statement_window_months,
      statement_max_age_days: settings.statement_max_age_days,
      good_standing_max_age_days: settings.good_standing_max_age_days
    }
  };
}

/** readVault — the endpoint's read. null when the client is not in this org. */
export async function readVault(db, { orgId, clientId, audience = "client", now = new Date(), env = process.env, sign = null } = {}) {
  const facts = await loadVaultFacts(db, { orgId, clientId });
  if (!facts) return null;
  const core = vaultFromFacts(facts, { now, env });
  return shapeVault({ client: facts.client, core, audience, now, env, sign });
}

/* ───────────────────────────── staff decisions ───────────────────────────── */

export class VaultError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "VaultError";
    this.code = code;
    this.status = status;
  }
}

const REASON_MAX = 300;
const TITLE_MAX = 120;
const NOTE_MAX = 300;

function cleanText(v, field, { max, required = false } = {}) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!s) {
    if (required) throw new VaultError("invalid_" + field, `${field} is required`);
    return null;
  }
  if (s.length > max) throw new VaultError("invalid_" + field, `${field} must be ${max} characters or fewer`);
  return s;
}

/** A date the person typed: YYYY-MM-DD, a real date, not in the future. */
export function readPeriodEnd(v, { now = new Date() } = {}) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).trim();
  if (!parseIso(s)) throw new VaultError("invalid_period_end", "period_end must be a date like 2026-09-30");
  if (s > isoDay(now)) throw new VaultError("invalid_period_end", "period_end is in the future");
  if (s < "2000-01-01") throw new VaultError("invalid_period_end", "period_end is too far back");
  return s;
}

function readCovers(v) {
  if (v === null || v === undefined || String(v).trim() === "") return 1;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 24) throw new VaultError("invalid_covers", "covers must be a whole number from 1 to 24");
  return n;
}

async function liveFacts(db, { orgId, clientId }) {
  const facts = await loadVaultFacts(db, { orgId, clientId });
  if (!facts) throw new VaultError("not_found", "no such client", 404);
  return facts;
}

/** The cheap check: is this client in this org? Throws the same 404 as liveFacts. */
async function requireClient(db, { orgId, clientId }) {
  if (!isUuid(clientId)) throw new TypeError("client_id must be a uuid");
  const r = await db.query(`SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`, [String(clientId).trim(), orgId]);
  if (!r.rows[0]) throw new VaultError("not_found", "no such client", 404);
}

/**
 * decideDocument — a person accepts or rejects one uploaded file.
 *
 *   status        'accepted' | 'rejected'
 *   reason        required on a reject; the client reads it as "what to fix"
 *   itemKey       file the document under this line (a standard key or a custom one)
 *   entityId      the business container it belongs to (needed when the client has
 *                 more than one business and the file does not already say)
 *   covers        how many months / years this one file covers (default 1)
 *   periodEnd     the statement's end date / the date a certificate was issued
 *
 * A decision that would leave the file counting toward NO line is refused (409):
 * accepting a paper that proves nothing is a button that lies. File it under a
 * line (item_key) first.
 */
export async function decideDocument(db, {
  orgId, clientId, documentId, status, reason = null, itemKey = null, entityId = null,
  covers = null, periodEnd = null, staffId = null, now = new Date(), env = process.env
} = {}) {
  if (!isUuid(documentId)) throw new VaultError("invalid_document_id", "document_id must be a uuid");
  if (status !== "accepted" && status !== "rejected") {
    throw new VaultError("invalid_status", "status must be accepted or rejected");
  }
  const why = status === "rejected" ? cleanText(reason, "reason", { max: REASON_MAX, required: true }) : null;
  const units = status === "accepted" ? readCovers(covers) : 1;
  const end = status === "accepted" ? readPeriodEnd(periodEnd, { now }) : null;
  if (itemKey !== null && itemKey !== undefined && itemKey !== "" && !/^[a-z0-9_]{2,64}$/.test(String(itemKey))) {
    throw new VaultError("invalid_item_key", "item_key is not a valid line key");
  }
  if (entityId && !isUuid(entityId)) throw new VaultError("invalid_entity_id", "entity_id must be a uuid");

  const facts = await liveFacts(db, { orgId, clientId });
  const doc = facts.documents.find((d) => String(d.id) === String(documentId));
  if (!doc) throw new VaultError("document_not_found", "that document is not in this client's uploads", 404);

  const key = itemKey ? String(itemKey) : null;
  const entity = entityId ? String(entityId) : null;
  if (entity && !facts.scopes.some((s) => s.id === entity)) {
    throw new VaultError("unknown_business", "entity_id is not one of this client's businesses", 404);
  }
  // What the file would count toward after this decision: what is being sent, else
  // what an earlier decision already filed it under.
  const prior = facts.reviews.get(String(documentId)) || null;
  const after = {
    item_key: key || (prior && prior.item_key) || null,
    entity_id: entity || (prior && prior.entity_id) || null
  };
  const slots = buildSlots({ scopes: facts.scopes, customItems: facts.customItems, waivers: [], env });
  const businessCount = facts.scopes.filter((s) => s.kind === SCOPE.BUSINESS).length;
  const hits = slotsForDocument(doc, after, slots, businessCount);
  if (!hits.length) {
    throw new VaultError(
      "unfiled",
      after.item_key
        ? "that line is not on this client's list, or the business is wrong — check item_key and entity_id"
        : businessCount > 1
          ? "this file does not say which line or business it is for — send item_key and entity_id"
          : "this file does not match any line on the list — send item_key to file it under one",
      409
    );
  }

  const row = (await db.query(
    `INSERT INTO document_vault_reviews
       (org_id, client_id, document_id, status, item_key, entity_id, covers, period_end, reason, reviewed_by_staff_id, reviewed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, now())
     ON CONFLICT (document_id) DO UPDATE SET
       status = EXCLUDED.status,
       item_key = COALESCE(EXCLUDED.item_key, document_vault_reviews.item_key),
       entity_id = COALESCE(EXCLUDED.entity_id, document_vault_reviews.entity_id),
       covers = EXCLUDED.covers,
       period_end = EXCLUDED.period_end,
       reason = EXCLUDED.reason,
       reviewed_by_staff_id = EXCLUDED.reviewed_by_staff_id,
       reviewed_at = now()
     RETURNING id, status`,
    [orgId, String(clientId).trim(), String(documentId), status, key, entity, units, end, why, staffId || null]
  )).rows[0];
  return { id: row.id, status: row.status, lines: hits.map((h) => h.slot) };
}

/** addCustomItem — staff add a line the standard list does not have. */
export async function addCustomItem(db, {
  orgId, clientId, title, note = null, entityId = null, subtype = null, need = null, staffId = null
} = {}) {
  const t = cleanText(title, "title", { max: TITLE_MAX, required: true });
  const n = cleanText(note, "note", { max: NOTE_MAX });
  const count = need === null || need === undefined || String(need).trim() === "" ? 1 : Number(need);
  if (!Number.isInteger(count) || count < 1 || count > 24) throw new VaultError("invalid_need", "need must be a whole number from 1 to 24");
  const sub = subtype ? String(subtype).trim() : null;
  if (sub && !SUBTYPES.client_upload.includes(sub)) {
    throw new VaultError("invalid_subtype", `subtype must be one of ${SUBTYPES.client_upload.join(", ")}`);
  }
  if (entityId && !isUuid(entityId)) throw new VaultError("invalid_entity_id", "entity_id must be a uuid");
  await requireBusinessScope(db, { orgId, clientId, entityId });
  const id = globalThis.crypto.randomUUID();
  const key = `custom_${id.slice(0, 8)}`;
  await db.query(
    `INSERT INTO document_vault_items
       (id, org_id, client_id, entity_id, item_key, kind, title, note, subtype, need, created_by_staff_id)
     VALUES ($1, $2, $3, $4, $5, 'custom', $6, $7, $8, $9, $10)`,
    [id, orgId, String(clientId).trim(), entityId || null, key, t, n, sub, count, staffId || null]
  );
  return { id, item_key: key };
}

/** The client must exist; and when a business is named it must be one of theirs. */
async function requireBusinessScope(db, { orgId, clientId, entityId }) {
  if (!entityId) return requireClient(db, { orgId, clientId });
  if (!isUuid(clientId)) throw new TypeError("client_id must be a uuid");
  const r = await db.query(
    `SELECT 1 FROM entities
      WHERE id = $1 AND org_id = $2 AND client_id = $3 AND kind = 'business' AND archived_at IS NULL`,
    [String(entityId), orgId, String(clientId).trim()]
  );
  if (!r.rows[0]) {
    await requireClient(db, { orgId, clientId });
    throw new VaultError("unknown_business", "entity_id is not one of this client's businesses", 404);
  }
}

/** retireItem — staff take a custom line off (the row stays, marked retired). */
export async function retireItem(db, { orgId, clientId, itemId, staffId = null } = {}) {
  if (!isUuid(itemId)) throw new VaultError("invalid_item_id", "item_id must be a uuid");
  await requireClient(db, { orgId, clientId });
  const r = await db.query(
    `UPDATE document_vault_items
        SET retired_at = now(), retired_by_staff_id = $4
      WHERE id = $1 AND org_id = $2 AND client_id = $3 AND retired_at IS NULL
      RETURNING id`,
    [String(itemId), orgId, String(clientId).trim(), staffId || null]
  );
  if (!r.rows[0]) throw new VaultError("item_not_found", "no such open item", 404);
  return { id: r.rows[0].id };
}

const standardKeys = new Set(STANDARD_ITEMS.map((i) => i.key));

/** waiveItem — staff say a standard line does not apply here. A reason is required. */
export async function waiveItem(db, { orgId, clientId, itemKey, entityId = null, reason, staffId = null } = {}) {
  const key = String(itemKey || "");
  if (!standardKeys.has(key)) throw new VaultError("invalid_item_key", "only a standard line can be waived");
  const why = cleanText(reason, "reason", { max: REASON_MAX, required: true });
  if (entityId && !isUuid(entityId)) throw new VaultError("invalid_entity_id", "entity_id must be a uuid");
  const def = STANDARD_ITEMS.find((i) => i.key === key);
  if (def.scope === SCOPE.CLIENT && entityId) throw new VaultError("invalid_entity_id", "this line is not per business");
  if (def.scope === SCOPE.BUSINESS && !entityId) {
    // No business named: fine when there is only one (its container, or the lone
    // business row's unscoped line); ambiguous when there are several.
    const facts = await liveFacts(db, { orgId, clientId });
    const businesses = facts.scopes.filter((s) => s.kind === SCOPE.BUSINESS);
    if (businesses.length > 1) throw new VaultError("choose_business", "this line repeats per business — send entity_id");
    entityId = businesses[0] ? businesses[0].id : null;
  } else {
    await requireBusinessScope(db, { orgId, clientId, entityId });
  }
  const r = await db.query(
    `INSERT INTO document_vault_items
       (org_id, client_id, entity_id, item_key, kind, note, created_by_staff_id)
     VALUES ($1, $2, $3, $4, 'waiver', $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [orgId, String(clientId).trim(), entityId || null, key, why, staffId || null]
  );
  return { id: r.rows[0] ? r.rows[0].id : null, created: !!r.rows[0] };
}

/** unwaiveItem — put a waived standard line back on the list. */
export async function unwaiveItem(db, { orgId, clientId, itemKey, entityId = null, staffId = null } = {}) {
  const key = String(itemKey || "");
  if (!standardKeys.has(key)) throw new VaultError("invalid_item_key", "only a standard line can be waived");
  if (entityId && !isUuid(entityId)) throw new VaultError("invalid_entity_id", "entity_id must be a uuid");
  await requireClient(db, { orgId, clientId });
  const r = await db.query(
    `UPDATE document_vault_items
        SET retired_at = now(), retired_by_staff_id = $5
      WHERE org_id = $1 AND client_id = $2 AND kind = 'waiver' AND item_key = $3
        AND entity_id IS NOT DISTINCT FROM $4::uuid AND retired_at IS NULL
      RETURNING id`,
    [orgId, String(clientId).trim(), key, entityId || null, staffId || null]
  );
  if (!r.rows[0]) throw new VaultError("item_not_found", "that line is not waived", 404);
  return { id: r.rows[0].id };
}

export default {
  buildVault, buildScopes, buildSlots, vaultLine, vaultComplete, readVault, shapeVault,
  decideDocument, addCustomItem, retireItem, waiveItem, unwaiveItem, loadVaultFacts, vaultFromFacts
};
