// Batch 04, part 1: the saved results of the chat, text and push controls.
// Plain read-only SELECTs. Each one takes the company as $1::uuid and returns
// sample_count (how many saved results exist) and bad_count (how many are wrong).
// Every table and column named here is one the writing code uses (see the file
// named above each query). The window is the last 30 days so an old bad row can
// age out; state tables (push devices) have no window.

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
// lands through the same portal-message route, so the topic must survive.
export const PORTAL_CALL_REQUEST_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE c.client_id IS DISTINCT FROM m.client_id
         OR c.channel IS DISTINCT FROM m.channel
         OR m.rendered_body ~ '^I would like a call about: *$')::int AS bad_count
  FROM messages m
  LEFT JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
 WHERE m.org_id = $1::uuid AND m.direction = 'inbound' AND m.sender_kind = 'client'
   AND m.provider IS NULL AND m.is_demo = false
   AND m.rendered_body LIKE 'I would like a call about:%'
   AND m.created_at > now() - interval '30 days'`;

// Written by src/push/store.mjs saveSubscription / revokeSubscription. The
// sign-in account is the client's own, or an authorized rep's (a rep account
// carries no client id of its own by design: accounts_subject_ck).
export const PUSH_DEVICE_SQL = `
SELECT count(DISTINCT s.id)::int AS sample_count,
       count(DISTINCT s.id) FILTER (WHERE cl.id IS NULL
         OR NULLIF(BTRIM(COALESCE(s.encrypted_endpoint, '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(s.encrypted_p256dh, '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(s.encrypted_auth, '')), '') IS NULL
         OR (s.account_id IS NOT NULL
             AND (a.kind IS NULL OR a.kind NOT IN ('client', 'authorized_rep')
                  OR (a.kind = 'client' AND a.client_id IS DISTINCT FROM s.client_id)))
         OR s.revoked_at < s.created_at
         OR s.expired_at < s.created_at
         OR (s.revoked_at IS NULL AND s.expired_at IS NULL AND twin.id IS NOT NULL))::int AS bad_count
  FROM client_push_subscriptions s
  LEFT JOIN clients cl ON cl.org_id = s.org_id AND cl.id = s.client_id
  LEFT JOIN accounts a ON a.org_id = s.org_id AND a.id = s.account_id
  LEFT JOIN client_push_subscriptions twin ON twin.org_id = s.org_id
       AND twin.endpoint_hash = s.endpoint_hash AND twin.id <> s.id
       AND twin.revoked_at IS NULL AND twin.expired_at IS NULL
 WHERE s.org_id = $1::uuid`;

// Written by src/messaging/compose.mjs composeAndSend (the staff Send path,
// also used by /api/chat/messages kind=client) and then by dispatch.mjs.
// The shift rule: only the owner is exempt from clocking in (SUPER_ROLES). A text
// sent on the first try with no schedule is logged as text_sent on the open shift.
// A text held overnight, or retried later by the sweeper, is sent outside the
// request, so it leaves no event on purpose and is not judged for one. The
// closer deck's pay-link and soft-pull texts (provider_ref 'staff:pay-link-...'
// and 'staff:soft-pull-...') call composeAndSend with no shift at all, so they
// are not judged for one (product finding: api/closer-deck.mjs has no shift gate).
const STAFF_SEND_BAD = `s.id IS NULL OR cl.id IS NULL
         OR c.kind IS DISTINCT FROM 'client'
         OR c.client_id IS DISTINCT FROM m.client_id
         OR c.channel IS DISTINCT FROM m.channel
         OR m.direction IS DISTINCT FROM 'outbound'
         OR NULLIF(BTRIM(COALESCE(m.rendered_body, '')), '') IS NULL
         OR (m.status IN ('sent', 'delivered')
             AND (NULLIF(BTRIM(COALESCE(m.provider, '')), '') IS NULL
                  OR NULLIF(BTRIM(COALESCE(m.provider_message_id, '')), '') IS NULL))
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

export const STAFF_MESSAGE_SQL = `
SELECT count(DISTINCT m.id)::int AS sample_count,
       count(DISTINCT m.id) FILTER (WHERE ${STAFF_SEND_BAD})::int AS bad_count
  FROM messages m${STAFF_SEND_JOINS}
 WHERE m.org_id = $1::uuid AND m.sender_kind = 'staff'
   AND m.channel IN ('sms', 'email') AND m.is_demo = false
   AND m.created_at > now() - interval '30 days'`;

// The chat widget on every desk. Two of its four modes leave a saved row:
// "Message staff" (api/chat/messages kind=internal, src/chat/internal.mjs) and
// "Message a client" (the same send path as the Send button above).
// Ask and Knowledge return an answer to the page and save nothing.
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
   AND m.created_at > now() - interval '30 days'`;

// Written by src/messaging/gate.mjs gateAndRecord (status, blocked_reason,
// blocked_at, and a createTask for restricted wording) and dispatch.mjs finalise
// (status 'blocked' with last_error). The task body is "<message id>:<codes>".
// opted_out, quiet_hours, recipient_unknown and gate_error clear on their own and
// raise no task; every other code is restricted wording and does.
export const MESSAGE_BLOCKED_SQL = `
SELECT count(DISTINCT m.id)::int AS sample_count,
       count(DISTINCT m.id) FILTER (WHERE
         NULLIF(BTRIM(COALESCE(m.rendered_body, '')), '') IS NULL
         OR (NULLIF(BTRIM(COALESCE(m.blocked_reason, '')), '') IS NULL
             AND NULLIF(BTRIM(COALESCE(m.last_error, '')), '') IS NULL)
         OR (NULLIF(BTRIM(COALESCE(m.blocked_reason, '')), '') IS NOT NULL AND m.blocked_at IS NULL)
         OR (NULLIF(BTRIM(COALESCE(m.blocked_reason, '')), '') IS NOT NULL
             AND m.blocked_reason !~ '^(opted_out|quiet_hours|recipient_unknown|gate_error)(,(opted_out|quiet_hours|recipient_unknown|gate_error))*$'
             AND t.assignee_role IS NULL))::int AS bad_count
  FROM messages m
  LEFT JOIN tasks t ON t.org_id = m.org_id AND t.source_workflow = 'messaging-gate'
       AND t.body LIKE m.id::text || ':%'
 WHERE m.org_id = $1::uuid AND m.status = 'blocked' AND m.direction = 'outbound'
   AND m.sender_kind = 'staff' AND m.channel IN ('sms', 'email') AND m.is_demo = false
   AND m.created_at > now() - interval '30 days'`;

// Written by dispatch.mjs dispatchOne, the only writer of messages.scheduled_at.
// A text inside quiet hours (20:00 to 08:00 Arizona) is put back on the queue
// with scheduled_at at the next 08:00 Arizona. Email is never held.
export const MESSAGE_HELD_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE m.channel IS DISTINCT FROM 'sms'
         OR m.direction IS DISTINCT FROM 'outbound'
         OR m.scheduled_at <= m.created_at
         OR to_char(m.scheduled_at AT TIME ZONE 'America/Phoenix', 'HH24:MI:SS') <> '08:00:00'
         OR NULLIF(BTRIM(COALESCE(m.rendered_body, '')), '') IS NULL)::int AS bad_count
  FROM messages m
 WHERE m.org_id = $1::uuid AND m.sender_kind = 'staff' AND m.scheduled_at IS NOT NULL
   AND m.is_demo = false AND m.created_at > now() - interval '30 days'`;

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
