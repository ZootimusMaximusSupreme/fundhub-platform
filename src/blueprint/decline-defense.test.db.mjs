// An in-memory stand-in for the tables decline defense touches (migration 470
// and the few it reads), for tests only. Unknown SQL throws, so a query the
// store adds without this file knowing fails loudly. The real constraints are
// proven against Postgres in src/blueprint/decline-defense.pg.test.mjs.
//
// Shared by src/blueprint/decline-defense.test.mjs and the two screen tests,
// which build their fixtures from the real store through this, so a fixture
// can never drift from what the code writes.

export const TEST_ORG = "11111111-1111-4111-8111-111111111111";
export const TEST_CLIENT = "22222222-2222-4222-8222-222222222222";

/* THE SAMPLE CLIENT for screens and fixtures: the Blueprint sim client
   (029964c5…). Their real file (read-only, 2026-10-06) has 4 hard inquiries —
   Experian 2, Equifax 1, TransUnion 1 — and nothing else failing, so the one
   reason the bank's letter states is inquiries. One person, one file
   (.claude/rules/sample-clients-consistent.md). The applications and the letter
   are a sample, never written to the live database. One line of the letter is
   one no category covers, to show "a person will read this". */
export const SIM_CLIENT = Object.freeze({ id: "029964c5-4d8e-47ed-88c9-53ac13863fd4", org_id: "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6", first_name: "Sim", last_name: "Eleven-Blueprint" });
export const SIM_APPLICATIONS = Object.freeze([
  Object.freeze({ id: "c0000000-0000-4000-8000-000000000001", bank: "Chase", lender_name: "Chase", lender_id: null, product_name: "Ink Business Cash", status: "Applied", submitted_date: "2026-09-30", updated_at: new Date("2026-10-02T15:00:00Z") }),
  Object.freeze({ id: "c0000000-0000-4000-8000-000000000002", bank: "American Express", lender_name: "American Express", lender_id: null, product_name: "Blue Business Plus", status: "Applied", submitted_date: "2026-09-30", updated_at: new Date("2026-10-01T15:00:00Z") })
]);
export const SIM_SAMPLE_LETTER = `Dear Sim Eleven-Blueprint,

Thank you for your recent application for a Chase Ink Business Cash credit card.
Unfortunately, we are unable to approve your request at this time. The principal reasons for our decision are:

- Too many inquiries in the last 12 months
- Requested credit line exceeds our guidelines

If you would like us to reconsider, please call 1-800-453-9719 within 30 days.

Experian, P.O. Box 2002, Allen, TX 75013, 1-888-397-3742, www.experian.com`;

/* The tables the store touches, in memory. Unknown SQL throws, so a query the
   store adds without this file knowing fails loudly. */
export function memoryDb({ client = { id: TEST_CLIENT, org_id: TEST_ORG, first_name: "Sim", last_name: "Eleven-Blueprint" }, buyer = true, applications = [], lenders = [], documents = [], pastesToday = 0, inbox = [] } = {}) {
  const t = { declines: [], steps: [], tasks: [] };
  let seq = 0;
  const nextId = () => `99999999-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const db = {
    t,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      if (/FROM transactions t/.test(s)) return { rows: buyer ? [{ x: 1 }] : [] };
      if (/FROM applications WHERE id = \$1::uuid AND org_id = \$2::uuid AND client_id = \$3::uuid/.test(s)) {
        return { rows: applications.filter((a) => a.id === params[0]) };
      }
      if (/SELECT id, status FROM applications WHERE id = \$1::uuid/.test(s)) return { rows: applications.filter((a) => a.id === params[0]) };
      if (/FROM applications WHERE org_id = \$1::uuid AND client_id = \$2::uuid/.test(s)) return { rows: applications };
      if (/FROM lenders/.test(s)) return { rows: lenders };
      if (/FROM documents WHERE id = \$1::uuid/.test(s)) return { rows: documents.filter((d) => d.id === params[0]) };
      if (/SELECT count\(\*\)::int AS n FROM blueprint_declines/.test(s)) return { rows: [{ n: pastesToday }] };
      if (/^INSERT INTO blueprint_declines/.test(s)) {
        const [org_id, client_id, application_id, lender_id, bank, product, declined_on, bureaus_pulled, letter_text, letter_hash,
          letter_document_id, looks_like, reason_categories, needs_person, analysis, source, recorded_by, recon_on] = params;
        if (!needs_person && !reason_categories.length) throw new Error("blueprint_declines_needs_person_ck");
        const clash = t.declines.find((d) => (application_id && d.application_id === application_id) ||
          (letter_hash && d.client_id === client_id && d.letter_hash === letter_hash));
        if (clash) return { rows: [] };
        const row = { id: nextId(), org_id, client_id, application_id, lender_id, bank, product, declined_on, bureaus_pulled,
          letter_text, letter_hash, letter_document_id, looks_like, reason_categories, needs_person, analysis: JSON.parse(analysis),
          source, recorded_by, recon_on, outcome: "open", outcome_approved_amount: null, reapply_on: null, outcome_notes: null,
          outcome_by: null, outcome_at: null, task_id: null, created_at: new Date() };
        t.declines.push(row);
        return { rows: [row] };
      }
      if (/^SELECT id FROM blueprint_declines WHERE org_id/.test(s)) {
        const [, client_id, application_id, letter_hash] = params;
        return { rows: t.declines.filter((d) => d.client_id === client_id &&
          ((application_id && d.application_id === application_id) || (letter_hash && d.letter_hash === letter_hash))).map((d) => ({ id: d.id })) };
      }
      if (/^INSERT INTO blueprint_decline_steps/.test(s)) {
        const [org_id, decline_id, position, step_key, who, step_text, client_text, source_kind, source_ref, is_blank, blank_label, status, filled_text] = params;
        if (!is_blank && !(step_text && source_kind && source_ref)) throw new Error("blueprint_decline_steps_cited_ck");
        if (is_blank && (step_text || source_kind || source_ref || !blank_label)) throw new Error("blueprint_decline_steps_blank_ck");
        t.steps.push({ id: nextId(), org_id, decline_id, position, step_key, who, step_text, client_text, source_kind, source_ref,
          is_blank, blank_label, status, filled_text, done_at: status === "open" ? null : new Date(), done_by: status === "open" ? null : "agent (rules)" });
        return { rows: [] };
      }
      if (/^SELECT id FROM tasks WHERE client_id = \$1 AND source_workflow = \$2 AND body = \$3/.test(s)) {
        return { rows: t.tasks.filter((x) => x.client_id === params[0] && x.source_workflow === params[1] && x.body === params[2]) };
      }
      if (/^INSERT INTO tasks/.test(s)) {
        const [org_id, client_id, title, body, due_at, source_workflow, assignee_role] = params;
        if (Buffer.byteLength(body, "utf8") > 2700) throw new Error("index row size exceeds btree maximum");
        if (t.tasks.some((x) => x.client_id === client_id && x.source_workflow === source_workflow && x.body === body)) return { rows: [] };
        const row = { id: nextId(), org_id, client_id, title, body, due_at, source_workflow, assignee_role, done: false };
        t.tasks.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (/^UPDATE blueprint_declines SET task_id/.test(s)) { t.declines.find((d) => d.id === params[0]).task_id = params[1]; return { rows: [] }; }
      if (/^SELECT \* FROM blueprint_declines WHERE id = \$1::uuid AND org_id = \$2::uuid AND client_id = \$3::uuid/.test(s)) {
        return { rows: t.declines.filter((d) => d.id === params[0] && d.org_id === params[1] && d.client_id === params[2]) };
      }
      if (/^UPDATE blueprint_declines SET letter_document_id/.test(s)) { t.declines.find((d) => d.id === params[0]).letter_document_id = params[1]; return { rows: [] }; }
      if (/^UPDATE blueprint_decline_steps SET status = 'done', done_at = now\(\), done_by = \$3 WHERE decline_id/.test(s)) {
        for (const st of t.steps.filter((x) => x.decline_id === params[0] && x.step_key === "get_letter" && x.status === "open")) {
          st.status = "done"; st.done_by = params[2]; st.done_at = new Date();
        }
        return { rows: [] };
      }
      if (/^SELECT id, is_blank, filled_text FROM blueprint_decline_steps/.test(s)) {
        return { rows: t.steps.filter((x) => x.decline_id === params[0] && x.step_key === params[2]) };
      }
      if (/^UPDATE blueprint_decline_steps SET status = \$2::text/.test(s)) {
        const st = t.steps.find((x) => x.id === params[0]);
        st.status = params[1];
        st.filled_text = params[2] ?? st.filled_text;
        st.done_at = params[1] === "open" ? null : new Date();
        st.done_by = params[1] === "open" ? null : params[3];
        if (st.is_blank && st.status === "done" && !st.filled_text) throw new Error("blueprint_decline_steps_blank_done_ck");
        return { rows: [st] };
      }
      if (/^UPDATE blueprint_declines SET recon_on/.test(s)) { t.declines.find((d) => d.id === params[0]).recon_on = params[1]; return { rows: [] }; }
      if (/^UPDATE tasks SET due_at/.test(s)) {
        const task = t.tasks.find((x) => x.id === params[0] && !x.done);
        if (task) task.due_at = params[1];
        return { rows: [] };
      }
      if (/^UPDATE blueprint_declines SET outcome = \$2::text/.test(s)) {
        const d = t.declines.find((x) => x.id === params[0]);
        Object.assign(d, {
          outcome: params[1], outcome_approved_amount: params[2], reapply_on: params[3],
          outcome_notes: params[4] ?? d.outcome_notes, outcome_by: params[1] === "open" ? null : params[5],
          outcome_at: params[1] === "open" ? null : new Date()
        });
        if (d.outcome === "reapply_later" && !d.reapply_on) throw new Error("blueprint_declines_reapply_ck");
        return { rows: [d] };
      }
      if (/^SELECT id, first_name, last_name FROM clients/.test(s)) {
        return { rows: params[0] === client.id && params[1] === client.org_id ? [{ id: client.id, first_name: client.first_name, last_name: client.last_name }] : [] };
      }
      if (/^SELECT \* FROM blueprint_declines WHERE org_id = \$1::uuid AND client_id = \$2::uuid/.test(s)) {
        return { rows: t.declines.filter((d) => d.org_id === params[0] && d.client_id === params[1]).slice().reverse() };
      }
      if (/^SELECT \* FROM blueprint_decline_steps WHERE org_id/.test(s)) {
        return { rows: t.steps.filter((x) => params[1].includes(x.decline_id)).sort((a, b) => a.position - b.position) };
      }
      if (/FROM bank_inbox/.test(s)) return { rows: inbox };
      if (/outcome IN \('still_declined', 'reapply_later'\)/.test(s)) {
        return { rows: t.declines.filter((d) => ["still_declined", "reapply_later"].includes(d.outcome)) };
      }
      throw new Error(`unexpected SQL: ${s.slice(0, 140)}`);
    }
  };
  return db;
}
