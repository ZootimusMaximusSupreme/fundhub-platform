// GET /api/read/inbox — every conversation in the company, newest activity first.
//
// The staff reply inbox's list pane. One row per thread, carrying enough to
// render a list item without a second request per row: who it is with, which
// channel, when it last moved, the last thing said, and whether anybody has
// answered it.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS IS NOT api/read/conversations.mjs WITH THE client_id MADE OPTIONAL.
//
// That endpoint requires client_id and its header explains at length why:
// "'forgot the parameter' must never degrade into 'return the whole table'".
// That reasoning is correct for what it is — the Closer Dashboard's pre-call
// panel, which is always about one person — and relaxing it would mean a
// missing parameter silently changed what the endpoint is for.
//
// An inbox is a different question with a different answer. It is cross-client
// BY DEFINITION; there is no id to pass, because the whole point is to see the
// threads you do not already know about. So it is a second endpoint with its
// own name, and the "no client id" case is its normal case rather than a
// degraded one. api/read/conversations.mjs is untouched and is still what the
// client context panel uses to show one person's other threads.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT "UNREAD" MEANS HERE, EXACTLY.
//
//   unread = the most recent message on the thread came from the client.
//
// It is DERIVED, not stored. There is no read receipt in this schema, no
// last_read_at on conversations, and no per-staff read state anywhere — so
// there is no way to know whether a particular employee has looked at a
// particular thread, and this does not pretend otherwise. What it can say from
// the rows that exist is "they spoke last and nobody has replied", which is the
// thing an inbox is actually for: work that is owed.
//
// The consequence, stated plainly so the screen does not overclaim: reading a
// thread does not clear its flag, and replying does. It is a needs-a-reply
// marker, and public/app/messaging.html labels it "needs reply" rather than
// "unread" for that reason. Adding real per-staff read state means a table, a
// write endpoint and a decision about whether read is per-person or per-company
// — none of which is invented here.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE LATERAL, AND WHY IT IS NOT A GROUP BY.
//
// Each thread needs its LAST message — body, direction, time. A GROUP BY gives
// max(created_at) and then needs a self-join to recover the rest of that row.
// LATERAL ... ORDER BY created_at DESC LIMIT 1 asks for the row directly and
// rides idx_messages_thread (117), which is ordered for exactly this.
//
// LEFT JOIN LATERAL, not an inner one. A conversation with no messages is a
// real state — upsertConversation can create the thread before a message row
// lands — and an inbox that hides threads with nothing in them would be hiding
// exactly the ones somebody should look at. Those rows come back with a null
// preview and the screen says so rather than rendering a blank line.
//
// THE ORDERING IS EXPLAINED WHERE THE QUERY IS, not here — see the block above
// export const run. Short version: the page is chosen using only columns on
// `conversations`, so an index can serve it, and the lateral runs afterwards
// against the chosen rows rather than against the whole table.
//
// ORG COMES FROM THE SESSION and nowhere else. This is the endpoint audit C1
// was about — a cross-client list with no id in the request — so the filter is
// on the session's org, a session with none binds NULL, and it fails CLOSED.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

/* ═══════════════════════════════════════════════════════════════════════════
   THE PAGE IS CHOSEN BEFORE THE LATERAL RUNS, AND THAT IS THE WHOLE QUERY PLAN.

   The obvious shape — join the newest message to every conversation, then sort
   by it and take fifty — makes Postgres run the lateral for EVERY conversation
   in the company before it can order them. At a few hundred threads nobody
   notices. At a hundred thousand it is a hundred thousand index lookups to
   render one screen, on every load, and it gets slower every week the business
   grows. That is the shape of thing that works in testing and falls over in
   month nine.

   So the inner SELECT picks the page using ONLY columns on `conversations`,
   which an index can serve directly (idx_conversations_activity, migration
   119), and the lateral then runs against the fifty rows that survived.

   THE SORT KEY MOVED FROM THE MESSAGE TO THE THREAD, and that is a real
   trade worth stating. It now orders by `last_pulse_at`, the column
   src/conversations/store.mjs maintains, rather than by the newest message's
   own timestamp. Both writers keep it current — the inbound handler and
   compose — but threadMessage() deliberately swallows its own failures, so a
   thread whose pulse write failed would sort by its created_at instead of by
   its newest message.

   That is survivable and the alternative is not: a rare row in a slightly wrong
   position, versus a screen that stops loading. COALESCE(last_pulse_at,
   created_at) means a thread with no pulse still sorts somewhere sensible
   rather than vanishing to the bottom, and `activity_at` in the output still
   reports the message time when there is one, so the screen shows the truth
   even in the rare case the ordering lagged. */
export const run = readHandler({
  roles: ROLE_SETS.STAFF,
  fetch: (db, { limit, offset, query, staff }) => {
    /* ?needs_reply=1 — the "Needs reply" tab, filtered IN THE DATABASE.

       It used to be filtered in the browser over whatever page had been
       loaded, which is fine at fifty threads and a lie at fifty thousand: the
       tab would show "the threads needing a reply among the newest two
       hundred" while looking like it showed all of them, and the oldest
       unanswered message — the one that matters most — is exactly the one that
       would be missing. */
    const needsReplyOnly = query.needs_reply === "1" || query.needs_reply === "true";

    return db.query(
      `WITH page AS (
         SELECT c.id, c.client_id, c.channel, c.summary, c.sentiment,
                c.last_pulse_at, c.created_at
           FROM conversations c
          WHERE c.org_id = $3::uuid
            AND EXISTS (
              SELECT 1 FROM clients active_client
               WHERE active_client.id = c.client_id
                 AND active_client.org_id = c.org_id
                 AND active_client.custom_fields->>'crm_archived_at' IS NULL
            )
            AND ($4::boolean IS NOT TRUE OR (
                  -- "the newest message on this thread came from the client",
                  -- asked per-thread against idx_messages_thread rather than by
                  -- ranking every message in the company.
                  --
                  -- A thread with no messages yields NULL here, and
                  -- NULL = 'inbound' is itself NULL, which is not true, so it is
                  -- excluded. Correct: nobody said anything, so nobody is owed
                  -- a reply. Same answer the needs_reply column gives.
                  SELECT m.direction FROM messages m
                   WHERE m.conversation_id = c.id
                   ORDER BY m.created_at DESC, m.id DESC
                   LIMIT 1
                 ) = 'inbound')
          ORDER BY COALESCE(c.last_pulse_at, c.created_at) DESC, c.id DESC
          LIMIT $1 OFFSET $2
       )
       SELECT page.id,
              page.client_id,
              page.channel,
              page.summary,
              page.sentiment,
              page.last_pulse_at,
              page.created_at,
              cl.first_name,
              cl.last_name,
              last.id            AS last_message_id,
              last.direction     AS last_direction,
              last.rendered_body AS last_body,
              last.status        AS last_status,
              last.created_at    AS last_at,
              -- See the header: this is "they spoke last", not "nobody has read it".
              (last.direction = 'inbound')            AS needs_reply,
              COALESCE(last.created_at, page.last_pulse_at, page.created_at) AS activity_at
         FROM page
         JOIN clients cl
           ON cl.id = page.client_id
          AND cl.org_id = $3::uuid
         LEFT JOIN LATERAL (
           SELECT m.id, m.direction, m.rendered_body, m.status, m.created_at
             FROM messages m
            WHERE m.conversation_id = page.id
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT 1
         ) last ON true
        ORDER BY COALESCE(last.created_at, page.last_pulse_at, page.created_at) DESC, page.id DESC`,
      [limit + 1, offset, (staff && staff.org_id) || null, needsReplyOnly]
    ).then((r) => r.rows);
  }
});

/* sentiment IS PASSED THROUGH AS NULL, exactly as api/read/conversations.mjs
   does, and for the reason written at length in src/conversations/store.mjs:
   nothing in this repository computes Hot/Warm/Cold. It is selected rather than
   dropped so the shape matches the sibling endpoint; the screen does not render
   it, because a guessed sentiment on an inbox row is a claim about a person
   nobody observed. */
export default (req, res) => run(req, res, { db, requireAuth });
