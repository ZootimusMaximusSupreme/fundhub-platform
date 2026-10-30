// Finish-853 batch 21 (tier 4, lane gap-catalog-display): the Social Studio (social-studio.html), the
// Staff & Teams desk (staff-teams.html) and the Teleprompter (teleprompter.html). These are the controls
// that leave a saved result a read-only SQL text can judge.
//
// LIVE CHECK    One read-only SQL text. The display lane runs it for the company. It returns
//               sample_count (how many saved results exist) and bad_count (how many are wrong) and goes
//               red on the first wrong one. A control nobody has used yet has no results, so it is green
//               with the words "no saved results yet" (emptyAs "quiet") until the first wrong result.
// PRACTICE TEST A real page in Chromium with a fake /api. Those rows are in fin-b21-display-practice.mjs.
//
// Every live check is built from named bad-result conditions. The SQL text is the conditions joined with
// OR, one SELECT per kind of saved row, stacked with UNION ALL. fin-b21-live-contracts.test.mjs runs that
// exact text over stand-in rows, breaks one condition at a time and sees it go red, and drops each
// condition from the text and sees that its row is no longer caught.
//
// This file is read at build time by scripts/pulse/compile-catalog.mjs. The live bundle reads the compiled
// copy in src/pulse/catalog/generated.json, so it imports nothing at run time.
//
// It must not import display-saved-result.mjs (that file imports this one).

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIN_B21_LANE = "src/pulse/coverage/gap-catalog-display.mjs";
export const FIN_B21_SOURCE_FILE = "desks-f.json";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const SOCIAL_STUDIO_PAGE = path.join(ROOT, "public/app/social-studio.html");

export const STAFF_SURFACE = "staff-teams.html";
export const SOCIAL_SURFACE = "social-studio.html";
export const TELEPROMPTER_SURFACE = "teleprompter.html (+ teleprompter.js, teleprompter-edits.js)";

/** @type {Array<{key:string, control:string, surface:string, requirement:string, emptyAs?:string,
 *   parts?:Array<{from:string, where:string, bad:Array<[string,string]>}>, build?:Function}>} */
export const FIN_B21_CHECKS = [];

function check(spec) {
  const parts = (spec.parts || []).map((part) => Object.freeze({
    from: part.from, where: part.where, bad: Object.freeze(part.bad.map((pair) => Object.freeze([...pair])))
  }));
  FIN_B21_CHECKS.push(Object.freeze({ emptyAs: "quiet", ...spec, parts: Object.freeze(parts) }));
}

/** The SQL text for a check, or for a check with some named conditions left out (the test does that). */
export function sqlFor(spec, { without = [] } = {}) {
  if (typeof spec.build === "function") return spec.build({ without });
  const selects = spec.parts.map((part) => {
    const kept = part.bad.filter(([name]) => !without.includes(name));
    const when = kept.length ? kept.map(([, expr]) => `(${expr.trim()})`).join("\n                OR ") : "1 = 0";
    return `    SELECT CASE WHEN ${when} THEN 1 ELSE 0 END AS bad
      FROM ${part.from.trim()}
     WHERE ${part.where.trim()}`;
  });
  return `/* display-result:${spec.key} */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE r.bad = 1)::int AS bad_count
  FROM (
${selects.join("\n  UNION ALL\n")}
  ) r`;
}

const BLANK = (expr) => `NULLIF(BTRIM(COALESCE(${expr}, '')), '') IS NULL`;
const HOUR = 3600;

// ───────────────────────────── staff-teams.html ─────────────────────────────

const REAL_STAFF = `COALESCE(st.is_demo, false) = false`;

check({
  key: "staff-clock",
  surface: STAFF_SURFACE,
  control: "Clock tab 'Clock in' / 'Clock out' (your own row only)",
  requirement: "Every real shift of the last 90 days must belong to a person in the same company, must not end before it starts, and nobody may be left clocked in for more than a day. Never two open shifts for one person.",
  parts: [
    {
      from: `shifts s
      JOIN staff st ON st.id = s.staff_id`,
      where: `s.org_id = $1::uuid AND COALESCE(s.is_demo, false) = false AND ${REAL_STAFF}
      AND s.started_at > now() - interval '90 days'`,
      bad: [
        ["a shift ends before it starts", `s.ended_at IS NOT NULL AND s.ended_at < s.started_at`],
        ["a shift is filed under another company than its person", `st.org_id <> s.org_id`],
        ["a person has been clocked in for more than a day with nobody clocking out",
          `s.ended_at IS NULL AND s.started_at < now() - interval '24 hours'`]
      ]
    },
    {
      from: `(SELECT o.staff_id, count(*) AS open_count
              FROM shifts o
             WHERE o.org_id = $1::uuid AND o.ended_at IS NULL AND COALESCE(o.is_demo, false) = false
             GROUP BY o.staff_id) w`,
      where: `1 = 1`,
      bad: [["one person holds two open shifts at once", `w.open_count > 1`]]
    }
  ]
});

check({
  key: "staff-reset-link",
  surface: STAFF_SURFACE,
  control: "Editor 'Reset password': makes a 1 hour reset link and shows it in a prompt box to copy",
  requirement: "Every reset link of the last 90 days must run for one hour, belong to a person in the same company, never be used after it ran out, and a new link must end the earlier unused one.",
  parts: [
    {
      from: `password_resets r
      LEFT JOIN staff st ON st.id = r.staff_id`,
      where: `r.org_id = $1::uuid AND r.kind = 'reset' AND r.created_at > now() - interval '90 days'`,
      bad: [
        ["the link does not run for one hour",
          `EXTRACT(EPOCH FROM (r.expires_at - r.created_at)) < ${50 * 60} OR EXTRACT(EPOCH FROM (r.expires_at - r.created_at)) > ${70 * 60}`],
        // Until 2026-10-20 a new link also stamped used_at on the person's EXPIRED earlier links (src/auth/invite.mjs,
        // the "end the earlier link" UPDATE). That stamp lands within a second of the newer link being made and is
        // not a use, so it is not counted as one.
        ["the link was used after it ran out", `r.used_at IS NOT NULL AND r.used_at > r.expires_at
          AND NOT EXISTS (SELECT 1 FROM password_resets n
                           WHERE n.org_id = r.org_id AND n.id <> r.id AND n.kind = r.kind
                             AND (n.staff_id = r.staff_id OR n.account_id = r.account_id)
                             AND EXTRACT(EPOCH FROM (n.created_at - r.used_at)) >= 0
                             AND EXTRACT(EPOCH FROM (n.created_at - r.used_at)) < 5)`],
        ["the link belongs to nobody", `r.staff_id IS NULL AND r.account_id IS NULL`],
        ["the link names a person from another company", `st.id IS NOT NULL AND st.org_id <> r.org_id`]
      ]
    },
    {
      from: `(SELECT x.staff_id, count(*) AS live_links
              FROM password_resets x
             WHERE x.org_id = $1::uuid AND x.kind = 'reset' AND x.staff_id IS NOT NULL
               AND x.used_at IS NULL AND x.expires_at > now()
             GROUP BY x.staff_id) w`,
      where: `1 = 1`,
      bad: [["a new reset link did not end the earlier one: two live links for one person", `w.live_links > 1`]]
    }
  ]
});

check({
  key: "staff-revoke",
  surface: STAFF_SURFACE,
  control: "Editor 'Revoke login' (confirm): suspends the person and kills their sessions",
  requirement: "Every suspended person must have no sign-in session that is still alive.",
  parts: [{
    from: `staff st`,
    where: `st.org_id = $1::uuid AND st.status = 'suspended' AND ${REAL_STAFF}`,
    bad: [["a suspended person still has a live session",
      `EXISTS (SELECT 1 FROM sessions se WHERE se.staff_id = st.id AND se.revoked_at IS NULL AND se.expires_at > now())`]]
  }]
});

check({
  key: "staff-new-person",
  surface: STAFF_SURFACE,
  control: "Editor 'Save' for a NEW person: creates the login, mails the invite, shows the 7 day link",
  requirement: "Every invite link of the last 180 days must run for 7 days, belong to a person in the same company who has a login email and a job that is on the job list.",
  parts: [{
    from: `password_resets r
      LEFT JOIN staff st ON st.id = r.staff_id`,
    where: `r.org_id = $1::uuid AND r.kind = 'invite' AND r.created_at > now() - interval '180 days'`,
    bad: [
      ["the invite does not run for 7 days",
        `EXTRACT(EPOCH FROM (r.expires_at - r.created_at)) < ${7 * 24 * HOUR - 600} OR EXTRACT(EPOCH FROM (r.expires_at - r.created_at)) > ${7 * 24 * HOUR + 600}`],
      ["the invite belongs to nobody who exists", `st.id IS NULL`],
      ["the invite is filed under another company than its person", `st.id IS NOT NULL AND st.org_id <> r.org_id`],
      ["the invited person has no login email", `st.id IS NOT NULL AND ${BLANK("st.email")}`],
      ["the invited person has no job", `st.id IS NOT NULL AND ${BLANK("st.role")}`],
      ["the invited person's job is not on the job list",
        `st.id IS NOT NULL AND NOT ${BLANK("st.role")} AND NOT EXISTS (
            SELECT 1 FROM staff_roles sr
             WHERE sr.org_id = st.org_id AND lower(sr.key) = lower(BTRIM(st.role)) AND sr.active)`]
    ]
  }]
});

check({
  key: "staff-profile",
  surface: STAFF_SURFACE,
  control: "Editor 'Save' for an EXISTING person: name, email, phone, start date",
  requirement: "Every real person must have a name, a clean lower-case login email with an @, no phone saved as empty words, and a person who can sign in must have an email.",
  parts: [{
    from: `staff st`,
    where: `st.org_id = $1::uuid AND ${REAL_STAFF}`,
    bad: [
      ["the name is blank", BLANK("st.name")],
      ["the login email is not a clean lower-case address with an @",
        `st.email IS NOT NULL AND (st.email <> lower(BTRIM(st.email)) OR st.email NOT LIKE '%@%')`],
      ["the phone is saved as empty words", `st.phone IS NOT NULL AND ${BLANK("st.phone")}`],
      ["a person who has a password has no login email", `st.password_hash IS NOT NULL AND ${BLANK("st.email")}`]
    ]
  }]
});

check({
  key: "staff-role",
  surface: STAFF_SURFACE,
  control: "Editor 'Save' with a changed role (what that person may do)",
  requirement: "Every person who has a job must hold one that is on the job list, written in lower case.",
  parts: [{
    from: `staff st`,
    where: `st.org_id = $1::uuid AND ${REAL_STAFF} AND NOT ${BLANK("st.role")}`,
    bad: [
      ["the job is not on the job list", `NOT EXISTS (
            SELECT 1 FROM staff_roles sr
             WHERE sr.org_id = st.org_id AND lower(sr.key) = lower(BTRIM(st.role)) AND sr.active)`],
      ["the job is not saved in lower case", `st.role <> lower(BTRIM(st.role))`]
    ]
  }]
});

check({
  key: "staff-booked-text",
  surface: STAFF_SURFACE,
  control: "Lead alerts for active setters and the owner; closer texts only after a set lead or before an assigned call",
  requirement: "Each active setter or owner needs a phone for lead texts; every staff alert text of the last 90 days must have words, a number to go to, a passed check, and a person who exists.",
  parts: [
    {
      from: `staff st`,
      where: `st.org_id = $1::uuid AND ${REAL_STAFF} AND st.status = 'active' AND lower(COALESCE(st.role, '')) IN ('owner', 'setter')`,
      bad: [
        ["a setter or owner has no phone for lead texts", BLANK("st.phone")]
      ]
    },
    {
      from: `messages m`,
      where: `m.org_id = $1::uuid AND (m.template_key = 'SMS-S04C-STAFF-BOOKED' OR m.provider_ref LIKE 'staff-alert:%') AND COALESCE(m.is_demo, false) = false
      AND m.created_at > now() - interval '90 days'`,
      bad: [
        ["the text has no words", BLANK("m.rendered_body")],
        ["the text has nobody to go to", BLANK("m.to_address")],
        ["a sent text was not marked as having passed the check", `m.status = 'sent' AND COALESCE(m.compliance_check_passed, false) = false`],
        ["the text is not an outbound text message", `m.direction <> 'outbound' OR m.channel <> 'sms'`],
        ["the text names a person who is not on the staff list", `NOT EXISTS (
            SELECT 1 FROM staff p
             WHERE p.org_id = m.org_id AND m.provider_ref LIKE ('%:' || p.id::text))`]
      ]
    }
  ]
});

// ───────────────────────────── social-studio.html ─────────────────────────────

/** The page's own copy of the rule book: the `var RULES = [...]` array, read from the page file. */
export function pageRules(file = SOCIAL_STUDIO_PAGE) {
  const html = fs.readFileSync(file, "utf8");
  const found = /var RULES = (\[[\s\S]*?\n\]);/.exec(html);
  if (!found) throw new Error("social-studio.html: no `var RULES = [...]` array found");
  // eslint-disable-next-line no-new-func
  const rules = new Function(`"use strict"; return ${found[1]};`)();
  if (!Array.isArray(rules) || !rules.length) throw new Error("social-studio.html: the RULES array is empty");
  return rules;
}

const lit = (value) => `'${String(value ?? "").replace(/'/g, "''")}'`;
// Postgres prints a jsonb array of strings as ["a", "b"]: comma and a space.
const jsonList = (list) => `[${(list || []).map((x) => JSON.stringify(String(x))).join(", ")}]`;
/** md5 of the UTF-8 bytes, the same text Postgres md5() returns for a UTF-8 database. */
export const md5 = (value) => createHash("md5").update(String(value ?? ""), "utf8").digest("hex");

/* The rule's pattern and its words are carried as their md5 digests, not as text: the pattern text holds
   words like delete and remove that the shared lane guard rightly forbids anywhere in a read-only text,
   and a digest compares exactly as well. */
function wordingSql({ without = [], rules = pageRules() } = {}) {
  const values = rules.map((r) =>
    `(${[r.rule_set, r.rule_key, jsonList(r.offer_types), jsonList(r.platforms), r.match_type, md5(r.pattern), r.severity, md5(r.message), r.citation].map(lit).join(", ")})`
  ).join(",\n    ");
  const differs = [
    ["the saved rule has other words", `md5(c.message) <> p.message_md5`],
    ["the saved rule matches other text", `md5(c.pattern) <> p.pattern_md5`],
    ["the saved rule has another kind of match", `c.match_type <> p.match_type`],
    ["the saved rule has another strength", `c.severity <> p.severity`],
    ["the saved rule names another offer", `c.offer_types::text <> p.offer_types`],
    ["the saved rule names another platform", `c.platforms::text <> p.platforms`],
    ["the saved rule cites another law", `c.id IS NOT NULL AND c.citation IS DISTINCT FROM p.citation`]
  ].filter(([name]) => !without.includes(name));
  const missing = without.includes("the page has a rule the server does not have") ? "1 = 0" : "c.id IS NULL";
  const when = [missing, ...differs.map(([, expr]) => expr)].join("\n                OR ");
  const extraBad = without.includes("the server has a rule the page does not have") ? 0 : 1;
  const extra = `
  UNION ALL
    SELECT ${extraBad} AS bad
      FROM compliance_rules x
     WHERE x.org_id = $1::uuid AND x.active
       AND NOT EXISTS (SELECT 1 FROM p WHERE p.rule_set = x.rule_set AND p.rule_key = x.rule_key)`;
  return `/* display-result:social-wording */
WITH p(rule_set, rule_key, offer_types, platforms, match_type, pattern_md5, severity, message_md5, citation) AS (
  VALUES
    ${values}
)
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE r.bad = 1)::int AS bad_count
  FROM (
    SELECT CASE WHEN ${when} THEN 1 ELSE 0 END AS bad
      FROM p
      LEFT JOIN compliance_rules c
        ON c.org_id = $1::uuid AND c.active AND c.rule_set = p.rule_set AND c.rule_key = p.rule_key${extra}
  ) r`;
}

check({
  key: "social-wording",
  surface: SOCIAL_SURFACE,
  control: "'Check the wording' (live copy check beside the writer: rules held as a copy inside the page)",
  requirement: "Every rule in the page's own copy of the rule book must be a live rule on the server with the same words, match, strength, offer, platform and law, and the server must hold no live rule the page does not have.",
  emptyAs: undefined,
  parts: [],
  build: wordingSql,
  badNames: [
    "the page has a rule the server does not have",
    "the saved rule has other words",
    "the saved rule matches other text",
    "the saved rule has another kind of match",
    "the saved rule has another strength",
    "the saved rule names another offer",
    "the saved rule names another platform",
    "the saved rule cites another law",
    "the server has a rule the page does not have"
  ]
});

const REAL_PARTNER = (alias) => `NOT EXISTS (SELECT 1 FROM partners pt WHERE pt.id = ${alias}.partner_id AND COALESCE(pt.is_demo, false) = true)`;

check({
  key: "social-approval",
  surface: SOCIAL_SURFACE,
  control: "'Who approves posts' card (read-only: shows the saved approval switch, the safe default, or 'could not read')",
  requirement: "No post may be lined up, sending or sent without a passing copy check or a named person's approval, and every credit-repair post that is lined up or sent must carry a person's approval; every saved approval setting must sit in its partner's company.",
  parts: [
    {
      from: `social_posts p`,
      where: `p.org_id = $1::uuid AND p.status IN ('queued', 'posting', 'posted')
      AND p.created_at > now() - interval '180 days' AND ${REAL_PARTNER("p")}`,
      bad: [
        ["a credit-repair post is lined up or sent with nobody's approval", `p.offer_type = 'credit_repair' AND p.approved_at IS NULL`],
        ["a post held for a person is lined up or sent with nobody's approval", `p.approved_at IS NULL AND NOT EXISTS (
            SELECT 1 FROM compliance_screenings s
             WHERE s.subject_type = 'social_post' AND s.subject_id = p.id AND s.state = 'passed')`],
        ["an approval names nobody", `p.approved_at IS NOT NULL AND p.approved_by IS NULL`]
      ]
    },
    {
      from: `partner_module_settings ms
      JOIN partners pt ON pt.id = ms.partner_id`,
      where: `ms.org_id = $1::uuid AND COALESCE(pt.is_demo, false) = false`,
      bad: [["the saved setting sits under another company than its partner", `pt.org_id <> ms.org_id`]]
    }
  ]
});

check({
  key: "social-accounts",
  surface: SOCIAL_SURFACE,
  control: "Connected accounts and 'Not connected yet' cards (display; no disconnect control)",
  requirement: "Every connected account must name its account, say 'ready to post' only while it holds a sign-in key that has not run out, keep its posting times as a day-by-day list and its permissions as a list, and sit in its partner's company.",
  parts: [{
    from: `social_channels c
      JOIN partners pt ON pt.id = c.partner_id`,
    where: `c.org_id = $1::uuid AND COALESCE(pt.is_demo, false) = false`,
    bad: [
      ["the account has no account id", BLANK("c.external_account_id")],
      ["the account says ready to post but holds no sign-in key", `c.connection_state = 'active' AND c.encrypted_access_token IS NULL`],
      ["the account says ready to post but its sign-in key has run out",
        `c.connection_state = 'active' AND c.token_expires_at IS NOT NULL AND c.token_expires_at < now()`],
      ["the posting times are not a day-by-day list", `c.best_times IS NULL OR c.best_times::text NOT LIKE '{%'`],
      ["the permissions are not a list", `c.scopes IS NULL OR c.scopes::text NOT LIKE '[%'`],
      ["the account sits in another company than its partner", `pt.org_id <> c.org_id`]
    ]
  }]
});

check({
  key: "social-refuse",
  surface: SOCIAL_SURFACE,
  control: "Held row (owner and admin only): 'Refuse it' (asks first; the post will never go out)",
  requirement: "Every post a person refused must be blocked on the queue and on the post behind it, must carry the refusal reason on both, and must never have gone out.",
  parts: [{
    from: `marketing_content_queue q`,
    where: `q.org_id = $1::uuid AND q.blocked_reasons::text LIKE '%refused_by_a_person%'`,
    bad: [
      ["a refused post is not blocked on the queue", `q.status <> 'blocked'`],
      ["a refused post has no post behind it that is blocked", `NOT EXISTS (
            SELECT 1 FROM social_posts p WHERE p.id = q.social_post_id AND p.status = 'blocked')`],
      ["the blocked post behind a refusal does not carry the refusal reason", `NOT EXISTS (
            SELECT 1 FROM social_posts p
             WHERE p.id = q.social_post_id AND p.blocked_reasons::text LIKE '%refused_by_a_person%')`],
      ["a refused post went out anyway", `EXISTS (
            SELECT 1 FROM social_posts p
             WHERE p.id = q.social_post_id AND (p.posted_at IS NOT NULL OR p.external_post_id IS NOT NULL))`]
    ]
  }]
});

check({
  key: "social-throw-away",
  surface: SOCIAL_SURFACE,
  control: "Waiting row: 'Throw it away' and row-detail 'Throw this post away' (asks first, marks discarded, never deletes)",
  requirement: "Every post thrown away must stay on the list marked thrown away, and no post behind it may still be lined up, sending, held for a person or sent.",
  parts: [{
    from: `marketing_content_queue q`,
    where: `q.org_id = $1::uuid AND q.status = 'discarded'`,
    bad: [["a thrown-away post still has a live post behind it", `EXISTS (
            SELECT 1 FROM social_posts p
             WHERE p.id = q.social_post_id AND p.status IN ('awaiting_approval', 'queued', 'posting', 'posted'))`]]
  }]
});

check({
  key: "social-states",
  surface: SOCIAL_SURFACE,
  control: "Post states legend: Draft, Waiting, Sending now, Sent, Could not be sent, Needs a rewrite (plus Held for approval)",
  requirement: "Every post of the last 180 days must be the thing its state words say: 'Sending now' is not stuck, 'Sent' has a time and a reference, 'Could not be sent' says why, 'Needs a rewrite' holds a reason, 'Held for approval' has no approval yet and a held queue row has a post behind it.",
  parts: [
    {
      from: `social_posts p`,
      where: `p.org_id = $1::uuid AND p.created_at > now() - interval '180 days' AND ${REAL_PARTNER("p")}`,
      bad: [
        ["a post says Sending now but has been stuck there over 30 minutes",
          `p.status = 'posting' AND p.updated_at < now() - interval '30 minutes'`],
        ["a post says Sent but has no time or no reference",
          `p.status = 'posted' AND (p.posted_at IS NULL OR ${BLANK("p.external_post_id")})`],
        ["a post says Could not be sent but names no reason", `p.status = 'failed' AND ${BLANK("p.last_error")}`],
        ["a post says Needs a rewrite but holds no reason",
          `p.status = 'blocked' AND (p.blocked_reasons IS NULL OR p.blocked_reasons::text IN ('[]', 'null', '{}'))`],
        ["a post is held for a person but already has an approval", `p.status = 'awaiting_approval' AND p.approved_at IS NOT NULL`]
      ]
    },
    {
      from: `marketing_content_queue q`,
      where: `q.org_id = $1::uuid AND ${REAL_PARTNER("q")}`,
      bad: [
        ["a queue row is held for a person but has no post behind it", `q.status = 'awaiting_approval' AND q.social_post_id IS NULL`],
        ["a queue row says Needs a rewrite but holds no reason",
          `q.status = 'blocked' AND (q.blocked_reasons IS NULL OR q.blocked_reasons::text IN ('[]', 'null', '{}'))`]
      ]
    }
  ]
});

// ───────────────────────────── teleprompter.html ─────────────────────────────

// The Scripts tab's own visibility rule (src/marketing/scripts-store.mjs VISIBLE_SQL), over `s` and `b`.
const VISIBLE = `(s.source <> 'import' AND (s.batch_id IS NULL OR (b.status = 'released' AND b.release_at <= now())))`;
const LIVE_SCRIPT = (rootRef) => `SELECT 1
               FROM ad_scripts s
               LEFT JOIN marketing_batches b ON b.id = s.batch_id
              WHERE s.org_id = sh.org_id AND s.root_script_id::text = ${rootRef}::text
                AND s.archived_at IS NULL AND ${VISIBLE}`;

check({
  key: "shoot-open",
  surface: TELEPROMPTER_SURFACE,
  control: "Page open: reads the open shoot and its scripts (film key ?k=, a staff session, or open with no key)",
  requirement: "A company must never have two open shoots; an open shoot must list at least one script; and every script on it must still be a live, visible script with words to read.",
  parts: [
    {
      from: `(SELECT o.org_id, count(*) AS open_count
              FROM marketing_shoots o
             WHERE o.org_id = $1::uuid AND o.status <> 'done'
             GROUP BY o.org_id) w`,
      where: `1 = 1`,
      bad: [["more than one shoot is open, and the page shows only the newest", `w.open_count > 1`]]
    },
    {
      from: `marketing_shoots sh`,
      where: `sh.org_id = $1::uuid AND sh.status <> 'done'`,
      bad: [["an open shoot lists no scripts", `COALESCE(sh.root_script_ids::text, '') IN ('', '{}', '[]')`]]
    },
    {
      from: `marketing_shoots sh
      CROSS JOIN LATERAL unnest(sh.root_script_ids) AS r(root)`,
      where: `sh.org_id = $1::uuid AND sh.status <> 'done'`,
      bad: [
        ["a script on the shoot no longer has a live, visible version", `NOT EXISTS (
            ${LIVE_SCRIPT("r.root")})`],
        ["a script on the shoot has no words to read", `EXISTS (${LIVE_SCRIPT("r.root")})
            AND NOT EXISTS (${LIVE_SCRIPT("r.root")}
                AND NULLIF(BTRIM(COALESCE(s.body, '')), '') IS NOT NULL)`]
      ]
    }
  ]
});

check({
  key: "shoot-marks",
  surface: TELEPROMPTER_SURFACE,
  control: "'Got it' and 'Another take' on the end card (Space, Enter, Page Down = Got it; Page Up = Another take): counts the take and names the next file",
  requirement: "Every mark on a shoot must be for a script that is on that shoot, count one or more takes, say true or false for Got it, carry the time it was pressed, and a shoot with marks must have left planned and have a start time.",
  parts: [
    {
      from: `marketing_shoots sh
      CROSS JOIN LATERAL jsonb_each(sh.marks) AS m(key, value)`,
      where: `sh.org_id = $1::uuid`,
      bad: [
        ["a mark is for a script that is not on this shoot", `NOT EXISTS (
            SELECT 1 FROM unnest(sh.root_script_ids) AS x(root) WHERE x.root::text = m.key)`],
        ["the take count is missing or less than one", `CASE WHEN COALESCE(jsonb_typeof(m.value->'takes'), 'missing') = 'number'
              THEN (m.value->>'takes')::numeric < 1 ELSE true END`],
        ["Got it is not true or false", `COALESCE(jsonb_typeof(m.value->'got_it'), 'missing') <> 'boolean'`],
        ["the mark has no time", BLANK("m.value->>'at'")]
      ]
    },
    {
      from: `marketing_shoots sh`,
      where: `sh.org_id = $1::uuid`,
      bad: [
        ["a shoot has marks but still says planned", `sh.status = 'planned' AND sh.marks::text NOT IN ('{}', 'null')`],
        ["a shoot has marks but no start time", `sh.started_at IS NULL AND sh.marks::text NOT IN ('{}', 'null')`],
        ["a shoot is closed but has no finish time", `sh.status = 'done' AND sh.finished_at IS NULL`]
      ]
    }
  ]
});

// ───────────────────────────── the registry rows ─────────────────────────────

/** The rows spread into DISPLAY_RESULT_CONTRACTS (display-saved-result.mjs). */
export const FIN_B21_DISPLAY_CONTRACTS = Object.freeze(FIN_B21_CHECKS.map((spec) => Object.freeze({
  control: spec.control,
  mode: "query",
  requirement: spec.requirement,
  sql: sqlFor(spec),
  anyImpact: true,
  ...(spec.emptyAs ? { emptyAs: spec.emptyAs } : {})
})));

/** Names of every condition, per check key, for the guard test. */
export function conditionNames(spec) {
  if (spec.badNames) return spec.badNames;
  return spec.parts.flatMap((part) => part.bad.map(([name]) => name));
}
