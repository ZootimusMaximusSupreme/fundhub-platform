const SENSITIVE_IMPACTS = new Set(['money', 'customerData', 'customerMessage']);

function lane(name) {
  return [
    `src/pulse/coverage/${name}.mjs`,
    `src/pulse/coverage/${name}.test.mjs`,
  ];
}

function target(...names) {
  return Object.freeze(names.flatMap(lane));
}

const TARGETS = Object.freeze({
  alerts: target('gap-alerts'),
  auth: target('gap-auth'),
  banks: target('gap-banks', 'gap-bank-links'),
  calls: target('gap-calls'),
  closer: target('gap-closer'),
  csm: target('gap-csm'),
  documents: target('gap-documents'),
  finance: target('gap-finance-os'),
  funnels: target('gap-funnels'),
  funding: target('gap-funding', 'gap-fulfillment'),
  inquiry: target('gap-inquiry'),
  keys: target('gap-keys'),
  messaging: target('gap-sms'),
  moneyFunding: target('gap-money-funding'),
  moneyMoves: target('gap-money-moves'),
  partners: target('gap-partners'),
  payments: target('gap-payments'),
  pipeline: target('gap-pipeline-boards', 'gap-pipeline-facts'),
  privacy: target('gap-records'),
  repair: target('gap-repair'),
  subscriptions: target('gap-subscriptions'),
  webhooks: target('gap-webhooks'),
});

const PIPELINE_SURFACES = new Map([
  ['public/app/pipeline.html', 'pipeline'],
  ['pipeline:sales', 'pipeline'],
  ['pipeline:funding_card_stacking', 'funding'],
  ['pipeline:funding_altfin', 'funding'],
  ['pipeline:optimization', 'repair'],
  ['public/app/inquiry-remover.html (Repair pane)', 'repair'],
  ['pipeline:inquiry_removal', 'inquiry'],
  ['inquiry_removal_cases.case_status', 'inquiry'],
  ['inquiry_removal_cases.master_call_state', 'inquiry'],
  ['inquiry_log.status', 'inquiry'],
  ['inquiry_prep.prep_state', 'inquiry'],
  ['public/app/inquiry-remover.html (Inquiries pane)', 'inquiry'],
  ['public/app/csm-queue.html', 'csm'],
  ['src/hiring/booking.mjs', 'calls'],
  ['commission_ledger.status', 'moneyFunding'],
  ['public/app/closer-dashboard.html', 'closer'],
  ['public/app/client-control-panel.html', 'funding'],
  ['live_trials.status', 'partners'],
  ['funding_closeout.status', 'funding'],
  ['pipeline:purchase-routing', 'payments'],
  ['pipeline:affiliates_white_label', 'partners'],
  ['erasure_requests.status', 'privacy'],
]);

const EXTRA_PIPELINE_RESULTS = new Map([
  ['job:hiring-outreach-cadence', 'calls'],
  ['paid_service_requests.status', 'payments'],
  ['subscriptions.status / billing attempts', 'subscriptions'],
  ['next steps in Capital Blueprint: blueprint_decline_steps / next funding sequence', 'moneyFunding'],
  ['money_agent_tasks.status / money_transfers.status', 'moneyMoves'],
  ['pulse:stage-vs-fact', 'pipeline'],
  ['pipeline:hiring', 'calls'],
]);

function bankTarget(row) {
  const surface = String(row?.surface || '').toLowerCase();
  const control = String(row?.control || '').toLowerCase();
  const text = `${surface} ${control}`;

  if (/transfer/.test(text)) return 'moneyMoves';
  if (/alert|card-due|reminder/.test(text)) return 'alerts';
  if (/merchant|connections/.test(text)) return 'banks';
  if (/document/.test(text)) return 'documents';
  if (/authorized-rep|magic-link|portalLoginUrl/i.test(String(row?.surface || ''))) return 'auth';
  if (/unsubscribe/.test(text)) return 'messaging';
  if (/payment-links|closer-deck/.test(text)) return 'payments';
  if (/partner-site|partner-brand/.test(text)) return 'partners';
  if (/f11-bank-email-event-router|handlers\/comms/.test(text)) return 'webhooks';
  if (/cf-push-custom-html|tracking-manifest/.test(text)) return 'funnels';
  if (/lendflow|climate/.test(text)) return 'funding';
  if (/plaid keys/.test(text)) return 'keys';
  if (/plaid|banking|bank-accounts|money\/accounts|money\/trends|money\/banks|money\.js|money-accounts/.test(text)) {
    return 'banks';
  }
  return null;
}

function pipelineTarget(row) {
  return PIPELINE_SURFACES.get(row?.surface)
    || EXTRA_PIPELINE_RESULTS.get(row?.surface)
    || null;
}

function targetFor(sourceFile, row) {
  if (!SENSITIVE_IMPACTS.has(row?.impact)) return null;

  if (sourceFile === 'pipelines.json') {
    if (row.coverage === 'e2e') return pipelineTarget(row);
    if (new Set(['none', 'ping']).has(row.coverage)) {
      return EXTRA_PIPELINE_RESULTS.get(row.surface)
        || (row.surface === 'pipeline:funding_card_stacking' ? 'pipeline' : null)
        || (row.surface === 'pipeline:funding_altfin' ? 'funding' : null)
        || (row.surface === 'pipeline:optimization' ? 'repair' : null)
        || (row.surface === 'pipeline:inquiry_removal' ? 'inquiry' : null)
        || (row.surface === 'pipeline:ar_collections' ? 'payments' : null)
        || (row.surface === 'pipeline:affiliates_white_label' ? 'partners' : null)
        || (row.surface === 'inquiry_removal_cases.case_status' ? 'inquiry' : null);
    }
    if (
      row.coverage === 'deep'
      && row.surface === 'inquiry_removal_cases.case_status'
      && row.control === 'state Blocked'
    ) return 'inquiry';
    return null;
  }

  if (sourceFile === 'banks-links.json') {
    if (row.coverage === 'e2e') return bankTarget(row);
    if (new Set(['none', 'ping']).has(row.coverage)) {
      const surface = String(row.surface || '');
      if (/^src\/workflows\/finance-os-card-due-reminders/.test(surface)) return 'alerts';
      if (/^src\/workflows\/blueprint-finance-os-alerts/.test(surface)) return 'alerts';
      if (/^src\/workflows\/finance-os-money-agent/.test(surface)) return 'finance';
      if (/^src\/workflows\/finance-os-money-transfers/.test(surface)) return 'moneyMoves';
      if (/^src\/workflows\/merchant-pull-sweeper/.test(surface)) return 'banks';
      if (surface === 'Plaid keys on Netlify') return 'keys';
    }
  }

  return null;
}

export function sharedDataProofFor(sourceFile, row) {
  const targetName = targetFor(sourceFile, row);
  const evidence = targetName ? TARGETS[targetName] : null;
  if (!evidence) return null;

  return {
    depth: 'deep',
    evidence: evidence.join(' '),
    asserts: String(row.control),
  };
}

export function sharedDataTargetName(sourceFile, row) {
  return targetFor(sourceFile, row);
}

export const SHARED_DATA_TARGETS = TARGETS;
