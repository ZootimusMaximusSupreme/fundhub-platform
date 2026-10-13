// Public job application intake — the validation, throttling and spam handling
// that sits in front of pipeline.mjs's apply().
//
// ══════════════════════════════════════════════════════════════════════════════
// THIS IS THE ONLY UNAUTHENTICATED DOOR INTO THE HIRING TABLES.
//
// Everything else under api/hiring/ is gated to ROLE_SETS.HIRING (owner, admin)
// because it carries applicant PII and the scoring trail of an automated
// employment decision tool. This path is the exception by necessity: a careers
// page that requires a login is a careers page nobody applies through.
//
// So every value that reaches the database from here is treated as hostile:
// typed, trimmed, length-capped, and refused rather than coerced when it does
// not fit. Nothing is echoed back that a stranger did not already send.
// ══════════════════════════════════════════════════════════════════════════════
//
// FOUR RULES, ENFORCED HERE RATHER THAN REMEMBERED BY THE PAGE:
//
//   1. NO ENUMERATION. Every well-formed submission gets the identical reply,
//      whether it created a candidate, matched one already on file, hit an open
//      application for the same role, or was silently dropped as a bot. A form
//      that answers differently for a known address is an address checker.
//
//   2. NO PROTECTED CHARACTERISTICS, EVER. src/hiring/grading.mjs's isProtected()
//      is the same deny-list the grader uses. Here it is applied at INTAKE and it
//      REFUSES rather than filters: our own page never sends these keys, so their
//      presence means something is trying to feed protected data into an AEDT.
//      That deserves a 400, not a quiet strip.
//
//   3. ONLY THE OWNER'S QUESTIONS ARE ASKED. Until 2026-10-13 none were written
//      down, so this module stored contact details only. Chris has now written
//      the hiring funnel survey (src/hiring/survey.mjs). A body marked
//      funnel: "join" must answer exactly those questions, with exactly the
//      words on the buttons; any other body carrying `answers` is refused. See
//      the gap note at the bottom of this file.
//
//   4. NOTHING HERE REJECTS ANYBODY. There is no code path in this file that sets
//      a terminal status, writes a hiring_decisions row, or scores an
//      application. A refused submission is a REQUEST that was not accepted —
//      no candidate row, no application, no adverse record. The two are not the
//      same thing and must never be conflated.

import { isProtected } from "./grading.mjs";
import { apply } from "./pipeline.mjs";
import {
  SURVEY_VERSION,
  parseSurveyAnswers,
  routeFor,
  loomUrl
} from "./survey.mjs";
import { withTransaction } from "../db/with-transaction.mjs";
import { normalizeIp } from "../auth/session.mjs";

/* Length caps. Every one of these is a column this text lands in or sits beside;
   the cap is here so an over-long value is a 400 rather than a Postgres error
   with a column name in it. */
export const FIELD_LIMITS = Object.freeze({
  roleKey: 60,
  fullName: 120,
  email: 160,
  phone: 40,
  linkedinUrl: 300,
  sourceDetail: 200
});

/* The sourcing values are 051's CHECK constraint, not a list invented here.
   `source` is a constrained column precisely so the funnel can be measured by
   source, which is what doc 10's prescribed sourcing order is measured against.

   The LABELS are the only new words, and they describe a channel — not the
   candidate, and not anything they are judged on. */
export const HOW_HEARD = Object.freeze([
  { key: "referral",    label: "Someone who works here told me about it" },
  { key: "client_base", label: "I am, or was, a Fundhub customer" },
  { key: "audience",    label: "I follow Fundhub online" },
  { key: "social",      label: "Social media" },
  { key: "job_board",   label: "A job board" },
  { key: "linkedin",    label: "LinkedIn" },
  { key: "ads",         label: "An ad" },
  { key: "recruiter",   label: "A recruiter contacted me" },
  { key: "inbound",     label: "Somewhere else" }
]);

const HOW_HEARD_KEYS = new Set(HOW_HEARD.map((h) => h.key));

/* THE LIMITS — all checked against real rows and therefore hold across processes
   and restarts. Per-email and org-wide flood from candidate_applications; per-IP
   burst and sustained from hiring_apply_attempts (299). */
export const APPLY_LIMITS = Object.freeze({
  emailWindowHours: 24,
  maxPerEmail: 5,
  floodWindowMinutes: 5,
  maxOrgPerFloodWindow: 30,
  ipShortWindowMinutes: 10,
  maxPerIpShortWindow: 5,
  ipLongWindowMinutes: 60,
  maxPerIpLongWindow: 20,
  retryAfterMinutes: 15
});

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/* TWO CAPS, AND THE DIFFERENCE MATTERS.

   clean() TRUNCATES. Correct for prose — a 500-character "full name" is not a
   name, and keeping the first 120 of it loses nothing anybody will miss.

   capped() REFUSES, returning null. Correct for anything that is an identifier
   or a link. An address silently cut at 160 characters is a DIFFERENT, wrong
   address that we would store, fail to reach, and never know about; a role key
   cut at 60 could land on a different req; a truncated URL is a broken link.
   Losing the end of one of those does not make a smaller value, it makes a
   wrong one. */
function clean(v, max) {
  if (v == null) return "";
  return String(v).replace(CONTROL_CHARS, " ").trim().slice(0, max);
}

function capped(v, max) {
  if (v == null) return "";
  const s = String(v).replace(CONTROL_CHARS, " ").trim();
  return s.length > max ? null : s;
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/* tenDigits — the same normalisation api/public/partner-apply.mjs uses, copied
   rather than imported because that module is the partner funnel and importing
   from it would couple a careers form to a sales path. */
function tenDigits(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
  return digits.length === 10 ? digits : "";
}

/* A LinkedIn profile the applicant chose to give us, and nothing else.
   051's header is explicit: no profile harvesting. A URL typed into our own form
   is what an applicant submits; anything read from LinkedIn is not. */
function linkedinProfile(raw) {
  const v = capped(raw, FIELD_LIMITS.linkedinUrl);
  if (v === null) return null;
  if (!v) return "";
  let url;
  try { url = new URL(v.startsWith("http") ? v : `https://${v}`); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
  /* Stored as https whatever was pasted. A stored http:// link is one somebody
     later clicks, and the redirect it takes is not ours to vouch for. */
  url.protocol = "https:";
  const out = url.toString();
  return out.length > FIELD_LIMITS.linkedinUrl ? null : out;
}

/* A name field carrying a link is a bot, every time. Cheap, and it costs a real
   applicant nothing because no human types a URL into "full name". */
const LOOKS_LIKE_SPAM = /(https?:\/\/|www\.|\[url|<a\s)/i;

/* THE HONEYPOT. `website` is rendered off-screen with autocomplete off and no
   label a person can reach. A human never fills it in; a form-filling bot fills
   in everything it finds.

   NO CAPTCHA, deliberately — it is a barrier in front of a job application, it
   fails hardest for the people it should not, and it was ruled out for this
   surface. */
const HONEYPOT_FIELDS = ["website", "company_website"];

/* parseApplyBody(body) → { ok:false, error } | { ok:true, … }

   Pure. No database, no clock, no environment — so every branch below is
   testable without Postgres.

   `botSuspected` is returned as data rather than thrown as an error, because the
   caller must answer a bot with the SAME reply a person gets. Telling a bot it
   was detected is how the next version of it gets written. */
export function parseApplyBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_json" };
  }

  /* Rule 2, at the very front. Refused, not filtered: our page never sends these
     keys, so their presence is somebody trying to put a protected characteristic
     into an automated employment decision tool. Nothing is stored, and the reply
     names the category rather than the value. */
  const protectedKeys = Object.keys(body).filter(
    (k) => isProtected(k) || /^eeo[_-]/i.test(k));
  if (protectedKeys.length) {
    return { ok: false, error: "protected_field_refused" };
  }

  /* THE FUNNEL IS THE ONLY FORM THAT SENDS ANSWERS. The hiring funnel at
     /join/apply/ marks itself with funnel: "join", and its answers are checked
     against the owner's questions in src/hiring/survey.mjs. Any other body
     carrying `answers` is not our form and is still refused (rule 3). */
  const isFunnel = body.funnel === "join";
  if (body.funnel !== undefined && !isFunnel) {
    return { ok: false, error: "unsupported_field" };
  }
  if (!isFunnel && body.answers !== undefined) {
    return { ok: false, error: "unsupported_field" };
  }

  const botSuspected = HONEYPOT_FIELDS.some((f) => clean(body[f], 200) !== "");

  const roleKeyRaw = capped(body.role || body.role_key, FIELD_LIMITS.roleKey);
  const roleKey = roleKeyRaw === null ? "" : roleKeyRaw.toLowerCase();
  const fullName = clean(body.name || body.full_name, FIELD_LIMITS.fullName);
  const emailRaw = capped(body.email, FIELD_LIMITS.email);
  const email = emailRaw === null ? "" : emailRaw.toLowerCase();
  const phoneRaw = clean(body.phone || body.mobile, FIELD_LIMITS.phone);
  const sourceDetail = clean(body.how_heard_detail || body.source_detail, FIELD_LIMITS.sourceDetail);

  if (!/^[a-z0-9_]{1,60}$/.test(roleKey)) return { ok: false, error: "role_required" };
  /* ONE ERROR FOR BOTH, on purpose. "that name is missing" and "that address is
     malformed" are two facts a stranger could use to probe the form; they are
     also, to an applicant, the same instruction — check the two boxes at the top. */
  if (!fullName) return { ok: false, error: "name_email_required" };
  if (!isEmail(email)) return { ok: false, error: "name_email_required" };
  if (LOOKS_LIKE_SPAM.test(fullName)) return { ok: false, error: "name_email_required" };

  const linkedinProfileUrl = linkedinProfile(body.linkedin || body.linkedin_url);
  if (linkedinProfileUrl === null) return { ok: false, error: "linkedin_url_invalid" };

  const howHeard = clean(body.how_heard || body.source, 40).toLowerCase();
  const source = HOW_HEARD_KEYS.has(howHeard) ? howHeard : "inbound";

  const base = {
    ok: true,
    roleKey,
    fullName,
    email,
    phone: tenDigits(phoneRaw) || null,
    linkedinProfileUrl: linkedinProfileUrl || null,
    source,
    sourceDetail: sourceDetail || null,
    botSuspected
  };
  if (!isFunnel) return base;

  /* Funnel only. Owner-set 2026-10-13: LinkedIn is required for every role, and
     so are a phone number and a Loom. The old careers form keeps them optional. */
  if (!linkedinProfileUrl) return { ok: false, error: "linkedin_required" };
  if (!base.phone) return { ok: false, error: "phone_required" };
  const loom = loomUrl(body.loom || body.loom_url);
  if (loom === null) return { ok: false, error: "loom_url_invalid" };
  if (!loom) return { ok: false, error: "loom_required" };

  const survey = parseSurveyAnswers(roleKey, body.answers);
  if (!survey.ok) return { ok: false, error: survey.error };
  const route = routeFor(roleKey, survey.answers);

  return {
    ...base,
    funnel: "join",
    loomUrl: loom,
    route,
    /* What is stored on candidate_applications.answers: the answers word for
       word, which version of the questions they answered, and why the calendar
       was held back (empty when it was not). */
    answers: {
      ...survey.answers,
      survey_version: SURVEY_VERSION,
      review_flags: route.flags
    }
  };
}

// ---------------------------------------------------------------------------
// Reading the open roles — the careers page's list
// ---------------------------------------------------------------------------

/* listOpenRoles(db, { orgId }) → [{ key, name, brief }]

   ONLY THREE COLUMNS LEAVE. hiring_roles also holds comp, the scorecard, the
   bench target and the hiring manager's staff id; none of that is a stranger's
   business and comp in particular is an offer, not an advert.

   `brief` is hiring_roles.role_brief, and it is NULL until a human writes one.
   Null comes back as null. The page renders nothing in its place — an invented
   job description is a promise about a real job that nobody made. */
export async function listOpenRoles(db, { orgId } = {}) {
  if (!orgId) throw new Error("listOpenRoles: orgId is required");
  const { rows } = await db.query(
    `SELECT key, name, role_brief
       FROM hiring_roles
      WHERE org_id = $1 AND active
      ORDER BY name ASC`,
    [orgId]);
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    brief: r.role_brief && String(r.role_brief).trim() ? String(r.role_brief) : null
  }));
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/* THE PER-IP HALF — hiring_apply_attempts (299).

   Counted from real rows, so it holds across cold starts and warm instances.
   checkIpRate() returns "not limited" for a null ip ON PURPOSE — the alternative
   is one shared bucket that every applicant behind an unresolvable address falls
   into together, which locks out real people to slow down nobody. On Netlify the
   address always resolves (the adapter reads context.ip); anywhere it does not,
   only the per-email and org-wide limits below are in force. */

function asOf(now) {
  return now instanceof Date ? now : new Date(now ?? Date.now());
}

/* recordAttempt — called for every submission that got as far as the limiter,
   accepted or not, so a refused flood still counts against the source. */
export async function recordAttempt(db, { orgId, ip, now } = {}) {
  const normIp = normalizeIp(ip);
  if (!orgId || !normIp) return;
  const at = asOf(now);
  await db.query(
    `INSERT INTO hiring_apply_attempts (org_id, ip, created_at) VALUES ($1, $2::inet, $3)`,
    [orgId, normIp, at]
  );
}

/* resetAttempts — test seam. A test that trips the limiter would otherwise poison
   every test after it. */
export async function resetAttempts(db, { orgId, ip } = {}) {
  if (!db || !orgId) return;
  const normIp = normalizeIp(ip);
  if (normIp) {
    await db.query(
      `DELETE FROM hiring_apply_attempts WHERE org_id = $1 AND ip = $2::inet`,
      [orgId, normIp]
    );
  } else {
    await db.query(`DELETE FROM hiring_apply_attempts WHERE org_id = $1`, [orgId]);
  }
}

export async function checkIpRate(db, { orgId, ip, now, limits = APPLY_LIMITS } = {}) {
  const normIp = normalizeIp(ip);
  if (!orgId || !normIp) return { limited: false, reason: null };
  const at = asOf(now);
  const { rows } = await db.query(
    `SELECT
       (SELECT count(*) FROM hiring_apply_attempts a
         WHERE a.org_id = $1 AND a.ip = $2::inet
           AND a.created_at > $5::timestamptz - ($3::int * interval '1 minute'))::int AS short_count,
       (SELECT count(*) FROM hiring_apply_attempts a
         WHERE a.org_id = $1 AND a.ip = $2::inet
           AND a.created_at > $5::timestamptz - ($4::int * interval '1 minute'))::int AS long_count`,
    [orgId, normIp, limits.ipShortWindowMinutes, limits.ipLongWindowMinutes, at]
  );
  const shortCount = Number(rows[0].short_count);
  const longCount = Number(rows[0].long_count);
  if (shortCount >= limits.maxPerIpShortWindow) return { limited: true, reason: "ip_burst" };
  if (longCount >= limits.maxPerIpLongWindow) return { limited: true, reason: "ip_sustained" };
  return { limited: false, reason: null };
}

/* checkApplyRate(db, spec) → { limited, reason, retryAfterMinutes }

   The durable half. Two questions, both answered from candidate_applications:

     per address — how many applications has this email produced lately. A repeat
                   submit for the SAME role creates no row (051's partial unique
                   index), so this counts distinct roles rather than clicks; it
                   is the slow-drip guard, not the burst guard.

     org-wide    — how many applications landed in the last few minutes, from
                   anybody. This is the one that survives a distributed flood
                   across many addresses and many instances. It is set well above
                   any real careers-page volume, because the cost of it firing is
                   a real applicant being told to come back later. */
export async function checkApplyRate(db, { orgId, email, ip, now, limits = APPLY_LIMITS } = {}) {
  const byIp = await checkIpRate(db, { orgId, ip, now, limits });
  if (byIp.limited) {
    return { limited: true, reason: byIp.reason, retryAfterMinutes: limits.retryAfterMinutes };
  }

  const { rows } = await db.query(
    `SELECT
       (SELECT count(*) FROM candidate_applications a
          JOIN candidates c ON c.id = a.candidate_id
         WHERE a.org_id = $1 AND c.email = $2
           AND a.created_at > now() - ($3::int * interval '1 hour'))::int AS email_count,
       (SELECT count(*) FROM candidate_applications a
         WHERE a.org_id = $1
           AND a.created_at > now() - ($4::int * interval '1 minute'))::int AS flood_count`,
    [orgId, String(email || "").trim().toLowerCase(),
     limits.emailWindowHours, limits.floodWindowMinutes]);

  const emailCount = Number(rows[0].email_count);
  const floodCount = Number(rows[0].flood_count);

  if (emailCount >= limits.maxPerEmail) {
    return { limited: true, reason: "email", retryAfterMinutes: limits.retryAfterMinutes };
  }
  if (floodCount >= limits.maxOrgPerFloodWindow) {
    return { limited: true, reason: "flood", retryAfterMinutes: limits.retryAfterMinutes };
  }
  return { limited: false, reason: null, retryAfterMinutes: 0 };
}

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

/* submitApplication(db, parsed, { orgId }) → { stored, outcome }

   ONE TRANSACTION. apply() writes the candidate and the application; the profile
   URL is stamped in the same transaction so a crash between the two cannot leave
   a candidate whose link went nowhere.

   `outcome` is for the server's own logging and for tests. It NEVER reaches the
   caller of the endpoint — see rule 1. */
export async function submitApplication(db, parsed, { orgId } = {}) {
  if (!orgId) throw new Error("submitApplication: orgId is required");

  /* A bot is answered exactly as a person is, and nothing is written. The
     honeypot's value is that the bot cannot tell, so this branch must sit before
     the write and produce the same shape as the branch after it. */
  if (parsed.botSuspected) return { stored: false, outcome: "dropped_bot" };

  return withTransaction(db, async (tx) => {
    let result;
    try {
      result = await apply(tx, {
        orgId,
        roleKey: parsed.roleKey,
        fullName: parsed.fullName,
        email: parsed.email,
        phone: parsed.phone,
        source: parsed.source,
        sourceDetail: parsed.sourceDetail,
        /* Rule 3: only the funnel carries answers, and only to the owner's
           questions (src/hiring/survey.mjs). The old careers form stores none. */
        answers: parsed.answers || {},
        videoUrl: parsed.loomUrl || null
      });
    } catch (err) {
      /* apply() throws on an unknown or inactive role. That is the ONLY expected
         throw here and it is a 400, not a 500 — the page listed the roles, so a
         key it does not know means the req closed between the page load and the
         submit, or somebody typed one. */
      if (/no active hiring role/.test(String(err.message))) {
        const e = new Error("role_unavailable");
        e.code = "ROLE_UNAVAILABLE";
        throw e;
      }
      throw err;
    }

    if (parsed.linkedinProfileUrl && result.candidate?.id) {
      await tx.query(
        `UPDATE candidates
            SET linkedin_profile_url = COALESCE(linkedin_profile_url, $2),
                updated_at = now()
          WHERE id = $1`,
        [result.candidate.id, parsed.linkedinProfileUrl]);
    }

    /* Voluntary EEO self-ID — separate submission path (053_eeo_selfid.sql).
       Invite + email queue here; answers never touch the apply form. */
    if (result.application?.id) {
      const { sendInviteForApplication } = await import("./eeo-selfid.mjs");
      await sendInviteForApplication(tx, { orgId, applicationId: result.application.id });
    }

    return {
      stored: true,
      outcome: result.created ? "created" : "already_open",
      applicationId: result.application?.id || null
    };
  });
}

// ---------------------------------------------------------------------------
// What the funnel page shows next
// ---------------------------------------------------------------------------

/* nextStepFor(db, parsed, { orgId }) → { next, bookingUrl? }

   Funnel only. Tells the page which screen to show after the application is
   saved:

     book          the calendar, from hiring_roles.interview_booking_url for this
                   seat (the sales manager's link for setter, closer and CSM;
                   Chris's for COO)
     book_pending  they would see the calendar, but no link is set for the seat
                   yet, so the page says we will reach out
     review        a review rule held the calendar back (src/hiring/survey.mjs);
                   the application is saved and open for the sales manager

   RULE 1 STILL HOLDS. The answer depends on the seat and the answers the caller
   sent, and on the seat's public booking link — never on whether the address is
   already on file, and never on whether the honeypot caught a bot. A bot is
   shown the same screen a person with the same answers would see. */
export async function nextStepFor(db, parsed, { orgId } = {}) {
  if (!orgId) throw new Error("nextStepFor: orgId is required");
  if (!parsed || parsed.funnel !== "join") return { next: "received" };
  if (parsed.route?.next !== "book") return { next: "review" };
  const { rows } = await db.query(
    `SELECT interview_booking_url
       FROM hiring_roles
      WHERE org_id = $1 AND key = $2 AND active`,
    [orgId, parsed.roleKey]);
  const url = rows[0]?.interview_booking_url;
  return url && /^https:\/\/\S+$/.test(url)
    ? { next: "book", bookingUrl: url }
    : { next: "book_pending" };
}

// ---------------------------------------------------------------------------
// GAPS — absences found while building this, recorded rather than invented.
// ---------------------------------------------------------------------------
//
// 1. (CLOSED 2026-10-13) THE FUNNEL ASKS THE OWNER'S QUESTIONS. Chris wrote the
//    survey down; it lives in src/hiring/survey.mjs and only the funnel at
//    /join/apply/ sends it. The old careers form still sends contact details
//    only. Nothing is scored automatically: 051's rubric still needs a person.
//
// 2. NOTHING NOTIFIES A HUMAN. apply() opens the application in `applied` and
//    stops. There is no task and no message, so an application is seen only when
//    somebody opens the hiring board. src/hiring/owner.mjs's assigneeFor() is
//    the resolver a "new application" task would route through; adding one was
//    outside this unit's scope and is deliberately not done here rather than
//    half-done.
//
// 3. NO EEO SELF-ID IS COLLECTED. 053_eeo_selfid.sql builds the whole voluntary
//    self-identification path — invite tokens, the unlinking write, the
//    suppressed aggregate view — and NO CODE ANYWHERE READS OR WRITES THOSE
//    TABLES. Its design requires the survey to be a SEPARATE submission from the
//    application, so it cannot be bolted onto this form without breaking the
//    unlinkability the whole table is built around. Until the invite path is
//    built, the adverse-impact analysis 053 exists to enable has no data.
//
// 4. (CLOSED 299) THE PER-IP LIMIT IS DURABLE. hiring_apply_attempts holds burst
//    state across cold starts and instances — see checkIpRate's header.
