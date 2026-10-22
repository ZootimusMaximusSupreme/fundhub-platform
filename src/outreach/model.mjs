export const PROGRAM_KEY = 'bank_relationships';
export const LAUNCH_STATES = ['AZ', 'SC', 'FL', 'CA'];
export const STATE_CODES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI'.split(' ');
export const MANAGER_ROLES = ['owner', 'admin', 'sales_manager'];
export const OUTREACH_ROLES = [...MANAGER_ROLES, 'outbound_rep'];
export const STATUSES = ['new', 'researching', 'contacted', 'engaged', 'product_pending', 'verified_partner', 'paused', 'closed'];
export const LENDER_TABLES = ['OnlineBizCC', 'InBranchBizCC', 'BizLOC_Stated', 'BizLOC_Documented', 'PersonalCC', 'PersonalLoans', 'PersonalLOC'];
export const FACT_KEYS = ['minimum_score', 'minimum_time_in_business_years', 'minimum_revenue_threshold', 'bureaus_pulled', 'inquiry_tolerance', 'stated_income', 'eligible_states', 'application_url', 'paper_application_url'];
export function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
export function text(value, name, { required = false, max = 10000 } = {}) {
  if (value != null && typeof value !== 'string') fail(`${name} must be text`);
  const out = (value || '').trim();
  if (out.length > max || (required && !out)) fail(`Enter ${name}`);
  return out || null;
}
export function uuid(value, name = 'id') {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail(`Invalid ${name}`);
  return value;
}
export function httpUrl(value, name) {
  if (value == null || value === '' || value === 'unknown') return value === 'unknown' ? value : null;
  if (typeof value !== 'string') fail(`Enter a valid ${name}`);
  let url;
  try { url = new URL(value); } catch { fail(`Enter a valid ${name}`); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) fail(`Enter a valid ${name}`);
  return url.href;
}
export function dueAt(value, now = new Date()) {
  if (value == null || value === '') return new Date(now).toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail('Enter a valid next action date');
  return date.toISOString();
}
export function status(value) { if (!STATUSES.includes(value)) fail('Choose a valid status'); return value; }
/* ------------------------------------------------------------------------- *
 * Product field catalog (owner spec 2026-10-21, docs/specs/bank-outreach-manual-first-2026-10-21.md).
 * One row per question a banker can answer. The first nine keys are the
 * original facts: names, types and storage are unchanged, so saved products and
 * the live checks keep working. Every other key writes one typed `lenders`
 * column when a product is pushed (LENDER_EXTRA_COLUMNS).
 * ------------------------------------------------------------------------- */
export const FIELD_CATALOG = Object.freeze({
  minimum_score: { label: 'Minimum credit score', type: 'score' },
  minimum_time_in_business_years: { label: 'Minimum years in business', type: 'years' },
  minimum_revenue_threshold: { label: 'Minimum yearly revenue', type: 'money' },
  bureaus_pulled: { label: 'Bureaus pulled', type: 'bureaus' },
  inquiry_tolerance: { label: 'Inquiries they accept', type: 'text' },
  stated_income: { label: 'Accepts stated income', type: 'yesno' },
  eligible_states: { label: 'States served', type: 'states' },
  application_url: { label: 'Online application link', type: 'url' },
  paper_application_url: { label: 'Paper application link', type: 'url' },
  double_pull: { label: 'Pulls two bureaus', type: 'yesno' },
  relationship_required: { label: 'Needs an existing relationship', type: 'yesno' },
  requires_account_opening: { label: 'Must open an account first', type: 'yesno' },
  minimum_deposit: { label: 'Minimum deposit', type: 'money' },
  prequal_soft_pull: { label: 'Soft-pull pre-qualification', type: 'yesno' },
  business_bureau_pulled: { label: 'Business bureau pulled', type: 'text' },
  underwriter: { label: 'Who underwrites it', type: 'text' },
  intro_offers: { label: 'Intro offer', type: 'text' },
  multiple_llc_allowed: { label: 'More than one LLC allowed', type: 'yesno' },
  application_method: { label: 'How clients apply', type: 'text' },
  typical_amount: { label: 'Typical approved amount', type: 'money' },
  apr_pct: { label: 'APR (percent)', type: 'pct' },
  repayment_months: { label: 'Repayment months', type: 'months' },
  funding_speed: { label: 'How fast it funds', type: 'text' },
  average_starting_line: { label: 'Usual starting line', type: 'money' },
  max_line: { label: 'Largest line', type: 'money' },
  draw_and_renewal: { label: 'Draw period and renewal', type: 'text' },
  documents_required: { label: 'Documents required', type: 'text' },
  collateral_required: { label: 'Collateral required', type: 'yesno' },
  line_type: { label: 'Line type', type: 'text' }
});
export const FIELD_KEYS = Object.freeze(Object.keys(FIELD_CATALOG));

// Keys that write a typed `lenders` column beyond the twelve base columns that
// lenderValues() fills. The first nine keys are not here: their storage is fixed.
export const LENDER_EXTRA_COLUMNS = Object.freeze({
  double_pull: 'double_pull', relationship_required: 'relationship_required', requires_account_opening: 'requires_account_opening',
  minimum_deposit: 'minimum_deposit', prequal_soft_pull: 'prequal_soft_pull', business_bureau_pulled: 'business_bureau_pulled',
  underwriter: 'underwriter_interaction', intro_offers: 'intro_offers', multiple_llc_allowed: 'multiple_llc_allowed',
  application_method: 'application_method', typical_amount: 'typical_approval_range', apr_pct: 'apr_range_pct',
  repayment_months: 'repayment_terms_months', funding_speed: 'funding_speed', average_starting_line: 'average_starting_loc',
  max_line: 'max_known_loc', draw_and_renewal: 'draw_period_renewal', documents_required: 'docs_requested',
  collateral_required: 'collateral_required', line_type: 'loc_type'
});

const EVERY_PRODUCT = ['minimum_score', 'bureaus_pulled', 'double_pull', 'inquiry_tolerance', 'stated_income', 'eligible_states', 'application_url', 'paper_application_url', 'relationship_required', 'requires_account_opening', 'minimum_deposit', 'prequal_soft_pull'];
const BUSINESS_ONLY = ['minimum_time_in_business_years', 'minimum_revenue_threshold'];
// Adding a product type later (MCA) is one row here and one value in LENDER_TABLES.
const TYPE_ADDS = {
  OnlineBizCC: [...BUSINESS_ONLY, 'business_bureau_pulled', 'underwriter', 'intro_offers', 'multiple_llc_allowed'],
  InBranchBizCC: [...BUSINESS_ONLY, 'business_bureau_pulled', 'underwriter', 'intro_offers', 'multiple_llc_allowed'],
  BizLOC_Stated: [...BUSINESS_ONLY, 'business_bureau_pulled', 'average_starting_line', 'max_line', 'apr_pct', 'draw_and_renewal', 'documents_required', 'collateral_required', 'line_type'],
  BizLOC_Documented: [...BUSINESS_ONLY, 'business_bureau_pulled', 'average_starting_line', 'max_line', 'apr_pct', 'draw_and_renewal', 'documents_required', 'collateral_required', 'line_type'],
  PersonalCC: ['underwriter', 'intro_offers'],
  PersonalLOC: ['average_starting_line', 'max_line', 'apr_pct', 'draw_and_renewal', 'collateral_required'],
  PersonalLoans: ['application_method', 'typical_amount', 'apr_pct', 'repayment_months', 'funding_speed']
};
// What a person answers, per product type, in catalog order (the order the form shows).
export const TYPE_FIELDS = Object.freeze(Object.fromEntries(LENDER_TABLES.map(table => {
  const wanted = new Set([...EVERY_PRODUCT, ...TYPE_ADDS[table]]);
  return [table, Object.freeze(FIELD_KEYS.filter(key => wanted.has(key)))];
})));
// Keys that do not apply to a product type. The server stores "n/a" for them; a person never types it.
export const NOT_APPLICABLE = Object.freeze(Object.fromEntries(LENDER_TABLES.map(table => [table, Object.freeze(BUSINESS_ONLY.filter(key => !TYPE_FIELDS[table].includes(key)))])));

/** The field catalog as the screen reads it (spec section 4). A fresh object per call. */
export function productFields() {
  return {
    fields: Object.fromEntries(FIELD_KEYS.map(key => [key, { ...FIELD_CATALOG[key] }])),
    types: Object.fromEntries(LENDER_TABLES.map(table => [table, [...TYPE_FIELDS[table]]])),
    notApplicable: Object.fromEntries(LENDER_TABLES.map(table => [table, [...NOT_APPLICABLE[table]]]))
  };
}
/** Keep only the answers a product type asks for; anything else is dropped, not guessed. */
export function factsForType(lenderTable, facts) {
  const keys = TYPE_FIELDS[lenderTable];
  if (!keys) return { ...facts };
  return Object.fromEntries(Object.entries(facts || {}).filter(([key]) => keys.includes(key)));
}

// One answer, checked for its field's type. Blank means "not answered" (undefined);
// "unknown" is an answer; anything that does not fit throws and is never coerced.
export function normalizeFact(key, value) {
  const field = FIELD_CATALOG[key];
  if (!field) fail(`Unknown product fact: ${key}`);
  if (value == null || value === '') return undefined;
  if (value === 'unknown') return value;
  switch (field.type) {
    case 'score':
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 300 || value > 850) fail(`Enter a valid ${key}`);
      return value;
    case 'years': case 'money': case 'pct': {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (field.type === 'pct' && value > 100)) fail(`Enter a valid ${key}`);
      if (value > (field.type === 'years' ? 9999.99 : 999999999999.99) || Math.abs(value * 100 - Math.round(value * 100)) > 0.0001) fail(`Enter a valid ${key} with at most two decimal places`);
      return value;
    }
    case 'months':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 600) fail(`Enter a valid ${key}`);
      return value;
    case 'yesno':
      if (typeof value !== 'boolean') fail(`${key} must be true, false, or unknown`);
      return value;
    case 'bureaus': case 'states': {
      if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== 'string')) fail(`Enter ${key} or unknown`);
      const normalized = [...new Set(value.map(v => v.trim().toUpperCase()))];
      if (field.type === 'bureaus' && normalized.some(v => !['EX', 'EQ', 'TU'].includes(v))) fail('Use EX, EQ, TU for bureaus');
      if (field.type === 'states' && normalized.some(v => !STATE_CODES.includes(v))) fail('Use valid two-letter eligible states');
      return normalized;
    }
    case 'url': return httpUrl(value, key);
    default: return text(value, key, { required: true, max: 1000 });
  }
}

/* Without lenderTable: the original nine facts, exactly as before. With
   lenderTable: the facts that product type asks for, and "n/a" for the keys that
   do not apply to it. `complete` means every asked field is answered or "unknown". */
export function normalizeFacts(input, { complete = false, lenderTable = null } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Enter product facts');
  const typed = lenderTable != null;
  if (typed && !TYPE_FIELDS[lenderTable]) fail('Choose an existing lender product category');
  const asked = typed ? TYPE_FIELDS[lenderTable] : FACT_KEYS;
  const notApplicable = typed ? NOT_APPLICABLE[lenderTable] : [];
  for (const key of Object.keys(input)) {
    if (!typed) { if (!FACT_KEYS.includes(key)) fail(`Unknown product fact: ${key}`); continue; }
    if (!FIELD_CATALOG[key]) fail(`Unknown product fact: ${key}`);
    if (!asked.includes(key) && !notApplicable.includes(key)) fail(`${FIELD_CATALOG[key].label} does not apply to this kind of product`);
  }
  const facts = {};
  for (const key of typed ? FIELD_KEYS : FACT_KEYS) {
    if (notApplicable.includes(key)) {
      const given = input[key];
      if (given != null && given !== '' && given !== 'unknown' && given !== 'n/a') fail(`${FIELD_CATALOG[key].label} does not apply to this kind of product`);
      facts[key] = 'n/a';
      continue;
    }
    if (!asked.includes(key)) continue;
    const value = normalizeFact(key, input[key]);
    if (value === undefined) { if (complete) fail(typed ? `Answer ${FIELD_CATALOG[key].label} or enter unknown` : `Answer ${key} or enter unknown`); continue; }
    facts[key] = value;
  }
  if (complete && !['application_url', 'paper_application_url'].some(k => facts[k] && facts[k] !== 'unknown')) fail('Add a real application URL or paper application URL');
  return facts;
}

/* The typed `lenders` columns a product fills beyond the twelve base ones, as
   { column: value } in catalog order. Known-only: "unknown" and "n/a" are NULL,
   yes/no is "Yes"/"No", numbers stay numbers. Only columns this product type asks for. */
export function lenderExtras(lenderTable, facts) {
  const out = {};
  for (const key of TYPE_FIELDS[lenderTable] || []) {
    const column = LENDER_EXTRA_COLUMNS[key];
    if (!column) continue;
    const value = facts?.[key];
    out[column] = value == null || value === 'unknown' || value === 'n/a' ? null : FIELD_CATALOG[key].type === 'yesno' ? (value ? 'Yes' : 'No') : value;
  }
  return out;
}

// RFC 4180 quoting, BOM, CRLF and embedded commas/newlines; no network requests.
export function parseInstitutionCsv(source, csv, states = LAUNCH_STATES) {
  if (!['fdic', 'ncua'].includes(source)) fail('Choose FDIC or NCUA');
  if (typeof csv !== 'string' || !csv.trim() || Buffer.byteLength(csv) > 5_000_000) fail('Upload a CSV under 5 MB');
  const rows = []; let row = []; let cell = ''; let quoted = false;
  const raw = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') { if (quoted && raw[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(cell); cell = '';
      if (c !== ',') { if (row.some(v => v.trim())) rows.push(row); row = []; if (c === '\r' && raw[i + 1] === '\n') i++; }
    } else cell += c;
  }
  if (quoted) fail('CSV has an unclosed quote');
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  const headers = (rows.shift() || []).map(v => v.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  const aliases = { external_id: source === 'fdic' ? ['cert', 'certificate', 'certificatenumber', 'externalid'] : ['cunum', 'cunumber', 'charter', 'charternumber', 'externalid'], name: ['name', 'bankname', 'cuname', 'creditunionname'], state: ['stalp', 'state', 'physicalstate', 'statecode'], city: ['city', 'physicalcity'], website: ['website', 'webaddr', 'webaddress', 'url'] };
  const cols = Object.fromEntries(Object.entries(aliases).map(([k, names]) => [k, headers.findIndex(h => names.includes(h))]));
  if (['external_id', 'name', 'state'].some(k => cols[k] < 0)) fail('CSV needs institution ID, name, and state columns');
  if (rows.length > 10000) fail('Import at most 10,000 rows at once');
  let skipped = 0; const targets = new Map();
  for (const values of rows) {
    const item = Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, i < 0 ? null : (values[i] || '').trim()]));
    item.state = item.state.toUpperCase();
    if (!/^[0-9]+$/.test(item.external_id) || !item.name || !/^[A-Z]{2}$/.test(item.state)) fail('Each CSV row needs a real numeric institution ID, name, and two-letter state');
    item.external_id = item.external_id.replace(/^0+(?=\d)/, '');
    if (!states.includes(item.state)) { skipped++; continue; }
    item.source = source; item.institution_key = `${source}:${item.external_id}`;
    targets.set(`${item.external_id}:${item.state}`, item);
  }
  return { items: [...targets.values()], skipped };
}

// Only known answers enter typed lender columns; unknown stays NULL.
export function lenderValues(account, product, facts, staff) {
  // "n/a" is the server's value for a business-only key on a personal product: NULL in Lenders, like unknown.
  // A typed text answer of "n/a" elsewhere (inquiry tolerance) is the banker's word and stays.
  const known = key => facts[key] === 'unknown' || facts[key] == null || (facts[key] === 'n/a' && BUSINESS_ONLY.includes(key)) ? null : facts[key];
  const requirements = [known('minimum_score') != null ? `Minimum credit score ${facts.minimum_score}.` : 'Minimum credit score unknown.', `Inquiry tolerance: ${known('inquiry_tolerance') ?? 'unknown'}.`, `Stated income: ${known('stated_income') == null ? 'unknown' : facts.stated_income ? 'yes' : 'no'}.`].join(' ');
  return [account.org_id, product.lender_table, account.name, product.product_name, known('application_url') || known('paper_application_url'), known('eligible_states')?.join(', ') || null, known('bureaus_pulled')?.join('/') || null, requirements, known('minimum_time_in_business_years'), known('minimum_revenue_threshold'), `${product.evidence}\nPaper application: ${known('paper_application_url') || 'unknown'}`, staff.name || staff.email || staff.id];
}
