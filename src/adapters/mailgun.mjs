// Mailgun inbound-email adapter — Master Rebuild Spec Phase 1.
//
// Receives bank-forwarded emails from Mailgun, classifies them, and emits
// `mail.response` onto the canonical event bus. No the old spreadsheet and CRM side-effects
// here — handlers registered on `mail.response` perform those reactions.
//
// Classification is a direct port of inquiry-removal-ai/src/lib/email-classifier.js
// (7 event types: APPROVED / COUNTEROFFER / DENIED / MISSING_DOCS /
// ACTION_REQUIRED / APP_RECEIVED / NOISE). No external deps — pure Node built-ins.
//
// Mailgun signature scheme (real):
//   HMAC-SHA256( key = signingKey, data = timestamp + token ) hex === signature
// Fields arrive in body.signature.{timestamp,token,signature} or flat on body.

import crypto from "node:crypto";
import { emit } from "../events/bus.mjs";
import { contactIdFromRecipient } from "../outreach/mail.mjs";
import { recordBankerReply } from "../outreach/replies.mjs";
import { recordOptOut } from "../lib/opt-out.mjs";
import { createTask } from "../lib/create-task.mjs";
import { fromCents } from "../commissions/money.mjs";

// ---------------------------------------------------------------------------
// 1. Signature verification (fail-closed)
// ---------------------------------------------------------------------------
export function verifyMailgunSignature(timestamp, token, signature, signingKey) {
  if (!signingKey) return false;
  const ts = String(timestamp || "").trim();
  const tk = String(token || "").trim();
  const sig = String(signature || "").trim();
  if (!ts || !tk || !sig) return false;
  const expected = crypto
    .createHmac("sha256", signingKey)
    .update(ts + tk)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 2. Keyword classifier — ported from email-classifier.js verbatim
// ---------------------------------------------------------------------------
const NOISE_FROM_PATTERNS = ["noreply", "no-reply", "newsletter", "marketing", "unsubscribe", "donotreply"];
const NOISE_SUBJECT_PATTERNS = ["unsubscribe", "newsletter", "promotional", "update your preferences"];

const CLASSIFICATION_RULES = [
  {
    event_type: "APPROVED",
    keywords: ["approved", "congratulations", "approval", "funded", "you've been approved", "credit limit"],
    dollarAmountBoost: true
  },
  {
    event_type: "COUNTEROFFER",
    keywords: ["counteroffer", "counter offer", "revised offer", "lower amount", "reduced"]
  },
  {
    event_type: "DENIED",
    keywords: ["denied", "declined", "unfortunately", "not approved", "unable to approve", "adverse action"]
  },
  {
    event_type: "MISSING_DOCS",
    keywords: [
      "missing document",
      "documents needed",
      "additional documentation",
      "please provide",
      "upload",
      "verify your",
      "identity verification"
    ]
  },
  {
    event_type: "ACTION_REQUIRED",
    keywords: [
      "action required",
      "action needed",
      "please sign",
      "review and sign",
      "accept your offer",
      "log in to",
      "confirm your"
    ]
  },
  {
    event_type: "APP_RECEIVED",
    keywords: [
      "application received",
      "we received your application",
      "thank you for applying",
      "application submitted",
      "application confirmation"
    ]
  }
];

const DOLLAR_PATTERN = /\$[\d,]+(?:\.\d{2})?/;

/* ── THE BANK ALREADY TOLD US THE AMOUNT, AND WE THREW IT AWAY ─────────────
   Added 2026-08-30.

   DOLLAR_PATTERN above has always run on every inbound bank email. It only ever
   answered yes/no — "does this email contain a dollar figure" — as a nudge to
   classification confidence, and the figure it matched was dropped on the floor.
   Meanwhile a funding advisor reads the same email and types the same number
   into the Approved $ box by hand, and when they forget, the approval carries
   no amount. Fundhub bills a percent of approvals that HAVE an amount
   (docs/finance/CLOSEOUT-FEE-BASIS.md), so a forgotten box is a bill that never goes
   out. That is the leak these two functions close.

   WHAT THIS IS NOT. It is not a decision, and nothing downstream may treat it
   as one:

     * It never sets applications.approved_amount. It travels as far as a
       SUGGESTION on the screen, and a person clicks to accept it.
     * It never picks. A bank email routinely states a credit limit, an APR fee,
       an annual fee and a minimum payment in the same paragraph, and there is
       no honest way to tell from the text alone which one is the approval. Every
       distinct figure is carried and the screen says plainly that it cannot tell
       which is which. Guessing here would put a $39 annual fee on an invoice.
     * It never invents. No figure in the email means no suggestion — not zero.
       Zero is a claim the bank approved nothing; unknown is not nothing
       (CLAUDE.md §12).

   AND IT DOES NOT TOUCH THE CLASSIFIER. DOLLAR_PATTERN, the keyword rules and
   the negation pass are all exactly as they were. The scan below is a second,
   separate read of the same text that runs AFTER the decision is made, and it
   runs only for the two classifications that mean the bank said yes. A DENIED
   email carries no amounts at all — a denial letter quoting the limit it is
   refusing is the single most dangerous number in this mailbox. */

/* Distinct from DOLLAR_PATTERN on purpose — that one is the classifier's and is
   not to be edited for this. Global (every figure, not the first), and one or
   two decimal places, because "$5,000.5" is written by real senders. */
const DOLLAR_SCAN = /\$\s?(\d[\d,]*)(?:\.(\d{1,2}))?/g;

/* How much of an email we will read for figures. The same 64 KiB ceiling
   src/http/router.mjs puts on a stored webhook body, for the same reason: a
   real bank email is a couple of KB, and an unbounded scan of a 6 MB request
   is somebody else's denial-of-service. */
const MAX_SCANNED_CHARS = 64 * 1024;

/* How many distinct figures we will carry. Past a handful the answer is not
   "here are your options", it is "this email is a statement, not an approval",
   and the count below says so honestly. */
const MAX_AMOUNT_CANDIDATES = 6;

/* $1bn, the ceiling src/commissions/money.mjs and public/app/money-input.js
   both use. Anything past it is a typo or a phone number with a dollar sign in
   front of it, not an approval. */
const MAX_SUGGESTED_CENTS = 100_000_000_000;

/* One matched figure -> integer cents, or null when it is not an amount worth
   offering. No float multiply: "450.10" * 100 is 45009.999999999996 in
   JavaScript, and that is how a $450.10 approval becomes $450.09. The two
   halves are read as whole numbers, the same rule public/app/money-input.js
   applies to what a person types. */
function dollarMatchToCents(intPart, fracPart) {
  const digits = String(intPart || "").replace(/,/g, "");
  if (!/^\d+$/.test(digits)) return null;
  let frac = String(fracPart || "");
  while (frac.length < 2) frac += "0";
  const cents = Number(digits) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents)) return null;
  // Zero is not an unknown and it is not an approval. It is dropped, never offered.
  if (cents <= 0 || cents > MAX_SUGGESTED_CENTS) return null;
  return cents;
}

/**
 * Every distinct dollar figure stated in a bank email, in the order it is read
 * — subject first, then body.
 *
 * @returns {{candidates: string[], found: number}}
 *   `candidates` are fixed 2dp dollar strings ("5000.00"), ready for the
 *   Approved $ box and for numeric(14,2), capped at MAX_AMOUNT_CANDIDATES.
 *   `found` is how many DISTINCT figures the email actually stated, which can
 *   be larger than candidates.length — the screen reports the true number
 *   rather than the number that fitted.
 */
export function findDollarAmounts(subject, body) {
  const seen = new Set();
  const candidates = [];
  for (const source of [subject, body]) {
    const text = String(source || "").slice(0, MAX_SCANNED_CHARS);
    if (!text) continue;
    DOLLAR_SCAN.lastIndex = 0;
    let m;
    while ((m = DOLLAR_SCAN.exec(text)) !== null) {
      const cents = dollarMatchToCents(m[1], m[2]);
      if (cents === null) continue;
      if (seen.has(cents)) continue;
      seen.add(cents);
      if (candidates.length < MAX_AMOUNT_CANDIDATES) candidates.push(fromCents(cents));
    }
  }
  return { candidates, found: seen.size };
}

/* What the row on the screen shows instead of repeating the subject line.

   CAPPED, and the cap is the point — src/http/router.mjs:110 records what an
   uncapped stored body did to a shared production Postgres, and a bank email is
   small enough that a cap costs nothing. 500 characters is a preview, which is
   what the column is called and all the screen has room for; the whole email is
   NOT stored, so the account detail in the back half of a forwarded statement
   never lands in this table at all.

   Whitespace is flattened because forwarded plain-text mail is hard-wrapped and
   a preview full of line breaks reads as broken.

   TRUNCATION IS MARKED, same reasoning as the webhook capture: a silently
   shortened value is read as the whole thing.

   NO TEXT AT ALL RETURNS null, not "". The column then holds NULL and the
   screen falls through to the classification and the date, which is exactly how
   public/app/client-control-panel.html was written to behave. */
const MAX_PREVIEW_CHARS = 500;

export function bodyPreviewOf(text) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= MAX_PREVIEW_CHARS) return flat;
  return `${flat.slice(0, MAX_PREVIEW_CHARS)} … [truncated]`;
}

/* The two classifications that mean the bank said yes to something. A
   COUNTEROFFER is an approval for less, and the smaller figure in it is the one
   that gets billed, so it needs the suggestion just as much as an APPROVED
   does. Everything else — DENIED above all — carries no amounts. */
const OFFERS_AN_AMOUNT = new Set(["APPROVED", "COUNTEROFFER"]);

/* ── KEYWORD MATCHING — WORD BOUNDARIES, NOT RAW SUBSTRINGS ────────────────
   FIXED 2026-08-29. This was `lower.includes(kw)`, and a plain substring test
   reads words out of the middle of other words. Every one of these was live:

     "not approved"          contained "approved"  → a denial read as APPROVED
     "refunded"              contained "funded"    → a fee refund read as APPROVED
     "unapproved"            contained "approved"  → APPROVED
     "disapproved"           contained "approved"  → APPROVED

   The first one is the expensive one and it is covered twice over — once here,
   and again by the negation pass below — because a denial misread as an
   approval moves the client's funding card into the approved stage
   (src/workflows/f-11-bank-email-event-router.mjs).

   A space inside a keyword matches ANY run of whitespace. Forwarded plain-text
   bank mail hard-wraps, and "not\napproved" is the same phrase as
   "not approved"; a literal single-space match would miss it and hand the
   email straight back to the bug above. */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KEYWORD_REGEX_CACHE = new Map();
function keywordRegex(kw) {
  let re = KEYWORD_REGEX_CACHE.get(kw);
  if (!re) {
    re = new RegExp(`\\b${escapeRegex(kw).replace(/\s+/g, "\\s+")}\\b`, "i");
    KEYWORD_REGEX_CACHE.set(kw, re);
  }
  return re;
}

/* Returns the span as well as the keyword. The span is what lets a longer,
   more specific phrase from one rule cancel a shorter phrase from another rule
   sitting inside it — see suppressOverlapped. */
function findKeywordMatch(text, keywords) {
  if (!text) return null;
  for (const kw of keywords) {
    const m = keywordRegex(kw).exec(text);
    if (m) return { keyword: kw, index: m.index, length: m[0].length };
  }
  return null;
}

/* ── WHAT THE BANK DID TO THE WORD "APPROVED" ──────────────────────────────
   Two modifiers change the decision an email is reporting, and neither can be
   settled by counting keywords — a denial and an approval share almost all of
   their vocabulary. "Unfortunately, you were not approved for the requested
   credit limit" contains the APPROVED keyword "credit limit" fair and square;
   what makes it a denial is the word "not" in front of "approved".

   So these two run BEFORE the keyword contest and remove the APPROVED matches
   outright. The bank has stated its decision; no context word outranks it.

     negated  ("not approved", "unable to approve", "cannot fund")  → DENIED
     reduced  ("approved for a reduced amount")                     → COUNTEROFFER

   The filler list between the modifier and the approval word is deliberately a
   closed set of function words rather than `\w+`. A wider gap starts eating
   ordinary sentences: "this does not affect your approved limit" is an approval,
   and a two-word wildcard would read it as a denial. */
const APPROVAL_WORD = "(?:approve|approved|approves|approving|approval|approvals|fund|funded|funding)";
const NEGATOR = "(?:not|never|cannot|can['’]t|won['’]t|unable\\s+to|declined\\s+to|refused\\s+to|regret\\s+to)";
const NEGATION_FILLER = "(?:be|been|being|yet|currently|able\\s+to|going\\s+to|likely\\s+to|in\\s+a\\s+position\\s+to)\\s+";
const NEGATED_APPROVAL = new RegExp(`\\b${NEGATOR}\\s+(?:${NEGATION_FILLER})?${APPROVAL_WORD}\\b`, "i");

/* "reduced" on its own is NOT enough — "you are approved, your APR has been
   reduced" is an approval. It has to be a reduced AMOUNT. */
const REDUCED_AMOUNT = /\b(?:reduced|lower|lowered|partial|smaller|decreased)\s+(?:\w+\s+){0,1}?(?:amount|limit|line|offer|sum|figure)\b|\bpartial\s+approval\b/i;
const ANY_APPROVAL_WORD = new RegExp(`\\b${APPROVAL_WORD}\\b`, "i");

function findModifiedApproval(subject, body) {
  for (const source of ["subject", "body"]) {
    const text = (source === "subject" ? subject : body) || "";
    if (!text) continue;
    const neg = NEGATED_APPROVAL.exec(text);
    if (neg) {
      return { event_type: "DENIED", source, keyword: neg[0].toLowerCase().replace(/\s+/g, " "), index: neg.index, length: neg[0].length };
    }
  }
  for (const source of ["subject", "body"]) {
    const text = (source === "subject" ? subject : body) || "";
    if (!text || !ANY_APPROVAL_WORD.test(text)) continue;
    const red = REDUCED_AMOUNT.exec(text);
    if (red) {
      return { event_type: "COUNTEROFFER", source, keyword: red[0].toLowerCase().replace(/\s+/g, " "), index: red.index, length: red[0].length };
    }
  }
  return null;
}

/* A SHORTER PHRASE INSIDE A LONGER ONE IS NOT A SECOND SIGNAL — it is the same
   words being read twice, and the more specific reading is the right one. This
   is what makes "not approved" (DENIED) beat "approved" (APPROVED) regardless
   of which rule is listed first, without reordering the rule list. */
function suppressOverlapped(matches) {
  return matches.filter((m) => !matches.some((n) =>
    n !== m &&
    n.source === m.source &&
    n.length > m.length &&
    n.index <= m.index &&
    n.index + n.length >= m.index + m.length
  ));
}

function isNoise(from, subject) {
  if (from) {
    const lf = from.toLowerCase();
    for (const p of NOISE_FROM_PATTERNS) if (lf.includes(p)) return p;
  }
  if (subject) {
    const ls = subject.toLowerCase();
    for (const p of NOISE_SUBJECT_PATTERNS) if (ls.includes(p)) return p;
  }
  return null;
}

/* ONE IMPLEMENTATION, TWO ENTRY POINTS. classifyBankEmail and classifyFull used
   to hold a byte-for-byte copy of this loop each, so the substring bug had to be
   found and fixed twice and the two could silently drift apart. classifyFull is
   now the only implementation; classifyBankEmail reads its event_type. The only
   real difference was that classifyBankEmail has no From header to noise-check,
   which is a null argument, not a second function. */
function classifyFull({ subject, from, body }) {
  const noiseMatch = isNoise(from, subject);
  if (noiseMatch) return { event_type: "NOISE", confidence: "high", matched_rule: `noise_filter:${noiseMatch}` };

  const text = body || "";

  // Decided before the keyword contest, and it wins it — see findModifiedApproval.
  const modified = findModifiedApproval(subject, text);

  let matches = [];
  for (const rule of CLASSIFICATION_RULES) {
    /* An approval word the bank negated or cut down is not an approval. Drop
       the whole rule rather than the single keyword: the leftovers ("credit
       limit", "approval") are the denial letter describing what it is denying. */
    if (modified && rule.event_type === "APPROVED") continue;

    let m = null;
    if (modified && rule.event_type === modified.event_type) {
      m = modified; // the decisive phrase, reported in place of the rule's own keyword
    } else {
      const subjectMatch = findKeywordMatch(subject, rule.keywords);
      const bodyMatch = subjectMatch ? null : findKeywordMatch(text, rule.keywords);
      const hit = subjectMatch || bodyMatch;
      if (hit) m = { ...hit, source: subjectMatch ? "subject" : "body" };
    }
    if (!m) continue;

    let hasDollarAmount = false;
    if (rule.dollarAmountBoost) {
      hasDollarAmount = DOLLAR_PATTERN.test(subject || "") || DOLLAR_PATTERN.test(text);
    }
    matches.push({ event_type: rule.event_type, ...m, hasDollarAmount });
  }

  // The decisive phrase may name a rule whose own keywords never fired —
  // "approved for a lower credit limit" is a counteroffer with no counteroffer word in it.
  if (modified && !matches.some((m) => m.event_type === modified.event_type)) {
    matches.push({ event_type: modified.event_type, ...modified, hasDollarAmount: false });
    // Back into rule order. Everything already in the list is in that order, so
    // this only places the one row just added.
    const rank = (t) => CLASSIFICATION_RULES.findIndex((r) => r.event_type === t);
    matches.sort((a, b) => rank(a.event_type) - rank(b.event_type));
  }

  matches = suppressOverlapped(matches);

  if (matches.length === 0) return { event_type: "NOISE", confidence: "low", matched_rule: "no_keyword_match" };

  const best = matches[0];
  const confidence = matches.length === 1 ? "high" : "medium";
  const dollarNote = best.hasDollarAmount ? "+dollar_amount" : "";
  return { event_type: best.event_type, confidence, matched_rule: `${best.source}:${best.keyword}${dollarNote}` };
}

// classifyBankEmail — pure, returns the classification string (event_type).
export function classifyBankEmail(subject, body) {
  return classifyFull({ subject, from: null, body }).event_type;
}

// Exported for the classifier tests only — the adapter itself calls classifyFull.
export { classifyFull as _classifyFull };

// ---------------------------------------------------------------------------
// 3. Normalize raw Mailgun body into a flat event
// ---------------------------------------------------------------------------
export function normalizeMailgunEvent(body) {
  const b = body || {};

  // Signature fields arrive nested or flat
  const sig = b.signature || {};
  const timestamp = sig.timestamp || b.timestamp || "";
  const token = sig.token || b.token || "";
  const signature = sig.signature || b.signature_value || "";

  // Email fields — Mailgun sends both capitalized and lowercase variants
  const subject = b.subject || b.Subject || "";
  const from = b.sender || b.from || b.From || "";
  const bodyPlain = b["body-plain"] || b.body_plain || "";
  const strippedText = b["stripped-text"] || b.stripped_text || "";
  const text = strippedText || bodyPlain;

  // Message-Id for idempotency (best-effort)
  const messageId =
    b["Message-Id"] ||
    b["message-id"] ||
    b.messageId ||
    b.message_id ||
    null;

  // The recipient is what identifies WHICH client this bank email belongs to: F-10
  // provisions a per-client forwarding address `monitor+<clientId>@fundhub.ai`
  // (f-10-client-funding-inbox-provisioner.mjs:50). Without it, mail.response carries
  // nothing that resolves a contact and every downstream workflow (F-06, F-09, F-11)
  // exits `no_client` — they were dead on the real event.
  const recipient =
    b.recipient || b.to || b.To ||
    (b["event-data"] && b["event-data"].recipient) ||
    null;

  return { timestamp, token, signature, subject, from, text, messageId, recipient };
}

// ---------------------------------------------------------------------------
// 4. Map a normalized Mailgun event to canonical events
// ---------------------------------------------------------------------------
export function mapToCanonical(evt) {
  // An inbound bank email always maps to mail.response
  return [{ name: "mail.response" }];
}

// Resolve the client from the forwarding recipient. Prefers the deterministic
// `monitor+<clientId>@` plus-address F-10 mints, then falls back to a lookup on the
// stored funding_email_forwarding_address for any address minted another way.
export function clientIdFromRecipient(recipient) {
  const m = /\+([0-9a-zA-Z-]+)@/.exec(String(recipient || ""));
  return m ? m[1] : null;
}

/* THE REPLY TAG. Same plus-address idea F-10 already uses for bank mail, on a
   different local part so the two can never be confused: `monitor+<id>@` is a
   bank statement ABOUT a client, `reply+<id>@` is the client's own words TO us,
   and those two produce completely different rows.

   Minted on every outbound email by src/messaging/providers/resend.mjs. The
   local part must be exactly `reply` — a `monitor+` address arriving here must
   fall through to the From-address path, not be read as a reply. */
const REPLY_TAG = /(?:^|<)\s*reply\+([0-9a-fA-F-]{36})@/;

export function replyClientIdFrom(recipient) {
  const m = REPLY_TAG.exec(String(recipient || "").trim().toLowerCase());
  return m ? m[1] : null;
}

/* The org that owns a client. Needed because the reply tag names a client and
   the event bus needs a tenant; without this an emit falls back to the default
   org, which on a multi-tenant install is the wrong one. */
async function orgOfClient(db, clientId) {
  const r = await db.query(`SELECT org_id FROM clients WHERE id = $1 LIMIT 1`, [clientId]);
  return r.rows[0]?.org_id || null;
}

/* resolveClientFromSender — the client who WROTE this email, if it was a client.
   Matched on the From address against `clients.email`, case-insensitively and
   trimmed, the same lookup src/handlers/comms.mjs findClient() does.

   THIS IS A DIFFERENT QUESTION FROM resolveClientFromRecipient BELOW, AND
   CONFLATING THEM WOULD PUT A BANK'S WORDS IN A CLIENT'S MOUTH.

   The inbound mail this adapter was built for is a bank statement forwarded to
   `monitor+<clientId>@fundhub.ai`. There the client is the RECIPIENT — the mail
   is addressed to their monitoring inbox — and the sender is a bank. That is
   what `mail.response` is, and it is why onMailResponse writes a `bank_inbox`
   row and not a message.

   A client replying to an email we sent them is the opposite shape: they are
   the SENDER, and the recipient is one of our own addresses. That is a person
   talking to us, which is the only thing that belongs on their conversation
   thread. The distinction is an observable fact about the payload, not a guess:
   the From address either matches a client record or it does not.

   ORG COMES FROM THE MATCHED CLIENT, not from a default. `clients.email` has no
   unique index in this schema, so two orgs could hold the same address; LIMIT 1
   would then pick one arbitrarily and file a person's email under a company
   that is not theirs. So the org is read off the row that matched, and the
   event is emitted into it — the same shape resolveClientFromRecipient's
   sibling lookup returns. */
export async function resolveClientFromSender(db, from) {
  const email = String(from || "").trim().toLowerCase();
  if (!email) return null;
  // A From header is frequently `Name <addr@host>`; match the address inside
  // angle brackets when there is one, and the whole string when there is not.
  const bracketed = /<([^>]+)>/.exec(email);
  const address = (bracketed ? bracketed[1] : email).trim();
  if (!address) return null;
  /* TWO ROWS, NOT ONE, AND NO `LIMIT 1`. This used to be `LIMIT 1` with no
     ORDER BY, which is not "the oldest client with that address" — it is an
     ARBITRARY one, whichever Postgres handed back first. When two records share
     an address (a couple, a business address, a reused work account, the same
     person entered twice) a reply would be filed onto whichever of them the
     planner happened to reach, and the next read could pick the other.

     Reading two rows is enough to know whether there is exactly one answer. */
  const r = await db.query(
    `SELECT id, org_id FROM clients WHERE lower(email) = $1 LIMIT 2`,
    [address]
  );
  if (r.rows.length > 1) {
    /* AMBIGUOUS — REFUSE TO GUESS. Filing a person's words onto the wrong
       customer's credit file is worse than filing them nowhere: the wrong
       client's thread now contains somebody else's private message, and the
       right client looks like they never replied. The caller records the mail
       unthreaded instead, which is visible and recoverable. */
    return { clientId: null, orgId: null, ambiguous: true, address };
  }
  const c = r.rows[0];
  return c ? { clientId: c.id, orgId: c.org_id, ambiguous: false, address } : null;
}

export async function resolveClientFromRecipient(db, recipient) {
  if (!recipient) return null;
  const fromPlus = clientIdFromRecipient(recipient);
  if (fromPlus) return fromPlus;
  const r = await db.query(
    `SELECT id FROM clients WHERE custom_fields->>'funding_email_forwarding_address' = $1 LIMIT 1`,
    [String(recipient).trim().toLowerCase()]
  );
  return r.rows[0]?.id || null;
}

// ---------------------------------------------------------------------------
// 5. Outbound delivery events — the CRM cutover Ticket 2
//
// The return path: what Mailgun tells us about a message WE sent. A different
// payload shape from the inbound bank email above, and it must never be
// classified as one.
//
//   { "signature": { timestamp, token, signature },
//     "event-data": { event, recipient, severity,
//                     message: { headers: { "message-id": "..." } },
//                     "delivery-status": { message, code, description } } }
// ---------------------------------------------------------------------------

/** True when this payload is a delivery event rather than a forwarded email. */
export function isDeliveryEvent(body) {
  const d = body && body["event-data"];
  return !!(d && typeof d === "object" && typeof d.event === "string" && d.event);
}

/* Mailgun's event names → our `messages.status`.

   `complained` is the one that matters most and it is NOT a delivery failure —
   the mail arrived, was read, and the recipient pressed "this is spam". It is
   recorded on the message so an operator can see which send drew it, and it
   writes an opt-out, which is the part that has legal weight.

   `opened` and `clicked` are absent deliberately. They are engagement tracking,
   not delivery state, and letting an open overwrite `delivered` would lose the
   only record that the message actually landed. */
export const DELIVERY_STATUS_MAP = {
  delivered: "delivered",
  complained: "complained",
  rejected: "rejected",
  failed: null // resolved by severity below — permanent vs temporary
};

/* Who picks up a spam complaint, and under what source name. `admin` matches
   GATE_TASK_ROLE in src/messaging/gate.mjs: reviewing message copy is the same
   operational job whether the gate caught the wording or a recipient did. */
export const COMPLAINT_TASK_ROLE = "admin";
export const COMPLAINT_SOURCE = "mailgun-complaint";

/* The source name an unsubscribe is filed under. Deliberately NOT
   'provider_complaint': a spam report and an unsubscribe both stop the mail,
   but only one of them is somebody saying our copy looked like spam, and an
   operator reading opt_outs needs to tell those apart. */
export const UNSUBSCRIBE_SOURCE = "provider_unsubscribe";

/* `unsubscribed` WAS IN THIS SET UNTIL 2026-08-18 (T5-02), which meant the
   provider told us somebody had unsubscribed and we threw it away. The result
   was backwards: a spam complaint — the weaker, angrier signal — stopped the
   mail, and a deliberate press of the unsubscribe button did nothing at all.
   It is handled in its own branch below rather than added to
   DELIVERY_STATUS_MAP, because an unsubscribe is not a delivery state: the
   mail arrived, and writing it as a status would overwrite `delivered` and
   destroy the only record that it landed. */
export const IGNORED_DELIVERY_EVENTS = new Set([
  "accepted", "opened", "clicked", "stored", "delivered_ip"
]);

/* Mailgun writes the id with angle brackets on the send response and without
   them in the event payload. Whichever form the dispatcher stored, the two must
   still match, so both sides are stripped before comparison. */
export function normalizeMessageId(id) {
  const s = String(id || "").trim();
  return s.replace(/^<+/, "").replace(/>+$/, "");
}

export function normalizeDeliveryEvent(body) {
  const b = body || {};
  const sig = b.signature || {};
  const d = b["event-data"] || {};
  const headers = (d.message && d.message.headers) || {};
  const ds = d["delivery-status"] || {};

  const errorParts = [];
  if (ds.code) errorParts.push(`mailgun_${ds.code}`);
  if (ds.message || ds.description) errorParts.push(String(ds.message || ds.description));
  if (d.reason && errorParts.length === 0) errorParts.push(String(d.reason));

  return {
    timestamp: sig.timestamp || b.timestamp || "",
    token: sig.token || b.token || "",
    signature: sig.signature || b.signature_value || "",
    event: String(d.event || "").trim().toLowerCase(),
    severity: String(d.severity || "").trim().toLowerCase(),
    recipient: d.recipient || null,
    providerMessageId: normalizeMessageId(headers["message-id"] || d.id || ""),
    // Operator-facing only. Truncated, and it never carries the message body.
    errorText: errorParts.length ? errorParts.join(": ").slice(0, 300) : null
  };
}

/**
 * handleMailgunDeliveryEvent({ db, body, signingKey })
 *   → { ok, status, updated, event?, optedOut?, reason? }
 *
 * Fail-closed on the signature, exactly like the inbound path. `updated` is the
 * number of message rows moved; `optedOut` says whether a complaint produced an
 * opt-out row, because "we recorded the complaint" and "we will stop emailing
 * them" are two different claims and only the second one is the obligation.
 */
export async function handleMailgunDeliveryEvent({ db, body, signingKey }) {
  const evt = normalizeDeliveryEvent(body);

  /* FAIL CLOSED, UNCONDITIONALLY — no `if (signingKey)` guard, ever.

     That guard is the exact shape of the bug this ticket was written to kill on
     the inbound path: with the key unset, verification was skipped entirely and
     any stranger could POST a forged payload. On THIS path a forged payload
     opts a client out of email, or marks a live message dead. Passing no key
     must therefore reject everything, which is what verifyMailgunSignature
     already does — the bug was never calling it. */
  if (!verifyMailgunSignature(evt.timestamp, evt.token, evt.signature, signingKey)) {
    return { ok: false, status: 401, reason: "bad_signature", updated: 0 };
  }

  if (IGNORED_DELIVERY_EVENTS.has(evt.event)) {
    return { ok: true, status: 200, reason: "not_delivery_state", updated: 0, event: evt.event };
  }

  /* UNSUBSCRIBED — a withdrawal of consent, handled here and then done.

     It sits between the signature check and the status machinery on purpose.
     Above it, so a forged payload can never opt anybody out. Below the status
     machinery, so it can return before `mapped` is consulted — an unsubscribe
     has no delivery status to write and must not touch messages.status.

     It does NOT raise a review task, which is the one thing that makes it
     different from the complaint branch further down. A spam report is a
     signal about the TEMPLATE: somebody found the copy objectionable enough to
     press a button that damages our sending domain, and a person should read
     it. An unsubscribe is the ordinary, wanted outcome of the link we are
     obliged to put in the mail. Filing a task for each one would bury the
     complaints that actually need reading. */
  if (evt.event === "unsubscribed") {
    const row = await findOutboundEmailByProviderId(db, evt.providerMessageId);
    const target = row && row.client_id
      ? { clientId: row.client_id, orgId: row.org_id }
      : await resolveClientByEmail(db, evt.recipient);
    if (!target) {
      return {
        ok: true, status: 200, reason: "unmatched", updated: 0,
        event: evt.event, optedOut: false, taskRaised: false
      };
    }
    await recordOptOut(db, target.clientId, target.orgId, "email", UNSUBSCRIBE_SOURCE);
    return {
      ok: true, status: 200, reason: "unsubscribed", updated: 0,
      event: evt.event, optedOut: true, taskRaised: false
    };
  }

  let mapped = DELIVERY_STATUS_MAP[evt.event];
  if (evt.event === "failed") {
    // Mailgun splits hard bounces from transient ones by severity, and the two
    // mean different things to a dispatcher: one must never be retried, the
    // other should be. An absent severity is treated as temporary — the safe
    // direction, because wrongly marking an address permanently dead loses a
    // client's mail silently.
    mapped = evt.severity === "permanent" ? "bounced" : "failed";
  }
  if (!mapped) {
    return { ok: true, status: 200, reason: "unknown_event", updated: 0, event: evt.event };
  }

  const row = await findOutboundEmailByProviderId(db, evt.providerMessageId);

  /* THE OPT-OUT COMES FIRST, and it is the reason this endpoint exists.

     A spam complaint is a withdrawal of consent. It is written before the status
     update so that a failure updating the message row cannot cost us the
     opt-out — the wrong order here means we keep emailing somebody who reported
     us, which is the failure with legal consequences rather than operational
     ones. Written through src/lib/opt-out.mjs, the only sanctioned writer, so
     the send-path guard reads it without a second implementation to diverge. */
  let optedOut = false;
  let taskRaised = false;
  if (evt.event === "complained") {
    const target = row && row.client_id
      ? { clientId: row.client_id, orgId: row.org_id }
      : await resolveClientByEmail(db, evt.recipient);
    if (target) {
      await recordOptOut(db, target.clientId, target.orgId, "email", "provider_complaint");
      optedOut = true;
      taskRaised = await raiseComplaintTask(db, target, row, evt);
    }
  }

  if (!row) {
    /* No message row. Acknowledged so Mailgun stops retrying, but named — an
       unmatched receipt usually means the dispatcher never stored
       provider_message_id, and a bare 200 would hide that indefinitely.
       A complaint may still have opted the recipient out via the email
       fallback above, so that outcome is reported separately from this one. */
    return { ok: true, status: 200, reason: "unmatched", updated: 0, event: evt.event, optedOut, taskRaised };
  }

  const upd = await db.query(
    `UPDATE messages
        SET status = $2,
            last_error = COALESCE($3, last_error),
            updated_at = now()
      WHERE id = $1`,
    [row.id, mapped, evt.errorText]
  );

  return { ok: true, status: 200, updated: upd.rowCount ?? 0, event: evt.event, optedOut, taskRaised };
}

/* A complaint is a signal about a TEMPLATE, not only about one recipient.

   Opting the person out and telling nobody treats it as a single lost contact.
   It is usually the copy: if a template draws complaints, the next hundred sends
   of it will draw more, and nobody finds that out from an opt_outs row. So the
   complaint raises work for a person, the same way the compliance gate raises
   work when a message uses restricted wording.

   Built through createTask, which is the only sanctioned writer to the tasks
   table (src/lib/create-task.mjs) — src/workflows/task-routing.test.mjs fails
   the build on a raw insert into it anywhere under src/, because a task with no
   owning role is work that reaches nobody. That test greps the file text, so
   this comment says it in words rather than showing the statement.

   THE DEDUPE KEY IS `body`. 006_tasks_idempotency.sql keys on
   (client_id, source_workflow, body), so it must be identical when Mailgun
   retries the same complaint and different for a genuinely new one. The
   provider's message id is exactly that. When the receipt matched no message
   row, the recipient address stands in — one task per complaining address
   rather than one per retry.

   NO MESSAGE COPY IN THE TASK. Same reasoning as the gate: a task list is an
   index over work, not a second outbox holding client-facing text. The template
   key is named instead, because that is the thing to go and read. */
async function raiseComplaintTask(db, target, row, evt) {
  const res = await createTask(db, {
    orgId: target.orgId,
    clientId: target.clientId,
    title: "Spam complaint — review the template that sent this",
    sourceWorkflow: COMPLAINT_SOURCE,
    assigneeRole: COMPLAINT_TASK_ROLE,
    body: `mailgun-complaint:${evt.providerMessageId || evt.recipient || "unattributed"}`,
    detail: [
      row?.template_key
        ? `Template: ${row.template_key}`
        : "Template unknown — the complaint matched no message row.",
      "The recipient has been opted out of email automatically."
    ]
  });
  return !!res?.created;
}

/* Matched on THEIR id, both sides stripped of angle brackets. Guarded to
   outbound email so a colliding id cannot move a row on another channel.
   Shared by the unsubscribe branch and the delivery-status branch so the two
   can never drift into matching different rows for the same receipt. */
async function findOutboundEmailByProviderId(db, providerMessageId) {
  const found = await db.query(
    `SELECT id, org_id, client_id, template_key
       FROM messages
      WHERE btrim(provider_message_id, '<>') = $1
        AND direction = 'outbound'
        AND channel = 'email'`,
    [providerMessageId]
  );
  return found.rows[0] || null;
}

/* Last resort for a complaint we cannot tie to a message row. A complaint that
   names a recipient we know is still a withdrawal of consent; dropping it
   because the message id did not match would be the system forgetting on a
   technicality. Returns null when the address is unknown — there is no client to
   opt out, and inventing one is worse than recording nothing. */
async function resolveClientByEmail(db, recipient) {
  const email = String(recipient || "").trim().toLowerCase();
  if (!email) return null;
  const r = await db.query(
    `SELECT id, org_id FROM clients WHERE lower(email) = $1 LIMIT 1`,
    [email]
  );
  const c = r.rows[0];
  return c ? { clientId: c.id, orgId: c.org_id } : null;
}

// ---------------------------------------------------------------------------
// Adapter entrypoint
// handleMailgunWebhook({ db, body, signingKey })
//   → { ok, status, emitted: [{name, id, deduped}], reason? }
// ---------------------------------------------------------------------------
export async function handleMailgunWebhook({ db, body, signingKey }) {
  /* OUTBOUND EVENT ROUTING — the CRM cutover Ticket 2.

     Mailgun posts two completely different payloads and this adapter used to
     assume every one of them was a forwarded bank email. A delivery receipt has
     no subject and no body, so classifyFull() scored it NOISE and emitted it
     onto the bus as a real `mail.response`. Delivery receipts, bounces and spam
     complaints were therefore arriving as inbound bank mail — and the spam
     complaints, which are the ones that legally have to stop future sending,
     were the quietest of the three because NOISE is the classification nothing
     reacts to.

     Routed before verification because the delivery path verifies with the same
     key and the same function; splitting first keeps one signature check per
     path rather than one shared check and two shapes. */
  if (isDeliveryEvent(body)) {
    return handleMailgunDeliveryEvent({ db, body, signingKey });
  }

  const evt = normalizeMailgunEvent(body);

  /* FAIL CLOSED, unconditionally — matching every other adapter.

     This used to be wrapped in `if (signingKey)`, so an absent MAILGUN_SIGNING_KEY
     skipped verification altogether and ANY caller could POST a forged payload
     and have it emitted onto the canonical event bus as a real mail.response.
     .env.example ships the key blank and APPLY-NOTES never mentions it, so that
     was the shipped configuration, not a hypothetical.

     verifyMailgunSignature already returns false for a missing key; the bug was
     never calling it. commas/twilio/bland/clickfunnels all fail closed —
     mailgun was the sole exception, and the file's own header comment claimed
     otherwise. */
  if (!verifyMailgunSignature(evt.timestamp, evt.token, evt.signature, signingKey)) {
    return { ok: false, status: 401, reason: "bad_signature", emitted: [] };
  }

  /* A BANKER ANSWERING BANK OUTREACH (495). Bank outreach email carries a
     Reply-To of reply+bk-<contact id>@ (src/messaging/providers/resend.mjs), a
     different local-part shape from a client's reply+<client id>@, so the two
     never mix. The banker's words are saved on their bank record and read by
     src/outreach/replies.mjs; they are not a client's bank statement, so no
     mail.response is emitted for them. */
  const bankerContactId = contactIdFromRecipient(evt.recipient);
  if (bankerContactId) {
    const saved = await recordBankerReply(db, {
      contactId: bankerContactId, from: evt.from, subject: evt.subject, text: evt.text, messageId: evt.messageId || null
    });
    return { ok: true, status: 200, emitted: [], banker: saved };
  }

  const { event_type: classification } = classifyFull({
    subject: evt.subject,
    from: evt.from,
    body: evt.text
  });

  const canonical = mapToCanonical(evt);
  const emitted = [];
  const clientId = await resolveClientFromRecipient(db, evt.recipient);

  /* Read AFTER the classification, never before it, and never able to change
     it — see the block above DOLLAR_SCAN. Amounts are gathered only when the
     bank said yes to something; a denial carries none.

     `amounts` stays null for every other classification, and null means the two
     amount keys are left OFF the payload entirely rather than written as an
     empty list. "We did not look" and "we looked and the email stated nothing"
     are different facts and the row should not blur them. */
  const preview = bodyPreviewOf(evt.text);
  const amounts = OFFERS_AN_AMOUNT.has(classification)
    ? findDollarAmounts(evt.subject, evt.text)
    : null;

  for (const c of canonical) {
    const payload = {
      classification,
      from: evt.from,
      to: evt.recipient,
      subject: evt.subject,
      // Capped, whitespace-flattened, and null when the email had no text.
      // See bodyPreviewOf, and the note on message.inbound further down for
      // why mail.response carries this at all now.
      bodyPreview: preview,
      clientId,
      source: "mailgun"
    };
    if (amounts) {
      payload.amountCandidates = amounts.candidates;
      payload.amountCandidatesFound = amounts.found;
    }
    const idKey = evt.messageId ? `mailgun:${evt.messageId}:${c.name}` : undefined;
    const res = await emit(db, c.name, payload, { idempotencyKey: idKey, clientId: clientId || undefined });
    emitted.push({ name: c.name, id: res.id, deduped: res.deduped });
  }

  /* ── A CLIENT REPLYING TO US — the inbound half of the staff reply inbox ──
     Emitted IN ADDITION TO mail.response above, never instead of it, and only
     when the From address matches a client record. See resolveClientFromSender
     for why that condition is the whole of the distinction between "a bank sent
     a statement about this person" and "this person wrote to us".

     WHY message.inbound RATHER THAN A NEW EVENT NAME. src/handlers/comms.mjs
     onMessageInbound already writes the `messages` row, threads it onto the
     client's conversation for that channel, and dedupes on (org, provider_ref).
     It reads the channel off the payload rather than assuming SMS, so an email
     runs the same code path an inbound text does — one handler, one threading
     rule, one dedupe. A second event name would be a second copy of that, and
     the two would drift.

     The STOP/START branch inside that handler NOW FIRES FOR EMAIL TOO
     (changed 2026-08-18, T5-01). It used to be guarded on `channel === "sms"`,
     and the note here defended that on the grounds that "STOP" in an email
     SUBJECT line is not a TCPA keyword. That much still holds — and it is why
     the branch reads the BODY and requires a whole-body exact match, so a
     subject line, a signature block or a quoted thread can never trigger it.
     What it got wrong was concluding that email therefore had no opt-out word
     at all, which left a client who replied "STOP" still on the list.

     `sid` carries the Message-Id because that is the field onMessageInbound
     writes to provider_ref — so a Mailgun redelivery of the same email lands on
     the (org_id, provider_ref) unique index and does not become a second
     message in the thread. An email with no Message-Id gets no dedupe key,
     which the bus already handles the same way for mail.response.

     THE WHOLE BODY IS CARRIED, and only here. This payload is a person's own
     words written to us, which is exactly what a conversation thread is, and a
     thread with the messages missing is not a thread.

     `mail.response` carries a CAPPED PREVIEW instead — changed 2026-08-30, and
     the note that used to sit here said it carried nothing at all. That was
     true, and it is why onMailResponse wrote the subject line into
     body_preview: every bank_inbox row showed the same sentence twice, and the
     paragraph where the bank states the approved amount was gone forever. The
     reasoning behind it still stands and is respected — a forwarded bank
     statement's full text is account detail nobody asked us to keep, so the
     full text is still not stored. What is stored is 500 characters
     (bodyPreviewOf), which is a preview line for the screen, plus the dollar
     figures the classifier was already finding and discarding. */
  /* WHO REPLIED — THE ADDRESS THEY WROTE TO ANSWERS FIRST.

     Every email we send now carries a Reply-To of `reply+<clientId>@<domain>`
     (src/messaging/providers/resend.mjs), so an ordinary reply comes back
     addressed to exactly one client. That is deterministic: it does not care
     whether two people share a mailbox, whether they replied from their phone
     rather than the address on file, or whether they changed jobs.

     The From address is the FALLBACK, and it can only answer when it answers
     unambiguously — see resolveClientFromSender. This ordering is T5-04: a
     reply used to be filed on whichever client the database happened to return
     first for that address. */
  const tagged = replyClientIdFrom(evt.recipient);
  const sender = tagged
    ? { clientId: tagged, orgId: await orgOfClient(db, tagged), ambiguous: false }
    : await resolveClientFromSender(db, evt.from);

  if (sender && (sender.clientId || sender.ambiguous)) {
    const inboundKey = evt.messageId ? `mailgun:${evt.messageId}:message.inbound` : undefined;
    if (sender.ambiguous) {
      /* Recorded, not thrown away, and not attached to anybody. Losing a
         client's words is not an acceptable way to avoid misfiling them. */
      console.warn(
        `[mailgun] inbound reply from an address held by more than one client — ` +
        `filed unthreaded rather than on a guess. Message ${evt.messageId || "(no id)"}.`
      );
    }
    const res = await emit(db, "message.inbound", {
      from: evt.from,
      to: evt.recipient,
      body: evt.text,
      subject: evt.subject,
      sid: evt.messageId,
      channel: "email",
      source: "mailgun",
      // Named on the payload so the reason a message is unthreaded survives
      // into the event log rather than living only in a warning line.
      unresolved_reason: sender.ambiguous ? "address_matches_more_than_one_client" : undefined
    }, {
      idempotencyKey: inboundKey,
      orgId: sender.orgId || undefined,
      clientId: sender.clientId || undefined
    });
    emitted.push({ name: "message.inbound", id: res.id, deduped: res.deduped });
  }

  return { ok: true, status: 200, emitted };
}
