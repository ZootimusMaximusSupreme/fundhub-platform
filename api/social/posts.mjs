// GET/POST /api/social/posts — list the marketing queue plus failed/posted posts
// and its one open failed-post task; queue, discard, approve or refuse.
//
// WHY approve AND reject LIVE HERE. 240 gave a post the guardrail engine held for
// a person somewhere to sit (social_posts.status = 'awaiting_approval') and
// nothing could move it out again, so every held post stayed held for good —
// including every credit_repair post, which src/compliance/screen.mjs holds
// unconditionally. This route already existed and already dispatched on
// body.action, so the two decisions are two more actions on it rather than a new
// endpoint and a new row in netlify/functions/api.mjs's ROUTES map.
//
// THE ROLE CHECK IS ITS OWN CALL. requireAuth/authenticate read only { db, env }
// and silently drop a `roles` key — the bug src/http/auth-gate.test.mjs exists to
// catch — so requireRole() is called separately, after the principal resolves.
// A PARTNER MAY NEVER APPROVE THEIR OWN POST. That is the whole point of the
// hold, so it is refused here on the server; the buttons being hidden on
// public/app/social-studio.html is a courtesy, not the gate.
//
// AND NEITHER MAY ANOTHER COMPANY'S OWNER. withPartnerScope opens the
// transaction as the partner NAMED IN THE REQUEST, so row-level security says
// nothing about whether that partner belongs to the caller's company. The org
// predicate on the approve/reject lookup is the only thing that does — the same
// guard, written the same way, as api/brand/review.mjs.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid, requireRole } from "../../src/http/read-api.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { safeError } from "../../src/http/health.mjs";
import { schedule } from "../../src/social/scheduler.mjs";
import { SUITE_OFF, assertSuiteEnabled } from "../../src/brand/meter.mjs";

/* Named here rather than inherited, matching api/brand/review.mjs: this decides
   whether held marketing copy goes out, and widening it should cost somebody an
   edit to this line. */
const APPROVAL_ROLES = new Set(["owner", "admin"]);

/* Where the caller's company comes from. Copied from api/brand/review.mjs, the
   sibling that already scopes its own approve and reject this way — the same
   principal shapes reach both files, so they must read the org the same way. */
function orgIdOf(principal) {
  if (principal.kind === "staff") return principal.staff?.org_id || principal.orgId || null;
  return principal.orgId || null;
}

/* WHAT A REFUSED POST BECOMES, AND WHAT THAT WORD ALSO MEANS.
   social_posts admits only draft / awaiting_approval / queued / posting / posted
   / failed / blocked (240), and marketing_content_queue only draft / queued /
   scheduled / awaiting_approval / discarded / blocked (243). The only existing
   value that means "this will never go out" is 'blocked' — so a person refusing
   a post and the automatic copy check refusing one land on the SAME word, and
   the status column alone cannot tell them apart afterwards. That is recorded,
   not hidden: no new status was invented and no migration was written for it.
   The reason below is appended to blocked_reasons so a reader can still see
   which of the two happened, because that list is what the screen prints under
   "why it was refused".

   There is no rejected_by column on either table and none was added, so WHO
   refused a post is not recorded anywhere. approved_by is not used for it: that
   column means "approved", and writing a refuser into it would be a false
   record. */
const REFUSED_BY_A_PERSON = {
  code: "refused_by_a_person",
  rule_set: "approval",
  severity: "block",
  message: "A person at Fundhub read this post and refused it, so it will not go out. " +
           "To use these words, write a new post."
};

/* decideHeldPost — approve or refuse one held post, inside the caller's
   transaction so the post and its queue row can never disagree.

   APPROVAL IS ONE STATEMENT, ON PURPOSE. 240's screen gate is BEFORE UPDATE OF
   status and reads NEW.approved_at, so setting the signature in a separate
   statement from the status change would be refused by the trigger. */
async function decideHeldPost(tx, { row, action, staffId }) {
  if (row.status !== "awaiting_approval") {
    const e = new Error("not held");
    e.code = "NOT_HELD";
    throw e;
  }
  // A queue row only ever reaches 'awaiting_approval' on the branch that handed
  // it to a social account, so this should be impossible. If it happens the
  // honest answer is that there is no post to act on, not a guess.
  if (!row.social_post_id) {
    const e = new Error("no post");
    e.code = "NO_POST";
    throw e;
  }

  if (action === "approve") {
    const post = await tx.query(
      `UPDATE social_posts
          SET approved_at = now(), approved_by = $2, status = 'queued'
        WHERE id = $1 AND status = 'awaiting_approval'
        RETURNING id, status, approved_at`,
      [row.social_post_id, staffId]
    );
    // Somebody else moved it between the read and the write.
    if (!post.rows[0]) {
      const e = new Error("not held");
      e.code = "NOT_HELD";
      throw e;
    }
    /* The mirror. 'scheduled' is the value this same file already writes for a
       post that has been handed to a social account with a send time (243:
       "scheduled — handed to a social account with a send time"), which is
       exactly what an approved held post now is. 'queued' would claim no
       account had been chosen, and one has. */
    const u = await tx.query(
      `UPDATE marketing_content_queue
          SET status = 'scheduled', updated_at = now()
        WHERE id = $1 RETURNING *`,
      [row.id]
    );
    return u.rows[0];
  }

  // Refused. 'blocked' is not one of the four live states the screen gate
  // guards, so the trigger lets this through untouched, and publishDue never
  // sees it again. COALESCE because a null list must not swallow the reason.
  const reason = JSON.stringify([REFUSED_BY_A_PERSON]);
  const refused = await tx.query(
    `UPDATE social_posts
        SET status = 'blocked',
            blocked_reasons = COALESCE(blocked_reasons, '[]'::jsonb) || $2::jsonb
      WHERE id = $1 AND status = 'awaiting_approval'
      RETURNING id, status`,
    [row.social_post_id, reason]
  );
  /* Somebody else moved it between the read and the write — the same check the
     approve arm above makes, and it was missing here. Without it a refusal that
     changed no row still marked the screen's row 'blocked' and answered 200,
     while the post itself sat in 'queued' and would still have gone out: the
     screen said stopped, the sender said send. Throwing rolls the queue write
     below back too, because both statements are in the one transaction. */
  if (!refused.rows[0]) {
    const e = new Error("not held");
    e.code = "NOT_HELD";
    throw e;
  }
  const u = await tx.query(
    `UPDATE marketing_content_queue
        SET status = 'blocked',
            blocked_reasons = COALESCE(blocked_reasons, '[]'::jsonb) || $2::jsonb,
            updated_at = now()
      WHERE id = $1 RETURNING *`,
    [row.id, reason]
  );
  return u.rows[0];
}

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db });
  if (!principal) return;

  const partnerId = resolvePartnerId(principal, {
    partner_id: (req.body && req.body.partner_id) || (req.query || {}).partner_id
  });
  if (!partnerId) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }

  try {
    if (req.method === "GET") {
      const data = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
        const queue = await tx.query(
          `SELECT id, caption, offer_type, scheduled_for, status, social_post_id,
                  blocked_reasons, created_at, updated_at
             FROM marketing_content_queue
            WHERE partner_id = $1
            ORDER BY created_at DESC
            LIMIT 100`,
          [partnerId]
        );
        const terminal = await tx.query(
          `SELECT id, id AS social_post_id, channel_id, asset_id, caption, offer_type,
                  scheduled_for, status, blocked_reasons, attempt, posted_at,
                  external_post_id, last_error, created_at, updated_at
             FROM social_posts
            WHERE partner_id = $1
              AND status IN ('failed', 'posted')
            ORDER BY created_at DESC
            LIMIT 100`,
          [partnerId]
        );
        const terminalIds = new Set(terminal.rows.map((row) => row.id));
        const tasks = await tx.query(
          `SELECT id, task_key, title, detail, severity, resolved_at, created_at, updated_at
             FROM partner_onboarding_tasks
            WHERE partner_id = $1
              AND task_key = 'social_post_failed'
              AND resolved_at IS NULL
            ORDER BY updated_at DESC
            LIMIT 1`,
          [partnerId]
        );
        const items = terminal.rows
          .concat(queue.rows.filter((row) => !row.social_post_id || !terminalIds.has(row.social_post_id)))
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, 100);
        return { items, tasks: tasks.rows };
      });
      return res.status(200).json({ ok: true, items: data.items, tasks: data.tasks });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const action = String(body.action || "queue");
      if (!isUuid(body.id)) return res.status(400).json({ ok: false, error: "id_required" });

      /* THE GATE, BEFORE ANY ROW IS READ, so the refusal cannot depend on whose
         post was named. A partner is refused outright — they may write, queue
         and throw away their own posts, and that is all. Staff need owner or
         admin, checked in its own call after the principal resolved. */
      let approvalOrgId = null;
      if (action === "approve" || action === "reject") {
        if (principal.kind !== "staff") {
          return res.status(403).json({
            ok: false, error: "forbidden",
            message: "Only Fundhub can approve or refuse a held post. You cannot approve your own."
          });
        }
        const staff = principal.staff || { role: principal.role };
        if (!requireRole(res, staff, APPROVAL_ROLES)) return;

        /* THE CALLER'S OWN COMPANY, read the same way api/brand/review.mjs
           reads it. withPartnerScope below scopes rows to the partner NAMED IN
           THE BODY, not to the company the caller belongs to, so nothing else
           in this file compares the two. A staff session with no company
           attached is refused rather than treated as "every company", for the
           same reason review.mjs refuses it. */
        approvalOrgId = orgIdOf(principal);
        if (!approvalOrgId) {
          return res.status(403).json({
            ok: false, error: "no_org_scope",
            message: "Your sign-in is not attached to a company, so nothing was changed."
          });
        }
      }

      const out = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
        await assertSuiteEnabled(tx, partnerId);
        /* THE WHERE CLAUSE IS THE GUARD. Without the org line, an owner or
           admin of one company could approve or refuse another company's held
           post simply by putting that partner's id in the body — row-level
           security scopes to the named partner, and named the partner is. It
           is NULL, and so passes, for every action except approve and reject,
           which is deliberate: list, queue and discard legitimately serve a
           partner and are unchanged. A post in another company reads as "not
           found", the same answer as a post that does not exist, so this
           endpoint never confirms another company's post is real. */
        const row = (await tx.query(
          `SELECT * FROM marketing_content_queue
            WHERE id = $1 AND partner_id = $2
              AND ($3::uuid IS NULL OR org_id = $3::uuid)`,
          [body.id, partnerId, approvalOrgId]
        )).rows[0];
        if (!row) {
          const e = new Error("not found");
          e.code = "NOT_FOUND";
          throw e;
        }

        if (action === "approve" || action === "reject") {
          return await decideHeldPost(tx, {
            row, action, staffId: principal.staffId || null
          });
        }

        if (action === "discard") {
          const u = await tx.query(
            `UPDATE marketing_content_queue
                SET status = 'discarded', updated_at = now()
              WHERE id = $1 RETURNING *`,
            [row.id]
          );
          return u.rows[0];
        }

        const channelId = body.channel_id;
        if (!channelId) {
          const when = body.scheduled_for || row.scheduled_for;
          const u = await tx.query(
            `UPDATE marketing_content_queue
                SET status = 'queued',
                    scheduled_for = COALESCE($2::timestamptz, scheduled_for),
                    updated_at = now()
              WHERE id = $1 RETURNING *`,
            [row.id, when || null]
          );
          return u.rows[0];
        }

        const org = (await tx.query(
          `SELECT org_id FROM partners WHERE id = $1`, [partnerId]
        )).rows[0];
        const scheduled = await schedule(tx, {
          orgId: org.org_id,
          partnerId,
          channelId,
          caption: row.caption,
          offerType: row.offer_type,
          scheduledFor: body.scheduled_for || row.scheduled_for
        });
        /* THREE ENDINGS, NOT TWO. src/social/scheduler.mjs returns 'blocked',
           'needs_approval' or 'passed', and 240 made the middle one real: that
           post is sitting in social_posts.status = 'awaiting_approval' and the
           sender cannot see it. Recording it here as 'scheduled' told the partner
           it was lined up to go out when nothing will ever send it — two tables
           saying different things about the same post, and the partner reading
           the wrong one. 243 adds the word this line needs. */
        const status =
          scheduled.state === "blocked" ? "blocked"
            : scheduled.state === "needs_approval" ? "awaiting_approval"
              : "scheduled";
        const u = await tx.query(
          `UPDATE marketing_content_queue
              SET status = $2,
                  social_post_id = $3,
                  blocked_reasons = $4::jsonb,
                  scheduled_for = COALESCE($5::timestamptz, scheduled_for),
                  updated_at = now()
            WHERE id = $1 RETURNING *`,
          [row.id, status, scheduled.post?.id || null,
           JSON.stringify(scheduled.reasons || []),
           body.scheduled_for || row.scheduled_for || null]
        );
        return { ...u.rows[0], social: scheduled };
      });
      return res.status(200).json({ ok: true, item: out });
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (err) {
    if (err.code === "NOT_FOUND") return res.status(404).json({ ok: false, error: "not_found" });
    if (err.code === "NOT_HELD") {
      return res.status(409).json({ ok: false, error: "not_held",
        message: "Nothing changed — this post is not waiting for a person any more. " +
                 "Reload the page to see where it is now." });
    }
    if (err.code === "NO_POST") {
      return res.status(409).json({ ok: false, error: "no_post",
        message: "Nothing changed — this post was never handed to a social account, " +
                 "so there is nothing to approve." });
    }
    if (err.code === SUITE_OFF) {
      return res.status(403).json({ ok: false, error: "suite_off",
        message: "The owner has not turned this on for this partner." });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
