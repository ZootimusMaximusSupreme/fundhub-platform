// Bank outreach on a clock: find bankers, send the three cold emails, read
// replies. Each pass is bounded and never throws; the next pass is the retry.
//
// FINDING. One search per bank-by-state row (bank + state + title, LinkedIn
// profiles only) through src/messaging/providers/serper-search.mjs. A daily cap
// keeps the free searches lasting. Found bankers are suggestions a rep accepts.
//
// EMAILS. Three steps per saved banker email (day 0, 4, 9). Each is a queued
// `messages` row; the shared dispatcher sends it. Nothing queues without
// approved copy and the mail settings named in mailConfig(): with any missing,
// the steps WAIT rather than burn, so turning sending on later starts at step 1.
import { searchWeb, serperKey } from '../messaging/providers/serper-search.mjs';
import { PROGRAM_KEY, LAUNCH_STATES } from './model.mjs';
import { bankerQuery, parseResults } from './finder.mjs';
import { COLD_STEPS, COLD_KEYS, mailConfig, refFor, inSendWindow } from './mail.mjs';
import { templateFor, loadTarget, renderBankEmail, queueBankEmail, logAutomation, stopSequence, arizonaDayStart, iso } from './queue.mjs';
import { processReplies } from './replies.mjs';

export const SEARCHES_PER_PASS = 6;
export const DEFAULT_SEARCHES_PER_DAY = 80;
export const DEFAULT_EMAILS_PER_DAY = 40;
export const EMAILS_PER_PASS = 25;
export const RESEARCH_AFTER_DAYS = 30;
const EARLY = ['new', 'researching', 'contacted'];
// Next actions the system itself wrote. A rep's own words are never replaced.
const SYSTEM_ACTIONS = new Set(['Assign a rep and find a banker', 'Find and contact a banker']);
const FOUND_ACTION = /^Review \d+ found bankers? and connect on LinkedIn$/;
const systemAction = (value) => !value || SYSTEM_ACTIONS.has(value) || FOUND_ACTION.test(value);
const DAY_MS = 86400000;

const intEnv = (value, fallback) => { const n = Number.parseInt(value, 10); return Number.isFinite(n) && n >= 0 ? n : fallback; };

export async function searchSweep(db, { env = process.env, now = new Date(), search = searchWeb, perPass = SEARCHES_PER_PASS } = {}) {
  if (!serperKey(env)) return { ok: true, reason: 'no_search_key', searched: 0 };
  const cap = intEnv(env.BANK_OUTREACH_SEARCHES_PER_DAY, DEFAULT_SEARCHES_PER_DAY);
  const used = (await db.query(`SELECT count(*)::int n FROM outreach_search_runs WHERE created_at >= $1::timestamptz`, [arizonaDayStart(now)])).rows[0].n;
  const room = Math.min(perPass, cap - used);
  if (room <= 0) return { ok: true, reason: 'daily_cap', searched: 0, used, cap };
  // Claim rows in one statement so two passes never search the same bank.
  const claimed = (await db.query(`UPDATE outreach_accounts a SET banker_search_at=$1::timestamptz
    FROM (SELECT a.id, a.banker_search_at prev FROM outreach_accounts a JOIN outreach_programs p ON p.id=a.program_id AND p.org_id=a.org_id
      WHERE p.key=$2 AND a.status NOT IN ('paused','closed','verified_partner')
        AND (a.banker_search_at IS NULL OR a.banker_search_at < $1::timestamptz - make_interval(days => $3))
      ORDER BY (a.assigned_staff_id IS NULL), (a.banker_search_at IS NOT NULL), (a.state <> ALL($4::text[])), a.banker_search_at NULLS FIRST, a.name, a.id
      LIMIT $5 FOR UPDATE OF a SKIP LOCKED) s
    WHERE a.id=s.id RETURNING a.id,a.org_id,a.name,a.state,a.next_action,a.next_due_at,s.prev`,
  [iso(now), PROGRAM_KEY, RESEARCH_AFTER_DAYS, LAUNCH_STATES, room])).rows;
  const results = []; let failures = 0;
  const unclaim = (rows) => Promise.all(rows.map(r => db.query(`UPDATE outreach_accounts SET banker_search_at=$2 WHERE id=$1`, [r.id, r.prev])));
  for (const [i, account] of claimed.entries()) {
    if (failures >= 2) { await unclaim([account]); continue; }
    const query = bankerQuery(account);
    if (!query) { await unclaim([account]); results.push({ id: account.id, reason: 'no_query' }); continue; }
    const res = await search({ query, num: 10 }, { env });
    if (res.blocked) {
      // The dry-run fence held it: nothing was spent, so this row and every
      // row still waiting in this pass go back to unsearched.
      await unclaim(claimed.slice(i));
      return { ok: true, reason: 'fence_blocked', searched: results.filter(r => r.runId).length, results };
    }
    if (!res.ok) {
      failures++;
      await db.query(`INSERT INTO outreach_search_runs(org_id,account_id,provider,query,status,error) VALUES($1,$2,'serper',$3,'failed',$4)`, [account.org_id, account.id, query, String(res.error || 'search failed').slice(0, 300)]);
      results.push({ id: account.id, reason: 'failed', error: res.error });
      continue;
    }
    const leads = parseResults(res.results, account);
    const run = (await db.query(`INSERT INTO outreach_search_runs(org_id,account_id,provider,query,status,result_count,leads_found) VALUES($1,$2,'serper',$3,'done',$4,$5) RETURNING id`, [account.org_id, account.id, query, res.results.length, leads.length])).rows[0];
    let added = 0;
    for (const lead of leads) {
      const ins = await db.query(`INSERT INTO outreach_contact_leads(org_id,account_id,search_run_id,name,title,employer,linkedin_url,snippet,confidence)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (org_id,account_id,linkedin_url) DO NOTHING RETURNING id`,
      [account.org_id, account.id, run.id, lead.name, lead.title, lead.employer, lead.linkedin_url, lead.snippet, lead.confidence]);
      added += ins.rows.length;
    }
    if (added) {
      const waiting = (await db.query(`SELECT count(*)::int n FROM outreach_contact_leads WHERE org_id=$1 AND account_id=$2 AND status='suggested'`, [account.org_id, account.id])).rows[0].n;
      const nextAction = systemAction(account.next_action) ? `Review ${waiting} found banker${waiting === 1 ? '' : 's'} and connect on LinkedIn` : account.next_action;
      if (nextAction !== account.next_action) await db.query(`UPDATE outreach_accounts SET next_action=$2,next_due_at=COALESCE(next_due_at,now()),updated_at=now() WHERE id=$1`, [account.id, nextAction]);
      await logAutomation(db, { orgId: account.org_id, accountId: account.id, channel: 'linkedin', outcome: 'bankers_found', note: `${added} banker${added === 1 ? '' : 's'} found by a LinkedIn search`, nextAction, nextDueAt: account.next_due_at });
    }
    results.push({ id: account.id, results: res.results.length, leads: added, runId: run.id });
  }
  return { ok: true, searched: results.filter(r => r.runId).length, failed: failures, results };
}

/* Start a cadence for every saved banker email that has none, on a bank still
   in its early stage. A banker who already wrote to us never gets cold mail. */
export async function enrollSequences(db, { now = new Date(), limit = 200 } = {}) {
  const { rows } = await db.query(`INSERT INTO outreach_email_sequences(org_id,account_id,contact_id,next_due_at)
    SELECT c.org_id,c.account_id,c.id,$1::timestamptz FROM outreach_contacts c
      JOIN outreach_accounts a ON a.id=c.account_id AND a.org_id=c.org_id
      JOIN outreach_programs p ON p.id=a.program_id AND p.org_id=a.org_id
     WHERE p.key=$2 AND a.status=ANY($3::text[]) AND nullif(btrim(c.email),'') IS NOT NULL AND c.email_opt_out_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM outreach_email_sequences s WHERE s.org_id=c.org_id AND s.contact_id=c.id)
       AND NOT EXISTS (SELECT 1 FROM outreach_inbound_emails r WHERE r.org_id=c.org_id AND r.contact_id=c.id)
     ORDER BY c.created_at, c.id LIMIT $4
    ON CONFLICT (org_id, contact_id) DO NOTHING RETURNING id`, [iso(now), PROGRAM_KEY, EARLY, limit]);
  return rows.length;
}

/* Why this cadence ends now, or null to keep going. Read fresh every pass:
   the cadence sleeps for days and any of these can become true meanwhile. */
export async function stopReasonFor(db, seq, target) {
  if (!target) return 'manual';
  if (target.email_opt_out_at) return 'opted_out';
  if (!String(target.email || '').includes('@')) return 'no_email';
  if (['paused', 'closed'].includes(target.status)) return 'account_closed';
  if (!EARLY.includes(target.status)) return 'manual';
  const reply = (await db.query(`SELECT 1 FROM outreach_inbound_emails WHERE org_id=$1 AND contact_id=$2 AND COALESCE(kind,'other') NOT IN ('auto_reply') LIMIT 1`, [seq.org_id, seq.contact_id])).rows[0];
  if (reply) return 'replied';
  const bad = (await db.query(`SELECT status FROM messages WHERE org_id=$1 AND provider_ref LIKE $2 AND status IN ('bounced','complained','failed') ORDER BY (status='complained') DESC LIMIT 1`, [seq.org_id, `bank-outreach:${seq.contact_id}:step%`])).rows[0];
  if (bad?.status === 'complained') {
    await db.query(`UPDATE outreach_contacts SET email_opt_out_at=COALESCE(email_opt_out_at,now()),updated_at=now() WHERE org_id=$1 AND id=$2`, [seq.org_id, seq.contact_id]);
    return 'opted_out';
  }
  if (bad) return 'bounced';
  if (seq.step >= COLD_STEPS.length) return 'completed';
  return null;
}

export async function sequenceSweep(db, { env = process.env, now = new Date(), perPass = EMAILS_PER_PASS } = {}) {
  const enrolled = await enrollSequences(db, { now });
  const cfg = mailConfig(env);
  if (!cfg.ok) return { ok: true, reason: 'not_configured', missing: cfg.missing, enrolled, queued: 0 };
  if (!inSendWindow(now)) return { ok: true, reason: 'outside_send_window', enrolled, queued: 0 };
  const cap = intEnv(env.BANK_OUTREACH_EMAILS_PER_DAY, DEFAULT_EMAILS_PER_DAY);
  const sentToday = (await db.query(`SELECT count(*)::int n FROM messages WHERE template_key=ANY($1::text[]) AND created_at >= $2::timestamptz`, [COLD_KEYS, arizonaDayStart(now)])).rows[0].n;
  const room = Math.min(perPass, cap - sentToday);
  if (room <= 0) return { ok: true, reason: 'daily_cap', enrolled, queued: 0, sentToday, cap };
  // Claim by pushing next_due_at an hour out; a crash mid-pass retries then.
  const due = (await db.query(`UPDATE outreach_email_sequences s SET next_due_at=$1::timestamptz + interval '1 hour',updated_at=now()
    WHERE s.id IN (SELECT id FROM outreach_email_sequences WHERE status='active' AND next_due_at <= $1::timestamptz ORDER BY next_due_at LIMIT $2 FOR UPDATE SKIP LOCKED)
    RETURNING s.*`, [iso(now), room])).rows;
  const results = []; let queued = 0;
  for (const seq of due) {
    try {
      const target = await loadTarget(db, { orgId: seq.org_id, contactId: seq.contact_id });
      const stop = await stopReasonFor(db, seq, target);
      if (stop) { await stopSequence(db, { orgId: seq.org_id, contactId: seq.contact_id, reason: stop, now }); results.push({ id: seq.id, stopped: stop }); continue; }
      const spec = COLD_STEPS[seq.step];
      const tpl = await templateFor(db, seq.org_id, spec.key);
      const rendered = tpl ? renderBankEmail(tpl, target, { env }) : null;
      if (!tpl || rendered.reason) {
        // Waiting on copy approval or settings: hold the step, check again tomorrow.
        await db.query(`UPDATE outreach_email_sequences SET next_due_at=$2::timestamptz,updated_at=now() WHERE id=$1`, [seq.id, new Date(new Date(now).getTime() + DAY_MS).toISOString()]);
        results.push({ id: seq.id, waiting: tpl ? rendered.reason : 'template_pending', key: spec.key });
        continue;
      }
      const messageId = await queueBankEmail(db, { target, templateKey: spec.key, subject: rendered.subject, body: rendered.body, providerRef: refFor(seq.contact_id, `step${spec.step}`) });
      const next = COLD_STEPS[seq.step + 1];
      const nextDue = next ? new Date(new Date(now).getTime() + next.afterDays * DAY_MS).toISOString() : iso(now);
      await db.query(`UPDATE outreach_email_sequences SET step=$2,last_sent_at=CASE WHEN $3::boolean THEN $4::timestamptz ELSE last_sent_at END,next_due_at=$5::timestamptz,updated_at=now() WHERE id=$1`, [seq.id, spec.step, !!messageId, iso(now), nextDue]);
      if (!next) await stopSequence(db, { orgId: seq.org_id, contactId: seq.contact_id, reason: 'completed', now });
      if (messageId) {
        queued++;
        await db.query(`UPDATE outreach_accounts SET status=CASE WHEN status IN ('new','researching') THEN 'contacted' ELSE status END,last_touch_at=now(),updated_at=now() WHERE org_id=$1 AND id=$2`, [seq.org_id, seq.account_id]);
        await logAutomation(db, { orgId: seq.org_id, accountId: seq.account_id, contactId: seq.contact_id, channel: 'email', outcome: `auto_email_step_${spec.step}`, note: `Automatic email ${spec.step} of ${COLD_STEPS.length} queued`, nextAction: target.next_action, nextDueAt: target.next_due_at });
      }
      results.push({ id: seq.id, step: spec.step, messageId });
    } catch (err) {
      results.push({ id: seq.id, error: String(err?.message || err).slice(0, 200) });
    }
  }
  return { ok: true, enrolled, queued, results };
}

/* One pass of all three. Each part reports alone so one failure never hides the others. */
export async function runAutomation(db, opts = {}) {
  const guard = async (fn) => { try { return await fn(); } catch (err) { return { ok: false, error: String(err?.message || err).slice(0, 300) }; } };
  return {
    search: await guard(() => searchSweep(db, opts)),
    emails: await guard(() => sequenceSweep(db, opts)),
    replies: await guard(() => processReplies(db, opts))
  };
}
