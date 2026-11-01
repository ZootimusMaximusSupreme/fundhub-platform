import { createHash } from "node:crypto";

// What a push notification is allowed to say. The lock-screen gate.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — credit-repair messaging. This
// module decides the words that can reach a client's phone; the lists below are
// the control, not a style guide.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE ONE FACT THIS FILE IS BUILT AROUND
//
// A push notification renders on a LOCKED PHONE. It is visible to whoever is
// holding it — a partner, a colleague leaning over a desk, a stranger who picked
// it up on a train — with no password and no unlock. Every other surface this
// product has (the portal, an email, a text) requires something. A lock-screen
// banner requires nothing.
//
// So the body of a notification is PUBLIC TEXT. Not "sensitive but encrypted" —
// the encryption in crypto.mjs protects it from the push service in transit and
// stops there. It arrives, it is decrypted, and it is displayed.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS IS A WHITELIST, AND WHY THE DENYLIST THAT WAS HERE WAS REPLACED
//
// This file used to hold a banned-word list: about twenty-five lender names,
// four bureau names, a set of credit-repair words, and a few regular expressions
// for money. Anything NOT on that list went through. A reviewer put all of these
// on a locked screen with the flag off, and every one of them was allowed:
//
//     "You owe 24000 this month. Pay 900 today."
//     "Minimum due 95 by Friday."          "Balance 42.5k due."
//     "Your Prosper loan is past due."     "Bread Financial needs a payment."
//     "Best Egg statement is ready."       "Your Marcus account was updated."
//     "Your OppLoans payment is late."     "Your 90-day late was removed."
//     "Your inquiry removal is done."
//
// There are thousands of lenders and an unbounded number of ways to write a
// number, so a denylist here can only ever be a list of the leaks somebody has
// already thought of. Every lender founded next year is a hole nobody notices.
//
// So the rule is inverted. WITH THE DETAIL FLAG OFF, A NOTIFICATION BODY IS NOT
// FREE TEXT AT ALL. It is chosen by key out of APPROVED_BODIES below — a short
// list of complete, fully-written sentences that hold no client-specific value
// of any kind, and which a person can read end to end in ten seconds. Anything
// else is REFUSED. Not stripped, not trimmed, not escaped: refused, and refused
// permanently rather than retried, because a retry would refuse it again.
//
// The same applies to every other string the payload carries — the title, the
// tap target and the collapse tag are each drawn from a fixed list too. With the
// flag off, the complete set of payloads this function can produce is finite and
// can be written down; src/push/payload.test.mjs writes it down and then proves
// by fuzzing that nothing outside it can be built.
//
// ═══════════════════════════════════════════════════════════════════════════
// REFUSED, NOT STRIPPED
//
// A sanitiser that quietly removes "$4,200" leaves "Your  payment is due" and
// nobody ever learns the caller tried. A refusal is loud at the point the code
// is written, which is the only point anybody can fix it.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE DETAIL FLAG
//
// allowDetail: false, everywhere, today. Nothing in this repository sets it to
// true. It exists so that turning detail on later is a one-line change at ONE
// call site with a name a reader understands, rather than a rewrite of this
// gate under time pressure. Flipping it is Chris's call and nobody else's.
//
// Even with the flag on, the length caps and the same-origin check on the tap
// target still apply — the flag lifts the whitelist and nothing else.

export class PushPayloadRefused extends Error {
  constructor(message, { reason } = {}) {
    super(message);
    this.name = "PushPayloadRefused";
    this.reason = reason || "not_approved";
  }
}

/* ── THE APPROVED BODIES ──────────────────────────────────────────────────
   The whole vocabulary of a locked screen. Every one of these is safe to read
   over somebody's shoulder on a train: no amount, no creditor, no score, no
   bureau, no word about credit repair, and nothing that differs between one
   client and the next.

   ADDING ONE is the intended way to say something new. Write the complete
   sentence here, give it a key, and pass that key. Do not pass a string. */
export const APPROVED_BODIES = Object.freeze({
  payment_due:      "A payment is due soon. Open FundHub.",
  payment_past_due: "A payment needs your attention. Open FundHub.",
  statement_close:  "Something on your file needs a look. Open FundHub.",
  document_needed:  "We need a document from you. Open FundHub.",
  check_in:         "Time for your check-in. Open Fundhub.",
  call_confirmation: "Please confirm your upcoming call in FundHub.",
  update:           "There is an update on your file. Open FundHub.",
  test:             "Test notification from FundHub."
});

export const APPROVED_BODY_KEYS = Object.freeze(Object.keys(APPROVED_BODIES));
const APPROVED_BODY_TEXT = Object.freeze(Object.values(APPROVED_BODIES));

/** The kinds a caller may send, each with the approved body it gets by default.
    A kind is always also a body key; the extra keys above exist so a kind can
    have a second approved wording without a second kind. */
export const PUSH_KINDS = Object.freeze([
  "payment_due", "statement_close", "document_needed", "check_in", "call_confirmation", "update", "test"
]);

/** kind → its default body. A subset of APPROVED_BODIES, kept under the old
    name because that is what callers and tests already say. */
export const GENERIC_BODIES = Object.freeze(
  Object.fromEntries(PUSH_KINDS.map((k) => [k, APPROVED_BODIES[k]]))
);

/** The app's own name is the title, always. A title that varies is a second
    place for a leak, and no notification needs one. */
export const TITLE = "FundHub";
export const APPROVED_TITLES = Object.freeze([TITLE]);

/** Where a tap goes. SAME-ORIGIN PATH ONLY — an absolute URL in a payload is an
    open redirect that opens itself, with no click on a link and no address bar
    to read. With the flag off it must be one of these exactly, so a client's
    identifiers cannot be smuggled out in a query string either. */
export const DEFAULT_URL = "/app/client-portal.html";
const LESSON_SLUGS = [
  "pre-underwriting", "funding-sequence", "apply-yourself", "money-on-the-table",
  "after-you-say-yes", "bank-said-no", "thirteen-points", "card-paydown",
  "credit-optimization", "credit-partner", "business-one-two", "blueprint-12-months",
  "soft-pull", "the-call", "who-we-are", "cost-of-waiting", "the-maximum",
  "the-money-talk", "tried-before", "blueprint-value", "blueprint-in-action",
  "your-data-is-safe"
];
export const APPROVED_URLS = Object.freeze([
  DEFAULT_URL, ...LESSON_SLUGS.map((slug) => `/slideshows/${slug}.html`)
]);

// Staff work alerts use a separate fixed vocabulary. A client ID travels only
// as tap metadata; names, phone numbers, and survey answers stay in the signed-in
// workspace rather than on the lock screen.
export const STAFF_PUSH_PATH = "/app/staff-alert";
export const STAFF_PUSH_BODIES = Object.freeze({
  lead: "A new lead is ready. Open Fundhub to call.",
  set: "A lead is set. Open Fundhub for the handoff.",
  upcoming: "Your next call is coming up. Open Fundhub."
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildStaffPushPayload(notification = {}) {
  const kind = String(notification.kind || "");
  const clientId = String(notification.clientId || "").toLowerCase();
  const key = String(notification.key || "").trim();
  if (notification.title != null || notification.body != null || notification.url != null || notification.tag != null) {
    throw refuse("staff push copy and tap target are fixed", "not_approved");
  }
  if (!Object.hasOwn(STAFF_PUSH_BODIES, kind)) throw refuse("unknown staff push kind", "unknown_kind");
  if (!UUID.test(clientId)) throw refuse("staff push needs a client UUID", "bad_client_id");
  if (!key || key.length > 200) throw refuse("staff push needs a stable key", "bad_key");
  // Use a distinct collapse ID per event, so two new leads do not replace one another.
  const tag = `staff-${kind}-${createHash("sha256").update(`${clientId}:${key}`).digest("hex").slice(0, 24)}`;
  return JSON.stringify({ kind, clientId, title: "Fundhub", body: STAFF_PUSH_BODIES[kind],
    url: STAFF_PUSH_PATH, tag });
}

/** The collapse key. Two "payment due" notifications should replace one another
    rather than stack; the browser does that by tag. It is not displayed, but it
    is a string in the payload, so it is whitelisted like everything else. */
export const APPROVED_TAGS = Object.freeze([...PUSH_KINDS]);

/* Titles and bodies are capped well under what a phone shows so nothing is
   silently cut mid-word on a small screen. With the flag off the caps can never
   fire — every approved body is far shorter — so they exist for the flag-on
   path. */
const MAX_TITLE = 40;
const MAX_BODY = 120;

function refuse(message, reason) {
  return new PushPayloadRefused(message, { reason });
}

function keyList(keys) {
  return keys.join(", ");
}

/**
 * assertLockScreenSafe(text, { field, allowDetail })
 *
 * With the flag off: the text must be, character for character, one of the
 * approved strings for its field. Anything else throws PushPayloadRefused.
 * With the flag on: returned unchanged. It never edits, either way.
 */
export function assertLockScreenSafe(text, { field = "body", allowDetail = false } = {}) {
  const s = String(text == null ? "" : text);
  if (allowDetail === true) return s;

  const approved = field === "title" ? APPROVED_TITLES : APPROVED_BODY_TEXT;
  if (approved.includes(s)) return s;

  throw refuse(
    `push ${field} refused: a notification is read on a locked screen, so with detail off the ` +
    `${field} may not be free text. Choose one of the approved ${field === "title" ? "titles" : "bodies"} ` +
    `by key (${field === "title" ? "the title is always \"FundHub\"" : keyList(APPROVED_BODY_KEYS)}), ` +
    `add a new approved one to src/push/payload.mjs, or set allowDetail:true deliberately.`,
    "not_approved"
  );
}

/**
 * buildPushPayload(notification, { allowDetail }) → JSON string
 *
 * The exact bytes the service worker will read. Small on purpose: a push
 * payload has a hard ceiling near 4 KB and every byte here is one the encrypted
 * record has to carry.
 *
 *   kind      which notification this is; picks the default approved body
 *   bodyKey   optional. A key into APPROVED_BODIES, to say something other than
 *             the default for this kind. THIS IS THE INTENDED WAY TO CHOOSE
 *             WORDS — there is no way to write them here.
 *   body      optional. Only accepted with the flag off if it is character for
 *             character one of the approved bodies; free text is refused.
 *   url       where the tap goes; an approved same-origin path
 *   tag       collapse key; an approved kind name
 */
export function buildPushPayload(notification = {}, { allowDetail = false } = {}) {
  const detail = allowDetail === true;

  const kind = String(notification.kind || "update");
  if (!Object.hasOwn(GENERIC_BODIES, kind)) {
    throw refuse(
      `unknown push kind "${String(kind).slice(0, 40)}" — the kinds are ${keyList(PUSH_KINDS)}. ` +
      `Add a new one to src/push/payload.mjs with an approved body first.`,
      "unknown_kind"
    );
  }

  /* ── the body ──────────────────────────────────────────────────────────── */
  let body;
  const hasKey = notification.bodyKey != null && String(notification.bodyKey) !== "";
  if (hasKey) {
    const bodyKey = String(notification.bodyKey);
    if (!Object.hasOwn(APPROVED_BODIES, bodyKey)) {
      throw refuse(
        `unknown push body key "${bodyKey.slice(0, 40)}" — the approved keys are ${keyList(APPROVED_BODY_KEYS)}. ` +
        `Write the complete sentence into APPROVED_BODIES in src/push/payload.mjs and use its key.`,
        "unknown_body_key"
      );
    }
    // A key IS the whitelist. It cannot carry anything, so it is honoured
    // whether the detail flag is on or off.
    body = APPROVED_BODIES[bodyKey];
  } else if (notification.body != null && String(notification.body) !== "") {
    body = assertLockScreenSafe(notification.body, { field: "body", allowDetail: detail });
  } else {
    body = GENERIC_BODIES[kind];
  }

  /* ── the title ─────────────────────────────────────────────────────────── */
  const title = assertLockScreenSafe(
    notification.title == null || String(notification.title) === "" ? TITLE : notification.title,
    { field: "title", allowDetail: detail }
  );

  if (title.length > MAX_TITLE) {
    throw refuse(`push title is ${title.length} characters; the cap is ${MAX_TITLE}`, "too_long");
  }
  if (body.length > MAX_BODY) {
    throw refuse(`push body is ${body.length} characters; the cap is ${MAX_BODY}`, "too_long");
  }

  /* ── the tap target ────────────────────────────────────────────────────── */
  const url = notification.url == null ? DEFAULT_URL : String(notification.url);
  if (!url.startsWith("/") || url.startsWith("//")) {
    // "//evil.example" is a protocol-relative absolute URL and a browser treats
    // it as one, so the leading-slash check alone is not enough.
    throw refuse(
      `push url must be a same-origin path beginning with a single "/" — got ${url.slice(0, 40)}`,
      "bad_url"
    );
  }
  if (!detail && !APPROVED_URLS.includes(url)) {
    throw refuse(
      `push url refused: with detail off the tap target must be one of ${keyList(APPROVED_URLS)}, ` +
      `so a client's identifiers cannot travel in a query string. Got ${url.slice(0, 40)}.`,
      "not_approved"
    );
  }

  /* ── the collapse tag ──────────────────────────────────────────────────── */
  let tag = notification.tag == null || String(notification.tag) === "" ? kind : String(notification.tag);
  if (!detail && !APPROVED_TAGS.includes(tag)) {
    throw refuse(
      `push tag refused: with detail off the collapse tag must be one of ${keyList(APPROVED_TAGS)}. ` +
      `Got ${tag.slice(0, 40)}.`,
      "not_approved"
    );
  }
  tag = tag.slice(0, 40);

  return JSON.stringify({ kind, title, body, url, tag });
}

export default {
  buildPushPayload,
  buildStaffPushPayload,
  assertLockScreenSafe,
  APPROVED_BODIES,
  APPROVED_BODY_KEYS,
  APPROVED_TITLES,
  APPROVED_URLS,
  APPROVED_TAGS,
  GENERIC_BODIES,
  PUSH_KINDS,
  TITLE,
  DEFAULT_URL
};
