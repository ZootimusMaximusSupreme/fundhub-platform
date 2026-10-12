function caseKey(sourceFile, surface, control) {
  return `${sourceFile}\0${surface}\0${control}`;
}

const PIPELINE_MOTION_EVIDENCE = [
  'src/pulse/pipeline-motion.mjs',
  'src/pulse/catalog/proofs/data-pipeline-motion.test.mjs',
].join(' ');

const REPAIR_CLOCK_EVIDENCE = [
  'src/pulse/coverage/gap-repair.mjs',
  'src/pulse/coverage/gap-repair.test.mjs',
  PIPELINE_MOTION_EVIDENCE,
].join(' ');

export const DATA_PROOF_CASES = Object.freeze([
  {
    sourceFile: 'pipelines.json',
    surface: 'pipeline:optimization',
    control: 'stage letters_generated (Letters Generated, sort 3)',
    proof: {
      depth: 'deep',
      evidence: PIPELINE_MOTION_EVIDENCE,
      asserts: 'The read-only pipeline check fails when a repair card is in letters_generated.',
    },
  },
  {
    sourceFile: 'pipelines.json',
    surface: 'pipeline:optimization',
    control: 'stage response_received (Response Received, sort 7)',
    proof: {
      depth: 'deep',
      evidence: PIPELINE_MOTION_EVIDENCE,
      asserts: 'The read-only pipeline check fails when a repair card is in response_received.',
    },
  },
  {
    sourceFile: 'pipelines.json',
    surface: 'pipeline:optimization',
    control: 'transition SLA clock breach (intake 3bd, docs 14d, analysis 1h, letters 30m, ready 4h, transit 10d, response due+5d, parsed 24h)',
    proof: {
      depth: 'deep',
      evidence: REPAIR_CLOCK_EVIDENCE,
      asserts: 'The read-only repair checks fail when a repair file passes its stage clock.',
    },
  },
  ...['Scheduled', 'In Progress', 'Escalated'].map((state) => ({
    sourceFile: 'pipelines.json',
    surface: 'inquiry_removal_cases.case_status',
    control: `state ${state}`,
    proof: {
      depth: 'deep',
      evidence: 'src/pulse/coverage/gap-inquiry.mjs src/pulse/coverage/gap-inquiry.test.mjs',
      asserts: `The read-only inquiry check fails when a ${state} case is stuck past its clock.`,
    },
  })),
  {
    sourceFile: 'pipelines.json',
    surface: 'public/app/sales-floor.html',
    control: 'Funnel tiles: Booked, Held, Deposits, Funded, Downsells (this month)',
    proof: {
      depth: 'deep',
      evidence: 'src/pulse/coverage/gap-sales-manager.mjs src/pulse/coverage/gap-sales-manager.test.mjs',
      asserts: 'The read-only sales check fails when funnel totals are missing or invalid.',
    },
  },
  {
    sourceFile: 'pipelines.json',
    surface: 'pulse:pipeline-motion',
    control: "pipeline:repair / pipeline:clients / pipeline:outbound (the three 'pipeline' checks)",
    proof: {
      depth: 'deep',
      evidence: PIPELINE_MOTION_EVIDENCE,
      asserts: 'The three read-only pipeline checks execute and a stuck repair result fails.',
    },
  },
  {
    sourceFile: 'pipelines.json',
    surface: 'pulse:crm-data',
    control: 'crm-data:pipeline-cards (cards with no column or no person, every rail)',
    proof: {
      depth: 'deep',
      evidence: 'src/pulse/coverage/gap-crm-links.mjs src/pulse/coverage/gap-crm-links.test.mjs',
      asserts: 'The read-only CRM check fails when a pipeline card has no stage or person.',
    },
  },
  {
    sourceFile: 'tables.json',
    surface: 'table:funnel_page_stats',
    control: 'funnel_page_stats: daily ClickFunnels page stats | written by: src/analytics/clickfunnels-org-sync.mjs | read by: api/read/funnel-pages.mjs, src/ops/weekly-brief.mjs, src/pulse/machine.mjs',
    proof: {
      depth: 'deep',
      evidence: 'src/pulse/machine.mjs src/pulse/machine.test.mjs',
      asserts: 'The read-only machine check fails when saved funnel page stats are missing or stale.',
    },
  },
]);

const PROOFS = new Map(DATA_PROOF_CASES.map((entry) => [
  caseKey(entry.sourceFile, entry.surface, entry.control),
  entry.proof,
]));

if (PROOFS.size !== DATA_PROOF_CASES.length) {
  throw new Error('Data catalog proof cases must be unique.');
}

export function dataProofFor(sourceFile, row) {
  const proof = PROOFS.get(caseKey(sourceFile, row?.surface, row?.control));
  return proof ? { ...proof } : null;
}
