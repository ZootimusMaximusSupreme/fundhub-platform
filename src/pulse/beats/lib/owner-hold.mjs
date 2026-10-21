// Clients the owner put on hold: no contact and no change.
//
// Owner call 2026-10-09 (ops/workflows/fix-batch-2026-10-09.md), said again 2026-10-20:
// Braum, FH-000507, gets no email, no sign-in link, no call and no data step. He is the
// only real client (owner fact 2026-10-20).
//
// A check that would tell staff to reach out to one of these clients has nothing a person
// may do about it. When EVERY client such a check names is on this list, the check says
// "nothing to judge" with the code owner-hold-client (src/pulse/na-conditions.mjs), and the
// lane that made the row reads the database again on every audit to prove that is still
// true. The day any other client is waiting, the row is red again, by name.
//
// The list is client codes, owner-set. Add or remove a code only when Chris says so.
//
// ONE LIST, TWO CLOCKS (2026-10-20). This file used to be src/pulse/owner-hold.mjs. It moved here,
// unchanged, so the hourly beats (beat-client-portal.mjs, beat-repair-trip.mjs) read the same hold as
// the morning lanes (gap-portal.mjs and the records lane); a beat may import only from
// src/pulse/beats/lib. src/pulse/owner-hold.mjs re-exports it. Pure: no imports, no I/O.

export const OWNER_HOLD_CLIENTS = Object.freeze([
  Object.freeze({
    clientCode: "FH-000507",
    setOn: "2026-10-09",
    why: "Owner: do not contact. No email, sign-in link, call or data step."
  })
]);

const CODES = new Set(OWNER_HOLD_CLIENTS.map((c) => c.clientCode));

/** True when this client code is on the owner's no-contact hold. */
export function onOwnerHold(clientCode) {
  return typeof clientCode === "string" && CODES.has(clientCode);
}

// ── Helpers for checks that judge late files (records lane, 2026-10-20) ─────────────────────────────
// A late file on hold is not counted as a break and not called green. When the only late files are held,
// the check says "nothing to judge" with the code below and names them; its lane re-runs the same read on
// every audit (naVerify), so the day another client's file is late the row is red again by name.

export const OWNER_HOLD_CODE = "owner-hold-client";

const CODE_RE = /^[A-Z]{2}-[0-9]{6}$/;
for (const code of CODES) {
  if (!CODE_RE.test(code)) throw new Error(`owner hold ${code} is not a client code`);
}

/** The held client codes, in list order. */
export const HELD_CODES = Object.freeze([...CODES]);

const norm = (code) => (typeof code === "string" ? code.trim().toUpperCase() : "");

/** onOwnerHold, after trimming and upper-casing the code as a client row may carry it. */
export function isHeldCode(code) {
  return onOwnerHold(norm(code));
}

function holdFor(code) {
  return OWNER_HOLD_CLIENTS.find((c) => c.clientCode === norm(code)) || null;
}

/** Split a list into the items not on hold and the items on hold. codeOf(item) gives the client code. */
export function splitHeld(items, codeOf) {
  const open = [];
  const held = [];
  for (const item of items || []) (isHeldCode(codeOf(item)) ? held : open).push(item);
  return { open, held };
}

/** The held codes in a list, upper case, sorted, once each. */
export function heldCodesOf(items, codeOf) {
  return [...new Set((items || []).map(codeOf).filter(isHeldCode).map(norm))].sort();
}

/** The held codes as a SQL list for NOT IN, e.g. ('FH-000507'). Codes are checked against CODE_RE above. */
export function heldCodesSqlList() {
  return `(${HELD_CODES.map((code) => `'${code}'`).join(", ")})`;
}

/** The line a green row adds when its read leaves held files out. */
export function ownerHoldNote() {
  const parts = OWNER_HOLD_CLIENTS.map((c) => `${c.clientCode} (on the owner's no-contact hold since ${c.setOn})`);
  return `Files on owner hold are not counted: ${parts.join(", ")}.`;
}

/** The one sentence a held late-file row says. */
export function ownerHoldSay(codes = []) {
  const list = (Array.isArray(codes) ? codes : []).filter(isHeldCode).map(norm);
  if (!list.length) return "A file on owner hold is late. Judged the day another file is late.";
  const parts = list.map((code) => `${code} (on the owner's no-contact hold since ${holdFor(code).setOn})`);
  const who = parts.length === 1 ? `The only late file is ${parts[0]}` : `The only late files are ${parts.join(" and ")}`;
  return `${who}. Nothing else to judge. Judged again the day another file is late.`;
}

/** A gap-lane row for a check whose only late files are on hold. args name the check, the company and the files. */
export function ownerHoldRow(check, orgId, codes, extra = {}) {
  return {
    id: check,
    status: "na",
    detail: ownerHoldSay(codes),
    suggestedFix: null,
    ...extra,
    na: { code: OWNER_HOLD_CODE, args: { check, orgId: String(orgId || ""), clients: [...codes] } }
  };
}

/** True when a lane row is still the same owner-hold claim (the naVerify answer). */
export function stillOwnerHold(row, args) {
  if (!row || row.status !== "na" || !row.na || row.na.code !== OWNER_HOLD_CODE) return false;
  const now = Array.isArray(row.na.args?.clients) ? row.na.args.clients : [];
  const said = Array.isArray(args?.clients) ? args.clients : [];
  return now.length > 0 && now.length === said.length && now.every((code, i) => code === said[i]);
}
