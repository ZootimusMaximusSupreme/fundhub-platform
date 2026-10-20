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
export function normalizeFacts(input, { complete = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Enter product facts');
  const facts = {};
  for (const key of Object.keys(input)) if (!FACT_KEYS.includes(key)) fail(`Unknown product fact: ${key}`);
  for (const key of FACT_KEYS) {
    const value = input[key];
    if (value == null || value === '') { if (complete) fail(`Answer ${key} or enter unknown`); continue; }
    if (value === 'unknown') { facts[key] = value; continue; }
    if (['minimum_score', 'minimum_time_in_business_years', 'minimum_revenue_threshold'].includes(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (key === 'minimum_score' && (!Number.isInteger(value) || value < 300 || value > 850))) fail(`Enter a valid ${key}`);
      if (key !== 'minimum_score' && (value > (key === 'minimum_time_in_business_years' ? 9999.99 : 999999999999.99) || Math.abs(value * 100 - Math.round(value * 100)) > 0.0001)) fail(`Enter a valid ${key} with at most two decimal places`);
      facts[key] = value;
    } else if (key === 'stated_income') {
      if (typeof value !== 'boolean') fail('stated_income must be true, false, or unknown');
      facts[key] = value;
    } else if (key === 'bureaus_pulled' || key === 'eligible_states') {
      if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== 'string')) fail(`Enter ${key} or unknown`);
      const normalized = [...new Set(value.map(v => v.trim().toUpperCase()))];
      if (key === 'bureaus_pulled' && normalized.some(v => !['EX', 'EQ', 'TU'].includes(v))) fail('Use EX, EQ, TU for bureaus');
      if (key === 'eligible_states' && normalized.some(v => !STATE_CODES.includes(v))) fail('Use valid two-letter eligible states');
      facts[key] = normalized;
    } else if (key.endsWith('_url')) facts[key] = httpUrl(value, key);
    else facts[key] = text(value, key, { required: true, max: 1000 });
  }
  if (complete && !['application_url', 'paper_application_url'].some(k => facts[k] && facts[k] !== 'unknown')) fail('Add a real application URL or paper application URL');
  return facts;
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
  const aliases = { external_id: source === 'fdic' ? ['cert', 'certificate', 'certificatenumber', 'externalid'] : ['cunum', 'cunumber', 'charter', 'charternumber', 'externalid'], name: ['name', 'bankname', 'cuname', 'creditunionname'], state: ['stalp', 'state', 'physicalstate', 'statecode'], city: ['city', 'physicalcity'], website: ['website', 'webaddress', 'url'] };
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
  const known = key => facts[key] === 'unknown' || facts[key] == null ? null : facts[key];
  const requirements = [known('minimum_score') != null ? `Minimum credit score ${facts.minimum_score}.` : 'Minimum credit score unknown.', `Inquiry tolerance: ${known('inquiry_tolerance') ?? 'unknown'}.`, `Stated income: ${known('stated_income') == null ? 'unknown' : facts.stated_income ? 'yes' : 'no'}.`].join(' ');
  return [account.org_id, product.lender_table, account.name, product.product_name, known('application_url') || known('paper_application_url'), known('eligible_states')?.join(', ') || null, known('bureaus_pulled')?.join('/') || null, requirements, known('minimum_time_in_business_years'), known('minimum_revenue_threshold'), `${product.evidence}\nPaper application: ${known('paper_application_url') || 'unknown'}`, staff.name || staff.email || staff.id];
}
