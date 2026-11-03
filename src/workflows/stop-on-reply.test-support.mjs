// Test double for the reply read in stop-on-reply.mjs, shared by the workflow
// tests that stop on a reply (s-nobook-chase.test.mjs and
// ai-set-03-no-answer-cadence.test.mjs).
// Not a test file itself (no ".test." before the extension), so node --test
// skips it.
//
// withReplyRead(inner) answers the reply read from the fake's own `events` and
// `clients`, the way the SQL answers it, and hands everything else to
// inner.query. The SQL itself is proven against Postgres in
// stop-on-reply.pg.test.mjs; this only keeps the workflow tests honest about
// WHEN the answer flips. Rows it reads, as pgFake keeps them:
//   events  { id, org_id, client_id, name, payload, created_at }
//   clients { id, org_id, phone }

import { HAS_REPLIED_SQL } from "./stop-on-reply.mjs";
import { HAS_NO_ANSWER_SQL } from "./stop-on-setter.mjs";

const digits = (s) => String(s ?? "").replace(/\D/g, "");
const at = (value) => new Date(value).getTime();

export function withReplyRead(inner) {
  const wrapped = Object.create(inner);
  wrapped.query = async (sql, params = []) => {
    if (String(sql) !== HAS_REPLIED_SQL) return inner.query(sql, params);
    const [clientId, eventId] = params;
    const me = inner.clients.find((c) => c.id === clientId);
    const start = me && inner.events.find((e) => e.id === eventId && e.org_id === me.org_id);
    if (!me || !start) return { rows: [] };
    const mine = digits(me.phone);
    const hit = inner.events.some((e) => {
      if (e.name !== "message.inbound" || e.org_id !== me.org_id) return false;
      if (!(at(e.created_at) > at(start.created_at))) return false;
      if (e.client_id === clientId) return true;
      if (e.client_id) return false;
      const p = e.payload || {};
      return (p.channel ?? "sms") === "sms"
        && mine.length >= 10
        && digits(p.from).slice(-10) === mine.slice(-10);
    });
    return { rows: hit ? [{ replied: 1 }] : [] };
  };
  return wrapped;
}

export function withSetterNoAnswerRead(inner) {
  const wrapped = Object.create(inner);
  wrapped.query = async (sql, params = []) => {
    if (String(sql) !== HAS_NO_ANSWER_SQL) return inner.query(sql, params);
    const [clientId, eventId, lookbackHours = 0] = params;
    const started = inner.events.find((event) => event.id === eventId);
    if (!started) return { rows: [] };
    const hit = inner.events.some((event) =>
      event.org_id === started.org_id
      && event.client_id === clientId
      && at(event.created_at) >= at(started.created_at) - lookbackHours * 3_600_000
      && (event.name === "setter.no_answer"
        || (event.name === "call.completed"
          && ["no_answer", "no-answer", "voicemail"].includes(event.payload?.disposition))));
    return { rows: hit ? [{ no_answer: 1 }] : [] };
  };
  return wrapped;
}
