/* The full buyer operates the existing fulfillment records from their own account. */
(() => {
  'use strict';
  const host = document.getElementById('blueprint-fulfillment');
  const demo = window.FHBlueprintDemo?.active === true ? window.FHBlueprintDemo : null;
  if (!host || demo?.isPreview || (!demo && new URLSearchParams(location.search).get('demo') === '1')) return;
  const token = demo ? null : localStorage.getItem('fh_token');
  if (!demo && (!token || token === 'demo')) return;
  const abort = new AbortController();
  const pendingWindows = new Set();
  const actionKeys = new Map();
  let principal = null;
  let funding = null;
  let inquiries = null;
  let services = null;
  let repair = null;
  let preparation = null;
  let moneyOverview = null;
  let errors = {};
  let view = 'today';
  let busy = false;
  let invalid = false;
  let notice = '';
  let generation = 0;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = cents => cents == null ? 'Awaiting quote' : new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(Number(cents) / 100);
  const date = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('en-US', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : null;
  const button = (label, action, attributes = '', primary = false) => `<button type="button" data-bf-action="${action}" ${attributes} class="${primary ? 'bf-primary' : ''}">${esc(label)}</button>`;
  const active = () => funding?.engagement?.status === 'active';
  const clientFundingActive = () => active() && funding?.engagement?.executionOwner === 'client' && funding?.state !== 'managed';
  const rows = value => Array.isArray(value) ? value : [];
  const stateNames = {needs_file:'Your report is needed',optimize:'Work on your file',held:'Waiting on a required step',ready:'Your next bank is ready',awaiting_response:'Waiting for bank responses',managed:'The Fundhub team is running this round',completed:'Your purchased funding round is complete'};

  function invalidate() {
    if (invalid) return;
    invalid = true;
    abort.abort();
    generation++;
    funding = inquiries = services = repair = preparation = null;
    actionKeys.clear();
    for (const win of pendingWindows) { try { win.close(); } catch {} }
    pendingWindows.clear();
    delete document.body.dataset.blueprintFulfillment;
    host.replaceChildren();
    host.hidden = false;
    const title = document.createElement('h2');
    title.textContent = 'Sign in to open your funding workspace';
    const link = document.createElement('a');
    link.href = '/portal-login.html';
    link.className = 'bf-link';
    link.textContent = 'Sign in';
    host.append(title, link);
  }

  function current() {
    if (!invalid && (demo ? !demo.isCurrent() : localStorage.getItem('fh_token') !== token)) invalidate();
    return !invalid;
  }

  async function request(path, options = {}) {
    if (!current()) throw new Error('Sign in again to continue.');
    if (demo) {
      const body = await demo.request(path, options);
      if (!current()) throw new Error('Sign in again to continue.');
      return body;
    }
    const headers = {accept:'application/json', authorization:'Bearer ' + token};
    if (typeof options.body === 'string') headers['content-type'] = 'application/json';
    const response = await fetch(path, {credentials:'same-origin', ...options, headers, signal:abort.signal});
    const body = await response.json();
    if (!current()) throw new Error('Sign in again to continue.');
    if (!response.ok || body.ok === false) {
      const error = new Error(body.message || 'This step could not be completed. Please try again.');
      error.status = response.status;
      error.code = body.error;
      if (response.status === 401) invalidate();
      throw error;
    }
    return body;
  }

  async function refresh(initial = false) {
    const run = ++generation;
    try {
      const next = await request('/api/blueprint/funding');
      if (!current() || run !== generation) return;
      if (!next.engagement || next.engagement.clientId !== principal.clientId || next.engagement.orgId !== principal.orgId) {
        invalidate();
        return;
      }
      funding = next;
      host.hidden = false;
      document.body.dataset.blueprintFulfillment = view === 'preparation' ? 'preparation' : 'active';
      const chat = document.getElementById('fh-chat-panel');
      if (chat?.dataset.autoPrecall === 'true') {
        document.getElementById('fh-chat-close')?.click();
        delete chat.dataset.autoPrecall;
      }
      render();
      const results = await Promise.allSettled([
        request('/api/blueprint/inquiries'), request('/api/blueprint/services'),
        request('/api/blueprint/repair'), request('/api/blueprint/plan'), request('/api/money/overview')
      ]);
      if (!current() || run !== generation) return;
      errors = {};
      if (results[0].status === 'fulfilled') inquiries = results[0].value;
      else { inquiries = null; errors.inquiries = results[0].reason.message; }
      if (results[1].status === 'fulfilled') services = results[1].value;
      else { services = null; errors.services = results[1].reason.message; }
      if (results[2].status === 'fulfilled') repair = results[2].value;
      else { repair = null; errors.repair = results[2].reason.message; }
      if (results[3].status === 'fulfilled') preparation = results[3].value;
      else preparation = null;
      moneyOverview = results[4].status === 'fulfilled' ? results[4].value : null;
      render();
    } catch (error) {
      if (!current() || run !== generation) return;
      if ([403,404].includes(error.status)) { funding = null; delete document.body.dataset.blueprintFulfillment; host.hidden = true; return; }
      errors.funding = error.message;
      host.hidden = false;
      render();
    }
  }

  function render() {
    if (!current()) return;
    if(view === 'preparation') { host.hidden=false;host.innerHTML=button('Back to Blueprint overview','view','data-view="today"');document.body.dataset.blueprintFulfillment='preparation';return; }
    const tabs = [['today','Overview'],['repair','Credit repair'],['inquiries','Inquiry removal'],['funding','Applications'],['services','Reports and help'],['preparation','Preparation steps']];
    host.innerHTML = `<div class="bf-header"><div><h2>Your Capital Blueprint</h2>${view === 'today' ? '' : `<p class="bf-caption">${esc(stateNames[funding?.state] || 'Your saved funding plan')}</p>`}</div>${button('Refresh','refresh')}</div>
      <nav class="bf-tabs" aria-label="Funding workspace">${tabs.map(([key,label]) => button(label,'view',`data-view="${key}" ${view === key ? 'aria-current="page"' : ''}`)).join('')}</nav>
      ${view === 'preparation' ? '<p>Your saved preparation steps are below.</p>' : (screens[view] || today)()}
      <div class="bf-status" role="status" aria-live="polite">${esc(notice)}</div>`;
    document.body.dataset.blueprintFulfillment = view === 'preparation' ? 'preparation' : 'active';
  }

  function errorView(key) {
    return `<div role="alert"><p>${esc(errors[key])}</p>${button('Try again','refresh')}</div>`;
  }

  function loadingView(label) {
    return `<section class="bf-panel" role="status" aria-busy="true"><p>${esc(label)}</p><div class="bf-skeleton" aria-hidden="true"><span></span><span></span><span></span></div></section>`;
  }

  function today() {
    if (errors.funding) return errorView('funding');
    const apps = rows(funding?.applications);
    const cases = rows(inquiries?.cases);
    const nextCheck = cases.map(c => c.nextCheckAt).filter(Boolean).sort()[0];
    let destination = 'preparation';
    let label = 'Open preparation steps';
    if (funding?.state === 'ready') { destination = 'funding'; label = 'Review my next bank'; }
    else if (cases.some(c => rows(c.inquiries).some(i => i.state !== 'removed_verified'))) { destination = 'inquiries'; label = 'Open my bureau work'; }
    else if (funding?.state === 'awaiting_response') { destination = 'funding'; label = 'Review my applications'; }
    else if (funding?.state === 'needs_file') { destination = 'services'; label = 'Open report options'; }
    const stepId = preparation?.progress?.nextStep?.waypointId;
    const step = rows(preparation?.progress?.waypoints).find(w => w.id === stepId);
    if (funding?.state === 'optimize' && repair?.actions?.canGenerate) { destination = 'repair'; label = 'Open my repair work'; }
    const detail = ['optimize','held'].includes(funding?.state) && step?.detail ? step.detail : funding?.nextAction;
    const title = ['optimize','held'].includes(funding?.state) && step?.title ? step.title : stateNames[funding?.state];
    if (!preparation) return loadingView('Loading your Blueprint and current report…');
    let control = funding?.state==='completed' ? button('Review my applications','view','data-view="funding"',true) : button(label,'view',`data-view="${destination}"`,true);
    if(step && ['optimize','held'].includes(funding?.state)) {
      control = step.key==='blueprint_dispute_mail_letters' ? button('Open my letters','open-letters','',true)
        : `<a class="bf-link bf-primary" href="${esc(window.FHBlueprintJourney?.route('/progress.html#waypoints')||'/progress.html#waypoints')}">Open this step →</a>`;
    }
    return window.FHBlueprintJourney?.render({data:preparation,next:{...step,title:title||'Your next step',detail:detail||''},control,hasFundingEngine:true,moneyOverview,fundingState:funding?.state}) || loadingView('Loading your next step…');
  }

  function inquiryWork() {
    if (errors.inquiries) return errorView('inquiries');
    if (!inquiries) return loadingView('Loading your bureau work…');
    const cases = rows(inquiries.cases);
    return `<section><h3>Your bureau work</h3><p>Use your own bureau account to submit the packet. Save its receipt here so the system can follow the result.</p>
      ${cases.length ? cases.map(caseView).join('') : '<p>Your file has no inquiry cases waiting for action.</p>'}
      <div class="bf-panel"><h3>Repair letters and responses</h3><p>Your saved letters, mailing choices and response uploads are in your preparation workspace.</p>${button('Open letters and responses','open-letters')}</div></section>`;
  }

  function bureauPortalLinks(c) {
    if (!active()) return '';
    const portal = httpsUrl(c.portalUrl);
    const upload = httpsUrl(c.documentUploadUrl);
    if (!portal && !upload) return '';
    return `<div class="bf-row">${portal ? `<a class="bf-link" href="${esc(portal)}" target="_blank" rel="noopener noreferrer">Open ${esc(c.bureau)} portal ↗</a>` : ''}${upload ? `<a class="bf-link" href="${esc(upload)}" target="_blank" rel="noopener noreferrer">Upload documents for a pending ${esc(c.bureau)} request ↗</a>` : ''}</div>${upload ? '<p class="bf-caption">Use the portal to start or manage a dispute. Document upload adds files to a request already open.</p>' : ''}`;
  }

  function caseView(c) {
    const documents = rows(c.documents);
    const items = rows(c.inquiries);
    const packet = c.packet || {};
    return `<article class="bf-item"><h3>${esc(c.bureau)} · ${esc(c.status)}</h3>
      ${packet.complete ? '<p>Required identity documents are on file.</p>' : `<p>Documents needed: ${esc(rows(packet.missing).map(item => typeof item === 'string' ? item : item.label).join(', ') || 'Open your document upload steps.')}</p>`}
      ${uploadForms(packet.uploads)}
      ${c.executionOwner === 'fundhub' ? '<p>The Fundhub team is running this case.</p>' : ''}
      <ul>${items.map(i => `<li>${esc(i.name)} · ${esc(i.state === 'removed_verified' ? 'Removal verified' : i.state === 'pending_verification' ? 'Waiting for verification' : 'Open')}${i.verifiedAt ? ' · ' + esc(date(i.verifiedAt)) : ''}</li>`).join('')}</ul>
      ${c.nextCheckAt ? `<p>Next check: ${esc(date(c.nextCheckAt))}</p>` : ''}
      ${c.submissionReference ? `<p>Submission reference: ${esc(c.submissionReference)}</p>` : ''}
      ${c.call?.status ? `<p>Bureau call: ${esc(c.call.status)}</p>` : ''}
      ${bureauPortalLinks(c)}
      <div class="bf-row">
      ${documents.map(d => button(d.title || 'Open packet document','document',`data-id="${esc(d.id)}"`)).join('')}
      ${c.actions?.canCheckSavedEvidence ? button('Check saved bureau evidence','check-evidence',`data-id="${esc(c.id)}"`) : ''}</div>
      ${c.actions?.canLaunchCall && active() ? `<form data-bf-form="bureau-call" data-case="${esc(c.id)}" class="bf-panel"><label class="bf-authorization"><input type="checkbox" name="authorization" required> I authorize my AI agent to contact ${esc(c.bureau)} about the inquiries in this case.</label><button type="submit">Call bureau with my AI agent</button></form>` : ''}
      ${c.actions?.canRecordSubmission && active() ? `<details class="bf-panel"><summary>Save my dispute submission</summary><form data-bf-form="submission" data-case="${esc(c.id)}"><div class="bf-fields"><label>Portal confirmation or mailing reference<input name="reference" required maxlength="500" value="${esc(c.submissionReference || '')}"></label><label>Submission receipt<input name="receipt" type="file" accept="application/pdf,image/jpeg,image/png" required></label></div><button type="submit">Save submission receipt</button></form></details>` : ''}
    </article>`;
  }

  function fundingWork() {
    if (errors.funding) return errorView('funding');
    const lenders = rows(funding?.lenders);
    const apps = rows(funding?.applications);
    return `<section><h3>Your permitted banks</h3><p>${esc(funding?.nextAction || '')}</p>
      ${lenders.length ? lenders.map((l,index) => `<article class="bf-item"><h3>${esc(l.name)}${l.productName ? ' · ' + esc(l.productName) : ''}</h3>${l.businessName ? `<p>${esc(l.businessName)}</p>` : ''}<p>${esc(l.reason || (l.available ? 'Ready for the current application step.' : 'Waiting on the current file.'))}</p>${l.nextEligibleAt ? `<p>Next check: ${esc(date(l.nextEligibleAt))}</p>` : ''}${l.available && clientFundingActive() ? button('Open bank application','open-lender',`data-id="${esc(l.id)}" data-business="${esc(l.businessId || '')}"`,l === lenders.find(item => item.available)) : ''}</article>`).join('') : '<p>Your next lenders will appear after the current file checks pass.</p>'}
      <div class="bf-panel"><h3>Your applications</h3>${apps.length ? apps.map(applicationView).join('') : '<p>You have no recorded bank applications for this round.</p>'}
      ${funding?.canFinishSubmissions && clientFundingActive() ? `<p>When you have finished sending applications for this round, close new submissions. The system will continue checking bank outcomes and funding.</p>${button('I’m done applying for this round','finish-submissions')}` : funding?.submissionsClosed ? '<p>New submissions are closed. Recorded applications remain tracked through their final outcomes.</p>' : ''}</div></section>`;
  }

  function applicationView(a) {
    return `<article class="bf-item"><h3>${esc(a.lenderName || 'Bank application')}</h3><p>Recorded status: ${esc(a.status)}</p>${a.reportedStatus ? `<p>Your report: ${esc(a.reportedStatus)} · ${a.outcomeVerified ? 'checked against saved bank evidence.' : 'waiting for the saved evidence to be checked.'}</p>` : ''}
      ${a.approvedAmount != null ? `<p>Recorded approval: ${esc(money(Number(a.approvedAmount) * 100))}</p>` : ''}
      ${Number(a.fundedAmount) > 0 ? `<p>Verified issued or funded: ${esc(money(Number(a.fundedAmount) * 100))}</p>` : ''}
      ${clientFundingActive() ? `<details><summary>Report a bank response</summary><form data-bf-form="application" data-id="${esc(a.id)}"><div class="bf-fields"><label>What did the bank say?<select name="status" required><option value="pending">Submitted or pending</option><option value="approved">Approved</option><option value="declined">Declined</option></select></label><label>Bank reference<input name="reference" maxlength="500"></label><label>Bank response document<input name="evidence" type="file" accept="application/pdf,image/jpeg,image/png"></label><label>Approval amount, if stated<input name="approvedAmount" type="number" min="0.01" step="0.01" inputmode="decimal"></label></div><button type="submit">Save bank response</button></form></details>` : ''}</article>`;
  }

  function serviceWork() {
    if (errors.services) return errorView('services');
    if (!services) return loadingView('Loading your report and help options…');
    const allowance = services.allowance || {};
    const ended = services.engagement?.status === 'completed' || allowance.engagementActive === false;
    const setupRequired = services.reportSetup?.required === true && !ended;
    const reportText = ended ? 'Your purchased funding round is complete. Its included report schedule has ended.' : setupRequired ? 'Enter your identity and authorize your included report through the secure form.' : allowance.includedAvailable ? 'Your included monthly report is available.' : allowance.nextIncludedAt ? 'Next included report: ' + date(allowance.nextIncludedAt) + '.' : 'Your included report allowance is being checked.';
    const reportAction = setupRequired ? `<a class="bf-link bf-primary" href="${esc(demo?demo.previewUrl('document','report-authorization'):'/app/soft-pull-approve.html?portal=1&blueprint=1')}">Set up my included report</a>` : allowance.pendingRequestId ? '<p>A report request is already in progress.</p>' : services.capabilities?.requestReport ? button(allowance.includedAvailable ? 'Request included report' : 'Request an extra report quote','request-report','',true) : '';
    return `<section><h3>Reports and help</h3><div class="bf-panel"><h3>Your credit report</h3><p>${esc(reportText)}</p>${reportAction}</div>
      ${services.capabilities?.requestHelp ? `<div class="bf-panel"><h3>Ask Fundhub to run a service</h3><form data-bf-form="service"><div class="bf-fields"><label>What would you like help with?<select name="serviceKind">${rows(services.serviceTypes).map(s => `<option value="${esc(s.key)}">${esc(s.label)}${s.priceCents != null ? ' · ' + esc(money(s.priceCents)) : ' · request a quote'}</option>`).join('')}</select></label><label>Case or round<select name="targetId">${targetOptions(rows(services.serviceTypes)[0]?.key)}</select></label><label>Tell the team which step needs help<textarea name="note" rows="3" maxlength="1500"></textarea></label></div><button type="submit">Request help and pricing</button></form></div>` : ''}
      <div class="bf-panel"><h3>Your service requests</h3>${rows(services.requests).length ? services.requests.map(serviceRequestView).join('') : '<p>You have no extra service requests.</p>'}</div></section>`;
  }

  function serviceRequestView(r) {
    const label = rows(services.serviceTypes).find(type => type.key === r.serviceKind)?.label || String(r.serviceKind).replaceAll('_',' ');
    const states = {requested:'Waiting for a quote',quote_required:'Waiting for a quote',quoted:'Quote ready',checkout_pending:'Preparing payment options',awaiting_payment:'Waiting for payment',paid:'Payment received',in_progress:'Fundhub is working on this',completed:'Completed',needs_review:'The team is reviewing this',failed:'The team needs to review this',cancelled:'Cancelled',refunded:'Refunded'};
    const options = Array.isArray(services.checkoutProviders) ? services.checkoutProviders : [{id:'commas',label:'Pay in full'}];
    const providers = options.filter(p => ['commas','whop'].includes(p.id) && (!r.checkoutProvider || p.id === r.checkoutProvider));
    const choices = providers.length > 1 ? `<label>Payment option<select name="provider">${providers.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}</select></label>` : providers.length ? `<input type="hidden" name="provider" value="${esc(providers[0].id)}">` : '';
    const checkout = providers.length ? `<form data-bf-form="checkout" data-id="${esc(r.id)}">${choices}<label class="bf-authorization"><input type="checkbox" name="authorization" required> I accept this service quote for ${esc(money(r.priceCents))}.</label><button type="submit">Review payment options</button></form>` : '<p>The team is preparing your payment options.</p>';
    return `<article class="bf-item"><h3>${esc(label)}</h3><p>${esc(states[r.status] || r.status)}${r.priceCents != null ? ' · ' + esc(money(r.priceCents)) : ''}</p>${httpsUrl(r.checkoutUrl) ? `<a class="bf-link" href="${esc(httpsUrl(r.checkoutUrl))}" target="_blank" rel="noopener noreferrer">Review checkout ↗</a>` : ['quoted','awaiting_payment'].includes(r.status) ? checkout : ''}</article>`;
  }


  function uploadForms(descriptors) {
    if (!active()) return '';
    return rows(descriptors).map(item => `<form data-bf-form="identity" data-kind="${esc(item.kind)}" data-subtype="${esc(item.subtype)}" class="bf-panel"><label>${esc(item.label)}<input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required></label><button type="submit">Upload document</button></form>`).join('');
  }

  function targetOptions(kind) {
    const type = rows(services?.serviceTypes).find(item => item.key === kind);
    return '<option value="">Use the current eligible case or round</option>' + rows(type?.targets).map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
  }

  function repairWork() {
    if (errors.repair) return errorView('repair');
    if (!repair) return loadingView('Loading your repair work…');
    const authorization = repair.authorization || {};
    return `<section><h3>Your credit repair work</h3>${authorization.signed ? '' : '<p>Sign your full Blueprint agreement in Agreements, then refresh this workspace.</p>'}
      ${uploadForms(authorization.uploads)}
      <p>${esc(repair.stage || 'Your current saved repair file')}</p>
      ${repair.actions?.canGenerate && active() ? button('Prepare my current repair letters','generate-repair','',true) : ''}
      ${rows(repair.cases).map(c => `<article class="bf-item"><h3>${esc(c.bureau)} · ${esc(c.round)} · ${esc(c.status)}</h3>${bureauPortalLinks(c)}${rows(c.items).map(item => `<p>${esc(item.creditor || item.creditorName || item.name || '')}${item.status ? ' · ' + esc(item.status) : ''}</p>`).join('')}${rows(c.letters).map(letterView).join('')}</article>`).join('')}
      ${active() ? '<form data-bf-form="repair-response" class="bf-panel"><h3>Upload a bureau response</h3><label>Response document<input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required></label><button type="submit">Upload response for review</button></form>' : ''}</section>`;
  }

  function letterView(letter) {
    return `<div class="bf-panel"><h3>${esc(letter.target || letter.bureau || 'Repair letter')}</h3><p>${letter.submission ? 'Submitted by you; awaiting bureau response.' : esc(letter.status || 'Prepared')}</p>${letter.documentId ? button('Open repair letter','document',`data-id="${esc(letter.documentId)}"`) : ''}
      ${letter.canRecordSubmission && active() ? `<details><summary>Save my letter submission</summary><form data-bf-form="repair-submission" data-letter="${esc(letter.id)}"><div class="bf-fields"><label>How did you submit it?<select name="channel"><option value="mail">Mail</option><option value="portal">Bureau portal</option></select></label><label>Submission reference<input name="reference" maxlength="200" required></label><label>Submission receipt<input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required></label></div><button type="submit">Save letter submission</button></form></details>` : ''}</div>`;
  }

  host.addEventListener('change',event => {
    if (event.target.name !== 'serviceKind') return;
    const select = event.target.form?.elements.targetId;
    if (select) select.innerHTML = targetOptions(event.target.value);
  });

  const screens = {today, repair:repairWork, inquiries:inquiryWork, funding:fundingWork, services:serviceWork};
  function httpsUrl(value) {
    if (demo) {
      try {
        const url = new URL(value, location.origin);
        return url.origin === location.origin && url.pathname === '/app/client-portal.html' && url.searchParams.get('demo') === '1' && url.searchParams.get('blueprint') === 'full' && ['bank','document','payment'].includes(url.searchParams.get('preview')) ? url.href : null;
      } catch { return null; }
    }
    try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
  }

  async function mutate(path, payload) {
    const signature = path + JSON.stringify(payload);
    if (!actionKeys.has(signature)) actionKeys.set(signature, crypto.randomUUID());
    let body;
    if (payload.action === 'checkout') {
      const quote = rows(services?.requests).find(item => item.id === payload.requestId);
      const expectedPriceCents = Number(quote?.priceCents);
      if (!Number.isSafeInteger(expectedPriceCents) || expectedPriceCents <= 0) throw new Error('Refresh your service quote before opening payment options.');
      body = {...payload,authorization:true,expectedPriceCents};
    } else body = {...payload,idempotencyKey:actionKeys.get(signature)};
    const result = await request(path, {method:'POST', body:JSON.stringify(body)});
    actionKeys.delete(signature);
    return result;
  }

  async function upload(file, kind, subtype) {
    const body = new FormData();
    body.append('kind', kind);
    body.append('subtype', subtype);
    body.append('files', file);
    const result = await request('/api/documents-upload', {method:'POST', body});
    const id = result.documents?.[0]?.id || result.results?.[0]?.document?.id || result.results?.[0]?.id;
    if (!id) throw new Error('The file was not returned as a saved document. Try the upload again.');
    return id;
  }

  host.addEventListener('click', async event => {
    const el = event.target.closest('[data-bf-action]');
    if (!el || !current()) return;
    const action = el.dataset.bfAction;
    if (action === 'view') { view = el.dataset.view; notice = ''; render(); return; }
    if (busy) return;
    if (action === 'refresh') return refresh();
    if (action === 'open-letters') {
      view = 'preparation'; render();
      const old = document.querySelector('#blueprint-plan [data-bp-action="view"][data-view="letters"]');
      if (old) old.click();
      document.getElementById('blueprint-plan')?.scrollIntoView({block:'start',behavior:'smooth'});
      return;
    }
    busy = true;
    el.disabled = true;
    let popup = null;
    try {
      if (action === 'open-lender' || action === 'document') {
        popup = window.open('about:blank','_blank');
        if (popup) { popup.opener = null; pendingWindows.add(popup); }
        const result = action === 'open-lender'
          ? await mutate('/api/blueprint/funding', {action:'open_lender',lenderId:el.dataset.id,businessId:el.dataset.business || null})
          : await request('/api/documents-download?id=' + encodeURIComponent(el.dataset.id));
        const download = result.document?.download;
        let url = result.url || (typeof download === 'string' ? download : download?.url || download?.path);
        if (!demo && action === 'document' && typeof url === 'string' && url.startsWith('/api/documents/')) url = new URL(url,location.origin).href;
        if (typeof url !== 'string' || !url.trim() || (!httpsUrl(url) && !(!demo && action === 'document' && url.startsWith(location.origin + '/api/documents/')))) throw new Error('A valid destination was not returned. Please try again.');
        if (!current()) return;
        if (popup) { popup.location.href = url; pendingWindows.delete(popup); }
        else location.assign(url);
      } else if (action === 'bureau-call') {
        await mutate('/api/blueprint/inquiries', {action:'launch_call',caseId:el.dataset.id});
        notice = 'Your bureau call request is saved. Its provider status appears on the case.';
      } else if (action === 'generate-repair') {
        await mutate('/api/blueprint/repair', {action:'generate'});
        notice = 'Your current repair letters were prepared from the saved file.';
      } else if (action === 'finish-submissions') {
        await mutate('/api/blueprint/funding', {action:'finish_submissions'});
        notice = 'New submissions are closed. The system is tracking the remaining bank outcomes.';
      } else if (action === 'check-evidence') {
        await mutate('/api/blueprint/inquiries', {action:'check_evidence',caseId:el.dataset.id});
        notice = 'Saved evidence checked. Your case shows the result.';
      } else if (action === 'request-report') {
        await mutate('/api/blueprint/services', {action:'request_report'});
        notice = 'Your report request is saved. Review its current status below.';
      } else if (action === 'service-checkout') {
        await mutate('/api/blueprint/services', {action:'checkout',requestId:el.dataset.id});
        notice = 'Your payment options are ready below.';
      }
      await refresh();
    } catch (error) {
      if (popup) { try { popup.close(); } catch {} pendingWindows.delete(popup); }
      notice = error.message;
      render();
    } finally { busy = false; if (current() && el.isConnected) el.disabled = false; }
  });

  host.addEventListener('submit', async event => {
    const form = event.target.closest('[data-bf-form]');
    if (!form) return;
    event.preventDefault();
    if (busy || !current()) return;
    busy = true;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    const values = new FormData(form);
    try {
      if (form.dataset.bfForm === 'identity') {
        const file = form.elements.file.files[0];
        if (!file) throw new Error('Choose the document to upload.');
        await upload(file,form.dataset.kind,form.dataset.subtype);
        notice = 'Your document is stored for the system to review.';
      } else if (form.dataset.bfForm === 'repair-response') {
        const file = form.elements.file.files[0];
        if (!file) throw new Error('Choose the bureau response.');
        await upload(file,'bureau_response','bureau_letter');
        notice = 'Your bureau response is saved for system review.';
      } else if (form.dataset.bfForm === 'repair-submission') {
        const file = form.elements.file.files[0];
        if (!file && !form.dataset.receiptId) throw new Error('Choose your submission receipt.');
        const receiptDocumentId = form.dataset.receiptId || await upload(file,'client_upload','repair_submission_receipt');
        form.dataset.receiptId = receiptDocumentId;
        await mutate('/api/blueprint/repair',{action:'record_submission',letterId:form.dataset.letter,channel:values.get('channel'),reference:String(values.get('reference') || '').trim(),receiptDocumentId});
        notice = 'Your submission is saved and awaiting the bureau response.';
      } else if (form.dataset.bfForm === 'checkout') {
        if (values.get('authorization') !== 'on') throw new Error('Accept the service quote to continue.');
        await mutate('/api/blueprint/services', {action:'checkout',requestId:form.dataset.id,provider:String(values.get('provider') || 'commas')});
        notice = 'Your payment options are ready below.';
      } else if (form.dataset.bfForm === 'bureau-call') {
        if (values.get('authorization') !== 'on') throw new Error('Authorize the call before continuing.');
        await mutate('/api/blueprint/inquiries', {action:'launch_call',caseId:form.dataset.case,authorization:true});
        notice = 'Your bureau call request is saved. Its provider status appears on the case.';
      } else if (form.dataset.bfForm === 'submission') {
        const file = form.elements.receipt.files[0];
        if (!file) throw new Error('Choose the submission receipt.');
        const receiptDocumentId = form.dataset.receiptId || await upload(file,'inquiry_doc','inquiry_submission_receipt');
        form.dataset.receiptId = receiptDocumentId;
        await mutate('/api/blueprint/inquiries', {action:'record_submission',caseId:form.dataset.case,reference:String(values.get('reference')).trim(),receiptDocumentId});
        notice = 'Submission saved. Removal verification is now tracked on the case.';
      } else if (form.dataset.bfForm === 'application') {
        const payload = {action:'report_application',applicationId:form.dataset.id,status:values.get('status')};
        const reference = String(values.get('reference') || '').trim();
        if (reference) payload.reference = reference;
        const file = form.elements.evidence.files[0];
        if (file) payload.evidenceDocumentId = form.dataset.evidenceId || await upload(file,'client_upload','funding_bank_response');
        if (payload.evidenceDocumentId) form.dataset.evidenceId = payload.evidenceDocumentId;
        const amount = values.get('approvedAmount');
        if (amount) payload.approvedAmount = Number(amount);
        await mutate('/api/blueprint/funding', payload);
        notice = 'Your bank response is saved for verification.';
      } else if (form.dataset.bfForm === 'service') {
        await mutate('/api/blueprint/services', {action:'request_help',serviceKind:values.get('serviceKind'),note:String(values.get('note') || '').trim(),...(values.get('targetId') ? {targetId:values.get('targetId')} : {})});
        notice = 'Your request is on the Fundhub team’s queue.';
      }
      await refresh();
    } catch (error) {
      if (!current()) return;
      let output = form.querySelector('[role="alert"]');
      if (!output) { output = document.createElement('p'); output.setAttribute('role','alert'); output.className = 'bf-error bf-status'; form.append(output); }
      output.textContent = error.message;
    } finally { busy = false; if (current() && submit.isConnected) submit.disabled = false; }
  });

  document.addEventListener('fh:blueprint-plan-updated',event=>{
    if(!current()||!principal||!event.detail?.businessPlans)return;
    const p=event.detail.businessPlans;
    if(p.clientId!==principal.clientId||p.orgId!==principal.orgId)return;
    preparation=event.detail;
    if(funding?.engagement&&view==='today')render();
  });
  document.addEventListener('fh:blueprint-navigate',event=>{
    if(!current()||!funding?.engagement)return;
    const action=event.detail?.action;
    if(action==='funding'){view='funding';render();return;}
    if(action==='repair-help'){view='services';render();return;}
    if(['onboarding','businesses','letters','lessons','support','credit','document','aged-help','upgrade'].includes(action)){view='preparation';render();}
  });
  host.addEventListener('click', event => { if (!current()) { event.preventDefault(); event.stopImmediatePropagation(); } },true);
  window.addEventListener('storage', () => current());
  window.addEventListener('focus', () => current());
  if (demo) {
    let demoScenario = demo.scenario;
    window.addEventListener('fh:blueprint-demo-change', () => {
      if (demo.scenario !== demoScenario) { demoScenario = demo.scenario; view = 'today'; notice = ''; actionKeys.clear(); }
      if (principal && current()) refresh();
    });
  }
  request('/api/auth/session').then(session => {
    if (!current()) return;
    const staff = session.staff || {};
    if (!(session.principal === 'client' || staff.role === 'client') || !staff.id || !staff.client_id || !staff.org_id) return;
    principal = {accountId:staff.id,clientId:staff.client_id,orgId:staff.org_id};
    return refresh(true);
  }).catch(() => { if (current()) host.hidden = true; });
})();
