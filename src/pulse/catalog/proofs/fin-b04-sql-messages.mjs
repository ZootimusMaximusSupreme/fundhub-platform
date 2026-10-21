// Batch 04, part 1: the saved results of the chat and text controls.
// Plain read-only SELECTs. Each one takes the company as $1::uuid and returns
// sample_count (how many saved results exist) and bad_count (how many are wrong).
// Every table and column named here is one the writing code uses (see the file
// named above each query). The window is the last 30 days so an old bad row can
// age out.
//
// Repair cycle 1 (2026-10-15): the first version of these queries judged what a
// message row SAYS about itself. A checker broke the product on purpose and found
// results that were wrong and still counted clean: a text that failed, a text
// stuck in the queue, a text that went out to a client who had opted out or in the
// middle of the night, a text with restricted wording that nothing blocked, a hold
// a day too long. Those are now judged here.

// The window quiet hours close, Arizona time (src/messaging/gate.mjs
// QUIET_START_HOUR and QUIET_END_HOUR; a test holds these two numbers to the gate).
export const QUIET_START_HOUR = 20;
export const QUIET_END_HOUR = 8;

// The staff roles a task may be given (src/lib/create-task.mjs EMPLOYEE_ROLES; a
// test holds this list to that set).
export const TASK_ASSIGNEE_ROLES = Object.freeze([
  "owner", "admin", "funding_advisor", "closer", "inquiry_specialist", "setter", "sales_manager", "csm"
]);

const quote = (list) => list.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(", ");

/** A prove or sim file (e2e+, +sim-, +colin-qa) is allowed to be texted at night
    (src/messaging/gate.mjs isProveSimRecipient). Needs alias cl for the client. */
const PROVE_SIM_FILE = `(lower(split_part(COALESCE(cl.email, ''), '@', 1)) LIKE 'e2e+%'
             OR lower(split_part(COALESCE(cl.email, ''), '@', 1)) LIKE '%+sim-%'
             OR lower(split_part(COALESCE(cl.email, ''), '@', 1)) LIKE '%+colin-qa%')`;

/** The text left the building (last_attempt_at is the claim that sent it) while the
    Arizona clock said 20:00 through 07:59. One minute is left off each edge: the
    claim time is the database clock and the dispatcher's own clock decides, a few
    milliseconds apart. A missing claim time cannot be placed, so it is not judged
    (a comparison with nothing is unknown, never true). Needs alias m. With
    smsOnly false the caller has already narrowed the rows to texts. */
const sentInQuietHours = ({ smsOnly = true } = {}) => `(${smsOnly ? "m.channel = 'sms' AND " : ""}m.status IN ('sent', 'delivered')
             AND (to_char(m.last_attempt_at AT TIME ZONE 'America/Phoenix', 'HH24:MI') >= '${QUIET_START_HOUR}:01'
                  OR to_char(m.last_attempt_at AT TIME ZONE 'America/Phoenix', 'HH24:MI') < '0${QUIET_END_HOUR - 1}:59')
             AND NOT ${PROVE_SIM_FILE})`;

/** The message was sent while the client was opted out on that channel. The opt-out
    row keeps the newest opt-out time and the opt-in that followed it (src/lib/
    opt-out.mjs), so "opted out at the moment of sending" is out <= send < in. */
const SENT_WHILE_OPTED_OUT = `(m.status IN ('sent', 'delivered')
             AND EXISTS (SELECT 1 FROM opt_outs oo
                          WHERE oo.client_id = m.client_id AND oo.channel = m.channel
                            AND oo.opted_out_at < m.last_attempt_at
                            AND (oo.opted_in_at IS NULL OR oo.opted_in_at > m.last_attempt_at)))`;

/** The message was sent with words a restricted-wording rule matches. Same rules the
    gate reads (compliance_rules, active, not a warning, no platform scope), judged
    the way the gate judges them: a phrase is a case-insensitive substring, a regex is
    case-insensitive (the migration that seeds them writes patterns both engines read
    the same way). The CASE keeps a phrase from ever being read as a pattern, which
    would be an error, not a no. A rule written after the message does not count
    against it. */
const SENT_WITH_RESTRICTED_WORDS = `(m.status IN ('sent', 'delivered')
             AND EXISTS (SELECT 1 FROM compliance_rules cr
                          WHERE cr.org_id = m.org_id AND cr.active = true
                            AND cr.match_type IN ('regex', 'phrase')
                            AND cr.severity IS DISTINCT FROM 'warn'
                            AND jsonb_array_length(cr.platforms) = 0
                            AND cr.updated_at < m.created_at
                            AND CASE WHEN cr.match_type = 'regex' THEN m.rendered_body ~* cr.pattern
                                     WHEN cr.match_type = 'phrase'
                                       THEN strpos(lower(m.rendered_body), lower(cr.pattern)) > 0
                                     ELSE false END))`;

// Written by api/chat/portal-message.mjs (POST): one inbound row, no provider,
// sender_kind 'client', status 'received', on the client's own thread.
export const PORTAL_MESSAGE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE c.kind IS DISTINCT FROM 'client'
         OR c.client_id IS DISTINCT FROM m.client_id
         OR c.channel IS DISTINCT FROM m.channel
         OR m.channel NOT IN ('sms', 'email')
         OR m.status IS DISTINCT FROM 'received'
         OR m.compliance_check_passed IS NOT TRUE
         OR NULLIF(BTRIM(COALESCE(m.rendered_body, '')), '') IS NULL)::int AS bad_count
  FROM messages m
  LEFT JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
 WHERE m.org_id = $1::uuid AND m.direction = 'inbound' AND m.sender_kind = 'client'
   AND m.provider IS NULL AND m.is_demo = false
   AND m.created_at > now() - interval '30 days'`;

// The unlock modal prefills "I would like a call about: <topic>" in the chat box
// (public/app/client-portal.html openChatAbout). The client presses Send and it
// lands through the same portal-message route, so the topic must survive. A topic
// that is empty, or is the word a broken variable prints (undefined, null, NaN,
// [object Object]), is a call request with nothing to call about.
export const PORTAL_CALL_REQUEST_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE c.client_id IS DISTINCT FROM m.client_id
         OR c.channel IS DISTINCT FROM m.channel
         OR m.rendered_body ~* '^I would like a call about:[[:space:]]*(undefined|null|nan|none|false|\\[object Object\\])?[[:space:]]*$')::int AS bad_count
  FROM messages m
  LEFT JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
 WHERE m.org_id = $1::uuid AND m.direction = 'inbound' AND m.sender_kind = 'client'
   AND m.provider IS NULL AND m.is_demo = false
   AND m.rendered_body LIKE 'I would like a call about:%'
   AND m.created_at > now() - interval '30 days'`;

// Written by src/messaging/compose.mjs composeAndSend (the staff Send path,
// also used by /api/chat/messages kind=client) and then by dispatch.mjs.
//
// THE SHIFT RULE. Every staff send route is shift-gated at the request
// (requireActiveShift, owner exempt), so the sender must have had an open shift on
// the moment the message was written, on either channel. The text_sent event is a
// second record of it: only a text sent on the first try with no schedule is
// logged (a text held overnight or retried by the sweeper is sent outside the
// request and leaves none, on purpose). The closer deck's pay-link and soft-pull
// messages (provider_ref 'staff:pay-link-...' and 'staff:soft-pull-...', texts and
// emails) call composeAndSend with no shift at all, so they are not judged for one
// (product finding: api/closer-deck.mjs has no shift gate).
const STAFF_SEND_BAD = `s.id IS NULL OR cl.id IS NULL
         OR c.kind IS DISTINCT FROM 'client'
         OR c.client_id IS DISTINCT FROM m.client_id
         OR c.channel IS DISTINCT FROM m.channel
         OR m.direction IS DISTINCT FROM 'outbound'
         OR NULLIF(BTRIM(COALESCE(m.rendered_body, '')), '') IS NULL
         OR (m.status IN ('sent', 'delivered')
             AND (NULLIF(BTRIM(COALESCE(m.provider, '')), '') IS NULL
                  OR NULLIF(BTRIM(COALESCE(m.provider_message_id, '')), '') IS NULL))
         OR (m.status = 'failed'
             AND NOT EXISTS (SELECT 1 FROM messages later
                              WHERE later.org_id = m.org_id AND later.client_id = m.client_id
                                AND later.channel = m.channel AND later.direction = 'outbound'
                                AND later.status IN ('sent', 'delivered')
                                AND later.created_at > m.created_at))
         OR (m.status IN ('queued', 'sending') AND m.created_at < now() - interval '1 day')
         OR ${SENT_WHILE_OPTED_OUT}
         OR ${sentInQuietHours()}
         OR (s.role IS DISTINCT FROM 'owner'
             AND COALESCE(m.provider_ref, '') NOT LIKE 'staff:pay-link-%'
             AND COALESCE(m.provider_ref, '') NOT LIKE 'staff:soft-pull-%'
             AND NOT EXISTS (SELECT 1 FROM shifts sf
                              WHERE sf.org_id = m.org_id AND sf.staff_id = m.sender_staff_id
                                AND sf.started_at <= m.created_at
                                AND (sf.ended_at IS NULL OR sf.ended_at >= m.created_at)))
         OR (m.channel = 'sms' AND m.status IN ('sent', 'delivered')
             AND m.scheduled_at IS NULL AND m.attempts = 1
             AND s.role IS DISTINCT FROM 'owner'
             AND COALESCE(m.provider_ref, '') NOT LIKE 'staff:pay-link-%'
             AND COALESCE(m.provider_ref, '') NOT LIKE 'staff:soft-pull-%'
             AND (sh.staff_id IS DISTINCT FROM m.sender_staff_id
                  OR m.created_at < sh.started_at
                  OR m.created_at > sh.ended_at))`;

const STAFF_SEND_JOINS = `
  LEFT JOIN staff s ON s.org_id = m.org_id AND s.id = m.sender_staff_id
  LEFT JOIN clients cl ON cl.org_id = m.org_id AND cl.id = m.client_id
  LEFT JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
  LEFT JOIN staff_events ev ON ev.org_id = m.org_id AND ev.kind = 'text_sent'
       AND ev.detail->>'message_id' = m.id::text
  LEFT JOIN shifts sh ON sh.org_id = ev.org_id AND sh.id = ev.shift_id`;

// An owner-ops text (provider_ref 'owner-ops:...') is not a staff reply either: the
// one on 2026-10-07 was the teleprompter link an agent texted to the owner's own
// phone, with no client and no thread. composeAndSend writes provider_ref NULL or
// 'staff:...', never 'owner-ops:', so leaving that marker out hides no Send-button
// row. It was the one "bad" row behind the Send button and Message > Client reds.
export const STAFF_MESSAGE_SQL = `
SELECT count(DISTINCT m.id)::int AS sample_count,
       count(DISTINCT m.id) FILTER (WHERE ${STAFF_SEND_BAD})::int AS bad_count
  FROM messages m${STAFF_SEND_JOINS}
 WHERE m.org_id = $1::uuid AND m.sender_kind = 'staff'
   AND m.channel IN ('sms', 'email') AND m.is_demo = false
   AND COALESCE(m.provider_ref, '') NOT LIKE 'owner-ops:%'
   AND m.created_at > now() - interval '30 days'`;

// The chat widget on every desk. Two of its four modes leave a saved row:
// "Message staff" (api/chat/messages kind=internal, src/chat/internal.mjs: a
// delivered note on an internal thread, no client, no shift gate) and "Message a
// client" (the same send path as the Send button above, and judged the same way).
// Ask and Knowledge return an answer to the page and save nothing; the route that
// answers them is held by a practice test (fin-b04-chat-ask.test.mjs).
//
// An owner-ops text (provider_ref 'owner-ops:...') is not a widget send: it is a
// note an agent texted to the owner's own phone (2026-10-07, the teleprompter
// link), with no client and no thread. It was the one "bad" row on 2026-10-18.
// The widget's client texts always name a client and its internal notes are
// channel 'internal', so leaving that marker out hides no widget row.
export const CHAT_WIDGET_SQL = `
SELECT count(DISTINCT m.id)::int AS sample_count,
       count(DISTINCT m.id) FILTER (WHERE
         (m.channel = 'internal' AND (s.id IS NULL
            OR m.client_id IS NOT NULL
            OR c.kind IS DISTINCT FROM 'internal' OR cp.staff_id IS NULL
            OR m.direction IS DISTINCT FROM 'outbound'
            OR m.status IS DISTINCT FROM 'delivered'
            OR NULLIF(BTRIM(COALESCE(m.rendered_body, '')), '') IS NULL))
         OR (m.channel IN ('sms', 'email') AND (${STAFF_SEND_BAD})))::int AS bad_count
  FROM messages m${STAFF_SEND_JOINS}
  LEFT JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
       AND cp.staff_id = m.sender_staff_id
 WHERE m.org_id = $1::uuid AND m.sender_kind = 'staff'
   AND m.channel IN ('internal', 'sms', 'email') AND m.is_demo = false
   AND COALESCE(m.provider_ref, '') NOT LIKE 'owner-ops:%'
   AND m.created_at > now() - interval '30 days'`;

// Written by src/messaging/gate.mjs gateAndRecord (status, blocked_reason,
// blocked_at, and a createTask for restricted wording) and dispatch.mjs finalise
// (status 'blocked' with last_error). The task body is "<message id>:<codes>".
// opted_out, quiet_hours, recipient_unknown and gate_error clear on their own and
// raise no task; every other code is restricted wording and does.
//
// The gate can also fail the other way: let a message out that it should have
// stopped. That leaves no blocked row, so sent and delivered staff messages are in
// this sample too, and each is judged for the two things the gate is for: the
// client had not opted out, and no restricted phrase or pattern is in the words.
// (A task counts as raised when one exists for the message with an owner who is a
// real staff role; a person closing it afterwards does not un-raise it.)
export const MESSAGE_BLOCKED_SQL = `
SELECT count(DISTINCT m.id)::int AS sample_count,
       count(DISTINCT m.id) FILTER (WHERE
         NULLIF(BTRIM(COALESCE(m.rendered_body, '')), '') IS NULL
         OR (m.status = 'blocked'
             AND (NULLIF(BTRIM(COALESCE(m.blocked_reason, '')), '') IS NULL
                  AND NULLIF(BTRIM(COALESCE(m.last_error, '')), '') IS NULL))
         OR (NULLIF(BTRIM(COALESCE(m.blocked_reason, '')), '') IS NOT NULL AND m.blocked_at IS NULL)
         OR (NULLIF(BTRIM(COALESCE(m.blocked_reason, '')), '') IS NOT NULL
             AND m.blocked_reason !~ '^(opted_out|quiet_hours|recipient_unknown|gate_error)(,(opted_out|quiet_hours|recipient_unknown|gate_error))*$'
             AND (t.assignee_role IS NULL OR t.assignee_role NOT IN (${quote(TASK_ASSIGNEE_ROLES)})))
         OR ${SENT_WHILE_OPTED_OUT}
         OR ${SENT_WITH_RESTRICTED_WORDS})::int AS bad_count
  FROM messages m
  LEFT JOIN tasks t ON t.org_id = m.org_id AND t.source_workflow = 'messaging-gate'
       AND t.body LIKE m.id::text || ':%'
 WHERE m.org_id = $1::uuid AND m.status IN ('blocked', 'sent', 'delivered') AND m.direction = 'outbound'
   AND m.sender_kind = 'staff' AND m.channel IN ('sms', 'email') AND m.is_demo = false
   AND m.created_at > now() - interval '30 days'`;

// Written by dispatch.mjs dispatchOne, the only writer of messages.scheduled_at.
// A text inside quiet hours (20:00 to 08:00 Arizona) is put back on the queue
// with scheduled_at at the NEXT 08:00 Arizona and its claim time kept in
// last_attempt_at. Email is never held.
//
// Four ways the hold can be wrong, each one a client who is texted at the wrong
// time or never:
//   - a held row whose time is not 08:00 Arizona, is before it was written, or is
//     an email or an inbound row (the original conditions);
//   - a held row whose time is more than 12 hours after the claim that held it.
//     The next 08:00 is never further than that from a moment inside the window,
//     so a day or a week too long is red while the text waits;
//   - a text that went out with the Arizona clock inside the window and nothing
//     holding it (no schedule), prove and sim files aside;
//   - a text the gate blocked for quiet hours. The dispatcher defers BEFORE the
//     gate so this never records; one that does is a text lost for good.
export const MESSAGE_HELD_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE (m.scheduled_at IS NOT NULL
             AND (m.channel IS DISTINCT FROM 'sms'
                  OR m.direction IS DISTINCT FROM 'outbound'
                  OR m.scheduled_at <= m.created_at
                  OR to_char(m.scheduled_at AT TIME ZONE 'America/Phoenix', 'HH24:MI:SS') <> '08:00:00'
                  OR NULLIF(BTRIM(COALESCE(m.rendered_body, '')), '') IS NULL
                  OR m.last_attempt_at IS NULL
                  OR m.scheduled_at > m.last_attempt_at + interval '12 hours'))
         OR ${sentInQuietHours({ smsOnly: false })}
         OR m.blocked_reason ~ 'quiet_hours')::int AS bad_count
  FROM messages m
  LEFT JOIN clients cl ON cl.org_id = m.org_id AND cl.id = m.client_id
 WHERE m.org_id = $1::uuid AND m.sender_kind = 'staff'
   AND m.is_demo = false AND m.created_at > now() - interval '30 days'
   AND (m.scheduled_at IS NOT NULL
        OR (m.channel = 'sms' AND m.status IN ('sent', 'delivered'))
        OR m.blocked_reason ~ 'quiet_hours')`;

// Written by src/handlers/comms.mjs threadMessage (best effort, errors are
// swallowed). api/dashboard/pipeline.mjs paints the red 1 badge from the newest
// message on the client's sms or email thread, so an inbound message that is not
// on that thread never lights it. Texts from an unknown number carry no client
// and are not judged.
export const THREAD_LINK_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE c.client_id IS DISTINCT FROM m.client_id
         OR c.channel IS DISTINCT FROM m.channel
         OR c.kind IS DISTINCT FROM 'client')::int AS bad_count
  FROM messages m
  LEFT JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
 WHERE m.org_id = $1::uuid AND m.direction = 'inbound' AND m.channel IN ('sms', 'email')
   AND m.client_id IS NOT NULL AND m.is_demo = false
   AND m.created_at > now() - interval '30 days'
   AND m.created_at < now() - interval '10 minutes'`;

