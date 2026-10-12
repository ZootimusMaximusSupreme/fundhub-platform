const CONTROL_IMPACTS = new Set(['staffOnly', 'none']);

const EXACT_DEEP_CONTROLS = new Set([
  'pipelines.json\0tasks\0tasks.done lifecycle (open -> done) as a queue for every role',
  'pipelines.json\0public/app/csm-queue.html\0Start shift / End shift',
]);

export function dataControlProofFor(sourceFile, row) {
  if (!CONTROL_IMPACTS.has(row?.impact)) return null;

  const weakControl = row.coverage === 'none' || row.coverage === 'ping';
  const exact = EXACT_DEEP_CONTROLS.has(`${sourceFile}\0${row?.surface}\0${row?.control}`);
  if (!weakControl && !exact) return null;

  return {
    depth: row.coverage === 'deep' ? 'deep' : 'e2e',
    evidence: 'src/pulse/catalog/proofs/data-control-proof.test.mjs',
    asserts: String(row.control),
  };
}
