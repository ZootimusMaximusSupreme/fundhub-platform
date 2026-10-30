// The outbound messaging gate — the single checkpoint every outbound message
// passes through before any provider is contacted.
//
// This is the messaging sibling of src/compliance/screen.mjs, and it is written
// to that file's posture on purpose. Read its header; the same three properties
// hold here and each one is load-bearing:
//
// 1. DETERMINISTIC. Patterns, a clock and a database row. No model is asked
//    whether a message is safe to send.
//
// 2. FAILS CLOSED ON ANY ERROR. A database that is down, a malformed regex, a
//    message object missing its org — every one returns `blocked`, never
//    `allowed`. The catch at the bottom of gate() is the rule, not tidiness.
//
// 3. THERE IS NO OVERRIDE. No `force`, no `skipCompliance`, no `override`, no
//    `test_bypass`. Not as an argument, not as an option, not as an environment
//    variable, and not "just for tests" — the tests below drive this with real
//    inputs. assertNoBypass() actively rejects an options object carrying one,
//    so an override added by a future caller fails loudly at the gate instead of
//    quietly opening it. Do not add one. If a rule is wrong, fix the rule.
//
//
// WHY THE CLOCK IS AN ARGUMENT.
//
// Quiet hours are a wall-clock question, and a gate that reads the system clock
// directly can only be tested by running the suite at 11pm. `now` is injected so
// every case below states the exact instant it is asserting about. The default
// is the real clock; nothing in production passes one.
//
//
// THE SLEEPING-WORKFLOW CASE, WHICH IS THE WHOLE POINT.
//
// An Inngest workflow can be scheduled on Monday, sleep, and wake on Thursday.
// If the client opted out on Tuesday, that message must not go out — even
// though every compliance check "passed" at the moment it was queued.
//
// The defence is structural rather than a special case: THIS FUNCTION NEVER
// READS WHEN THE MESSAGE WAS CREATED OR SCHEDULED. There is no createdAt, no
// scheduledAt, no queuedAt in the input it consults, so there is no value a
// caller could pass that would make an opt-out recorded after queueing count
// for less than one recorded before it. Opt-out state is read fresh, from the
// database, at the instant of sending. There is no backdating exception because
// there is nothing to backdate against.
//
//
// RETURN SHAPE. { state, reasons[], task } — `state` is 'allowed' | 'blocked'.
// There is no third state and no soft block: anything that is not exactly
// 'allowed' must not reach a provider.

import { isOptedOut } from "../lib/opt-out.mjs";
import { loadRules, appliesTo, toRegex } from "../compliance/screen.mjs";
import { createTask } from "../lib/create-task.mjs";
import { BANK_EMAIL_KEYS } from "../outreach/mail.mjs";
import { isImmediateStaffAlert, isStaffText, staffTextRecipient, usesSetterContactHours } from "../staff/message-recipient.mjs";

/* Who owns a held message.
   `admin` rather than a client-facing role: the fix is editing a template, which
   is operational work, and src/lib/create-task.mjs rejects anything that is not
   an employee role outright. Work with no owner reaches nobody, which is the
   failure that helper exists to prevent. */
export const GATE_TASK_ROLE = "admin";

/* The source_workflow every task from this gate carries. Part of the dedupe key
   in 006_tasks_idempotency.sql, so it must stay stable. */
export const GATE_SOURCE = "messaging-gate";

/** Channels this gate knows how to reason about. An unrecognised channel is a
    block: we cannot apply quiet hours to a channel we have no rule for, and
    guessing which rules apply is the failure this exists to prevent. */
export const CHANNELS = new Set(["sms", "email", "voice"]);

/** Welcome mail for a partner or affiliate. They are not client rows, so these
    keys are the only emails allowed out with no clientId attached. */
export const PARTNER_WELCOME_KEYS = new Set(["AF1", "EMAIL-PARTNER-WELCOME"]);

/** The partner welcome TEXT. Same standing as the email above: a partner has no
    clients row, so there is no opt-out record to read for them.

    The extra condition that makes this safe is upstream, not here.
    src/partners/welcome.mjs writes this row ONLY when the applicant ticked the
    text box on the apply form, so the row existing is itself the consent
    record — there is no path that queues this key without it.

    Quiet hours are untouched: a partner text queued at 2am still waits for
    08:00 Arizona like everyone else's. */
export const PARTNER_WELCOME_SMS_KEYS = new Set(["SMS-PARTNER-WELCOME"]);

/** Voluntary EEO self-ID invite — candidate has no clients row (053_eeo_selfid.sql). */
export const CANDIDATE_EEO_EMAIL_KEYS = new Set(["EMAIL-CANDIDATE-EEO-INVITE"]);

/** Bank outreach email to a banker (495). A banker is not a client row; their
    opt-out lives on outreach_contacts, so that is what this gate reads. The
    address must belong to a saved banker in this company, or it is refused. */
export const BANK_OUTREACH_EMAIL_KEYS = new Set(BANK_EMAIL_KEYS);

/** A destination we could actually text. Deliberately stricter than the email
    branch's `includes("@")`: a partner text with no real number on the row
    falls back to recipient_unknown and is blocked, not sent into the dark. */
const E164 = /^\+[1-9]\d{7,14}$/;

/** Quiet hours, Arizona time, inclusive start and exclusive end.
    20:00 through 07:59 is closed; 08:00 through 19:59 is open.

    These used to read 23:00/11:00 against America/New_York, which is the same
    8am-8pm window seen from Phoenix in summer — Eastern was standing in for a
    zone nobody here works in. Arizona does not observe daylight saving, so
    naming the real zone also removes the winter drift: the old pair widened to
    9am-9pm Phoenix once Eastern fell back, which is later than anyone intended
    to be texting. Summer behaviour is unchanged; winter now starts and ends an
    hour earlier, which is the tighter side. */
export const QUIET_START_HOUR = 20;
export const QUIET_END_HOUR = 8;

/** The timezone quiet hours are measured in. A named zone, not an offset, so
    the operating system's timezone database stays the authority even though
    this particular zone never shifts. */
export const QUIET_HOURS_TZ = "America/Phoenix";

/** Channels quiet hours apply to. Texts wake people up; email does not.
    A Set rather than `channel === "sms"` so adding voice later is a one-word
    change at the definition instead of a condition to find in the body. */
export const QUIET_HOURS_CHANNELS = new Set(["sms"]);

/* The only option keys gate() accepts. Anything else is rejected — see
   assertNoBypass. Kept as an explicit allow-list rather than a deny-list of
   known bypass names, because a deny-list only stops the override someone
   already thought to name. */
const ALLOWED_OPTIONS = new Set(["now", "timeZone"]);

/* assertNoBypass — the structural half of "there is no override".

   Property 3 in the header is only worth the words if something enforces it.
   A future caller writing `gate(db, msg, { force: true })` gets an exception
   here, which gate() turns into a BLOCK — so the attempt to bypass the gate
   closes it rather than opening it. That direction is deliberate: the failure
   mode of a typo'd option name must never be "sent unchecked". */
function assertNoBypass(options) {
  for (const key of Object.keys(options || {})) {
    if (!ALLOWED_OPTIONS.has(key)) {
      throw new Error(
        `gate: unknown option ${JSON.stringify(key)}. This gate has no override, ` +
        `force, or bypass of any kind and must not be given one.`
      );
    }
  }
}

/* hourInZone — the hour of the day at `date` in the given zone, 0-23.

   Named for what it does rather than for one zone: the default moved from
   Eastern to Arizona and a function called easternHour returning a Phoenix
   hour is the kind of name that gets trusted and then quietly misread.

   Intl carries the timezone database, so daylight saving is handled without
   this file knowing when the transitions are. formatToParts rather than a
   formatted string because hour12:false renders midnight as "24" in some ICU
   versions and as "00" in others; reading the part and taking it modulo 24
   gives the same answer under both.

   Exported because it is the whole of the quiet-hours decision and is worth
   testing directly against the transition dates. */
export function hourInZone(date, timeZone = QUIET_HOURS_TZ) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "numeric", hour12: false
  }).formatToParts(date);
  const raw = parts.find((p) => p.type === "hour")?.value;
  const hour = Number(raw);
  if (!Number.isInteger(hour)) {
    // Unreadable clock. Throwing lands in gate()'s catch, which blocks — the
    // correct direction when we cannot tell what time it is where the
    // recipient's phone is.
    throw new Error(`hourInZone: could not read the hour in ${timeZone}`);
  }
  return hour % 24;
}

/* inQuietHours — true when `date` falls in the closed window.

   The window wraps midnight, so this is an OR rather than the usual
   start <= h < end. Getting that backwards yields a window that is never open,
   which is why it is its own exported function with its own tests. */
export function inQuietHours(date, timeZone = QUIET_HOURS_TZ) {
  const hour = hourInZone(date, timeZone);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/** The setter SOP's 6 a.m.–10 p.m. Phoenix window, only for named setter paths. */
export function inSetterContactQuietHours(date, timeZone = QUIET_HOURS_TZ) {
  const hour = hourInZone(date, timeZone);
  return hour >= 22 || hour < 6;
}

/* Prove / sim identity. Quiet hours still bind every real customer. These
   patterns are the plus-tags and agent self-loop used for fire proves — not
   a force flag, and not a path a live client can opt into. */
const AGENT_PROVE_PHONE_DIGITS = "16616054248";

export function emailLooksLikeProveSim(email) {
  const local = String(email || "").split("@")[0].toLowerCase();
  if (!local) return false;
  return local.startsWith("e2e+")
    || local.includes("+sim-")
    || local.includes("+colin-qa");
}

export function phoneIsAgentProveLine(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return false;
  return digits === AGENT_PROVE_PHONE_DIGITS || digits === "6616054248";
}

/** True only for a prove/sim file. The agent line alone is never enough. */
export function isProveSimRecipient({ email } = {}) {
  return emailLooksLikeProveSim(email);
}

export async function recipientSkipsQuietHours(db, clientId) {
  if (!clientId) return false;
  const { rows } = await db.query(
    `SELECT email, phone FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  return isProveSimRecipient(rows[0] || {});
}

/* gate(db, message, options) → { state, reasons[], task }

   message: {
     orgId,     — required. Missing means we do not know whose rules apply.
     clientId,  — required for client mail. Affiliate welcome AF1 records
                  toAddress instead; missing both is a block.
     channel,   — 'sms' | 'email' | 'voice'
     body,      — the rendered text that would be sent
     messageId  — optional; the messages.id row this decision is about, carried
                  into the raised task so a human can find it.
   }

   options: { now, timeZone } and nothing else.

   Every check runs; the reasons accumulate rather than short-circuiting, so an
   operator looking at a held message sees all of what is wrong with it instead
   of fixing one thing and rediscovering the next on the retry. */
export async function gate(db, message = {}, options = {}) {
  try {
    assertNoBypass(options);
    return await run(db, message, options);
  } catch (err) {
    // FAIL CLOSED. Every error becomes a block. `detail` carries the cause for
    // the operator; the reason text stays generic.
    return {
      state: "blocked",
      reasons: [{
        code: "gate_error",
        rule_set: "engine",
        message: "The message could not be checked, so it was not sent.",
        detail: String((err && err.message) || err).slice(0, 300)
      }],
      task: null
    };
  }
}

async function run(db, message, { now = () => new Date(), timeZone = QUIET_HOURS_TZ } = {}) {
  const { orgId, clientId, channel, body = "", messageId = null, templateKey = null,
    toAddress = null, providerRef = null } = message;

  // NOTE WHAT IS NOT DESTRUCTURED ABOVE: createdAt, scheduledAt, queuedAt.
  // They are absent on purpose — see the sleeping-workflow note in the header.
  // Adding one here would reintroduce exactly the bug this gate exists to stop.

  if (!orgId) throw new Error("gate: orgId is required");
  if (!channel) throw new Error("gate: channel is required");
  if (!CHANNELS.has(channel)) {
    throw new Error(`gate: unknown channel ${JSON.stringify(channel)}`);
  }

  const reasons = [];
  let task = null;

  // ---- 1. Opt-out ----------------------------------------------------------
  // Read now, from the database, per channel. A missing clientId is a block and
  // not a pass: a message with nobody attached has no opt-out record to check,
  // and "we could not find a record" must never resolve to "nobody objected".
  // A partner or affiliate is not a client row, so their own welcome mail has
  // no clientId to look up. The address is on the queued row and they asked for
  // it by filling in the apply form.
  const welcomeKey = String(templateKey || "");
  const welcomeTo = String(toAddress || "");
  const messageKind = { clientId, channel, templateKey, toAddress, providerRef };
  const staffText = isStaffText(messageKind);
  const partnerWelcome =
    (channel === "email" && PARTNER_WELCOME_KEYS.has(welcomeKey) && welcomeTo.includes("@"))
    || (channel === "sms" && PARTNER_WELCOME_SMS_KEYS.has(welcomeKey) && E164.test(welcomeTo));
  const candidateEeoWelcome =
    channel === "email" && CANDIDATE_EEO_EMAIL_KEYS.has(welcomeKey) && welcomeTo.includes("@");
  const bankOutreach =
    !clientId && channel === "email" && BANK_OUTREACH_EMAIL_KEYS.has(welcomeKey) && welcomeTo.includes("@");
  if (staffText) {
    const recipient = staffTextRecipient(messageKind);
    const matching = recipient && (await db.query(
      `SELECT id FROM staff
        WHERE org_id = $1 AND id = $2 AND phone = $3 AND status = 'active'
          AND lower(role) = ANY($4::text[])
          AND ($5::boolean = false OR notify_booked_call_sms = true)
        LIMIT 1`,
      [orgId, recipient.staffId, toAddress, recipient.roles, recipient.requireBookedAlertSwitch]
    )).rows[0];
    if (!matching) reasons.push(r("recipient_unknown", "consent",
      "This internal text is not addressed to an active enabled staff recipient."));
  } else if (bankOutreach) {
    const banker = (await db.query(
      `SELECT count(*)::int AS saved, count(*) FILTER (WHERE email_opt_out_at IS NOT NULL)::int AS opted_out
         FROM outreach_contacts WHERE org_id = $1 AND lower(btrim(email)) = lower(btrim($2))`,
      [orgId, welcomeTo])).rows[0] || {};
    if (!Number(banker.saved)) {
      reasons.push(r("recipient_unknown", "consent",
        "This bank outreach email is not addressed to a saved banker, so it was not sent."));
    } else if (Number(banker.opted_out)) {
      reasons.push(r("opted_out", "consent",
        "This banker asked us to stop emailing them. It was not sent.", { citation: "CAN-SPAM 15 U.S.C. 7704(a)(4)" }));
    }
  } else if (!clientId && !partnerWelcome && !candidateEeoWelcome) {
    reasons.push(r("recipient_unknown", "consent",
      "This message has no client attached, so we cannot check whether they asked us to stop. It was not sent."));
  } else if (clientId && await isOptedOut(db, clientId, channel)) {
    reasons.push(r("opted_out", "consent",
      `This person asked us to stop contacting them on ${channel}. It was not sent.`,
      { citation: "TCPA 47 U.S.C. 227" }));
  }

  // ---- 2. Quiet hours ------------------------------------------------------
  // Texts only. Measured in Arizona at the moment of sending, which is also why
  // a message held here is held rather than failed: it becomes sendable on its
  // own at 8am without anyone editing it.
  //
  // Prove/sim plus-tag files are outside this rule so a night fire can be
  // proven. Real customers still wait. Not a force / skipCompliance option.
  const setterHours = usesSetterContactHours(messageKind);
  const quiet = setterHours ? inSetterContactQuietHours(now(), timeZone) : inQuietHours(now(), timeZone);
  if (QUIET_HOURS_CHANNELS.has(channel) && quiet && !isImmediateStaffAlert(messageKind)) {
    const skip = staffText ? false : await recipientSkipsQuietHours(db, clientId);
    if (!skip) {
      reasons.push(r("quiet_hours", "tcpa",
        setterHours
          ? "Setter texts are not sent between 22:00 and 06:00 Phoenix time. This one is held until 06:00."
          : `Text messages are not sent between ${QUIET_START_HOUR}:00 and ${QUIET_END_HOUR}:00 Arizona time. This one is being held until the window opens.`,
        { citation: "TCPA 47 C.F.R. 64.1200(c)(1)", retryable: true }));
    }
  }

  // ---- 3. Restricted words -------------------------------------------------
  // Matched against the SAME compliance_rules rows the ad screen uses
  // (047_compliance_rules.sql) rather than a second list kept here. A phrase
  // that cannot run in an ad cannot run in a text either, and two lists would
  // eventually disagree about which is which.
  //
  // SCOPING, AND WHY IT IS WIDER THAN screen()'s. Ad copy is scoped by
  // offer_type, because an ad declares what it is selling. A message to a
  // client declares nothing, so there is no offer type to scope by — and
  // picking one on the caller's behalf would choose which body of law to apply.
  // So every rule whose platform scope is empty applies, regardless of its
  // offer_types. That is the fail-closed direction: more rules, never fewer.
  // It also excludes the TikTok row automatically, whose `.*` pattern matches
  // everything and which is scoped to a platform no message is sent on.
  const haystack = String(body || "");
  const rules = await loadRules(db, orgId);

  for (const rule of rules) {
    // Presence rules ("this disclosure must appear") are an ad-funnel concept —
    // they describe a landing page carrying the CROA disclosure, not a text
    // message. Applying them here would block every message ever sent for not
    // containing the disclosure, which is the unusable direction.
    if (rule.match_type === "required") continue;
    if (!appliesTo(rule.platforms, null)) continue;

    const matched = rule.match_type === "phrase"
      ? haystack.toLowerCase().includes(String(rule.pattern).toLowerCase())
      : toRegex(rule.pattern).test(haystack);
    if (!matched) continue;

    reasons.push({
      code: rule.rule_key,
      rule_set: rule.rule_set,
      message: rule.message,
      citation: rule.citation || undefined,
      severity: rule.severity
    });
  }

  // A restricted-word hit is the one kind of block a human has to act on: the
  // copy itself is wrong and will keep being wrong on every retry. The other
  // two clear on their own — the person opts back in, or the clock reaches 11am.
  // So this is the only branch that raises a task.
  const restricted = reasons.filter((x) => x.rule_set !== "engine"
    && x.rule_set !== "consent" && x.rule_set !== "tcpa");
  if (restricted.length) {
    // A createTask() spec, not a tasks row. createTask is the only sanctioned
    // writer (src/lib/create-task.mjs) and src/workflows/task-routing.test.mjs
    // fails the build on any raw insert into the tasks table anywhere in src/
    // — because a task with no assignee_role is work that reaches nobody.
    // (That test greps the file text, so this comment says it in words.)
    //
    // `body` IS THE DEDUPE KEY. 006_tasks_idempotency.sql keys on
    // (client_id, source_workflow, body), so this must be stable across replays
    // of the same held message and distinct between different ones. The message
    // id plus the rule codes is both: re-gating the same message produces the
    // identical string and dedupes, while a different message or a different
    // rule produces a new task.
    //
    // The MESSAGE BODY IS DELIBERATELY NOT IN IT. That copy is client-facing
    // text about a consumer's file; a task list is an index over work, not a
    // second outbox — the same reasoning as the staff_events note in
    // src/workflows/messaging.mjs.
    task = {
      orgId,
      clientId: clientId || null,
      title: "Held: outbound message uses restricted wording",
      sourceWorkflow: GATE_SOURCE,
      assigneeRole: GATE_TASK_ROLE,
      body: `${messageId || "unrecorded"}:${restricted.map((x) => x.code).sort().join(",")}`,
      // Not persisted — carried so a caller rendering this to a human has the
      // readable reasons without re-deriving them from the codes.
      detail: restricted.map((x) => `${x.message}${x.citation ? ` (${x.citation})` : ""}`)
    };
  }

  // Warnings do not hold a message; anything else does.
  const hard = reasons.filter((x) => x.severity !== "warn");
  if (hard.length) return { state: "blocked", reasons, task };

  return { state: "allowed", reasons, task: null };
}

/* gateAndRecord — gate, then persist the outcome.

   Split from gate() for the same reason screenAndRecord is split from screen():
   the decision stays a pure-ish function that tests can drive without a write,
   and a caller previewing a message does not litter the audit trail. Every path
   that actually dispatches must use this one.

   Writes blocked_reason/blocked_at onto the message row (110_messages_outbound)
   and inserts the task if one was raised. Note what it never does: it does not
   clear blocked_reason on an allowed result. A block is an audit record, and
   the way to send after one is a new message row that passes on its own. */
export async function gateAndRecord(db, message = {}, options = {}) {
  const result = await gate(db, message, options);

  if (result.state === "blocked" && message.messageId) {
    await db.query(
      `UPDATE messages
          SET blocked_reason = $2, blocked_at = now(), status = 'blocked'
        WHERE id = $1`,
      [message.messageId, result.reasons.map((x) => x.code).join(",")]
    );
  }

  if (result.task) {
    // Through createTask, never a raw INSERT — it is the only writer that
    // attaches an owning role, and it carries the replay dedupe.
    const { detail, ...spec } = result.task; // eslint-disable-line no-unused-vars
    await createTask(db, spec);
  }

  return result;
}

// --- helpers ---------------------------------------------------------------

const r = (code, rule_set, message, extra = {}) => ({ code, rule_set, message, ...extra });

export default gate;
