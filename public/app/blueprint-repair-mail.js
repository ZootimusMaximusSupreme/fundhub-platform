/* "Mail it for me · $97" on each repair letter (unit MAIL, Chris 2026-11-07:
   "if you want us to print, generate and send them, we can do that").
   The same $97 batch mailing the funding letters use (src/blueprint/letter-mailing.mjs):
   the same quote, the same secure checkout, the same mail house, the same tracker
   (sending, mailed, expected delivery, reply due). Every value comes from
   GET /api/blueprint/letter-mailing; this file draws it and sends back only the
   client's own choices. Nothing here charges a card: payment happens on the
   secure checkout page. */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows = value => Array.isArray(value) ? value : [];
  const demo = () => window.FHBlueprintDemo?.active === true ? window.FHBlueprintDemo : null;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const BUREAUS = {EX:'Experian', EQ:'Equifax', TU:'TransUnion'};
  /* Orders that hold a letter. "Quoted" holds nothing: no one said yes yet. */
  const LIVE = ['payment_pending', 'awaiting_payment', 'mail_pending', 'mailing', 'mailed', 'needs_review'];
  const UNPAID = ['payment_pending', 'awaiting_payment'];
  const day = value => value && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toLocaleDateString('en-US', {month:'short', day:'numeric'}) : null;
  const price = mailing => {
    const cents = Number(mailing?.priceCents);
    return Number.isSafeInteger(cents) && cents > 0 ? '$' + (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100)) : null;
  };
  const roundName = value => /^R[1-6]$/.test(String(value || '')) ? 'Round ' + String(value).slice(1) : 'This round';
  const button = (label, action, attrs = '', primary = false) =>
    `<button type="button" class="${primary ? 'brm-primary' : ''}" data-brm-action="${action}" ${attrs}>${esc(label)}</button>`;

  let panel = null;          // the open review: {documentId, round, picked:Set, quote, busy, error, key}
  const local = new Map();   // orderId -> {order, base}: what the client's own action returned, over the read it was made on
  const seen = new Map();    // documentId -> the letter and context it was last drawn with
  const notes = new Map();   // documentId -> the last answer said to the client, kept across re-draws

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
      return url.protocol === 'https:' ? url.href : null;
    } catch { return null; }
  }
  const mailable = mailing => mailing?.capabilities?.mailSupported === true && mailing?.capabilities?.hostedCheckoutSupported === true && Boolean(price(mailing));

  /* The order holding this letter: the client's own last answer wins until a newer read arrives. */
  function orderFor(id, mailing) {
    for (const [key, entry] of local) if (entry.base !== mailing) local.delete(key);
    const merged = new Map(rows(mailing?.orders).filter(o => o?.id).map(o => [o.id, o]));
    for (const [key, entry] of local) merged.set(key, entry.order);
    for (const order of merged.values()) {
      if (!LIVE.includes(order?.status)) continue;
      const envelope = rows(order.envelopes).find(e => e?.documentId === id);
      if (envelope) return {order, envelope};
    }
    return null;
  }
  const remember = (order, letterId) => { if (order?.id) local.set(order.id, {order, base:seen.get(letterId)?.ctx?.mailing || null}); };
  /* Paid, mailing, mailed or being checked: Fundhub mails it, so "Mail it yourself" goes away. */
  function held(letter, mailing) {
    const found = orderFor(String(letter?.documentId || ''), mailing);
    return Boolean(found && !UNPAID.includes(found.order.status));
  }
  function roundLetters(mailing, round) {
    return rows(mailing?.letters).filter(l => l?.kind === 'repair' && l.eligibleForMailing === true && UUID.test(String(l.documentId || ''))
      && l.round === round).slice(0, Number(mailing?.maxLetters) || 6);
  }

  /* Mailed only when PostGrid reports the letter handed to the post office; until
     then it is "Sending", even while printing (Codex CX28). PostGrid never confirms
     delivery, so this never says "Delivered" (CX26): its "completed" date is the
     expected delivery date. The reply date counts from that date and stays empty
     until it is known (CX27). */
  function trackerView(t) {
    const m = t.mail || {};
    const mailedOn = m.state === 'done' ? day(m.at) : null;
    const mail = mailedOn ? `<li data-state="done"><span>Mailed</span><small>${esc(mailedOn)}</small></li>`
      : '<li data-state="now"><span>Sending</span></li>';
    const d = t.delivery || {};
    const expected = d.state === 'expected' ? day(d.at) : null;
    const delivery = expected ? `<li data-state="expected"><span>Expected delivery</span><small>${esc(expected)}</small></li>`
      : `<li data-state="${d.state === 'now' ? 'now' : 'todo'}"><span>${d.state === 'now' ? 'Out for delivery' : 'Delivery'}</span></li>`;
    const due = expected ? day(t.replyDueAt) : null;
    return `<span class="brm-label">Fundhub mails it</span><ol class="brm-track" aria-label="Mail tracker">
      ${mail}${delivery}
      <li data-state="${due ? 'due' : 'todo'}"><span>Reply due</span>${due ? `<small>${esc(due)}</small>` : ''}</li></ol>
      ${t.problem ? `<p class="brm-line brm-problem">${t.problem === 'returned' ? 'It came back. Our team will help.' : 'The mail house stopped it. Our team will help.'}</p>` : ''}`;
  }
  function statusView({order, envelope}, mailing) {
    if (envelope.status === 'accepted' && envelope.tracker) return trackerView(envelope.tracker);
    if (order.status === 'needs_review' || envelope.status === 'needs_review') return '<p class="brm-line">Our team is checking this mailing.</p>';
    if (!UNPAID.includes(order.status)) return '<p class="brm-line">Paid. We mail it soon.</p>';
    const pay = safeUrl(order.checkoutUrl);
    return `<p class="brm-line">Waiting for payment.</p><div class="brm-choice">
      ${pay ? `<a class="brm-pay" href="${esc(pay)}" target="_blank" rel="noopener noreferrer">Pay ${esc(price(mailing) || '$97')}</a>` : ''}
      ${button('Check payment', 'status', `data-order="${esc(order.id)}"`)}</div>`;
  }
  function panelView(mailing) {
    const p = panel;
    const q = p.quote;
    const list = roundLetters(mailing, p.round);
    if (!list.some(l => l.documentId === p.documentId)) {
      const own = rows(mailing?.letters).find(l => l?.documentId === p.documentId);
      if (own) list.unshift(own);
    }
    const options = rows(q?.paymentOptions).filter(o => o && typeof o.id === 'string');
    const from = q?.returnAddressSummary || {};
    const fromLine = [from.name, from.line1, from.city, [from.state, from.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const ready = q && !p.busy;
    return `<form class="brm-panel" data-brm-form="confirm" data-document="${esc(p.documentId)}">
      <h4>We mail these for ${esc(price(mailing))}</h4>
      <ul class="brm-pick">${list.map(l => `<li><label class="brm-check"><input type="checkbox" data-brm-pick="${esc(l.documentId)}"
        ${p.picked.has(l.documentId) ? 'checked' : ''}><span>${esc(BUREAUS[l.bureau] || l.bureau || 'Bureau')} · ${esc(roundName(l.round))}</span></label></li>`).join('')}</ul>
      ${p.busy ? '<p class="brm-line" role="status">Getting your price…</p>' : ''}
      ${ready && fromLine ? `<p class="brm-line">From ${esc(fromLine)}</p>` : ''}
      ${ready && options.length > 1 ? `<label class="brm-field">Pay with<select name="paymentOptionId">${options.map(o => `<option value="${esc(o.id)}">${esc(o.label || 'Secure checkout')}</option>`).join('')}</select></label>`
        : ready && options[0] ? `<input type="hidden" name="paymentOptionId" value="${esc(options[0].id)}">` : ''}
      ${ready ? `<label class="brm-check brm-agree"><input type="checkbox" name="authorization" required><span>I read these letters. Charge ${esc(price(mailing))} once and mail them for me.</span></label>` : ''}
      <div class="brm-choice">${ready ? `<button type="submit" class="brm-primary">Pay ${esc(price(mailing))}</button>` : ''}${button('Not now', 'close')}</div>
      ${p.error ? `<p class="brm-line brm-problem" role="alert">${esc(p.error)}</p>` : ''}
    </form>`;
  }
  const wrap = (id, inner) => `<div class="brm" data-brm-letter="${esc(id)}">${inner}<p class="brm-status" role="status" aria-live="polite">${esc(notes.get(id) || '')}</p></div>`;

  /** The mail choice, the payment step or the tracker for one repair letter. */
  function block(letter, ctx = {}) {
    const id = String(letter?.documentId || '');
    if (!UUID.test(id)) return '';
    seen.set(id, {letter, ctx});
    const mailing = ctx.mailing || null;
    const found = orderFor(id, mailing);
    if (found) return wrap(id, statusView(found, mailing));
    if (ctx.active !== true || letter.submission) return '';
    const info = rows(mailing?.letters).find(l => l?.documentId === id && l.kind === 'repair');
    const canSelf = letter.canRecordSubmission === true;
    const canMail = info?.eligibleForMailing === true && mailable(mailing);
    if (!canSelf && !canMail) return '';
    const open = panel?.documentId === id;
    return wrap(id, `<span class="brm-label">How to send it</span><div class="brm-choice">
      ${canSelf ? button('Mail it yourself', 'self', `data-document="${esc(id)}"`) : ''}
      ${canMail ? button(`Mail it for me · ${price(mailing)}`, 'pick', `data-document="${esc(id)}" data-round="${esc(info.round || '')}" aria-expanded="${open}"`) : ''}
      </div>${open ? panelView(mailing) : ''}`);
  }

  function repaint(id) {
    const el = document.querySelector(`[data-brm-letter="${id}"]`);
    const last = seen.get(id);
    if (!el || !last) return;
    const focus = document.activeElement;
    const pick = el.contains(focus) ? focus.dataset?.brmPick || null : null;
    const action = el.contains(focus) ? focus.dataset?.brmAction || null : null;
    el.outerHTML = block(last.letter, last.ctx);
    const next = document.querySelector(`[data-brm-letter="${id}"]`);
    const target = pick ? next?.querySelector(`[data-brm-pick="${pick}"]`) : action ? next?.querySelector(`[data-brm-action="${action}"]`) : null;
    if (target) target.focus();
  }
  const updated = () => document.dispatchEvent(new CustomEvent('fh:blueprint-repair-mail-updated'));
  const say = (el, text) => {
    const box = el.closest('.brm');
    if (box?.dataset.brmLetter) { if (text) notes.set(box.dataset.brmLetter, text); else notes.delete(box.dataset.brmLetter); }
    const out = box?.querySelector('.brm-status');
    if (out) out.textContent = text;
  };

  async function quote() {
    const mine = panel;
    const ids = [...mine.picked];
    if (!ids.length) { mine.quote = null; mine.error = 'Pick at least one letter.'; repaint(mine.documentId); return; }
    mine.busy = true; mine.error = ''; repaint(mine.documentId);
    try {
      const result = await request('/api/blueprint/letter-mailing', {method:'POST', body:JSON.stringify({action:'quote', documentIds:ids})});
      if (panel !== mine || [...mine.picked].join() !== ids.join()) return;
      mine.quote = result?.order || result;
    } catch (error) {
      if (panel === mine) { mine.quote = null; mine.error = error.message; }
    } finally {
      if (panel === mine) { mine.busy = false; repaint(mine.documentId); }
    }
  }

  document.addEventListener('click', async event => {
    const el = event.target.closest?.('[data-brm-action]');
    if (!el || el.disabled) return;
    const action = el.dataset.brmAction;
    if (action === 'self') {
      const details = el.closest('.bf-panel')?.querySelector('details[data-brm-self]');
      if (details) { details.open = true; details.scrollIntoView({block:'nearest', behavior:'smooth'}); details.querySelector('select,input')?.focus({preventScroll:true}); }
      return;
    }
    if (action === 'pick') {
      const id = el.dataset.document;
      const last = seen.get(id);
      const round = el.dataset.round || null;
      panel = {documentId:id, round, picked:new Set(roundLetters(last?.ctx?.mailing, round).map(l => l.documentId)), quote:null, busy:false, error:'',
        key:crypto.randomUUID().replaceAll('-', '')};
      panel.picked.add(id);
      await quote();
      return;
    }
    if (action === 'close') { const id = panel?.documentId; panel = null; if (id) repaint(id); return; }
    if (action === 'status') {
      el.disabled = true;
      say(el, '');
      try {
        const result = await request('/api/blueprint/letter-mailing', {method:'POST', body:JSON.stringify({action:'status', orderId:el.dataset.order})});
        const order = result?.order || result;
        remember(order, el.closest('[data-brm-letter]')?.dataset.brmLetter);
        say(el, UNPAID.includes(order?.status) ? 'Not paid yet.' : '');
        updated();
      } catch (error) { say(el, error.message); }
      finally { if (el.isConnected) el.disabled = false; }
    }
  });
  document.addEventListener('change', event => {
    const box = event.target.closest?.('[data-brm-pick]');
    if (!box || !panel) return;
    if (box.checked) panel.picked.add(box.dataset.brmPick); else panel.picked.delete(box.dataset.brmPick);
    panel.quote = null;
    quote();
  });
  document.addEventListener('submit', async event => {
    const form = event.target.closest?.('[data-brm-form="confirm"]');
    if (!form) return;
    event.preventDefault();
    const mine = panel;
    const q = mine?.quote;
    if (!mine || !q || mine.busy) return;
    const values = new FormData(form);
    if (values.get('authorization') !== 'on') { mine.error = 'Check the box to say yes first.'; repaint(mine.documentId); return; }
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const result = await request('/api/blueprint/letter-mailing', {method:'POST', body:JSON.stringify({action:'confirm', orderId:q.orderId || q.id,
        quoteVersion:q.quoteVersion, paymentOptionId:String(values.get('paymentOptionId') || ''), authorization:true, idempotencyKey:mine.key})});
      remember(result?.order || result, mine.documentId);
      if (panel === mine) panel = null;
      repaint(mine.documentId);
      updated();
    } catch (error) {
      if (panel === mine) { mine.error = error.message; repaint(mine.documentId); }
    }
  });

  window.FHBlueprintRepairMail = Object.freeze({block, held});
})();
