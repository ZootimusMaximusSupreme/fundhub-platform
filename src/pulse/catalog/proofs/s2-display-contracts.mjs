// Slice 2 (customer messages): screen controls whose exact result is judged in
// two halves that meet at one request:
//   - the BROWSER half, a real page driven by a Playwright spec with fake
//     routes, judging the exact write the control sends;
//   - the SERVER half, the real api/ handler run with a stand-in database,
//     judging what is saved or queued for that same request.
// Each row names the exact catalog control. The wrapper test
// (s2-display-contracts.test.mjs) runs every spec named here.
export const S2_DISPLAY_WRAPPER = "src/pulse/catalog/proofs/s2-display-contracts.test.mjs";

const AGENT_SERVER = "src/http/s2-agents-save.test.mjs";
const AUTH_SERVER = "src/http/s2-message-routes-auth.test.mjs";
const REP_SERVER = "src/http/s2-message-routes-reset-rep.test.mjs";
const OUTBOUND_SERVER = "src/http/s2-message-routes-outbound.test.mjs";
const CONTRACTS_SERVER = "src/http/s2-message-routes-contracts.test.mjs";
const MONEY_ALERTS_SERVER = "src/http/money-alerts.test.mjs";

function group(sourceFile, surface, specs, servers, controls) {
  return Object.freeze({
    sourceFile, surface,
    specs: Object.freeze([...specs]),
    servers: Object.freeze([...servers]),
    controls: Object.freeze([...controls]),
  });
}

export const S2_DISPLAY_GROUPS = Object.freeze([
  group("desks-a.json", "agent-editor.html",
    ["e2e/s2-agent-editor-save.spec.mjs"], [AGENT_SERVER], [
      "Authority switch: May book on a closer's calendar",
      "Authority switch: May send a contract for signature",
      "Authority: Max messages per client per day input",
      "Escalation: After no reply select (15 minutes, 1 hour, 4 hours, 24 hours, 48 hours)",
      "Escalation: Escalate immediately when input",
      "Escalation: Escalate to select",
      "Guardrail switch: Honor quiet hours",
      "Guardrail switch: Never promise a score outcome",
      "Guardrail switch: Never state a funding amount",
      "Guardrail switch: Stop on the word attorney",
      "Guardrail text box (hard constraints block)",
      "Identity: Channel select (SMS, Email, Voice, Internal)",
      "Prompt textarea",
      "Save agent button",
      "Trigger events: 13 event toggles (entry.captured, survey.submitted, payment.received, and 10 more)",
    ]),
  group("desks-a.json", "agent-editor.html",
    ["e2e/agent-editor-promote-demote.spec.mjs"], [AGENT_SERVER], [
      "Promote to live button (saves first, then promotes, confirm dialog)",
      "Return to shadow button (demote, confirm dialog)",
    ]),
  group("desks-a.json", "client-control-panel.html",
    ["e2e/s2-ccp-portal-access.spec.mjs"], [AUTH_SERVER], [
      "Send portal sign-in link button (owner/admin)",
    ]),
  group("desks-a.json", "client-control-panel.html",
    ["e2e/s2-ccp-portal-access.spec.mjs"], [REP_SERVER], [
      "Authorized rep: Add this person to the file button and Name/Email/Phone inputs (owner/admin)",
    ]),
  group("desks-b.json", "documents.html",
    ["e2e/documents-clicks.spec.mjs"], [CONTRACTS_SERVER], [
      "Contract cell: Remind button (re-sends the signing request to one signer)",
    ]),
  group("desks-b.json", "financeos.html#alerts",
    ["e2e/s2-financeos-alerts.spec.mjs"], [MONEY_ALERTS_SERVER], [
      "On/off switch for each of the four alerts (payment timing, promo ending, cash cushion, new credit)",
      "Promo: 'Edit promo' / 'Save promo' (end date, APR) / 'Remove this promo' (asks first) / 'Keep it'",
      "Statement close day: 'Change day' / 'Save day' / 'Cancel' per card and 'Save days' (batch)",
    ]),
  group("desks-c.json", "money-alerts.html",
    ["e2e/s2-money-alerts.spec.mjs"], [MONEY_ALERTS_SERVER], [
      "Batch 'Save days' for several hand-entered cards at once",
      "Card promo: 'Add promo' / 'Change promo' form (end date, APR %) + Save promo + Cancel",
      "Card promo: 'Remove this promo' then 'Yes, remove it' / 'Keep it'",
      "Card: 'Change day' (statement close day select 1-31) + Save + Cancel",
      "Switch: Cash cushion (6 months of minimums, personal and business apart) (cash_reserve)",
      "Switch: New credit (new_credit)",
      "Switch: Pay before the statement closes (payment_timing)",
      "Switch: Promo rate ending (60 / 30 / 7 days) (promo_end)",
    ]),
  group("desks-e.json", "public/app/ops-admin.html",
    ["e2e/ops-admin-outbound.spec.mjs"], [OUTBOUND_SERVER], [
      "Send what is waiting (button, confirm dialog: goes to real clients, cannot be pulled back)",
      "Pause sending / Turn sending on (button, confirm dialog)",
      "Email unsent invoices (button, confirm dialog; shown only when invoices were never emailed)",
    ]),
  group("desks-e.json", "public/app/ops-admin.html",
    [], [OUTBOUND_SERVER], [
      "dispatch (server): drains the queue now through the provider route and the compliance gate",
      "settings (server): the company-wide send switch and daily cap",
    ]),
]);

// Specs that prove Flow rows. They run from their own small wrapper
// (s2-flow-pages.test.mjs) because the flow-proof guard gives each test file
// 120 seconds, which the whole screen suite above does not fit in.
export const S2_FLOW_WRAPPER = "src/pulse/catalog/proofs/s2-flow-pages.test.mjs";
export const S2_FLOW_SPECS = Object.freeze([
  "e2e/s2-consulting-pages.spec.mjs",
]);

export const S2_DISPLAY_SPECS = Object.freeze(
  [...new Set(S2_DISPLAY_GROUPS.flatMap((entry) => entry.specs))].sort());

/** Entries in the shape display-proof-cases.mjs reads. */
export const S2_DISPLAY_PROOF_CASES = Object.freeze(S2_DISPLAY_GROUPS.flatMap((entry) =>
  entry.controls.map((control) => {
    const tests = [S2_DISPLAY_WRAPPER, ...entry.servers];
    return Object.freeze({
      sourceFile: entry.sourceFile,
      surface: entry.surface,
      control,
      depth: "deep",
      evidence: tests.join("; "),
      tests: Object.freeze(tests),
    });
  })));
