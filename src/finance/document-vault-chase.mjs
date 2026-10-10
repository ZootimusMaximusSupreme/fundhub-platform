// The vault's chase — the money helper's rules brain asking a client for the next
// missing paper. Capital Blueprint unit B3.
//
// "The agent collects bank statements, tax returns and ID ahead of time."
//
// THE SHAPE IS THE WAYPOINT NUDGE'S, ON PURPOSE (src/nudge/ladder.mjs): a text, an
// email, a text, and then a person. Three asks per line and the fourth step is a
// human. It is a table of three constants and not a loop, because on 2026-09-03 a
// chase loop in this product sent 51 identical texts to one phone in two hours.
// There is no arithmetic in this file that can produce a fourth ask.
//
// THE RULES (every one is enforced here and pinned by a test):
//   * ONE ASK PER CLIENT PER N DAYS. N is 3 (DOCUMENT_VAULT_ASK_EVERY_DAYS to move
//     it). The ask is about ONE line, the next one still open, so a client with
//     eight missing papers is asked about the first, not texted eight times. Counted
//     in whole calendar days (UTC) so a cron that fires a few seconds earlier than
//     yesterday does not lose a day.
//   * THREE ASKS PER LINE. Then the line is "handed to a person": one CSM task per
//     client per round, listing what is still open. While that task is open the chase
//     says nothing; once a CSM closes it, the chase goes on with the lines that still
//     have asks left (a line that used up its three is never asked a fourth time).
//   * STOP WHEN COMPLETE. A complete vault asks for nothing.
//   * WAITING ON US IS NOT THE CLIENT'S FAULT. A line whose file is uploaded and
//     waiting for review is never chased — a PERSON is told instead: one "Documents
//     are waiting for your review" task per client at a time (role admin: the role
//     the vault's staff gate lets accept a file).
//   * A FILE THAT ARRIVES ENDS THE ROUND. Asks are counted from the newest file on
//     that line, so a statement that goes stale three months later starts a fresh
//     count of three, not "already asked three times".
//   * A PERSON ALREADY ON IT (an open CSM task from this chase) → no more messages.
//   * AN ESCALATION ON FILE (a lawyer, a threat) → nothing at all. Same stop the
//     money helper uses (client_escalations).
//   * NEVER A SECOND MESSAGE ON A CHANNEL INSIDE 20 HOURS, whoever sent the first
//     (the waypoint nudge, the money helper, anything). The dispatcher still owns
//     quiet hours, the opt-out read and the dry-run switch.
//
// THE ASK GOES THROUGH THE EXISTING TASK CONTRACT (docs/finance/money-agent-tasks.md).
// Each ask is one money_agent_tasks row: kind 'other', source 'doc-vault',
// task_key 'vault:<line>:<scope>', assignee 'agent', moves no money. It is
// enqueued AND claimed in one statement (born 'claimed', so the money helper's claim,
// which only takes 'queued' rows, can never take it), worked — sendTemplated QUEUES
// the message, the dispatcher sends — and finished 'done' with what happened in
// `result`. The claim-first insert is the cap: money_agent_tasks_one_open refuses a
// second open row for the same line, so two schedulers cannot both ask.
//
// NOTHING MOVES MONEY AND NOTHING IS SENT FROM HERE. sendTemplated only writes a
// `messages` row at status 'queued' (CLAUDE.md §12).

import { createTask as defaultCreateTask } from "../lib/create-task.mjs";
import { sendTemplated as defaultSend } from "../workflows/messaging.mjs";
import {
  loadVaultFacts, vaultFromFacts, vaultLine, DONE_STATUSES, ITEM_STATUS, isoDay, isUuid
} from "./document-vault.mjs";
import { vaultSettings } from "./document-vault-items.mjs";

export const TASK_SOURCE = "doc-vault";
export const TASK_KEY_PREFIX = "vault";
export const BRAIN = "doc-vault-rules";
/** tasks.source_workflow for the hand-off to a person. */
export const STAFF_SOURCE = "document-vault";
export const STAFF_TASK_ROLE = "csm";
/** tasks.source_workflow for "files are waiting for review". One open at a time per client. */
export const REVIEW_SOURCE = "document-vault-review";
/* WHO IS TOLD A FILE IS WAITING. The role that can act on it: accepting and
   rejecting go through POST /api/money/vault, whose staff gate is ROLE_SETS.FINANCE
   (owner, admin, sales_manager) like the rest of api/money/*. A CSM would be handed a
   task the endpoint then refuses them, so it goes to admin. If the gate is widened to
   the CSM, change this one constant. */
export const REVIEW_TASK_ROLE = "admin";

/** The three asks, in order. The step after the last is a person. */
export const ASK_STEPS = Object.freeze([
  Object.freeze({ rung: 1, channel: "sms", templateKey: "SMS-VAULT-ASK-1" }),
  Object.freeze({ rung: 2, channel: "email", templateKey: "EMAIL-VAULT-ASK-2" }),
  Object.freeze({ rung: 3, channel: "sms", templateKey: "SMS-VAULT-ASK-3" })
]);
export const MAX_ASKS = ASK_STEPS.length;
export const TEMPLATE_KEYS = Object.freeze(ASK_STEPS.map((s) => s.templateKey));

/** Hours a channel stays quiet after any outbound message on it. */
export const QUIET_HOURS = 20;

/** Lines a client can act on. 'uploaded' is waiting on staff; done lines need nothing. */
const CLIENT_ACTION = Object.freeze([ITEM_STATUS.MISSING, ITEM_STATUS.EXPIRED, ITEM_STATUS.REJECTED]);

export const askTaskKey = (slot) => `${TASK_KEY_PREFIX}:${slot}`;

/** 'vault:bank_statements_business:<uuid>' → 'bank_statements_business:<uuid>' */
export function slotOfTaskKey(taskKey) {
  const m = /^vault:(.+)$/.exec(String(taskKey || ""));
  return m ? m[1] : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayGap(fromIso, toIso) {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

const escapeHtml = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* ───────────────────────────── the plan (pure) ───────────────────────────── */

/**
 * planChase — what to do for one client today. No database, no clock but `now`.
 *
 *   core    buildVault() output
 *   asks    prior ask rows: [{ task_key, created_at, status }]
 *   facts   { escalated, openStaffTask, recent: { sms, email } }
 *
 * Returns { ask, csm, reason, counts } where ask / csm are null or a description.
 */
export function planChase({ core, asks = [], facts = {}, now = new Date(), env = process.env } = {}) {
  const settings = vaultSettings(env);
  const every = settings.ask_every_days;
  const today = isoDay(now);

  /* FILES WAITING FOR REVIEW tell a PERSON, not the client. Vault-only papers skip
     the identity reader (src/handlers/doc-check.mjs), so nothing else announces an
     upload. One task at a time per client: while one is open, no second. This is
     internal work, so a client under escalation still gets it (the escalation stops
     messages TO the client, not staff looking at a file). */
  const open = core ? core.items.filter((i) => !DONE_STATUSES.includes(i.status)) : [];
  const waiting = open.filter((i) => i.status === ITEM_STATUS.UPLOADED);
  const review = waiting.length && !facts.openReviewTask
    ? { slots: waiting.map((i) => i.slot), labels: waiting.map((i) => i.label) }
    : null;
  const none = (reason, extra = {}) => ({ ask: null, csm: null, review, reason, ...extra });

  if (!core) return none("no_vault");
  if (core.complete) return none("complete");
  if (facts.escalated) return none("escalation_on_file");

  const actionable = open.filter((i) => CLIENT_ACTION.includes(i.status));
  if (!actionable.length) return none("waiting_on_review");

  // Asks for each line, counted only since the newest file on that line.
  const bySlot = new Map();
  for (const a of asks) {
    const slot = slotOfTaskKey(a.task_key);
    if (!slot) continue;
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(a);
  }
  const state = actionable.map((item) => {
    const since = item.last_activity_at ? Date.parse(item.last_activity_at) : 0;
    const mine = (bySlot.get(item.slot) || [])
      .filter((a) => Date.parse(a.created_at) > since)
      .sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at));
    return { item, count: mine.length, last: mine.length ? isoDay(mine[mine.length - 1].created_at) : null };
  });

  /* THE HAND-OFF. A line that has had its three asks and has been quiet for the
     window goes to a person: one CSM task for the client, listing what is open. Its
     round is named by the date of the newest exhausted line's last ask, so the same
     round is one task however many passes see it, and a LATER line running out opens
     a new round. A round that already has a task (open or closed) is not made again;
     once a CSM closes theirs, the chase goes on with the lines that still have asks. */
  const exhausted = state.filter((s) => s.count >= MAX_ASKS && s.last && dayGap(s.last, today) >= every);
  const done = new Set(Array.isArray(facts.handoffs) ? facts.handoffs : []);
  let csm = null;
  if (exhausted.length && !facts.openStaffTask) {
    const cycle = exhausted.map((s) => s.last).sort().pop();
    if (!done.has(cycle)) {
      csm = { slots: exhausted.map((s) => s.item.slot), labels: exhausted.map((s) => s.item.label), cycle };
    }
  }

  const base = { csm, review, counts: { actionable: actionable.length, exhausted: state.filter((s) => s.count >= MAX_ASKS).length } };
  // A person is being handed this client right now, or already has them: no message
  // from the chase while they reach out.
  if (csm) return { ask: null, reason: "handed_to_a_person", ...base };
  if (facts.openStaffTask) return { ask: null, reason: "a_person_has_this", ...base };

  // One ask per client per window, across every line (and every earlier round).
  const lastAny = asks.map((a) => isoDay(a.created_at)).filter(Boolean).sort().pop() || null;
  if (lastAny && dayGap(lastAny, today) < every) return { ask: null, reason: "asked_recently", ...base };

  const next = state.find((s) => s.count < MAX_ASKS);
  if (!next) return { ask: null, reason: "ladder_done", ...base };

  const step = ASK_STEPS[next.count];
  if (facts.recent && facts.recent[step.channel]) return { ask: null, reason: "recent_message", ...base };

  const after = actionable.length - 1;
  return {
    ask: {
      slot: next.item.slot,
      key: next.item.key,
      label: next.item.label,
      status: next.item.status,
      rung: step.rung,
      channel: step.channel,
      templateKey: step.templateKey,
      more: after
    },
    reason: `ask_${step.rung}`,
    ...base
  };
}

/** The words that go into the template for an ask. */
export function askContext(core, ask) {
  const item = core.items.find((i) => i.slot === ask.slot);
  const rejected = item && item.status === ITEM_STATUS.REJECTED
    ? item.documents.filter((d) => d.status === ITEM_STATUS.REJECTED && d.reason).slice(-1)[0]
    : null;
  // A person typed the reason for the client to read; keep a text from becoming an essay.
  const clip = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1).trimEnd()}…` : String(t));
  const what = rejected
    ? `${item.ask_text} (the last copy could not be used: ${clip(rejected.reason, 120)})`
    : item && item.status === ITEM_STATUS.EXPIRED
      ? `${item.ask_text} (the ones we have are too old now)`
      : item.ask_text;
  const rows = core.items.filter((i) => CLIENT_ACTION.includes(i.status));
  /* "Reply to this text with a photo" is only true for the three PERSONAL papers.
     A texted photo is filed by what the document reader says it is
     (src/handlers/inbound-mms-docs.mjs): an ID, an address proof, a bank statement,
     a tax return. It can never be a BUSINESS statement or a staff-added line, so
     for those the text points at the portal alone. */
  const byPhoto = item && item.scope.kind === "client" && !item.custom;
  return {
    what,
    reply_phrase: byPhoto ? " Or reply to this text with a photo." : "",
    more_phrase: ask.more > 0 ? ` After that, ${ask.more} more ${ask.more === 1 ? "document" : "documents"}.` : "",
    list_html:
      `<ul style="margin:0 0 0 18px;padding:0;">${rows.map((r) => `<li>${escapeHtml(r.label)} — ${escapeHtml(r.detail)}</li>`).join("")}</ul>`
  };
}

/* ───────────────────────────── reads ───────────────────────────── */

/** Every ask this client has had, oldest first. */
export async function loadAsks(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT id, task_key, status, created_at
       FROM money_agent_tasks
      WHERE org_id = $1 AND client_id = $2 AND source = $3
      ORDER BY created_at, id`,
    [orgId, clientId, TASK_SOURCE]
  );
  return r.rows;
}

export async function loadChaseFacts(db, { orgId, clientId, now = new Date() }) {
  const since = new Date(new Date(now).getTime() - QUIET_HOURS * 60 * 60 * 1000);
  const [esc, staff, out] = await Promise.all([
    db.query(`SELECT 1 FROM client_escalations WHERE client_id = $1 LIMIT 1`, [clientId]),
    db.query(
      `SELECT source_workflow, body, done FROM tasks
        WHERE org_id = $1 AND client_id = $2 AND source_workflow = ANY($3::text[])`,
      [orgId, clientId, [STAFF_SOURCE, REVIEW_SOURCE]]),
    db.query(
      `SELECT DISTINCT channel FROM messages
        WHERE org_id = $1 AND client_id = $2 AND direction = 'outbound' AND created_at > $3`,
      [orgId, clientId, since])
  ]);
  const channels = new Set(out.rows.map((r) => r.channel));
  const handedOff = staff.rows.filter((r) => (r.source_workflow || STAFF_SOURCE) === STAFF_SOURCE);
  return {
    escalated: esc.rows.length > 0,
    openStaffTask: handedOff.some((r) => r.done === false),
    openReviewTask: staff.rows.some((r) => r.source_workflow === REVIEW_SOURCE && r.done === false),
    // The rounds a person has already been handed: 'vault-csm:<client>:<YYYY-MM-DD>'.
    handoffs: handedOff
      .map((r) => /^vault-csm:[0-9a-f-]{36}:(\d{4}-\d{2}-\d{2})$/i.exec(String(r.body || "")))
      .filter(Boolean).map((m) => m[1]),
    recent: { sms: channels.has("sms"), email: channels.has("email") }
  };
}

async function assignedCsm(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT assigned_csm_staff_id FROM clients WHERE id = $1 AND org_id = $2`, [clientId, orgId]);
  return (r.rows[0] && r.rows[0].assigned_csm_staff_id) || null;
}

/* An ask row is open for the few milliseconds between its insert and its finish.
   If the function dies in between, the row would stay open, and
   money_agent_tasks_one_open would then refuse every later ask for that line
   forever. So a pass first closes any vault ask still open after an hour as
   failed. It still counts as an attempt: the ladder stays bounded. */
export const STALE_AFTER_HOURS = 1;

export async function closeStaleAsks(db, { orgId, clientId, now = new Date() }) {
  const cutoff = new Date(new Date(now).getTime() - STALE_AFTER_HOURS * 60 * 60 * 1000);
  const r = await db.query(
    `UPDATE money_agent_tasks
        SET status = 'failed',
            result = jsonb_build_object('asked', false, 'error', 'closed by the next pass: the ask never finished')
      WHERE org_id = $1 AND client_id = $2 AND source = $3
        AND status IN ('queued', 'claimed') AND created_at < $4
      RETURNING id`,
    [orgId, clientId, TASK_SOURCE, cutoff]
  );
  return r.rows.length;
}

/* ───────────────────────────── the runner ───────────────────────────── */

/**
 * runVaultChase — one client, one pass. Never moves money. With dryRun it only
 * reads and returns the plan: not one INSERT, UPDATE or message.
 *
 * @returns {Promise<object>} { ok, reason, plan, ask?, csm?, vault }
 */
export async function runVaultChase(db, {
  orgId, clientId, now = new Date(), env = process.env, dryRun = false,
  send = defaultSend, createTask = defaultCreateTask
} = {}) {
  if (!orgId || !isUuid(clientId)) return { ok: false, reason: "missing_ids" };
  const vaultFacts = await loadVaultFacts(db, { orgId, clientId });
  if (!vaultFacts) return { ok: false, reason: "no_client" };
  const core = vaultFromFacts(vaultFacts, { now, env });
  const summary = { complete: core.complete, ...core.summary };
  if (core.complete) return { ok: true, reason: "complete", plan: null, vault: summary };

  if (!dryRun) await closeStaleAsks(db, { orgId, clientId, now });
  const [asks, facts] = await Promise.all([
    loadAsks(db, { orgId, clientId }),
    loadChaseFacts(db, { orgId, clientId, now })
  ]);
  const plan = planChase({ core, asks, facts, now, env });
  if (dryRun) return { ok: true, dryRun: true, reason: plan.reason, plan, vault: summary };

  const out = { ok: true, reason: plan.reason, plan, vault: summary, ask: null, csm: null, review: null };

  if (plan.csm) {
    const key = `vault-csm:${clientId}:${plan.csm.cycle}`;
    const t = await createTask(db, {
      orgId, clientId,
      title: "Client has not sent their documents after three asks — reach out",
      sourceWorkflow: STAFF_SOURCE,
      assigneeRole: STAFF_TASK_ROLE,
      assigneeStaffId: await assignedCsm(db, { orgId, clientId }),
      eventId: key,
      body: key,
      detail: `Asked three times with no new file. Still open: ${plan.csm.labels.join("; ")}. `
        + `Call them, or waive a line that does not apply in the vault. ${vaultLine({ complete: false, summary: core.summary, missing: core.missing })}`
    });
    out.csm = { created: !!(t && t.created), taskId: (t && t.id) || null, key };
  }

  if (plan.review) {
    const key = `vault-review:${clientId}:${isoDay(now)}`;
    const t = await createTask(db, {
      orgId, clientId,
      title: "Documents are waiting for your review",
      sourceWorkflow: REVIEW_SOURCE,
      assigneeRole: REVIEW_TASK_ROLE,
      eventId: key,
      body: key,
      detail: `Uploaded and not yet accepted or rejected: ${plan.review.labels.join("; ")}. `
        + "Open the client's document vault and accept or reject each file."
    });
    out.review = { created: !!(t && t.created), taskId: (t && t.id) || null, key };
  }

  if (plan.ask) out.ask = await sendAsk(db, { orgId, clientId, core, ask: plan.ask, now, send });
  return out;
}

/**
 * sendAsk — enqueue, claim, work, finish. One row, one message, never two.
 * Exported for tests.
 */
export async function sendAsk(db, { orgId, clientId, core, ask, now = new Date(), send = defaultSend }) {
  const taskKey = askTaskKey(ask.slot);
  const item = core.items.find((i) => i.slot === ask.slot);
  /* ENQUEUED AND CLAIMED IN ONE STATEMENT. The row is born 'claimed', never
     'queued': the money helper's claim (src/finance/money-agent-tasks.mjs
     claimAgentTask, WHERE status = 'queued') then cannot take a vault ask between
     an insert and a claim, and a crash cannot leave one waiting in the queue for
     the helper to pick up and work as if it were its own. The partial unique index
     money_agent_tasks_one_open still covers 'claimed', so a second scheduler gets
     no row back and asks nothing. */
  const ins = await db.query(
    `INSERT INTO money_agent_tasks
       (org_id, client_id, task_key, kind, title, why, source, assignee, status,
        claimed_by, claimed_at, requested_by_kind, detail)
     VALUES ($1, $2, $3, 'other', $4, $5, $6, 'agent', 'claimed', $7, now(), 'staff', $8::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      orgId, clientId, taskKey,
      `Send ${item.ask_text}`,
      item.why || null,
      TASK_SOURCE,
      BRAIN,
      JSON.stringify({
        vault: true, slot: ask.slot, item_key: ask.key, rung: ask.rung, channel: ask.channel,
        status_at_ask: ask.status, need: item.need, have: item.have, requested_by: "doc-vault"
      })
    ]
  );
  const id = ins.rows[0] && ins.rows[0].id;
  if (!id) return { asked: false, reason: "already_open" };

  const finish = (status, result) => db.query(
    `UPDATE money_agent_tasks
        SET status = $2, done_at = CASE WHEN $2 = 'done' THEN now() ELSE done_at END, result = $3::jsonb
      WHERE id = $1`,
    [id, status, JSON.stringify(result)]
  );

  let sent;
  try {
    sent = await send(db, {
      orgId, clientId,
      channel: ask.channel,
      templateKey: ask.templateKey,
      eventId: `vault-ask:${id}`,
      context: { vault: askContext(core, ask) }
    });
  } catch (err) {
    await finish("failed", { asked: false, error: String((err && err.message) || err).slice(0, 300), rung: ask.rung, channel: ask.channel });
    return { asked: false, reason: "send_failed", taskId: id };
  }

  if (sent && sent.sent) {
    await finish("done", { asked: true, queued: true, rung: ask.rung, channel: ask.channel, template: ask.templateKey });
    return { asked: true, taskId: id, rung: ask.rung, channel: ask.channel, templateKey: ask.templateKey };
  }
  // Not sent (opted out, template not approved, no address): the row says so, and it
  // still counts as an attempt, so the ladder ends in a person instead of repeating.
  const why = (sent && sent.reason) || "not_sent";
  await finish("cancelled", { asked: false, reason: why, rung: ask.rung, channel: ask.channel, template: ask.templateKey });
  return { asked: false, reason: why, taskId: id, rung: ask.rung, channel: ask.channel };
}

export default { planChase, runVaultChase, sendAsk, ASK_STEPS, MAX_ASKS, TEMPLATE_KEYS };
