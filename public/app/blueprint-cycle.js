/* The client fulfillment cycle (Chris, 2026-11-07, unit CYCLE). Small pieces
   inside the existing Blueprint views, never a page of their own:
     1. the full credit report for each soft pull       (Credit & reports)
     2. letter steps: approve, print, check the address  (both letter lists)
     3. a preparation buyer who is fundable stops at "Book a call with your CSM"
        (Your next step); a full implementation buyer gets the application
        guide (Applications)
     4. "Call <bureau>" with a short script              (Inquiry removal)
   Every value comes from the server read it sits on (src/blueprint/fulfillment-cycle.mjs).
   A read without these fields shows nothing new. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows = value => Array.isArray(value) ? value : [];
  const demo = () => window.FHBlueprintDemo?.active === true ? window.FHBlueprintDemo : null;
  const day = value => value && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : null;
  /* Whole dollars, rounded DOWN: a guide never shows more than is on file. */
  const dollars = cents => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', maximumFractionDigits:0})
    .format(Math.floor(Number(cents) / 100));
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SOURCES = {plan:'From your plan', bank:'From your bank deposits', business_bank:'From your business deposits'};
  const REASONS = {not_on_file:'Not on file', split_by_business:'Not split by business yet'};
  let ready = null;
  let readyLoading = false;
  /* Approvals saved on this page, so a host that re-renders from its own earlier
     read still shows them. Keyed by letter version: a new version needs a new one. */
  const saved = new Map();

  function token() { try { return localStorage.getItem('fh_token'); } catch { return null; } }
  async function request(path, options = {}) {
    const d = demo();
    if (d) {
      const body = await d.request(path, options);
      if (body && body.ok === false) throw new Error(body.message || 'That did not save. Try again.');
      return body;
    }
    const t = token();
    if (!t || t === 'demo') throw new Error('Sign in again to continue.');
    const headers = {accept:'application/json', authorization:'Bearer ' + t};
    if (typeof options.body === 'string') headers['content-type'] = 'application/json';
    const response = await fetch(path, {credentials:'same-origin', ...options, headers});
    let body = {};
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok || body.ok === false) throw new Error(body.message || 'That did not save. Try again.');
    return body;
  }
  function safeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value, location.origin);
      if (demo()) return url.origin === location.origin ? url.href : null;
      return url.origin === location.origin || url.protocol === 'https:' ? url.href : null;
    } catch { return null; }
  }
  const button = (label, action, attrs = '', primary = false) =>
    `<button type="button" class="${primary ? 'bc-primary' : ''}" data-bc-action="${action}" ${attrs}>${esc(label)}</button>`;

  /* ── 1. Full credit report for each soft pull ── */
  function reports(data) {
    const list = rows(data?.cycle?.fullReports).filter(r => UUID.test(String(r?.documentId || '')) && Number(r.version) >= 1);
    if (!list.length) return '';
    return `<div class="bc-reports"><span class="bc-label">Full credit reports</span><ul>${list.map(r => `<li>
      <span>${esc(day(r.pulledAt) || 'Saved report')}${r.newest ? ' <small>Newest</small>' : ''}</span>
      ${button('Open', 'report', `data-document="${esc(r.documentId)}" data-version="${esc(r.version)}" aria-label="Open the full credit report from ${esc(day(r.pulledAt) || 'this pull')}"`)}</li>`).join('')}</ul>
      <p class="bc-status" role="status" aria-live="polite"></p></div>`;
  }

  /* ── 2. Letter steps ── */
  function letterSteps(letter) {
    const id = String(letter?.documentId || '');
    if (!UUID.test(id) || !letter?.approval || !('to' in letter)) return '';
    const local = saved.get(id + ':' + String(letter.versionId || '')) || {};
    const approved = Boolean(letter.approval.approvedAt || local.approvedAt);
    const checked = Boolean(letter.approval.addressCheckedAt || local.addressCheckedAt);
    const to = letter.to && rows(letter.to.lines).length ? letter.to : null;
    const address = to
      ? `<address>${rows(to.lines).map(esc).join('<br>')}</address>`
      : '<p class="bc-caption">Use the address on the letter.</p>';
    return `<div class="bc-letter" data-bc-letter="${esc(id)}" data-version="${esc(letter.versionId || '')}">
      <div class="bc-mailto"><span class="bc-label">Mail to</span>${address}</div>
      <ol class="bc-steps">
        <li data-done="${approved}">${approved ? '<span>✓ Approved</span>' : button('Approve letter', 'approve', `data-document="${esc(id)}"`, true)}</li>
        <li>${button('Open and print', 'print', `data-document="${esc(id)}"`)}</li>
        <li data-done="${checked}">${checked ? '<span>✓ Address checked</span>'
          : approved ? button('The address is right', 'address', `data-document="${esc(id)}"`) : '<span class="bc-later">Check the address</span>'}</li>
      </ol>
      <p class="bc-status" role="status" aria-live="polite"></p></div>`;
  }

  /* ── 3a. Preparation buyer, fundable: Book a call with your CSM ── */
  function loadReady() {
    if (ready || readyLoading) return;
    readyLoading = true;
    request('/api/money/ready-to-fund').then(body => { ready = body; paintReady(); })
      .catch(() => {}).finally(() => { readyLoading = false; });
  }
  const readyWords = () => ['requested', 'csm_assigned'].includes(ready?.status) ? 'Your CSM will reach out.'
    : ready?.status === 'done' ? 'Your CSM call is done.' : '';
  function paintReady() {
    for (const el of document.querySelectorAll('[data-bc-ready-status]')) el.textContent = readyWords();
  }
  function stop(data, hasFundingEngine) {
    /* The server says which buyer this is (cycle.offer); the page's own flag
       (hasFundingEngine) is only a second check, never the answer. */
    const cycle = data?.cycle;
    if (!data?.businessPlans?.startedAt || cycle?.offer !== 'preparation' || hasFundingEngine === true || cycle?.fundable !== true) return null;
    const url = safeUrl(cycle.bookCallUrl);
    if (!url) return null;
    loadReady();
    return {
      title: 'You are fundable. Book a call with your CSM.',
      detail: 'Your CSM will help you with the next step.',
      impact: 'UnderwriteIQ says your file is fundable.',
      control: `${button('Book a call', 'book-call', `data-url="${esc(url)}"`, true)}<p class="bc-status" data-bc-ready-status role="status" aria-live="polite">${esc(readyWords())}</p>`
    };
  }

  /* ── 3b. Full implementation: the application guide ── */
  /* Deposits are an estimate, not income, so the first step is the client's own
     check. A read without the estimate flag still marks deposit rows by their source. */
  const ESTIMATE_SOURCES = new Set(['bank', 'business_bank']);
  function guide(funding) {
    const g = funding?.guide;
    if (!g || !rows(g.rows).length) return '';
    return `<section class="bc-guide"><h3>Your application guide</h3><p class="bc-confirm">${esc(g.rule || 'Confirm your real income before you apply.')}</p>
      <dl>${rows(g.rows).map(r => {
        const yearly = Number.isSafeInteger(r.yearlyCents) && r.yearlyCents > 0 ? r.yearlyCents : null;
        const estimate = yearly != null && (r.estimate === true || (r.estimate == null && ESTIMATE_SOURCES.has(r.source)));
        const value = yearly == null ? esc(REASONS[r.reason] || 'Not on file')
          : `${esc(dollars(yearly))} a year<small>${estimate ? 'Estimate · ' : ''}${esc(dollars(r.monthlyCents))} a month · ${esc(SOURCES[r.source] || 'On file')}</small>`;
        return `<div data-known="${yearly != null}" data-estimate="${estimate}"><dt>${esc(r.label)}</dt><dd>${value}</dd></div>`;
      }).join('')}</dl></section>`;
  }

  /* ── 4. Call the bureau about inquiries ── */
  function call(c) {
    const s = c?.selfCall;
    if (!s || !rows(s.script).length) return '';
    const tel = /^\+1\d{10}$/.test(String(s.number || '')) ? s.number : null;
    return `<section class="bc-call"><h4>Call ${esc(s.name)}</h4>
      ${tel ? `<a class="bc-tel" href="tel:${esc(tel)}">${esc(s.display || tel)}</a>` : '<p class="bc-caption">Number not on file. Ask your CSM.</p>'}
      <span class="bc-label">Say this</span><ol class="bc-script">${rows(s.script).map(line => `<li>${esc(line)}</li>`).join('')}</ol>
      <span class="bc-label">Have ready</span><ul class="bc-ready">${rows(s.haveReady).map(line => `<li>${esc(line)}</li>`).join('')}</ul>
      ${rows(s.uploadFirst).length ? `<p class="bc-caption">Upload first: ${esc(rows(s.uploadFirst).join(', '))}.</p>` : ''}
      <p class="bc-caption">Then save your confirmation number below.</p></section>`;
  }

  /* ── Actions ── */
  async function openDocument(id, version, popup) {
    const query = '/api/documents-download?id=' + encodeURIComponent(id) + (version ? '&version=' + encodeURIComponent(version) : '');
    const result = await request(query);
    const download = result.document?.download;
    const url = safeUrl(result.url || (typeof download === 'string' ? download : download?.url || download?.path));
    if (!url) throw new Error('This file could not be opened. Try again.');
    if (popup) popup.location.href = url;
    else location.assign(url);
  }
  function statusFor(el) {
    return el.closest('.bc-letter,.bc-reports')?.querySelector('.bc-status') || el.parentElement?.querySelector('.bc-status');
  }
  document.addEventListener('click', async event => {
    const el = event.target.closest?.('[data-bc-action]');
    if (!el || el.disabled) return;
    const action = el.dataset.bcAction;
    const status = statusFor(el);
    let popup = null;
    el.disabled = true;
    try {
      if (action === 'book-call') {
        const url = safeUrl(el.dataset.url);
        if (url) window.open(url, '_blank', 'noopener');
        ready = await request('/api/money/ready-to-fund', {method:'POST', body:JSON.stringify({})});
        paintReady();
        if (status && !status.textContent) status.textContent = 'Your CSM will reach out.';
      } else if (action === 'report' || action === 'print') {
        popup = window.open('about:blank', '_blank');
        if (popup) popup.opener = null;
        await openDocument(el.dataset.document, action === 'report' ? el.dataset.version : null, popup);
      } else if (action === 'approve' || action === 'address') {
        const result = await request('/api/blueprint/letter-mailing', {method:'POST',
          body:JSON.stringify({action: action === 'approve' ? 'approve_letter' : 'check_address', documentId: el.dataset.document})});
        const block = el.closest('.bc-letter');
        if (block && result?.approval) {
          const versionId = String(result.versionId || block.dataset.version || '');
          saved.set(el.dataset.document + ':' + versionId, result.approval);
          block.outerHTML = letterSteps({documentId: el.dataset.document, versionId, approval: result.approval, to: result.to ?? null});
          return;
        }
      }
    } catch (error) {
      if (popup) { try { popup.close(); } catch {} }
      if (status) status.textContent = error.message;
    } finally {
      if (el.isConnected) el.disabled = false;
    }
  });

  window.FHBlueprintCycle = Object.freeze({reports, letterSteps, stop, guide, call});
})();
