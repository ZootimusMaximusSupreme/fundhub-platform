// Finish-853 batch 20: the read-only SQL texts of the live checks. Each takes the company as
// $1::uuid and returns sample_count (how many saved results exist) and bad_count (how many are wrong).
// Written in the common subset of Postgres and SQLite (no regexes, no arrays) so
// fin-b20-live-contracts.test.mjs can run the exact text over stand-in rows with the real column names.
// A text is read at build time by scripts/pulse/compile-catalog.mjs; the live bundle reads the compiled copy.

// The photo is one object per person under one path, written only by api/staff/avatar.mjs:
//   staff-avatars/<org id>/<staff id>/<sha256>.<png|jpg>
// A provider may hand back a longer handle (a blob URL carries that path), so the path is matched
// anywhere in the key and the extension at its end. A key that names another person's or another
// company's folder, or a file that is not a png or jpeg, is a wrong photo.
export const AVATAR_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE s.avatar_key NOT LIKE '%staff-avatars/' || s.org_id::text || '/' || s.id::text || '/%'
         OR (lower(s.avatar_key) NOT LIKE '%.png' AND lower(s.avatar_key) NOT LIKE '%.jpg'
             AND lower(s.avatar_key) NOT LIKE '%.jpeg'))::int AS bad_count
  FROM staff s
 WHERE s.org_id = $1::uuid AND s.avatar_key IS NOT NULL AND BTRIM(s.avatar_key) <> ''
   AND COALESCE(s.is_demo, false) = false`;

// Sign out stamps revoked_at (api/auth/logout.mjs, src/auth/session.mjs revokeSession) and verifySession
// only slides a session whose revoked_at is null and whose expires_at is ahead. So a session that was
// seen later than the moment it was revoked is a session the gate still let in: the sign-out did not
// take, or the session check let a dead token through. Five minutes of slack.
//
// What this cannot see, said here so nobody reads it as more: verifySession and its account twin slide
// expires_at forward in the same statement that stamps last_seen_at, so a wrongly accepted EXPIRED token
// leaves no trace in these columns (last_seen_at is never later than the slid expires_at). That arm was
// here once and could never fire, so it is gone. The expiry rule is held by src/auth/session.test.mjs
// (the one statement carries both liveness predicates) and the sign-out call by
// src/http/auth-logout-handler.test.mjs (the handler revokes in both stores), not by saved rows.
export const SESSION_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE r.revoked_at < r.created_at
         OR EXTRACT(EPOCH FROM (r.last_seen_at - r.revoked_at)) > 300)::int AS bad_count
  FROM (SELECT org_id, created_at, expires_at, revoked_at, last_seen_at FROM sessions
        UNION ALL
        SELECT org_id, created_at, expires_at, revoked_at, last_seen_at FROM account_sessions) r
 WHERE r.org_id = $1::uuid AND r.created_at > now() - interval '30 days'`;

// shell.js paintBrand() re-validates every token and silently drops the bad ones, so a brand row with a
// value the shell rejects paints nothing and nobody is told. The table CHECKs the colours and faces;
// what it does not check is the wordmark, ink equal to paper (a page whose text is the colour of its
// ground), or a ramp that is not empty or six stops. The wordmark test is shell.js safeWordmark() word
// for word: trim, then https followed by one or more characters that are not whitespace, quote, angle
// bracket or parenthesis (any case), or an image data address with a base64 body of its own alphabet.
export const BRAND_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE (b.wordmark_url IS NOT NULL AND b.wordmark_url ~ '\\S'
           AND NOT (b.wordmark_url ~* '^\\s*https://[^\\s"''<>()]+\\s*$'
                    OR b.wordmark_url ~ '^\\s*data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+\\s*$'))
         OR (b.ink IS NOT NULL AND b.paper IS NOT NULL AND lower(b.ink) = lower(b.paper))
         OR jsonb_array_length(b.ramp) NOT IN (0, 6))::int AS bad_count
  FROM org_brand b
 WHERE b.org_id = $1::uuid`;

// api/chat/messages.mjs starts a person-to-person thread through src/chat/internal.mjs
// getOrCreateInternalThread: kind internal, no client, internal_pair_key = the two staff ids joined by a
// colon, exactly those two staff as participants, both in this company. Every message in it is an
// internal staff note from one of the two. A thread of any other shape is a wrong result of the widget's
// Message > teammate mode. The key is accepted in either order so the check never depends on how a
// database sorts text.
export const CHAT_PEER_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE c.client_id IS NOT NULL
         OR c.internal_pair_key IS NULL
         OR COALESCE(p.n_parts, 0) <> 2
         OR COALESCE(p.n_foreign, 0) > 0
         OR (COALESCE(p.n_parts, 0) = 2
             AND c.internal_pair_key NOT IN (p.lo || ':' || p.hi, p.hi || ':' || p.lo))
         OR EXISTS (SELECT 1 FROM messages m
                     WHERE m.conversation_id = c.id
                       AND (m.channel <> 'internal' OR m.sender_kind <> 'staff' OR m.sender_staff_id IS NULL
                            OR NOT EXISTS (SELECT 1 FROM conversation_participants x
                                            WHERE x.conversation_id = c.id AND x.staff_id = m.sender_staff_id))))::int AS bad_count
  FROM conversations c
  LEFT JOIN (SELECT cp.conversation_id,
                    count(*) AS n_parts,
                    count(*) FILTER (WHERE s.id IS NULL OR s.org_id <> $1::uuid) AS n_foreign,
                    MIN(cp.staff_id::text) AS lo,
                    MAX(cp.staff_id::text) AS hi
               FROM conversation_participants cp
               JOIN conversations c0 ON c0.id = cp.conversation_id AND c0.org_id = $1::uuid AND c0.kind = 'internal'
               LEFT JOIN staff s ON s.id = cp.staff_id
              GROUP BY cp.conversation_id) p ON p.conversation_id = c.id
 WHERE c.org_id = $1::uuid AND c.kind = 'internal' AND COALESCE(c.is_demo, false) = false
   AND COALESCE(c.last_pulse_at, c.created_at) > now() - interval '60 days'`;

// src/sales/metrics.mjs beliefAnalytics() joins every call outcome to its client with
// c.org_id = o.org_id, so an outcome whose client sits in another company never reaches the belief
// panel. The table CHECKs the seven belief words; what it cannot check is that the client is the
// company's own. Last 60 days, demo rows left out.
export const BELIEF_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE c.id IS NULL
         OR o.belief_failed NOT IN ('pain', 'doubt', 'cost', 'desire', 'money', 'support', 'trust'))::int AS bad_count
  FROM call_outcomes o
  LEFT JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
 WHERE o.org_id = $1::uuid AND o.belief_failed IS NOT NULL
   AND COALESCE(o.is_demo, false) = false AND o.logged_at > now() - interval '60 days'`;

// The same join feeds the "Where it is coming from" panel (held, close and desire by lead source),
// and it counts every call outcome, not only the ones that name a belief. A call whose client is not
// in the company leaves that panel's close rate short, and the closer's number with it. The outcome
// word is not judged here: the table CHECKs the five words, so that arm could never fire. Last 60 days,
// demo rows left out, same window as the belief check.
export const SOURCE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE c.id IS NULL)::int AS bad_count
  FROM call_outcomes o
  LEFT JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
 WHERE o.org_id = $1::uuid AND COALESCE(o.is_demo, false) = false
   AND o.logged_at > now() - interval '60 days'`;

// The floor discipline panel's two counted lines, judged from the rows they are counted from.
//
// 1. "Calls not logged" (src/sales/call-outcomes.mjs listUnloggedCalls) counts past-due closer
//    booking tasks for active clients with no disposition by task_id or same-client booking_ref.
//    The bad arm catches a reference match if that exclusion is ever lost. A blank body cannot match.
// 2. "Calls not recorded" (src/sales/unrecorded.mjs listUnrecordedCalls) means no recording and no
//    transcript. The rows judged are exactly the calls the chip counts: held, not demo, last 14 days,
//    no recording address, no transcript, and older than the 20 minute grace window or logged before
//    the last Drive sync.
export const DISCIPLINE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE r.bad = 1)::int AS bad_count
  FROM (
    SELECT CASE WHEN EXISTS (SELECT 1 FROM call_outcomes d
                              WHERE d.org_id = t.org_id AND d.client_id = t.client_id
                                AND NULLIF(BTRIM(t.body), '') IS NOT NULL
                                AND d.booking_ref = t.body)
                THEN 1 ELSE 0 END AS bad
      FROM tasks t
      JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
     WHERE t.org_id = $1::uuid AND t.assignee_role = 'closer' AND t.title LIKE 'Strategy session%'
       AND t.done IS NOT TRUE AND c.custom_fields->>'crm_archived_at' IS NULL
       AND t.due_at IS NOT NULL AND t.due_at < now()
       AND NOT EXISTS (SELECT 1 FROM call_outcomes o
                        WHERE o.org_id = t.org_id AND o.client_id = t.client_id
                          AND (o.task_id = t.id OR
                               (NULLIF(BTRIM(t.body), '') IS NOT NULL AND o.booking_ref = t.body)))
    UNION ALL
    SELECT 0 AS bad
      FROM call_outcomes u
     WHERE u.org_id = $1::uuid AND COALESCE(u.is_demo, false) = false AND u.outcome <> 'no_show'
       AND u.logged_at > now() - interval '14 days'
       AND (u.recording_url IS NULL OR BTRIM(u.recording_url) = '')
       AND (u.transcript IS NULL OR BTRIM(u.transcript) = '')
       AND (u.logged_at < now() - interval '20 minutes'
            OR u.logged_at < (SELECT s.last_sync_at FROM brain_drive_sync s WHERE s.org_id = u.org_id))
  ) r`;

// The "Recording rows" the page paints out of src/sales/recordings.mjs listRecentRecordings. A row
// links only when the address is https on drive.google.com or docs.google.com (safeDriveUrl in
// sales-floor.js), otherwise it says "No link". A file the page calls "Words ready" because it no
// longer needs transcription must have words: indexed chunks, or a transcript on that client's call.
// Two sources, last 14 days, demo calls left out. Name-only matches (a document with "recording" in
// its title) are not recordings and are left out, and so are files a person uploaded to Company Brain or
// the app wrote itself (source upload or generated): those have no Drive address by design.
export const RECORDING_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE r.bad = 1)::int AS bad_count
  FROM (
    SELECT CASE WHEN c.id IS NULL
                  OR (lower(o.recording_url) NOT LIKE 'https://drive.google.com/%'
                      AND lower(o.recording_url) NOT LIKE 'https://docs.google.com/%')
                THEN 1 ELSE 0 END AS bad
      FROM call_outcomes o
      LEFT JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
     WHERE o.org_id = $1::uuid AND o.recording_url IS NOT NULL AND BTRIM(o.recording_url) <> ''
       AND COALESCE(o.is_demo, false) = false AND o.logged_at > now() - interval '14 days'
    UNION ALL
    SELECT CASE WHEN bf.web_view_link IS NULL OR BTRIM(bf.web_view_link) = ''
                  OR (lower(bf.web_view_link) NOT LIKE 'https://drive.google.com/%'
                      AND lower(bf.web_view_link) NOT LIKE 'https://docs.google.com/%')
                  OR (bf.client_id IS NOT NULL AND c2.id IS NULL)
                  OR (bf.needs_transcription = false
                      AND NOT EXISTS (SELECT 1 FROM brain_chunks ch WHERE ch.file_id = bf.id)
                      AND NOT EXISTS (SELECT 1 FROM call_outcomes t
                                       WHERE t.org_id = bf.org_id AND t.client_id = bf.client_id
                                         AND NULLIF(BTRIM(t.transcript), '') IS NOT NULL))
                THEN 1 ELSE 0 END AS bad
      FROM brain_files bf
      LEFT JOIN clients c2 ON c2.id = bf.client_id AND c2.org_id = bf.org_id
     WHERE bf.org_id = $1::uuid AND bf.source = 'drive'
       AND (bf.mime_type LIKE 'video/%' OR bf.mime_type LIKE 'audio/%' OR bf.needs_transcription = true)
       AND COALESCE(bf.indexed_at, bf.created_at) > now() - interval '14 days'
  ) r`;
