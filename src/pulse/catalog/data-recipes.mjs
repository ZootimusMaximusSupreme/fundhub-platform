import { dataProofFor } from './proofs/data-proof-cases.mjs';

const SUPPORTED_FILES = new Set([
  'pipelines.json',
  'tables.json',
  'banks-links.json',
]);

const CUSTOMER_OR_MONEY = new Set([
  'customerData',
  'customerMessage',
  'money',
]);

const BELOW_DEPTH = new Set(['ping', 'none']);

function fileName(sourceFile) {
  return String(sourceFile || '').replaceAll('\\', '/').split('/').at(-1);
}

function hasReceiptProof(row) {
  return /\breceipts?\b/i.test(String(row.evidence || ''));
}

function modeFor(row, proof) {
  const coverage = String(row.coverage || '').toLowerCase();
  const sensitive = CUSTOMER_OR_MONEY.has(row.impact);

  if (hasReceiptProof(row)) return 'receipt';
  if (proof) return 'test';
  if ((sensitive && BELOW_DEPTH.has(coverage)) || coverage === 'none') {
    return 'manual-red';
  }
  if (coverage === 'e2e') return 'test';
  if (coverage === 'deep' || coverage === 'ping') return 'read-only';
  return 'manual-red';
}

function scheduleFor(mode) {
  if (mode === 'receipt') return 'event';
  if (mode === 'test') return 'on-change';
  return 'daily';
}

function copyField(value) {
  return Array.isArray(value) ? [...value] : value;
}

function makeTarget(row) {
  const target = {
    kind: row.kind,
    control: row.control,
    calls: copyField(row.calls),
    tables: copyField(row.tables),
  };

  if ('created_in' in row) target.created_in = row.created_in;
  if ('writer_files' in row) target.writer_files = row.writer_files;
  if ('reader_files' in row) target.reader_files = row.reader_files;
  if ('pulse_reader_files' in row) {
    target.pulse_reader_files = copyField(row.pulse_reader_files);
  }

  return target;
}

export function supports(sourceFile, row) {
  return SUPPORTED_FILES.has(fileName(sourceFile))
    && Boolean(row && typeof row === 'object' && !Array.isArray(row))
    && typeof row.surface === 'string'
    && row.surface.length > 0;
}

export function makeRecipe(sourceFile, row) {
  if (!supports(sourceFile, row)) {
    throw new TypeError(`Unsupported data coverage row from ${fileName(sourceFile) || 'unknown source'}`);
  }

  const proof = dataProofFor(fileName(sourceFile), row);
  const mode = modeFor(row, proof);

  return {
    family: 'data',
    mode,
    target: makeTarget(row),
    expected: {
      coverage: row.coverage,
      impact: row.impact,
      evidence: row.evidence,
    },
    schedule: scheduleFor(mode),
    safe: true,
    sourceFile,
    surface: row.surface,
    ...(proof ? { proof } : {}),
  };
}
