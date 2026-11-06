/* CSMs follow the same full-package file and offer separately priced help. */
(() => {
  'use strict';
  const host = document.getElementById('blueprint-csm-services');
  if (!host) return;
  const token = localStorage.getItem('fh_token');
  if (!token || ['demo','demo-token'].includes(token)) return;
  const abort = new AbortController();
  let clients = [];
  let detail = null;
  let selected = null;
  let busy = false;
  let notice = '';
  let invalid = false;
  let offset = 0;
  let hasMore = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = cents => cents == null ? 'Quote needed' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(cents) / 100);
  const rows = value => Array.isArray(value) ? value : [];

  function current() {
    if (!invalid && localStorage.getItem('fh_token') !== token) {
      invalid = true; abort.abort(); clients = []; detail = null;
      host.replaceChildren(); host.hidden = true;
    }
    return !invalid;
  }
  async function api(path, payload) {
    if (!current()) throw new Error('Reload after signing in.');
    const headers = {accept:'application/json',authorization:'Bearer ' + token};
    if (payload) headers['content-type'] = 'application/json';
    const response = await fetch(path,{method:payload ? 'POST' : 'GET',headers,credentials:'same-origin',signal:abort.signal,...(payload ? {body:JSON.stringify(payload)} : {})});
    const body = await response.json();
    if (!current()) throw new Error('Reload after signing in.');
    if (!response.ok || body.ok === false) {
      const error = new Error(body.message || 'The service workspace could not load.');
      error.status = response.status;
      throw error;
    }
    return body;
  }
  async function load() {
    try {
      const result = await api('/api/blueprint/services?view=oversight&limit=50&offset=' + offset);
      if (!current()) return;
      clients = rows(result.clients); hasMore = result.hasMore === true;
      host.hidden = false;
      render();
    } catch (error) {
      if (!current()) return;
      if (error.status === 403) { host.hidden = true; return; }
      host.hidden = false;
      host.innerHTML = `<h2>Full-package clients</h2><p role="alert">${esc(error.message)}</p><button type="button" class="btn ghost" data-bcs-action="refresh">Try again</button>`;
    }
  }
  async function open(clientId) {
    selected = clientId;
    detail = null;
    render();
    const results = await Promise.allSettled([api('/api/blueprint/services?client_id=' + encodeURIComponent(clientId)),api('/api/blueprint/funding?clientId=' + encodeURIComponent(clientId))]);
    if (!current()) return;
    if (results[0].status !== 'fulfilled') throw results[0].reason;
    detail = results[0].value;
    detail.funding = results[1].status === 'fulfilled' ? results[1].value : null;
    render();
  }
  function render() {
    if (!current()) return;
    const name = clients.find(c => c.clientId === selected)?.clientName || 'Client';
    host.innerHTML = `<div class="q-row"><div><h2>Full-package clients</h2><p>Progress, current holds and separately priced help.</p></div><button type="button" class="btn ghost" data-bcs-action="refresh">Refresh clients</button></div>
      ${selected ? `<button type="button" class="btn ghost" data-bcs-action="back">Back to clients</button><h3>${esc(name)}</h3>${detail ? detailView() : '<div class="q-form open" role="status" aria-busy="true"><p>Loading this client’s saved work…</p><div class="bcs-skeleton" aria-hidden="true"><span></span><span></span><span></span></div></div>'}` : listView()}
      <p role="status" aria-live="polite">${esc(notice)}</p>`;
  }
  function listView() {
    return `${clients.length ? clients.map(c => `<article class="q-row card"><div><h3>${esc(c.clientName || 'Client')}</h3><p>${esc(c.status)} · ${esc(c.executionOwner)} · ${Number(c.openTasks || 0)} open tasks · ${Number(c.helpRequests || 0)} help requests</p></div><button type="button" class="btn ghost" data-bcs-action="open" data-client="${esc(c.clientId)}">Review client</button></article>`).join('') : '<p>No active full-package clients are in this view.</p>'}
      <div class="q-row">${offset ? '<button type="button" class="btn ghost" data-bcs-action="previous">Previous clients</button>' : ''}${hasMore ? '<button type="button" class="btn ghost" data-bcs-action="next">More clients</button>' : ''}</div>`;
  }
  function detailView() {
    const requests = rows(detail.requests);
    return `<div class="q-form open"><h3>Current work</h3>${rows(detail.oversight?.openSteps).length ? '<ul>' + detail.oversight.openSteps.map(s => `<li>${esc(s.title)} · ${esc(s.status || 'open')}${s.reason ? ' · ' + esc(s.reason) : ''}</li>`).join('') + '</ul>' : '<p>This file has no open steps in this queue.</p>'}
      ${bankReviewView()}
      <h3>Help requests and offers</h3>${requests.length ? requests.map(r => `<article class="card"><h3>${esc(rows(detail.serviceTypes).find(type => type.key === r.serviceKind)?.label || String(r.serviceKind).replaceAll('_',' '))}</h3><p>${esc(r.status)} · ${esc(money(r.priceCents))}</p>${r.note ? `<p>${esc(r.note)}</p>` : ''}${detail.capabilities?.quote && ['requested','quote_required'].includes(r.status) ? quoteForm(r) : ''}</article>`).join('') : '<p>No separately priced help is requested.</p>'}
      ${detail.capabilities?.quote ? `<h3>Offer team-run help</h3><form data-bcs-form="offer"><div class="q-field"><label>Service<select name="serviceKind" class="q-select">${rows(detail.serviceTypes).map(s => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join('')}</select></label></div><div class="q-field"><label>Case or round<select name="targetId" class="q-select">${targetOptions(rows(detail.serviceTypes)[0]?.key)}</select></label></div><div class="q-field"><label>Agreed service scope or case reference<textarea name="note" class="q-area" maxlength="1500" required></textarea></label></div>${amountField()}<button type="submit" class="btn ghost">Save offer for client review</button></form>` : ''}</div>`;
  }
  function amountField() {
    return '<div class="q-field"><label>Quoted price in USD<input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required></label></div>';
  }
  function quoteForm(r) {
    return `<form data-bcs-form="quote" data-id="${esc(r.id)}">${amountField()}<button type="submit" class="btn ghost">Save quote for client review</button></form>`;
  }
  host.addEventListener('click', async event => {
    const button = event.target.closest('[data-bcs-action]');
    if (!button || busy || !current()) return;
    try {
      busy = true;
      const action = button.dataset.bcsAction;
      if (action === 'open') await open(button.dataset.client);
      else if (action === 'document') {
        const id = button.closest('form')?.elements.evidenceDocumentId?.value;
        if (!id) throw new Error('Select the saved document first.');
        const popup = window.open('about:blank','_blank');
        if (popup) popup.opener = null;
        try {
          const result = await api('/api/documents-download?id=' + encodeURIComponent(id));
          let url = result.document?.download;
          if (typeof url === 'string' && url.startsWith('/api/documents/')) url = new URL(url,location.origin).href;
          const parsed = new URL(url);
          if (parsed.protocol !== 'https:' && !(parsed.origin === location.origin && parsed.pathname.startsWith('/api/documents/'))) throw new Error('The document link could not be opened.');
          if (!current()) { popup?.close(); return; }
          if (popup) popup.location.href = parsed.href;
          else throw new Error('Allow popups for Fundhub, then open the document again.');
        } catch (error) { popup?.close(); throw error; }
      }
      else if (action === 'back') { selected = null; detail = null; render(); }
      else { if (action === 'previous') offset = Math.max(0,offset - 50); if (action === 'next') offset += 50; selected = null; await load(); }
    } catch (error) { notice = error.message; render(); }
    finally { busy = false; }
  });
  host.addEventListener('submit', async event => {
    const form = event.target.closest('[data-bcs-form]');
    if (!form) return;
    event.preventDefault();
    if (busy || !current()) return;
    const values = new FormData(form);
    const bankReview = form.dataset.bcsForm === 'bank';
    const priceCents = bankReview ? null : Math.round(Number(values.get('amount')) * 100);
    if (!bankReview && (!Number.isSafeInteger(priceCents) || priceCents <= 0)) return;
    busy = true;
    form.querySelector('button[type="submit"]').disabled = true;
    try {
      let payload = form.dataset.bcsForm === 'offer'
        ? {action:'offer',client_id:selected,serviceKind:values.get('serviceKind'),note:String(values.get('note')).trim(),priceCents,...(values.get('targetId') ? {targetId:values.get('targetId')} : {}),idempotencyKey:form.dataset.key || crypto.randomUUID()}
        : {action:'quote',requestId:form.dataset.id,priceCents};
      if (payload.idempotencyKey) form.dataset.key = payload.idempotencyKey;
      if (bankReview) {
        payload = {action:'review_bank_evidence',clientId:selected,applicationId:form.dataset.id,evidenceDocumentId:values.get('evidenceDocumentId'),decision:values.get('decision'),note:String(values.get('note') || '').trim()};
        if (values.get('approvedAmount')) payload.approvedAmount = Number(values.get('approvedAmount'));
        if (values.get('fundedAmount')) payload.fundedAmount = Number(values.get('fundedAmount'));
      }
      await api(bankReview ? '/api/blueprint/funding' : '/api/blueprint/services?client_id=' + encodeURIComponent(selected),payload);
      notice = bankReview ? 'Bank evidence review saved against this application.' : 'Offer saved. The client can review and accept it in their own workspace.';
      await open(selected);
    } catch (error) { notice = error.message; render(); }
    finally { busy = false; if (current() && form.isConnected) form.querySelector('button[type="submit"]').disabled = false; }
  });

  function targetOptions(kind) {
    const type = rows(detail?.serviceTypes).find(item => item.key === kind);
    return '<option value="">Use current eligible case or round</option>' + rows(type?.targets).map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
  }
  function bankReviewView() {
    const apps = rows(detail.funding?.applications);
    if (!apps.length) return '';
    return `<h3>Current applications and bank evidence</h3>${apps.map(a => `<article class="card"><h3>${esc(a.lenderName || 'Bank application')}</h3><p>${esc(a.status)}${a.reportedStatus ? ' · client reported ' + esc(a.reportedStatus) : ''}</p>${rows(a.evidenceDocuments).length ? `<form data-bcs-form="bank" data-id="${esc(a.id)}"><div class="q-field"><label>Saved bank evidence<select name="evidenceDocumentId" class="q-select" required>${rows(a.evidenceDocuments).map(d => `<option value="${esc(d.id)}">${esc(d.reference || d.id)}</option>`).join('')}</select></label></div><button type="button" class="btn ghost" data-bcs-action="document">Open selected bank evidence</button><div class="q-field"><label>Outcome supported by the document<select name="decision" class="q-select"><option value="approved">Approved</option><option value="declined">Declined</option><option value="funded">Issued or funded</option></select></label></div><div class="q-field"><label>Approved amount in USD<input name="approvedAmount" type="number" min="0.01" step="0.01"></label></div><div class="q-field"><label>Actually issued or funded amount in USD<input name="fundedAmount" type="number" min="0.01" step="0.01"></label></div><div class="q-field"><label>Evidence review note<textarea name="note" class="q-area" required maxlength="1500"></textarea></label></div><button type="submit" class="btn ghost">Save reviewed bank outcome</button></form>` : '<p>Follow this application in the team funding workflow.</p>'}</article>`).join('')}`;
  }
  host.addEventListener('change',event => {
    if (event.target.name !== 'serviceKind') return;
    const select = event.target.form?.elements.targetId;
    if (select) select.innerHTML = targetOptions(event.target.value);
  });

  window.addEventListener('storage',current);
  window.addEventListener('focus',current);
  load();
})();
