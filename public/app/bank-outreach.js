/* Bank relationship workspace. The server owns role and assignment scope. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var labels = { new: 'New', researching: 'Researching', contacted: 'Contacted', engaged: 'Engaged', product_pending: 'Product review', verified_partner: 'Verified partner', paused: 'Paused', closed: 'Closed' };
  var categories = { OnlineBizCC: 'Business card · online', InBranchBizCC: 'Business card · branch', BizLOC_Stated: 'Business line · stated income', BizLOC_Documented: 'Business line · documented', PersonalCC: 'Personal card', PersonalLoans: 'Personal loan', PersonalLOC: 'Personal line' };
  var factLabels = { minimum_score: 'Minimum score', minimum_time_in_business_years: 'Minimum years in business', minimum_revenue_threshold: 'Minimum revenue', bureaus_pulled: 'Bureaus pulled', inquiry_tolerance: 'Inquiry tolerance', stated_income: 'Stated income', eligible_states: 'Eligible states', application_url: 'Online application URL', paper_application_url: 'Paper application URL' };
  var list = [], reps = [], canManage = false, offset = 0, total = 0, detail = null, section = 'touch', view = 'queue', requestNumber = 0, detailNumber = 0, initialized = false, searchTimer, returnFocus, returnBankId, importReturnFocus;
  // Product fields per category come from the server (productFields). An older response has none:
  // the form keeps today's nine facts, and pushing stays a manager control.
  var fieldCatalog = null, myStaffId = null, productAnswers = {};
  var legacyTypes = { minimum_score: 'score', minimum_time_in_business_years: 'years', minimum_revenue_threshold: 'money', bureaus_pulled: 'bureaus', inquiry_tolerance: 'text', stated_income: 'yesno', eligible_states: 'states', application_url: 'url', paper_application_url: 'url' };
  var factHints = { score: '300 to 850, or unknown', years: 'Years, or unknown', money: 'Dollars, or unknown', pct: 'Percent, or unknown', months: 'Months, or unknown', bureaus: 'EX, EQ, TU, or unknown', states: 'Two-letter states, or unknown', url: 'https://…, or unknown', text: 'Answer, or unknown' };
  var NUMBER_TYPES = ['score', 'years', 'money', 'pct', 'months'], DAY = 86400000;
  // Automation words. The server owns every status; these maps only name them.
  var EMAIL_STEPS = 3, automationNumber = 0, programStates = null;
  var leadStatus = { suggested: 'Needs review', accepted: 'Saved as banker', dismissed: 'Not a match' };
  var replyStatus = { new: 'New', needs_human: 'Needs you', handled: 'Done' };
  var replyKinds = { interested: 'Interested', data: 'Sent product facts', call: 'Wants a call', not_now: 'Not now', wrong_person: 'Wrong person', opt_out: 'Asked to stop', auto_reply: 'Automatic reply', bounce: 'Bounced', other: 'Other reply' };
  var readModes = { rules: 'Read by rules', shadow: 'Read by AI in practice mode', live: 'Read by AI' };
  var stopReasons = { replied: 'Emails stopped: the banker replied.', opted_out: 'Emails stopped: the banker opted out.', bounced: 'Emails stopped: the email bounced.', completed: 'All 3 emails sent. Emails stopped.', manual: 'Emails stopped by staff.', account_closed: 'Emails stopped: the bank is paused or closed.', no_email: 'Emails stopped: no email saved.' };
  var settingNames = { BANK_OUTREACH_FROM: 'From address', BANK_OUTREACH_POSTAL_ADDRESS: 'Mailing address for the email footer', RESEND_REPLY_TO_DOMAIN: 'Reply address domain', UNSUBSCRIBE_TOKEN_SECRET: 'Unsubscribe link key' };
  var draftReasons = { shadow_mode: 'Practice mode is on, so Fundhub sends nothing.', template_pending: 'The reply email copy is waiting for approval.', template_missing: 'The reply email copy is not set up.', no_email: 'This banker has no email or opted out.', reply_cap: 'This banker already got 3 replies in the last 30 days.', already_queued: 'This reply is already queued to send.' };
  var agentModes = { draft: ['Rules only', 'Fundhub handles STOP, out-of-office and bounce emails. A person reads every other reply.'], shadow: ['Practice', 'The AI reads replies and suggests facts and answers. It sends nothing.'], live: ['Live', 'The AI picks the reply email, and Fundhub sends it.'], missing: ['Not set up', 'The reply agent is not set up. A person reads every reply.'] };
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function headers() { var h = { accept: 'application/json', 'content-type': 'application/json' }; try { var token = localStorage.getItem('fh_token'); if (token) h.authorization = 'Bearer ' + token; } catch (_) { /* Cookie session remains available. */ } return h; }
  async function api(query, body) { var response = await fetch(body ? '/api/bank-outreach' : '/api/read/bank-outreach?' + new URLSearchParams(query || {}), { method: body ? 'POST' : 'GET', headers: headers(), credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined }); var data; try { data = await response.json(); } catch (_) { throw new Error('Bank outreach did not return a saved result. Try again.'); } if (!response.ok || !data.ok) throw Object.assign(new Error(data.message || 'Bank outreach could not load. Try again.'), { status: response.status }); return data; }
  function message(id, text, error) { var el = $(id); el.textContent = text; el.hidden = !text; el.classList.toggle('error', !!error); if (text && id === 'drawer-message' && $('bank-drawer').open) el.scrollIntoView({ block: 'nearest' }); }
  function readable(value, blank) { if (value == null || value === '' || (Array.isArray(value) && !value.length)) return blank || 'Unanswered'; if (value === 'unknown') return 'Unknown'; if (value === 'n/a') return 'Does not apply'; if (Array.isArray(value)) return value.join(', '); if (typeof value === 'boolean') return value ? 'Yes' : 'No'; return String(value); }
  function safeUrl(value) { try { var u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch (_) { return ''; } }
  function emailUrl(value) { var email = String(value || ''); return /^[^\s@<>]+@[^\s@<>]+$/.test(email) && !/[\u0000-\u001f\u007f]/.test(email) ? 'mailto:' + encodeURIComponent(email).replace(/%40/g, '@') : ''; }
  function phoneUrl(value) { var match = String(value || '').trim().match(/^(\+?[\d\s().-]+?)(?:\s*(?:ext\.?|x|;ext=)\s*(\d+))?$/i); if (!match) return ''; var number = match[1].replace(/[\s().-]/g, ''); return /\d/.test(number) ? 'tel:' + number + (match[2] ? ';ext=' + match[2] : '') : ''; }
  function date(value) { if (!value || Number.isNaN(new Date(value).getTime())) return 'No time saved'; var d = new Date(value), delta = Date.now() - d.getTime(); var exact = d.toLocaleString('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' Arizona'; var label = delta >= 0 && delta < 86400000 ? (delta < 60000 ? 'Just now' : delta < 3600000 ? Math.floor(delta / 60000) + 'm ago' : Math.floor(delta / 3600000) + 'h ago') : d.toLocaleString('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' Arizona'; return '<time datetime="' + esc(d.toISOString()) + '" title="' + esc(exact) + '">' + esc(label) + '</time>'; }
  function due(value) { if (!value) return 'Next action needed'; return (new Date(value).getTime() <= Date.now() ? 'Due · ' : 'Scheduled · ') + date(value); }
  function options(map, selected, blank) { return (blank ? '<option value="">' + esc(blank) + '</option>' : '') + Object.keys(map).map(function (key) { return '<option value="' + esc(key) + '"' + (key === selected ? ' selected' : '') + '>' + esc(map[key]) + '</option>'; }).join(''); }
  function field(label, name, value, attrs) { return '<label>' + esc(label) + '<input name="' + esc(name) + '" value="' + esc(value) + '" ' + (attrs || '') + '></label>'; }
  function textarea(label, name, value, required) { return '<label>' + esc(label) + '<textarea name="' + esc(name) + '" rows="3"' + (required ? ' required' : '') + '>' + esc(value) + '</textarea></label>'; }
  function submit(label, secondary) { return '<div class="form-actions"><button class="button' + (secondary ? '' : ' primary') + '" type="submit">' + esc(label) + '</button></div>'; }
  function statusTag(status) { return '<span class="status-tag' + (status === 'verified_partner' ? ' verified' : '') + '">' + esc(labels[status] || status) + '</span>'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function listWords(items) { return items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]; }
  function multiline(value) { return esc(value).replace(/\r?\n/g, '<br>'); }
  function count(value) { return esc(value == null ? '—' : value); }
  // The field catalog: labels, types and the ordered fields for each product category.
  function takeCatalog(data) { var pf = data && data.productFields; if (pf && pf.fields && typeof pf.fields === 'object' && pf.types && typeof pf.types === 'object') fieldCatalog = pf; }
  function allFactKeys() { return Object.keys(fieldCatalog ? fieldCatalog.fields : factLabels); }
  function factKeys(table) {
    if (!fieldCatalog) return Object.keys(factLabels);
    var keys = fieldCatalog.types[table], skip = (fieldCatalog.notApplicable || {})[table] || [];
    return (Array.isArray(keys) ? keys : Object.keys(factLabels)).filter(function (key) { return fieldCatalog.fields[key] && skip.indexOf(key) < 0; });
  }
  function factLabel(key) { var f = fieldCatalog && fieldCatalog.fields[key]; return f && f.label ? f.label : factLabels[key] || key; }
  function factType(key) { var f = fieldCatalog && fieldCatalog.fields[key]; return f && f.type ? f.type : legacyTypes[key] || 'text'; }
  function blankWord() { return fieldCatalog ? 'Not asked yet' : 'Unanswered'; }
  function rawFact(value) { return value == null || value === 'n/a' ? '' : Array.isArray(value) ? value.join(', ') : String(value); }
  function factList(candidate) { var facts = candidate.facts || {}; return '<dl class="record-facts">' + factKeys(candidate.lender_table).map(function (key) { return '<dt>' + esc(factLabel(key)) + '</dt><dd>' + esc(readable(facts[key], blankWord())) + '</dd>'; }).join('') + '</dl>'; }
  function factInput(key, value) {
    var type = factType(key), label = factLabel(key);
    if (type === 'yesno') return '<label>' + esc(label) + '<select name="' + esc(key) + '">' + (fieldCatalog ? options({ true: 'Yes', false: 'No', unknown: 'Unknown' }, value, 'Not asked yet') : options({ unknown: 'Unknown', true: 'Yes', false: 'No' }, value, 'Unanswered')) + '</select></label>';
    return field(label, key, value, fieldCatalog ? 'placeholder="' + esc(factHints[type] || factHints.text) + '"' + (type === 'url' ? ' inputmode="url"' : '') : 'placeholder="Unknown or actual answer"');
  }
  function factInputs(table) { return factKeys(table).map(function (key) { return factInput(key, productAnswers[key] || ''); }).join(''); }
  function parseFact(key, raw) {
    var value = String(raw).trim(), type = factType(key); if (!value) return undefined;
    if (/^unknown$/i.test(value)) return 'unknown';
    if (NUMBER_TYPES.indexOf(type) >= 0) { var cleaned = type === 'money' || type === 'pct' ? value.replace(/[$,%\s]/g, '') : value, n = cleaned ? Number(cleaned) : NaN; if (!Number.isFinite(n)) throw new Error(factLabel(key) + ' needs a number or unknown.'); return n; }
    if (type === 'yesno') return value === 'true';
    if (type === 'bureaus' || type === 'states') return value.split(/[,\s]+/).filter(Boolean).map(function (s) { return s.toUpperCase(); });
    return value;
  }
  // Same control for managers and reps. A rep pushes only on a bank assigned to them, and only
  // when the server sent the catalog (the server version that allows a rep to push).
  function canPush(p) { if (canManage) return !!(p.draft || !p.verified_at); return !!fieldCatalog && !p.verified_at && !!myStaffId && !!detail && detail.account.assigned_staff_id === myStaffId; }
  // What the server will still refuse. Shown next to the button; the server stays the judge.
  function pushGaps(candidate) {
    var facts = candidate.facts || {}, gaps = [], evidence = String(candidate.evidence || '').trim().toLowerCase();
    var open = factKeys(candidate.lender_table).filter(function (key) { var v = facts[key]; return v == null || v === '' || (Array.isArray(v) && !v.length); }).length;
    if (open) gaps.push(plural(open, 'more fact', 'more facts') + ' answered or marked unknown');
    if (!evidence || ['unknown', 'none', 'n/a', 'tbd'].indexOf(evidence) >= 0) gaps.push('source evidence');
    if (!(detail.contacts || []).some(function (c) { return String(c.name || '').trim() && [c.email, c.phone, c.linkedin_url].some(function (v) { return String(v || '').trim(); }); })) gaps.push('a banker with an email, phone or LinkedIn');
    if (!['application_url', 'paper_application_url'].some(function (key) { return facts[key] && facts[key] !== 'unknown' && facts[key] !== 'n/a'; })) gaps.push('an online or paper application link');
    return gaps;
  }
  // Warm-up messages go out from the rep's own email or phone. Fundhub only logs the touch.
  function warmupLinks(c) {
    var w = c.warmup || {}, mail = emailUrl(c.email), tel = phoneUrl(c.phone);
    var email = w.email && typeof w.email.subject === 'string' && typeof w.email.body === 'string' && mail && !c.email_opt_out_at ? mail + '?subject=' + encodeURIComponent(w.email.subject) + '&body=' + encodeURIComponent(w.email.body) : '';
    var text = typeof w.text === 'string' && w.text.trim() && tel && tel.indexOf(';ext=') < 0 ? 'sms:' + tel.slice(4) + '?&body=' + encodeURIComponent(w.text) : '';
    return { email: email, text: text };
  }
  function warmupHtml(c) {
    var links = warmupLinks(c), w = c.warmup || {}; if (!links.email && !links.text) return '';
    var both = links.email && links.text;
    return '<div class="warmup"><p class="caption">Warm-up message · asks for a call, not product facts</p><div class="record-actions">' +
      (links.email ? '<a class="button" href="' + esc(links.email) + '" data-warmup="email" data-contact-id="' + esc(c.id) + '" aria-label="Send warm-up email to ' + esc(c.name) + '">Email banker</a>' : '') +
      (links.text ? '<a class="button" href="' + esc(links.text) + '" data-warmup="text" data-contact-id="' + esc(c.id) + '" aria-label="Send warm-up text to ' + esc(c.name) + '">Text banker</a>' : '') + '</div>' +
      '<details class="warmup-preview"><summary>Read the warm-up ' + (both ? 'email and text' : links.email ? 'email' : 'text') + '</summary>' +
      (links.email ? '<p class="caption">Email subject</p><p><strong>' + esc(w.email.subject) + '</strong></p><div class="reply-body" tabindex="0" role="region" aria-label="Warm-up email to ' + esc(c.name) + '">' + multiline(w.email.body) + '</div>' : '') +
      (links.text ? '<p class="caption">Text message</p><div class="reply-body" tabindex="0" role="region" aria-label="Warm-up text to ' + esc(c.name) + '">' + multiline(w.text) + '</div>' : '') +
      '</details><p class="caption">Opens your own email or text app. Fundhub sends nothing. It logs the touch and a follow-up in 3 days.</p></div>';
  }
  function rowChips(a) { var chips = []; if (Number(a.leads_waiting) > 0) chips.push(plural(Number(a.leads_waiting), 'found banker', 'found bankers')); if (Number(a.replies_waiting) > 0) chips.push(plural(Number(a.replies_waiting), 'reply', 'replies')); return chips.length ? '<span class="row-chips">' + chips.map(function (chip) { return '<span class="status-tag">' + esc(chip) + '</span>'; }).join('') + '</span>' : ''; }
  // Every program state from the server. Restore the choice without making it the reset default.
  function paintStates(states) {
    states = Array.isArray(states) ? states : []; var key = states.join(','); if (key === programStates) return; programStates = key;
    var select = $('state'), current = select.value; select.innerHTML = '<option value="">All states</option>' + states.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join(''); select.value = states.includes(current) ? current : '';
    $('import-states').textContent = states.length > 8 ? 'all ' + states.length + ' states and territories in this program' : states.length ? listWords(states) : 'your program states';
  }
  function paintSummary(summary) {
    $('verified-week').textContent = summary.verified_products_week == null ? '—' : summary.verified_products_week;
    $('verified-compare').textContent = 'vs ' + (summary.verified_products_previous_week == null ? '—' : summary.verified_products_previous_week) + ' last week';
    $('verified-partners').textContent = summary.verified_partners == null ? '—' : summary.verified_partners;
    $('due-now').textContent = summary.due_now == null ? '—' : summary.due_now;
    $('leads-waiting').textContent = summary.leads_waiting == null ? '—' : summary.leads_waiting;
    $('replies-waiting').textContent = summary.replies_waiting == null ? '—' : summary.replies_waiting;
    if (canManage) { $('hero-label').textContent = 'Verified lender products this week'; $('hero-value').textContent = summary.verified_products_week == null ? '—' : summary.verified_products_week; $('hero-value').classList.add('manager-value'); $('hero-note').textContent = 'vs ' + (summary.verified_products_previous_week == null ? '—' : summary.verified_products_previous_week) + ' last week · Complete fact sets saved to Lenders'; $('result-label').textContent = 'Bank work due now'; $('verified-week').textContent = summary.due_now == null ? '—' : summary.due_now; $('verified-compare').textContent = 'of ' + (summary.total == null ? '—' : summary.total) + ' team banks'; $('result-note').textContent = 'Next actions keep banker facts moving'; $('last-result-label').textContent = 'Missing next action'; $('due-now').textContent = summary.missing_next_action == null ? '—' : summary.missing_next_action; }
    message('workspace-notice', summary.missing_next_action > 0 ? summary.missing_next_action + ' bank' + (summary.missing_next_action === 1 ? ' needs' : 's need') + ' a next action. Open the bank and save what happens next.' : '');
  }
  async function loadQueue() {
    var sequence = ++requestNumber, query = { q: $('search').value.trim(), state: $('state').value, status: $('status').value, offset: offset, limit: 25 }, filtered = !!(query.q || query.state || query.status);
    $('queue-panel').setAttribute('aria-busy', 'true'); $('queue-state').hidden = false; $('queue-table').hidden = true; $('pagination').hidden = true;
    $('queue-state').innerHTML = '<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><p class="caption">Loading bank queue…</p>';
    try {
      var data = await api(query); if (sequence !== requestNumber) return;
      canManage = !!data.canManage; reps = data.reps || []; list = data.items || []; total = Number(data.total || 0); paintStates((data.program || {}).states); takeCatalog(data);
      // A rep's seat list holds only their own seat. Anything else means "do not assume".
      myStaffId = !canManage && reps.length === 1 && reps[0] && reps[0].id ? reps[0].id : null;
      $('import-open').hidden = !canManage; $('view-switch').hidden = !canManage; $('queue-scope').textContent = canManage ? 'Team banks · earliest next action first' : 'Assigned banks only · earliest next action first';
      paintSummary(data.summary || {});
      var nextAccount = list.find(function (a) { return a.status !== 'paused' && a.status !== 'closed'; });
      $('work-next').hidden = !nextAccount; $('work-next').textContent = canManage ? 'Review next bank ↗' : 'Work next banker ↗';
      $('work-next').dataset.id = nextAccount ? nextAccount.id : '';
      if (!canManage) { $('hero-label').textContent = 'Your next banker'; $('hero-value').textContent = nextAccount ? nextAccount.name : list.length ? 'No active bank in this view' : filtered ? 'No matching bank' : 'Your queue is clear'; $('hero-note').textContent = nextAccount ? (nextAccount.next_action || 'Find and contact a banker') + ' · ' + nextAccount.state : list.length ? 'Open a bank below to review its relationship.' : filtered ? 'Clear your filters to see all assigned banks.' : 'Assigned banks and their next actions will appear here.'; }
      $('queue-count').textContent = total + ' bank' + (total === 1 ? '' : 's');
      if (!list.length) { $('queue-state').innerHTML = '<h3>' + (filtered ? 'No banks match your filters' : 'No banks in this view') + '</h3><p>' + (filtered ? 'Clear the search, state and relationship filters to see your bank queue.' : canManage ? 'Import official bank lists, then assign banks to your team.' : 'Assigned banks will appear here. Try clearing your filters or ask your manager for bank assignments.') + '</p><button class="button" type="button" id="empty-action">' + (canManage && !filtered ? 'Import banks' : 'Clear filters') + '</button>'; $('empty-action').onclick = canManage && !filtered ? openImport : clearFilters; }
      else {
        $('queue-state').hidden = true; $('queue-table').hidden = false; $('pagination').hidden = false;
        $('queue-rows').innerHTML = list.map(function (a) { return '<tr data-account="' + esc(a.id) + '"><td><strong title="' + esc(a.name) + '">' + esc(a.name) + '</strong><span class="caption">' + esc([a.city, a.state].filter(Boolean).join(', ')) + '</span>' + rowChips(a) + '</td><td><strong title="' + esc(a.next_action || 'Find and contact a banker') + '">' + esc(a.next_action || 'Find and contact a banker') + '</strong><span class="caption">' + due(a.next_due_at) + '</span></td><td>' + statusTag(a.status) + '</td>' + (canManage ? '<td class="manager-column"><span title="' + esc(a.assigned_staff_name || 'Unassigned') + '">' + esc(a.assigned_staff_name || 'Unassigned') + '</span></td>' : '') + '<td><button type="button" class="button open-bank" data-id="' + esc(a.id) + '" aria-label="Open ' + esc(a.name) + '">Open ↗</button></td></tr>'; }).join('');
        document.querySelectorAll('th.manager-column').forEach(function (el) { el.hidden = !canManage; });
        $('page-count').textContent = (offset + 1) + '–' + (offset + list.length) + ' of ' + total; $('previous').disabled = offset === 0; $('next').disabled = offset + 25 >= total;
      }
      if (!initialized) { initialized = true; if (canManage) setView('team'); }
    } catch (error) { if (sequence !== requestNumber) return; $('queue-state').innerHTML = '<h3>Bank queue could not load</h3><p>' + esc(error.message) + '</p><button type="button" class="button" id="queue-retry">Try again</button>'; $('queue-retry').onclick = loadQueue; if (!initialized) { $('hero-value').textContent = 'Bank data unavailable'; $('hero-note').textContent = 'Try the bank queue again to load your next action.'; $('verified-compare').textContent = 'Last week unavailable'; } }
    finally { if (sequence === requestNumber) $('queue-panel').setAttribute('aria-busy', 'false'); }
  }
  async function setView(next) {
    view = next; $('queue-section').hidden = next !== 'queue'; $('team-section').hidden = next !== 'team'; $('automation-section').hidden = next !== 'automation'; $('queue-view').setAttribute('aria-pressed', String(next === 'queue')); $('team-view').setAttribute('aria-pressed', String(next === 'team')); $('automation-view').setAttribute('aria-pressed', String(next === 'automation'));
    if (next === 'automation') return loadAutomation();
    if (next !== 'team') return;
    $('team-content').innerHTML = '<div class="skeleton skeleton-row"></div><p class="caption">Loading team results…</p>';
    try { var data = await api({ view: 'team' }); paintSummary(data.summary || {}); function breakdown(title, rows, key) { return '<div><h3>' + title + '</h3>' + (rows.length ? '<dl>' + rows.map(function (row) { return '<div><dt>' + esc(row[key]) + '</dt><dd>' + esc(row.verified_partners) + ' partners<span class="caption">' + esc(row.total) + ' banks · ' + esc(row.due_now) + ' due</span></dd></div>'; }).join('') + '</dl>' : '<p class="caption">Coverage will appear after banks are imported and assigned.</p>') + '</div>'; } $('team-content').innerHTML = '<div class="team-grid">' + breakdown('By rep', data.byRep || [], 'name') + breakdown('By state', data.byState || [], 'state') + '</div>'; }
    catch (error) { $('team-content').innerHTML = '<p>' + esc(error.message) + '</p><button class="button" id="team-retry" type="button">Try team results again</button>'; $('team-retry').onclick = function () { setView('team'); }; }
  }
  // Managers only. The server refuses reps; reps never see the control.
  function onOff(on) { return '<span class="status-tag' + (on ? ' verified' : '') + '">' + (on ? 'On' : 'Off') + '</span>'; }
  // Settings alone send nothing: an email goes out only when its copy is approved too.
  function emailStatus(email) {
    var approved = Number(email.templates_approved) || 0, total = Number(email.templates_total) || 0;
    if (!email.configured) return '<span class="status-tag">Off</span>';
    return total && approved >= total ? '<span class="status-tag verified">On</span>' : '<span class="status-tag">Waiting on copy</span>';
  }
  function automationRow(label, value) { return '<div><dt>' + esc(label) + '</dt><dd>' + value + '</dd></div>'; }
  function automationHtml(auto) {
    var search = auto.search || {}, email = auto.email || {}, replies = auto.replies || {}, missing = email.missing || [], signup = safeUrl(search.signup_url);
    var mode = agentModes[replies.agent_status] || [String(replies.agent_status || 'Unknown'), 'A person reads every reply.'];
    var empty = !Number(search.accounts) ? '<div class="notice automation-empty"><p><strong>No banks to work yet.</strong> Import official bank lists. Then the banker search has banks to search.</p><button class="button" type="button" id="automation-import">Import banks</button></div>' : '';
    return empty + '<div class="team-grid automation-grid">' +
      '<section aria-labelledby="automation-search"><h3 id="automation-search">Banker search ' + onOff(search.configured) + '</h3><dl>' + automationRow('Searches today', count(search.used_today) + ' of ' + count(search.per_day_cap)) + automationRow('Banks never searched', count(search.never_searched) + ' of ' + count(search.accounts)) + '</dl>' +
        (search.configured ? '<p class="caption">Fundhub searches LinkedIn results for bankers every 15 minutes until the daily cap.</p>' : '<p>Search is off. It starts when the search key is saved.</p>' + (signup ? '<div class="bank-links"><a href="' + esc(signup) + '" target="_blank" rel="noopener noreferrer">Get a search key at serper.dev ↗</a></div>' : '')) + '</section>' +
      '<section aria-labelledby="automation-email"><h3 id="automation-email">Automatic emails ' + emailStatus(email) + '</h3><dl>' + automationRow('Email copy approved', count(email.templates_approved) + ' of ' + count(email.templates_total)) + automationRow('Sent today', count(email.sent_today) + ' of ' + count(email.per_day_cap)) + automationRow('Bankers getting emails', count(email.active_sequences) + ' active<span class="caption">' + count(email.sequences) + ' started in all</span>') + automationRow('Send window', email.in_send_window ? 'Open now' : 'Closed now') + '</dl><p class="caption">Emails go out on Arizona weekdays, 6 a.m. to 2 p.m.</p>' +
        (missing.length ? '<p>Email is off until these settings are saved: ' + esc(listWords(missing.map(function (name) { return settingNames[name] || name; }))) + '.</p>' : '') + (Number(email.templates_approved) === 0 ? '<p>No email goes out until the email copy is approved.</p>' : Number(email.templates_approved) < Number(email.templates_total) ? '<p>Only approved emails go out. ' + count(email.templates_approved) + ' of ' + count(email.templates_total) + ' are approved.</p>' : '') + '</section>' +
      '<section aria-labelledby="automation-replies"><h3 id="automation-replies">Reply reading</h3><dl>' + automationRow('Mode', esc(mode[0])) + automationRow('Waiting to be read', count(replies.waiting)) + automationRow('Need a person', count(replies.needs_human)) + '</dl><p class="caption">' + esc(mode[1]) + '</p></section></div>';
  }
  async function loadAutomation() {
    var sequence = ++automationNumber, box = $('automation-content');
    box.setAttribute('aria-busy', 'true'); box.innerHTML = '<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><p class="caption">Loading automation status…</p>';
    try { var data = await api({ view: 'automation' }); if (sequence !== automationNumber) return; paintSummary(data.summary || {}); box.innerHTML = automationHtml(data.automation || {}); if ($('automation-import')) $('automation-import').onclick = openImport; }
    catch (error) { if (sequence !== automationNumber) return; box.innerHTML = '<h3>Automation status could not load</h3><p>' + esc(error.message) + '</p><button class="button" id="automation-retry" type="button">Try automation status again</button>'; $('automation-retry').onclick = loadAutomation; }
    finally { if (sequence === automationNumber) box.setAttribute('aria-busy', 'false'); }
  }
  function clearFilters() { $('queue-filters').reset(); }
  function restoreFocus(target) { if (!target || !target.isConnected || target.disabled || !target.getClientRects().length) return false; target.focus(); return document.activeElement === target; }
  async function openBank(id, preserveSection) {
    var sequence = ++detailNumber; if (!preserveSection) section = 'touch';
    if (!$('bank-drawer').open) { returnFocus = document.activeElement; returnBankId = id; $('bank-drawer').showModal(); }
    $('drawer-content').hidden = true; $('drawer-state').hidden = false; $('drawer-state').innerHTML = '<div class="skeleton skeleton-row"></div><p>Loading banker details…</p>'; message('drawer-message', '');
    try { var data = await api({ id: id }); if (sequence !== detailNumber) return; detail = data; takeCatalog(data); $('bank-title').textContent = data.account.name; $('bank-meta').textContent = [data.account.city, data.account.state, String(data.account.source || '').toUpperCase() + ' ' + data.account.external_id].filter(Boolean).join(' · '); $('bank-next-action').textContent = data.account.next_action || 'Find and contact a banker'; $('bank-next-due').innerHTML = due(data.account.next_due_at); var website = safeUrl(data.account.website); var search = 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent([data.account.name, data.account.state, 'business banker'].join(' ')); $('bank-links').innerHTML = '<a href="' + esc(search) + '" target="_blank" rel="noopener noreferrer">Find a banker on LinkedIn ↗</a>' + (website ? '<a href="' + esc(website) + '" target="_blank" rel="noopener noreferrer">Bank website ↗</a>' : ''); renderDetail(); $('drawer-state').hidden = true; $('drawer-content').hidden = false; showSection(section); }
    catch (error) { if (sequence !== detailNumber) return; $('drawer-state').innerHTML = '<p>' + esc(error.message) + '</p><button class="button" id="detail-retry" type="button">Try bank details again</button>'; $('detail-retry').onclick = function () { openBank(id, true); }; }
  }
  function showSection(next) { section = next; document.querySelectorAll('[data-section]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.section === next)); }); document.querySelectorAll('.detail-section').forEach(function (el) { el.hidden = el.id !== 'detail-' + next; }); message('drawer-message', ''); }
  // Found bankers come from search results only. Accepting saves a banker; LinkedIn stays a rep click.
  function leadCard(leads) {
    if (!leads.length) return '';
    var waiting = leads.filter(function (l) { return l.status === 'suggested'; }).length;
    return '<section class="found-bankers" aria-labelledby="found-bankers-title"><h3 id="found-bankers-title">Found bankers</h3><p class="caption section-note">' + (waiting ? plural(waiting, 'banker', 'bankers') + ' from a LinkedIn search ' + (waiting === 1 ? 'needs' : 'need') + ' review. Save as banker adds the person to your bankers. Connecting on LinkedIn stays your click.' : 'Every found banker is reviewed.') + '</p><div id="lead-list">' + leads.map(function (l) {
      var link = safeUrl(l.linkedin_url), open = l.status === 'suggested';
      return '<article class="saved-record" data-lead="' + esc(l.id) + '"><div class="record-heading"><div><strong>' + esc(l.name) + '</strong><p class="caption">' + esc([l.title || 'Title not found', l.employer].filter(Boolean).join(' · ')) + '</p></div><span class="status-tag' + (l.status === 'accepted' ? ' verified' : '') + '">' + esc(leadStatus[l.status] || l.status) + '</span></div>' +
        '<p class="caption">' + esc(l.confidence === 'high' ? 'High confidence match' : 'Medium confidence match') + ' · Found ' + date(l.created_at) + '</p>' + (open && l.snippet ? '<p>' + esc(l.snippet) + '</p>' : '') +
        (link ? '<div class="bank-links banker-contact-links"><a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer" aria-label="Open ' + esc(l.name) + ' on LinkedIn">Open on LinkedIn ↗</a></div>' : '') +
        (open ? '<div class="record-actions"><button class="button" type="button" data-accept-lead="' + esc(l.id) + '" aria-label="Save ' + esc(l.name) + ' as a banker">Save as banker</button><button class="button" type="button" data-dismiss-lead="' + esc(l.id) + '" aria-label="' + esc(l.name) + ' is not a match">Not a match</button></div>' : '') + '</article>';
    }).join('') + '</div></section>';
  }
  function emailState(c) {
    var mine = (detail.sequences || []).filter(function (s) { return s.contact_id === c.id; }), seq = mine.find(function (s) { return s.status === 'active'; }) || mine[mine.length - 1], sent = seq ? Number(seq.step) || 0 : 0;
    if (c.email_opt_out_at) return '<div class="email-state"><p><strong>Opted out of email</strong></p><p class="caption">Since ' + date(c.email_opt_out_at) + '. Fundhub sends this banker no automatic email.</p></div>';
    if (!seq) return '';
    if (seq.status === 'active') return '<div class="email-state"><p><strong>' + (sent ? 'Email ' + sent + ' of ' + EMAIL_STEPS + ' sent' : 'No automatic email sent yet') + '</strong></p><p class="caption">' + (sent < EMAIL_STEPS ? 'Email ' + (sent + 1) + ' due ' + date(seq.next_due_at) : 'Last email sent') + (seq.last_sent_at ? ' · Last sent ' + date(seq.last_sent_at) : '') + '</p><div class="record-actions"><button class="button" type="button" data-stop-emails="' + esc(c.id) + '" aria-label="Stop emails to ' + esc(c.name) + '">Stop emails</button></div></div>';
    return '<div class="email-state"><p><strong>' + esc(stopReasons[seq.stop_reason] || 'Automatic emails stopped.') + '</strong></p><p class="caption">' + (seq.stop_reason === 'completed' ? '' : (sent ? 'Email ' + sent + ' of ' + EMAIL_STEPS + ' sent · ' : 'No automatic email sent · ')) + 'Stopped ' + date(seq.stopped_at) + '</p></div>';
  }
  function draftReason(reason) {
    var key = String(reason || '').split(':')[0], names = String(reason || '').split(':').slice(1).join(':').split(',').map(function (n) { return n.trim(); }).filter(Boolean);
    if (key === 'not_configured') return 'Email settings are not saved yet: ' + listWords(names.map(function (n) { return settingNames[n] || n; })) + '.';
    return draftReasons[key] || 'Fundhub did not send this reply.';
  }
  function replyCard(r) {
    var s = r.suggested || {}, facts = s.facts || {}, keys = allFactKeys().filter(function (k) { return Object.prototype.hasOwnProperty.call(facts, k); });
    var draft = r.draft_reply && !r.draft_reply.queued_message_id ? r.draft_reply : null, sent = r.reply_message_id || (r.draft_reply && r.draft_reply.queued_message_id), referral = s.referral || null, referralEmail = referral && emailUrl(referral.email);
    var html = '<article class="saved-record" data-reply="' + esc(r.id) + '"><div class="record-heading"><div><strong>' + esc(r.subject || 'No subject') + '</strong><p class="caption">From ' + esc(r.from_address || 'the banker') + ' · ' + date(r.received_at) + '</p></div><span class="status-tag' + (r.status === 'handled' ? ' verified' : '') + '">' + esc(replyStatus[r.status] || r.status) + '</span></div>';
    html += '<p class="caption">' + esc([r.kind ? replyKinds[r.kind] || r.kind : 'Not read yet', readModes[r.ai_mode]].filter(Boolean).join(' · ')) + '</p>';
    if (r.status === 'new') html += '<p>Fundhub reads new replies on its next pass.</p>';
    if (r.error) html += '<p>Fundhub could not read this reply by itself. Read it and answer the banker.</p>';
    if (r.summary) html += '<p class="caption">AI summary</p><p>' + esc(r.summary) + '</p>';
    html += '<p class="caption">Banker’s message</p><div class="reply-body" tabindex="0" role="region" aria-label="Message from ' + esc(r.from_address || 'the banker') + '">' + multiline(r.body || 'No message text saved.') + '</div>';
    if (keys.length || s.product_name || s.lender_table || referral) {
      html += '<div class="reply-facts"><p class="caption">Suggested facts</p>' + (s.product_name || s.lender_table ? '<p><strong>' + esc([s.product_name, categories[s.lender_table] || s.lender_table].filter(Boolean).join(' · ')) + '</strong></p>' : '') +
        (keys.length ? '<dl class="record-facts">' + keys.map(function (key) { return '<dt>' + esc(factLabel(key)) + '</dt><dd>' + esc(readable(facts[key])) + '</dd>'; }).join('') + '</dl>' : '') +
        (s.evidence_quote ? '<p class="caption">Banker’s words</p><p>“' + esc(s.evidence_quote) + '”</p>' : '') +
        (referral ? '<p class="caption">Banker pointed to</p><p>' + esc(referral.name || 'Another banker') + '</p>' + (referralEmail ? '<div class="bank-links banker-contact-links"><a href="' + esc(referralEmail) + '" aria-label="Email ' + esc(referral.name || referral.email) + '">' + esc(referral.email) + '</a></div>' : '') : '') + '</div>';
    }
    if (r.suggestion_status === 'applied') html += '<p class="caption">Facts applied to a product draft. ' + lendersRule() + '</p>';
    if (r.suggestion_status === 'dismissed') html += '<p class="caption">Facts set aside.</p>';
    if (draft) html += '<div class="reply-draft"><p class="caption">What Fundhub would send</p><p>' + esc(draftReason(draft.reason)) + '</p>' + (draft.subject ? '<p><strong>' + esc(draft.subject) + '</strong></p>' : '') + (draft.body ? '<div class="reply-body" tabindex="0" role="region" aria-label="Reply Fundhub would send">' + multiline(draft.body) + '</div>' : '') + '</div>';
    else if (sent) html += '<p class="caption">Fundhub queued a reply email to this banker.</p>';
    if (r.suggestion_status === 'pending') html += '<form data-action="apply_reply_suggestion" data-reply-id="' + esc(r.id) + '">' + (s.product_name && s.lender_table ? '' : '<p class="caption">Add what the banker left out so the facts land on the right product.</p>' + (s.product_name ? '' : field('Product name', 'product_name', '', 'required maxlength="250"')) + (s.lender_table ? '' : '<label>Product category<select name="lender_table" required>' + options(categories, '', 'Choose a category') + '</select></label>')) + '<div class="record-actions"><button class="button" type="submit">Apply facts</button><button class="button" type="button" data-dismiss-reply="' + esc(r.id) + '">Set aside</button></div></form>';
    if (r.status === 'needs_human') html += '<div class="record-actions"><button class="button" type="button" data-reply-done="' + esc(r.id) + '">Mark done</button></div>';
    return html + '</article>';
  }
  // Who moves facts into Lenders. With the catalog server, a rep pushes their own bank's products too.
  function lendersRule() { return fieldCatalog ? 'Nothing reaches Lenders until the complete product is pushed.' : 'A manager verifies them before they reach Lenders.'; }
  function renderDetail() {
    var a = detail.account, contacts = detail.contacts || [], products = detail.products || [], leads = detail.leads || [], replies = detail.replies || [];
    var leadsWaiting = leads.filter(function (l) { return l.status === 'suggested'; }).length, repliesWaiting = replies.filter(function (r) { return r.status === 'new' || r.status === 'needs_human'; }).length;
    document.querySelector('[data-section="contacts"]').textContent = 'Bankers' + (leadsWaiting ? ' · ' + leadsWaiting + ' found' : '');
    document.querySelector('[data-section="replies"]').textContent = 'Replies' + (repliesWaiting ? ' · ' + repliesWaiting : '');
    $('detail-touch').innerHTML = '<h3>Save what happened. Choose what comes next.</h3><form data-action="log_touch"><div class="field-grid"><label>Channel<select name="channel">' + options({ linkedin: 'LinkedIn', email: 'Email', call: 'Call', note: 'Research note' }, 'linkedin') + '</select></label><label>Banker<select name="contact_id">' + options(Object.fromEntries(contacts.map(function (c) { return [c.id, c.name]; })), '', 'No specific banker') + '</select></label></div>' + field('Outcome', 'outcome', '', 'required maxlength="1000" placeholder="e.g. Banker shared credit policy"') + textarea('Notes', 'note', '') + field('Next action', 'next_action', '', 'required maxlength="1000" placeholder="e.g. Ask for application and bureau details"') + field('Next action time in Arizona (leave blank for now)', 'next_due_at', '', 'type="datetime-local"') + '<p class="caption">Blank time means due now. Each touch stays in the history.</p>' + submit('Save touch and next action') + '</form>';
    $('detail-contacts').innerHTML = leadCard(leads) + '<div id="contact-list">' + (contacts.length ? contacts.map(function (c) { var email = emailUrl(c.email), phone = phoneUrl(c.phone); return '<article class="saved-record" data-contact="' + esc(c.id) + '"><div class="record-heading"><div><strong>' + esc(c.name) + '</strong><p class="caption">' + esc(c.title || 'Title not saved') + '</p></div><button class="button" type="button" data-edit-contact="' + esc(c.id) + '">Edit banker</button></div>' + (c.email || c.phone || safeUrl(c.linkedin_url) ? '<div class="bank-links banker-contact-links">' + (email ? '<a href="' + esc(email) + '" aria-label="Email ' + esc(c.name) + '">' + esc(c.email) + '</a>' : c.email ? '<span>' + esc(c.email) + '</span>' : '') + (phone ? '<a href="' + esc(phone) + '" aria-label="Call ' + esc(c.name) + '">' + esc(c.phone) + '</a>' : c.phone ? '<span>' + esc(c.phone) + '</span>' : '') + (safeUrl(c.linkedin_url) ? '<a href="' + esc(safeUrl(c.linkedin_url)) + '" target="_blank" rel="noopener noreferrer">LinkedIn profile ↗</a>' : '') + '</div>' : '<p>Add an email, phone or LinkedIn profile to reach this banker.</p>') + warmupHtml(c) + emailState(c) + '</article>'; }).join('') : '<p class="section-note">No banker saved. Add the person who can confirm this bank’s product facts.</p>') + '</div><button class="button new-record" type="button" id="new-contact">Add banker</button><div id="contact-editor"></div>';
    $('detail-products').innerHTML = '<p class="caption section-note">Save actual answers or enter unknown. ' + (fieldCatalog ? 'Push to Lenders' : 'Verification') + ' needs every fact, source evidence, a reachable banker and an application path.</p><div id="product-list">' + (products.length ? products.map(function (p) { var candidate = canManage && p.draft ? p.draft : p, push = canPush(p), gaps = push && fieldCatalog ? pushGaps(candidate) : []; return '<article class="saved-record" data-product="' + esc(p.id) + '"><div class="record-heading"><div><strong>' + esc(candidate.product_name) + '</strong><p class="caption">' + esc(categories[candidate.lender_table] || candidate.lender_table) + '</p></div><span class="status-tag">' + (canManage && p.draft ? 'Pending amendment' : p.verified_at ? 'Verified in Lenders' : 'Needs verification') + '</span></div>' + (canManage && p.draft ? '<p class="caption">Proposed changes below. Published lender facts stay in place until manager verification.</p>' : '') + factList(candidate) + '<p class="caption">Source evidence</p><p>' + esc(candidate.evidence || 'No evidence saved') + '</p>' + (gaps.length ? '<p class="caption push-gaps">Push to Lenders still needs ' + esc(listWords(gaps)) + '.</p>' : '') + '<div class="record-actions">' + (canManage || !p.verified_at ? '<button class="button" type="button" data-edit-product="' + esc(p.id) + '">Edit facts</button>' : '<p class="caption">Published facts are read-only. Ask your manager to amend them.</p>') + (push ? '<button class="button" type="button" data-verify="' + esc(p.id) + '">Push to Lenders</button>' : '') + '</div></article>'; }).join('') : '<p>No product facts saved yet.</p>') + '</div><button class="button new-record" type="button" id="new-product">Add product facts</button><div id="product-editor"></div>';
    $('detail-history').innerHTML = '<h3>Saved history</h3>' + ((detail.activities || []).length ? detail.activities.map(function (x) { return '<article class="saved-record"><strong>' + esc(x.outcome) + '</strong><p class="caption">' + esc(x.channel) + ' · ' + esc(x.actor === 'automation' ? 'Fundhub automation' : x.staff_name || 'Team member') + ' · ' + date(x.created_at) + '</p>' + (x.note ? '<p>' + esc(x.note) + '</p>' : '') + '<p>Next: ' + esc(x.next_action) + '</p><p class="caption">' + due(x.next_due_at) + '</p></article>'; }).join('') : '<p>No activity saved. Log a touch to start this history.</p>');
    $('detail-replies').innerHTML = '<h3>Banker replies</h3>' + (replies.length ? '<p class="caption section-note">Replies to Fundhub’s automatic emails. Suggested facts become a product draft only when you apply them. ' + (fieldCatalog ? lendersRule() : 'A manager still verifies.') + '</p><div id="reply-list">' + replies.map(replyCard).join('') + '</div>' : '<p>No banker replies yet. Replies to automatic emails show here.</p>');
    var availableStatuses = Object.fromEntries(Object.entries(labels).filter(function (entry) { return entry[0] !== 'verified_partner' || a.status === 'verified_partner' || products.some(function (p) { return p.verified_at; }); }));
    $('detail-relationship').innerHTML = '<h3>Relationship and next action</h3><form data-action="set_status"><label>Relationship status<select name="status">' + options(availableStatuses, a.status) + '</select></label><label>Partner check-in pace<select name="partner_activity">' + options({ active: 'Active · monthly check-in', quiet: 'Quiet · quarterly check-in' }, a.partner_activity) + '</select></label>' + field('Next action', 'next_action', a.next_action, 'required maxlength="1000"') + field('Next action time in Arizona (leave blank for now)', 'next_due_at', '', 'type="datetime-local"') + '<p class="caption">Verified partners need a verified product. Check-ins keep the facts current.</p>' + submit('Save relationship') + '</form>' + (canManage ? '<hr><h3>Assign this bank</h3><form data-action="assign"><label>Assigned rep<select name="staff_id">' + options(Object.fromEntries(reps.map(function (r) { return [r.id, r.name]; })), a.assigned_staff_id, 'Unassigned') + '</select></label>' + submit('Save assignment', true) + '</form>' : '');
    $('new-contact').onclick = function () { editContact({}); }; $('new-product').onclick = function () { editProduct({}); };
  }
  function editContact(c) { $('contact-editor').innerHTML = '<h3>' + (c.id ? 'Edit banker' : 'Add banker') + '</h3><form data-action="save_contact" data-record-id="' + esc(c.id || '') + '">' + field('Banker name', 'name', c.name, 'required maxlength="250"') + field('Title', 'title', c.title, 'maxlength="250"') + field('LinkedIn profile URL', 'linkedin_url', c.linkedin_url, 'type="url"') + field('Email', 'email', c.email, 'type="email"') + field('Phone', 'phone', c.phone, 'type="tel"') + '<p class="caption">Add at least one way to reach the banker before product verification.</p>' + submit('Save banker') + '</form>'; $('contact-editor').querySelector('input').focus(); }
  function editProduct(p) { var candidate = p.draft || p, facts = candidate.facts || {}, table = candidate.lender_table || 'OnlineBizCC'; productAnswers = {}; allFactKeys().forEach(function (key) { productAnswers[key] = rawFact(facts[key]); }); $('product-editor').innerHTML = '<h3>' + (p.id ? 'Edit product facts' : 'Add product facts') + '</h3><form data-action="save_product" data-record-id="' + esc(p.id || '') + '">' + field('Product name', 'product_name', candidate.product_name, 'required maxlength="250"') + '<label>Product category<select name="lender_table">' + options(categories, table) + '</select></label><p class="caption">Leave unanswered facts blank, or type unknown. Use EX, EQ, TU for bureaus and two-letter states separated by commas.</p><div class="field-grid" id="product-fields">' + factInputs(table) + '</div>' + textarea('Source evidence (who, when, and where)', 'evidence', candidate.evidence) + (p.verified_at ? '<p class="caption">Saving changes requires manager verification again before the new facts reach Lenders.</p>' : '') + submit('Save product facts') + '</form>'; $('product-editor').querySelector('input').focus(); }
  function formPayload(form) {
    var body = Object.fromEntries(new FormData(form)); body.action = form.dataset.action; if (form.dataset.recordId) body.id = form.dataset.recordId; if (form.dataset.replyId) body.reply_id = form.dataset.replyId;
    if (body.action === 'assign' || body.action === 'set_status') body.id = detail.account.id; else body.account_id = detail.account.id;
    if (body.next_due_at) body.next_due_at = new Date(body.next_due_at + '-07:00').toISOString();
    // Only the chosen category's fields are sent. Blank stays unanswered; it is never sent as a guess.
    if (body.action === 'save_product') { var facts = {}, asked = factKeys(body.lender_table); allFactKeys().forEach(function (key) { var raw = body[key]; delete body[key]; if (raw == null || asked.indexOf(key) < 0) return; var value = parseFact(key, raw); if (value !== undefined) facts[key] = value; }); body.facts = facts; }
    return body;
  }
  async function save(form) { var button = form.querySelector('[type=submit]'), label = button.textContent; button.disabled = true; button.textContent = 'Saving…'; message('drawer-message', ''); try { await api(null, formPayload(form)); await openBank(detail.account.id, true); message('drawer-message', 'Saved. Your bank queue is up to date.'); loadQueue(); if (view === 'team') setView('team'); } catch (error) { message('drawer-message', error.message, true); } finally { button.disabled = false; button.textContent = label; } }
  // After a refresh the pressed button is gone. Keep focus on the same record.
  function focusIn(selector) { var root = $('drawer-content'), record = root.querySelector(selector), target = (record && record.querySelector('button:not(:disabled),a[href],input,select')) || root.querySelector('#detail-' + section + ' :is(button:not(:disabled),a[href])') || $('drawer-close'); target.focus(); }
  // One automation action. A failure keeps the card and its inputs; a conflict shows the saved state.
  async function act(button, body, done, selector) {
    var label = button.textContent; button.disabled = true; button.textContent = 'Saving…'; message('drawer-message', '');
    try { await api(null, body); await openBank(detail.account.id, true); focusIn(selector); message('drawer-message', done); loadQueue(); if (view === 'team') setView('team'); else if (view === 'automation') loadAutomation(); }
    catch (error) { if (error.status === 409) { await openBank(detail.account.id, true); focusIn(selector); } message('drawer-message', error.message, true); }
    finally { button.disabled = false; button.textContent = label; }
  }
  var quickActions = [
    ['acceptLead', 'accept_lead', 'lead_id', 'lead', 'Banker saved. Connect with them on LinkedIn next.'],
    ['dismissLead', 'dismiss_lead', 'lead_id', 'lead', 'Marked not a match.'],
    ['stopEmails', 'stop_emails', 'contact_id', 'contact', 'Automatic emails stopped for this banker.'],
    ['dismissReply', 'dismiss_reply_suggestion', 'reply_id', 'reply', 'Suggested facts set aside.'],
    ['replyDone', 'mark_reply_handled', 'reply_id', 'reply', 'Reply marked done.']
  ];
  // Stopping emails cannot be undone, so it asks first and names the result.
  function confirmStop(id) {
    var c = (detail.contacts || []).find(function (x) { return x.id === id; }), name = c ? c.name : 'this banker';
    return window.confirm('Stop automatic emails to ' + name + '? The emails not sent yet will never go out. This cannot be undone.');
  }
  function quickAction(button) { quickActions.forEach(function (q) { var id = button.dataset[q[0]]; if (!id) return; if (q[0] === 'stopEmails' && !confirmStop(id)) return; var body = { action: q[1], account_id: detail.account.id }; body[q[2]] = id; act(button, body, q[4], '[data-' + q[3] + '="' + CSS.escape(id) + '"]'); }); }
  // The link opens the rep's own email or text app. The same click logs the touch and a follow-up.
  // A failed log keeps the card and every typed input, and says what to do.
  async function logWarmup(link, event) {
    if (link.getAttribute('aria-disabled') === 'true') { event.preventDefault(); return; }
    var id = link.dataset.contactId, kind = link.dataset.warmup, c = (detail.contacts || []).find(function (x) { return x.id === id; }); if (!c) return;
    var word = kind === 'email' ? 'Warm-up email' : 'Warm-up text', label = link.textContent, next = 'Follow up with ' + c.name;
    var body = { action: 'log_touch', account_id: detail.account.id, contact_id: c.id, channel: kind === 'email' ? 'email' : 'note', outcome: word + ' sent', note: null, next_action: next, next_due_at: new Date(Date.now() + 3 * DAY).toISOString() };
    link.setAttribute('aria-disabled', 'true'); link.textContent = 'Logging…'; message('drawer-message', '');
    try {
      await api(null, body); await openBank(detail.account.id, true);
      var again = $('drawer-content').querySelector('a[data-warmup="' + kind + '"][data-contact-id="' + CSS.escape(id) + '"]'); if (again) again.focus(); else focusIn('[data-contact="' + CSS.escape(id) + '"]');
      message('drawer-message', word + ' logged. Next action: ' + next + ' in 3 days.'); loadQueue(); if (view === 'team') setView('team');
    } catch (error) { message('drawer-message', word + ' not logged. ' + error.message + ' Save it in Log touch so the follow-up is kept.', true); }
    finally { if (link.isConnected) { link.removeAttribute('aria-disabled'); link.textContent = label; } }
  }
  function openImport() { if (this && typeof this.focus === 'function') this.focus(); importReturnFocus = document.activeElement; message('import-message', ''); $('import-dialog').showModal(); $('import-form select').focus(); }
  $('status').innerHTML = options(labels, '', 'All statuses');
  $('queue-filters').onsubmit = function (event) { event.preventDefault(); clearTimeout(searchTimer); offset = 0; loadQueue(); };
  $('queue-filters').onreset = function () { clearTimeout(searchTimer); setTimeout(function () { offset = 0; loadQueue(); }, 0); };
  $('search').oninput = function () { clearTimeout(searchTimer); searchTimer = setTimeout(function () { offset = 0; loadQueue(); }, 350); };
  ['state', 'status'].forEach(function (id) { $(id).onchange = function () { clearTimeout(searchTimer); offset = 0; loadQueue(); }; });
  $('previous').onclick = function () { offset = Math.max(0, offset - 25); loadQueue(); }; $('next').onclick = function () { offset += 25; loadQueue(); };
  // Safari pointer clicks do not focus buttons; make the dialog's return target explicit.
  $('work-next').onclick = function () { this.focus(); openBank(this.dataset.id); }; $('queue-rows').onclick = function (event) { var row = event.target.closest('[data-account]'); if (row) { var opener = row.querySelector('.open-bank'); if (opener) opener.focus(); openBank(row.dataset.account); } };
  $('queue-view').onclick = function () { setView('queue'); }; $('team-view').onclick = function () { setView('team'); }; $('automation-view').onclick = function () { setView('automation'); };
  $('drawer-close').onclick = function () { $('bank-drawer').close(); }; $('bank-drawer').addEventListener('close', function () { detailNumber++; if (restoreFocus(returnFocus)) return; var replacement = Array.from(document.querySelectorAll('.open-bank')).find(function (button) { return button.dataset.id === returnBankId; }); if (!restoreFocus(replacement)) restoreFocus($('work-next')); });
  document.querySelectorAll('[data-section]').forEach(function (button) { button.onclick = function () { showSection(button.dataset.section); }; });
  $('drawer-content').addEventListener('submit', function (event) { var form = event.target.closest('form[data-action]'); if (!form) return; event.preventDefault(); if (form.dataset.replyId) act(form.querySelector('[type=submit]'), formPayload(form), 'Facts saved as a product draft. ' + lendersRule(),'[data-reply="' + CSS.escape(form.dataset.replyId) + '"]'); else save(form); });
  // A new category shows its own fields. Answers stay for every field the categories share.
  $('drawer-content').addEventListener('change', function (event) { var form = event.target.closest('form[data-action="save_product"]'); if (!form || event.target.name !== 'lender_table') return; form.querySelectorAll('#product-fields [name]').forEach(function (el) { productAnswers[el.name] = el.value; }); $('product-fields').innerHTML = factInputs(event.target.value); });
  $('drawer-content').addEventListener('click', async function (event) { var warm = event.target.closest('a[data-warmup]'); if (warm && detail) { logWarmup(warm, event); return; } var button = event.target.closest('button'); if (!button || !detail) return; if (button.dataset.editContact) editContact(detail.contacts.find(function (c) { return c.id === button.dataset.editContact; })); if (button.dataset.editProduct) editProduct(detail.products.find(function (p) { return p.id === button.dataset.editProduct; })); if (button.dataset.verify) { button.disabled = true; var label = button.textContent; button.textContent = 'Pushing…'; try { await api(null, { action: 'verify_product', id: button.dataset.verify }); await openBank(detail.account.id, true); message('drawer-message', 'Verified product saved to Lenders.'); loadQueue(); if (view === 'team') setView('team'); } catch (error) { message('drawer-message', error.message, true); } finally { button.disabled = false; button.textContent = label; } } quickAction(button); });
  $('import-open').onclick = openImport; $('import-close').onclick = function () { $('import-dialog').close(); };
  $('import-dialog').addEventListener('close', function () { if (!restoreFocus(importReturnFocus)) restoreFocus($('import-open')); });
  $('import-file').onchange = async function () { var file = this.files && this.files[0]; if (!file) return; if (file.size > 5000000) { message('import-message', 'Choose a CSV file under 5 MB. Your current CSV is still here.', true); return; } try { $('import-form').elements.csv.value = await file.text(); message('import-message', 'Loaded ' + file.name + '. Review the CSV, then choose Import banks.'); } catch (_) { message('import-message', 'That CSV file could not load. Choose the file again or paste the CSV.', true); } };
  $('import-form').onsubmit = async function (event) { event.preventDefault(); var form = event.target, button = form.querySelector('[type=submit]'); button.disabled = true; button.textContent = 'Importing…'; try { var data = await api(null, Object.assign({ action: 'import' }, Object.fromEntries(new FormData(form)))); message('import-message', 'Imported ' + data.imported + ' banks · ' + data.existing + ' already saved · ' + data.skipped + ' outside launch states.'); loadQueue(); if (view === 'team') setView('team'); else if (view === 'automation') loadAutomation(); } catch (error) { message('import-message', error.message, true); } finally { button.disabled = false; button.textContent = 'Import banks'; } };
  loadQueue();
})();
