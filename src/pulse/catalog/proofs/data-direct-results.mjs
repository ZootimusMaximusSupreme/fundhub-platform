const EVIDENCE = 'src/pulse/catalog/proofs/data-direct-results.test.mjs';

function entry(sourceFile, surface, control) {
  return Object.freeze({
    sourceFile,
    surface,
    control,
    proof: Object.freeze({
      depth: 'deep',
      evidence: EVIDENCE,
      asserts: control,
    }),
  });
}

export const DATA_DIRECT_RESULT_CASES = Object.freeze([
  entry('banks-links.json', 'Plaid bank link / Plaid Link script', 'Plaid Link script load from cdn.plaid.com when Connect is pressed (error words: bank sign-in window did not load)'),
  entry('banks-links.json', 'src/banking/plaid-link.mjs completeLink', 'Consent stamp: consent_granted_at set when Link finishes, scope [accounts]; every reader filters it IS NOT NULL'),
  entry('banks-links.json', 'Plaid bank link / relink', 'Re-link a login that is in error (Plaid Link update mode, or any button that does it)'),
  entry('banks-links.json', 'api/money/overview.mjs, public/app/money.js', 'Balance freshness shown to the client: header says as of <date> but that date is the time of the page read, balance_as_of is not selected'),
  entry('banks-links.json', 'Plaid bank link / webhooks', 'Plaid webhooks (login required, pending expiration, new transactions)'),
  entry('banks-links.json', 'Plaid bank link / OAuth banks', 'Link token carries no redirect_uri (OAuth institutions)'),
  entry('banks-links.json', 'src/banking/plaid-refresh.mjs', 'An account Plaid stops listing is only reported as vanished and left as it was'),
  entry('banks-links.json', 'Plaid bank link / disconnect', 'Tell Plaid to drop the item (/item/remove) when a login is revoked'),
  entry('banks-links.json', 'Plaid bank link / disconnect', 'A client-facing control to disconnect their own bank'),
  entry('banks-links.json', 'src/workflows/finance-os-trend-snapshots.mjs', 'Daily 07:30 UTC balance snapshots per account, rollups, estimated backfill from transactions'),
  entry('banks-links.json', 'api/public/decline-autopsy-report.mjs, src/autopsy/link.mjs', 'Signed report link for the $27 Decline Autopsy (SHELVED 2026-08-31, route commented out)'),
  entry('banks-links.json', 'src/lib/render-template.mjs, src/workflows/messaging.mjs sendTemplated', 'Link merge tags in any template ({{pay_url}}, {{magic_link.url}}, {{custom_values.booking_link}}, {{survey_link}}, {{contract.link}}, {{affiliate_link}}...): an unknown or null tag renders as an empty string with a console warning and the message still sends'),
  entry('banks-links.json', 'src/hiring/eeo-selfid.mjs, db/migrations/300_eeo_invite_template_and_submit_outcome.sql', 'EEO self-ID invite email to a job candidate: link is https://fundhub.ai/eeo-survey.html?token=<token>'),
  entry('banks-links.json', 'Base address for every emailed link (src/workflows/messaging.mjs, src/messaging/dispatch.mjs, src/auth/magic-link.mjs, src/sales/closer-deck.mjs, api/contracts.mjs, src/affiliates/share-link.mjs, src/ops/brief-link.mjs)', 'Which host an emailed link points at: four env chains (APP_BASE_URL, PUBLIC_BASE_URL, PORTAL_BASE_URL/DEPLOY_PRIME_URL, PUBLIC_SITE_URL) then URL then fundhub.ai'),
  entry('pipelines.json', 'public/app/pipeline.html', 'Rail tab R-03 Funding: Alt-Fin (Lendflow) — tab removed 2026-08-25'),
  entry('pipelines.json', 'public/app/pipeline.html', 'MOVE menu -> Optimization / Round Sent (legacy)'),
  entry('pipelines.json', 'public/app/pipeline.html', "Sales rail note: 'A payment does not move a card' (railNote)"),
  entry('tables.json', 'table:product_aliases', 'product_aliases: alternate names that route to one product | written by: none in app code | read by: no app code | NOTE: dead table: no app code reads or writes it (src, api, netlify, scripts, vendor, tools searched)'),
]);

function key(sourceFile, surface, control) {
  return `${sourceFile}\0${surface}\0${control}`;
}

const BY_KEY = new Map(DATA_DIRECT_RESULT_CASES.map((item) => [
  key(item.sourceFile, item.surface, item.control),
  item.proof,
]));

if (BY_KEY.size !== DATA_DIRECT_RESULT_CASES.length) {
  throw new Error('Direct data result proof rows must be unique.');
}

export function directDataResultProofFor(sourceFile, row) {
  const proof = BY_KEY.get(key(sourceFile, row?.surface, row?.control));
  return proof ? { ...proof } : null;
}
