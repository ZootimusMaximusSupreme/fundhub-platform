// Owner holds — client files the owner told us to leave alone. Pure. Reads nothing, writes nothing.
//
// Owner call 2026-10-09 (ops/workflows/fix-batch-2026-10-09.md, "Owner call ... Bram"): "dont worry about bram."
// No email, no sign-in link, no call and no data step for FH-000507. Owner 2026-10-20: he is the only real
// client and stays no-contact / no-change.
//
// What a hold does in a check: a late file on hold is not counted as a break, and it is not called green.
// When the only late files are held, the check says "nothing to judge" with the code "owner-hold" and names the
// file, every morning. The lane re-runs the same read on every audit (its naVerify), so the day any other
// client's file is late the row is red again by name. Removing a client from this list turns its rows red again.
// Only the owner adds or removes a hold.

export const OWNER_HOLD_CODE = "owner-hold";

export const OWNER_HOLDS = Object.freeze([
  Object.freeze({
    clientCode: "FH-000507",
    since: "2026-10-09",
    why: "no contact and no change to this repair file"
  })
]);

const CODE_RE = /^[A-Z]{2}-[0-9]{6}$/;
const HELD = new Map(OWNER_HOLDS.map((hold) => [hold.clientCode.toUpperCase(), hold]));

for (const code of HELD.keys()) {
  if (!CODE_RE.test(code)) throw new Error(`owner hold ${code} is not a client code`);
}

/** The held client codes, upper case, in list order. */
export const HELD_CODES = Object.freeze([...HELD.keys()]);

export function isHeldCode(code) {
  return typeof code === "string" && HELD.has(code.trim().toUpperCase());
}

export function holdFor(code) {
  return isHeldCode(code) ? HELD.get(code.trim().toUpperCase()) : null;
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
  return [...new Set((items || []).map(codeOf).filter(isHeldCode).map((c) => c.trim().toUpperCase()))].sort();
}

/** The held codes as a SQL list for NOT IN, e.g. ('FH-000507'). Codes are checked against CODE_RE above. */
export function heldCodesSqlList() {
  return `(${HELD_CODES.map((code) => `'${code}'`).join(", ")})`;
}

/** The line a green row adds when its read leaves held files out. */
export function ownerHoldNote() {
  const parts = HELD_CODES.map((code) => `${code} (on hold since ${HELD.get(code).since}: ${HELD.get(code).why})`);
  return `Files on owner hold are not counted: ${parts.join(", ")}.`;
}

/** The one sentence a held row says. */
export function ownerHoldSay(codes = []) {
  const list = (Array.isArray(codes) ? codes : []).filter(isHeldCode);
  if (!list.length) return "A file on owner hold is late. Judged the day another file is late.";
  const parts = list.map((code) => {
    const hold = holdFor(code);
    return `${code.toUpperCase()} (on hold since ${hold.since}: ${hold.why})`;
  });
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
