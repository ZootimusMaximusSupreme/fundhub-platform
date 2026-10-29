// A stand-in message queue for the slice-2 customer-message proofs.
//
// It answers, in memory, the handful of statements a queued customer message
// goes through: the template read, the queue insert, the claim, the compliance
// reads, the routing read, the settings read and the final status update. It is
// built on the shared handler harness so every call is recorded and an
// unexpected statement is a loud error, never a silent empty answer.
//
// Nothing here can reach a database, a vendor or a person. The "provider" is the
// in-memory one, so a message that "sent" is only an entry in recorded().
import { fakeDb } from "../../../testing/handler-harness.mjs";

export const QUEUE_ORG = "0a000000-0000-4000-8000-000000000001";

/** state: what the stand-in database holds. All fields are optional. */
export function queueDb({
  orgId = QUEUE_ORG,
  templates = {},
  clients = {},
  invoices = {},
  settings = { outbound_enabled: true, daily_send_cap: 0 },
  optedOut = [],
  sentToday = 0,
  routing = [{ channel: "email", provider: "memory", enabled: true }, { channel: "sms", provider: "memory", enabled: true }],
  extra = [],
} = {}) {
  const state = { messages: [], statusUpdates: [], invoiceUpdates: [], claims: 0, settingsWrites: [] };
  let seq = 0;
  const idOf = () => `ee000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const byId = (id) => state.messages.find((m) => m.id === id);
  // Model the real invoice-to-client tenant join, not just the invoice ID.
  // Missing buyers or cross-company links must fail closed in these fakes too.
  const ownedBuyer = (inv) => Boolean(inv && clients[inv.client_id]
    && (clients[inv.client_id].org_id ?? orgId) === (inv.org_id ?? orgId));

  const rules = [
    ...extra,
    [/FROM message_templates\s+WHERE org_id = \$1 AND template_key = \$2/, (_s, p) => {
      const t = templates[p[1]];
      return t ? [{ template_key: p[1], subject: t.subject ?? null, body: t.body, compliance_passed: t.compliance_passed !== false }] : [];
    }],
    [/FROM message_templates\s+WHERE org_id = \$1::uuid AND template_key = \$2/, (_s, p) => {
      const t = templates[p[1]];
      return t ? [{ template_key: p[1], subject: t.subject ?? null, body: t.body, compliance_passed: t.compliance_passed !== false }] : [];
    }],
    [/SELECT body, subject FROM message_templates/, (_s, p) => {
      const t = templates[p[1]];
      return t ? [{ body: t.body, subject: t.subject ?? null }] : [];
    }],
    [/SELECT subject FROM message_templates/, (_s, p) => [{ subject: templates[p[1]]?.subject ?? null }]],
    [/SELECT first_name, last_name, email, phone, custom_fields FROM clients WHERE id = \$1/, (_s, p) => {
      const c = clients[p[0]];
      return c ? [{ custom_fields: {}, ...c }] : [];
    }],
    [/SELECT custom_fields FROM clients/, [{ custom_fields: {} }]],
    [/AS address FROM clients/, (_s, p) => {
      const c = clients[p[0]];
      return [{ address: c ? (/SELECT phone/.test(_s) ? c.phone : c.email) : null }];
    }],
    // An invoice is found by its id AND the asking company ($1, $2).
    [/FROM invoices i\s+JOIN clients c ON c\.id = i\.client_id AND c\.org_id = i\.org_id\s+JOIN orgs o/, (_s, p) => {
      const inv = invoices[p[0]];
      return ownedBuyer(inv) && (inv.org_id ?? orgId) === p[1]
        ? [{ org_name: "Fundhub", currency: "USD", status: "sent", ...inv }] : [];
    }],
    [/UPDATE invoices/, (s, p) => {
      state.invoiceUpdates.push({ sql: s, params: p });
      if (invoices[p[0]]) invoices[p[0]].emailed_at = "2026-10-13T17:00:00Z";
      return [];
    }],
    // The never-emailed list is one company's ($1) invoices, newest rules of the SQL kept.
    [/i\.status = 'sent'\s+AND i\.emailed_at IS NULL/, (_s, p) => Object.values(invoices)
      .filter((inv) => ownedBuyer(inv) && (inv.org_id ?? orgId) === p[0]
        && inv.status === "sent" && !inv.emailed_at)
      .slice(0, p[1])],
    [/FROM client_authorized_reps/, []],
    [/FROM opt_outs/, (_s, p) => (optedOut.includes(p[0]) ? [{ "?column?": 1 }] : [])],
    [/FROM compliance_rules/, []],
    [/FROM messaging_settings/, [{ org_id: orgId, ...settings }]],
    [/INSERT INTO messaging_settings/, (_s, p) => {
      const row = { org_id: p[0], outbound_enabled: p[1], daily_send_cap: p[2], alert_email: p[3], updated_by: p[4] };
      state.settingsWrites.push(row);
      return [row];
    }],
    [/FROM message_channel_routing/, (_s, p) => {
      const wanted = p.find((v) => typeof v === "string" && ["email", "sms"].includes(v));
      return wanted ? routing.filter((r) => r.channel === wanted) : routing;
    }],
    [/count\(\*\)::int AS n FROM messages/, [{ n: sentToday }]],
    [/count\(\*\) FILTER \(WHERE status = 'queued'\)/, () => [{
      queued: state.messages.filter((m) => m.status === "queued").length, due: 0, sending: 0, failed: 0, blocked: 0, sent_today: sentToday,
    }]],
    [/INSERT INTO messages/, (s, p) => {
      const row = { id: idOf(), org_id: p[0], client_id: p[1], channel: p[2], template_key: p[3], rendered_body: p[4], provider_ref: p[5], to_address: p[6], subject: p[7], status: "queued", attempts: 0, sql: s };
      if (/sender_staff_id/.test(s)) {
        Object.assign(row, { client_id: p[1], channel: p[3], rendered_body: p[4], provider_ref: p[5], to_address: p[6], subject: p[7], template_key: null, sender_staff_id: p[8] });
      } else if (/'outbound','sms',\$3/.test(s)) {
        Object.assign(row, { channel: "sms", template_key: p[2], rendered_body: p[3], provider_ref: p[4], to_address: p[5], subject: null });
      } else if (/\(\$1,\$2,'outbound','email'/.test(s) || /'outbound','email',\$3/.test(s)) {
        Object.assign(row, { channel: "email", template_key: p[2], rendered_body: p[3], provider_ref: p[4], to_address: p[5], subject: p[6] });
      }
      // ON CONFLICT (org_id, provider_ref) DO NOTHING: a second row for the same
      // reference is not written and nothing comes back, as in the database.
      if (/ON CONFLICT \(org_id, provider_ref\)/.test(s)
        && state.messages.some((m) => m.provider_ref && m.org_id === row.org_id && m.provider_ref === row.provider_ref)) {
        return [];
      }
      state.messages.push(row);
      return [{ id: row.id, created_at: "2026-10-13T17:00:00Z" }];
    }],
    [/SELECT id, created_at FROM messages WHERE org_id = \$1 AND provider_ref = \$2/, (_s, p) => state.messages
      .filter((m) => m.org_id === p[0] && m.provider_ref === p[1]).slice(0, 1)
      .map((m) => ({ id: m.id, created_at: "2026-10-13T17:00:00Z" }))],
    // The batch claim: one company's ($1) queued rows, at most $2 of them, fewer than $4 attempts.
    [/UPDATE messages m\s+SET status = 'sending'/, (_s, p) => {
      const due = state.messages
        .filter((m) => m.status === "queued" && (p[0] == null || m.org_id === p[0]) && m.attempts < p[3])
        .slice(0, p[1]);
      state.claims += due.length;
      for (const m of due) { m.status = "sending"; m.attempts += 1; }
      return due.map((m) => ({ ...m }));
    }],
    [/UPDATE messages\s+SET status = 'sending', last_attempt_at = now\(\), attempts = attempts \+ 1\s+WHERE id = \$1/, (_s, p) => {
      const m = byId(p[0]);
      if (!m || m.status !== "queued") return [];
      m.status = "sending";
      m.attempts += 1;
      state.claims += 1;
      return [{ ...m }];
    }],
    [/INSERT INTO conversations/, [{ id: "cc000000-0000-4000-8000-000000000001" }]],
    [/UPDATE messages m\s+SET conversation_id/, (_s, p) => [{ id: p[0] }]],
    [/UPDATE messages\s+SET status = 'sent'/, (s, p) => {
      const m = byId(p[0]);
      if (m) m.status = "sent";
      state.statusUpdates.push({ id: p[0], status: "sent", provider: p[1] });
      return [];
    }],
    [/UPDATE messages\s+SET blocked_reason/, (s, p) => {
      const m = byId(p[0]);
      if (m) { m.status = "blocked"; m.blocked_reason = p[1]; }
      state.statusUpdates.push({ id: p[0], status: "blocked", detail: p[1] });
      return [];
    }],
    // A text held for the night window goes back to queued with a send time.
    [/UPDATE messages\s+SET status = 'queued', scheduled_at = \$2/, (_s, p) => {
      const m = byId(p[0]);
      if (m) { m.status = "queued"; m.scheduled_at = p[1]; m.attempts = Math.max(0, m.attempts - 1); }
      state.statusUpdates.push({ id: p[0], status: "queued", scheduled_at: p[1] });
      return [];
    }],
    [/UPDATE messages SET status = \$2/, (s, p) => {
      const m = byId(p[0]);
      if (m) m.status = p[1];
      state.statusUpdates.push({ id: p[0], status: p[1], detail: p[3] });
      return [];
    }],
    [/UPDATE messages/, (s, p) => { state.statusUpdates.push({ id: p[0], status: "other", sql: s }); return []; }],
    [/INSERT INTO events|INSERT INTO message_events|INSERT INTO gate_decisions|INSERT INTO compliance_/, [{ id: idOf() }]],
  ];

  const fake = fakeDb(rules);
  return Object.assign(fake, { state });
}
