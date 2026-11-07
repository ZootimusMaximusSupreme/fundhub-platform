/* Where each client is — the CSM tracking section of csm-queue.html (unit N).
 *
 * One read, two shapes:
 *   GET /api/read/csm-queue?view=tracking            the list, falling behind first
 *   GET /api/read/csm-queue?view=tracking&client_id  one client, with UnderwriteIQ
 * and one write, the nudge, through the staff reply path every other staff text
 * uses: POST /api/messages. That path owns the gate, quiet hours, opt-outs and
 * the shift check. This file never sends on its own and never writes on load.
 *
 * The rules (what "falling behind" means, the seasoning clock, the apply gate)
 * live in src/csm/client-tracking.mjs. This file only draws what it is given.
 */
(() => {
  'use strict';
  const host = document.getElementById('csm-tracking');
  if (!host) return;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PAGE = 25;
  const state = {
    show: 'behind', mine: false, offset: 0, items: [], total: 0, behind: 0, hasMore: false, truncated: false,
    ready: false, failed: null, open: null, detail: {}, detailFailed: {}, form: null, busy: false
  };

  function api(path, options) {
    const init = options || {};
    init.headers = Object.assign({ accept: 'application/json' }, init.headers || {});
    try {
      const t = localStorage.getItem('fh_token') || '';
      if (t && t !== 'demo' && t !== 'demo-token') init.headers.authorization = 'Bearer ' + t;
    } catch (e) { /* no storage: the cookie still works */ }
    if (init.body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(init.body);
    }
    init.credentials = 'same-origin';
    return fetch(path, init).then(
      (r) => r.json().then((b) => ({ status: r.status, body: b }), () => ({ status: r.status, body: null })),
      (e) => ({ status: 0, body: null, transport: (e && e.message) || 'network error' })
    );
  }

  /* What went wrong, in plain words — never a status code (UI-STANDARDS §6). */
  function problem(res) {
    const err = String((res.body && res.body.error) || '');
    if (res.transport || res.status === 0) return 'Could not reach the server. Check your connection and try again.';
    if (res.status === 401) return 'You are signed out. Sign in and open this page again.';
    if (err === 'no_active_shift') return 'Clock in first. You can text a client only while you are on a shift.';
    if (err === 'idempotency_key_reused') return 'That message was already used for a different send. Reload and try again.';
    if (res.status === 403) return 'Your account cannot see this list.';
    if (res.status === 404) return 'That client is not on your company’s list. Reload the page.';
    if (res.status === 503) return 'The database is not reachable right now. Try again in a moment.';
    if (res.status === 400 && res.body && res.body.message) return 'That did not work: ' + String(res.body.message).slice(0, 160) + '.';
    return 'That did not load. Try again in a moment.';
  }

  function banner(tone, text) {
    const el = $('ctBanner');
    el.className = 'ct-banner show ' + tone;
    el.textContent = text;
  }
  function clearBanner() { $('ctBanner').className = 'ct-banner'; $('ctBanner').textContent = ''; }

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const money = (cents) => cents == null ? null
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents) / 100);

  /* Relative under a day, absolute after; exact time in the tooltip (UI-STANDARDS §7). */
  function ago(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const ms = Date.now() - d.getTime();
    const hours = Math.floor(ms / 3600000);
    let text;
    if (hours < 1) text = 'just now';
    else if (hours < 24) text = hours + 'h ago';
    else {
      const days = Math.floor(hours / 24);
      text = days < 8 ? plural(days, 'day', 'days') + ' ago'
        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return { text, title: d.toLocaleString('en-US', { timeZone: 'America/Phoenix' }) + ' Arizona' };
  }
  function dayText(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Phoenix' });
  }

  /* ── the words for one row ──────────────────────────────────────────────── */

  function stepWords(steps) {
    const s = steps || {};
    if (!s.total) return { line: 'No steps on this file yet', facts: [] };
    if (!s.current) return { line: 'All ' + s.total + ' steps done', facts: [] };
    const c = s.current;
    const where = 'Step ' + Math.min(s.done + 1, s.total) + ' of ' + s.total + ': ' + c.title;
    const facts = [];
    if (c.owner === 'fundhub') facts.push({ kind: 'owner', text: 'Our team’s step' });
    if (c.state === 'blocked') facts.push({ kind: 'blocked', text: 'Blocked', tone: 'late' });
    if (c.days_late !== null && c.days_late !== undefined) {
      facts.push({
        kind: 'days',
        text: (c.days_late < 1 ? 'Late today' : plural(c.days_late, 'day', 'days') + ' late') +
          (c.reminders === 'running' ? ' · auto reminders still going' : c.reminders === 'done' ? ' · auto reminders done' : ''),
        tone: 'late', title: c.due_at ? 'Due ' + dayText(c.due_at) : ''
      });
    } else if (c.days_on_step !== null && c.days_on_step !== undefined) {
      facts.push({ kind: 'days', text: 'On it ' + plural(c.days_on_step, 'day', 'days') });
    }
    return { line: where, facts };
  }

  function paymentWords(p) {
    if (!p || p.total_late === null || p.total_late === undefined) return { text: 'Payments: not known yet', title: 'The bank has not shared payment data and there is no Fundhub plan.' };
    if (p.total_late === 0) return { text: 'No late payments' };
    return { text: plural(p.total_late, 'late payment', 'late payments'), tone: 'late' };
  }

  function seasonWords(s) {
    if (!s || !s.opened) return { text: 'No bank account opened yet' };
    if (s.closest) return { text: s.closest.bank + ' · day ' + s.closest.day + ' of ' + s.closest.of, title: plural(s.seasoned, 'account is', 'accounts are') + ' seasoned' };
    return { text: plural(s.seasoned, 'account', 'accounts') + ' seasoned', tone: 'ok' };
  }

  function gateWords(g) {
    if (!g) return { text: 'Apply: not checked' };
    if (g.state === 'open') return { text: 'Can apply', tone: 'ok' };
    if (g.state === 'locked') return { text: 'Apply: locked' };
    return { text: 'Apply: not known yet' };
  }

  function chip(f) {
    return '<span class="chip' + (f.tone ? ' ' + f.tone : '') + '"' + (f.title ? ' title="' + esc(f.title) + '"' : '') + '>' + esc(f.text) + '</span>';
  }

  function rowHtml(r) {
    const name = r.client_name || r.client_code || 'Unnamed client';
    const sw = stepWords(r.steps);
    const open = state.open === r.client_id;
    const last = ago(r.last_team_text_at);
    const behind = r.behind || [];
    const has = (code) => behind.some((b) => b.code === code);
    const reasons = behind.map((b) => chip({ text: b.words, tone: 'late' })).join('');
    /* A reason already says the step's days, the block or the late payment, so
       the plain chip for the same fact is left out rather than said twice. */
    const stepSaid = has('step_late') || has('step_stuck');
    const facts = sw.facts.filter((f) => !(stepSaid && f.kind === 'days') && !(has('step_blocked') && f.kind === 'blocked'))
      .map(chip).join('');
    const context = [seasonWords(r.seasoning), gateWords(r.apply_gate),
      last ? { text: 'Last team text ' + last.text, title: last.title } : { text: 'No team text yet' }];
    if (!has('bank_late') && !has('plan_late')) context.unshift(paymentWords(r.payments));
    if (r.assigned_csm_name) context.push({ text: 'CSM: ' + r.assigned_csm_name });
    return '<article class="card ct-row' + ((r.behind || []).length ? ' behind' : '') + '" data-ct-row="' + esc(r.client_id) + '" aria-label="' + esc(name) + '">' +
      '<div class="ct-row-main">' +
        '<div class="ct-who">' +
          '<a class="ct-name" href="client-control-panel.html?client_id=' + encodeURIComponent(r.client_id) + '">' + esc(name) + '</a>' +
          '<p class="ct-step">' + esc(sw.line) + '</p>' +
          (reasons || facts ? '<div class="ct-facts">' + reasons + facts + '</div>' : '') +
          '<div class="ct-context" aria-label="Client facts">' + context.map(chip).join('') + '</div>' +
        '</div>' +
        '<div class="ct-acts"><button class="btn ghost" type="button" data-ct-open="' + esc(r.client_id) + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="ct-detail-' + esc(r.client_id) + '">' +
          (open ? 'Hide details' : 'See where they are') + '</button></div>' +
      '</div>' +
      (open ? '<div class="ct-detail" id="ct-detail-' + esc(r.client_id) + '">' + detailHtml(r) + '</div>' : '') +
      '</article>';
  }

  /* ── one client's detail ────────────────────────────────────────────────── */

  function detailHtml(r) {
    const d = state.detail[r.client_id];
    if (state.detailFailed[r.client_id]) {
      return '<p class="ct-empty" role="alert">' + esc(state.detailFailed[r.client_id]) + '</p>' +
        '<button class="btn ghost" type="button" data-ct-retry="' + esc(r.client_id) + '">Try again</button>';
    }
    if (!d) return '<div class="ct-detail-loading" role="status" aria-busy="true"><p>Loading where they are…</p><div class="ct-skel small" aria-hidden="true"></div></div>';
    return '<div class="ct-grid">' + stepBox(d) + payBox(d) + seasonBox(d) + gateBox(d) + '</div>' + nudgeBox(d) +
      '<p class="ct-foot"><a class="q-link" href="client-control-panel.html?client_id=' + encodeURIComponent(d.client_id) + '">Open the full client file</a></p>';
  }

  function box(title, body) { return '<section class="ct-box"><h3>' + esc(title) + '</h3>' + body + '</section>'; }

  function stepBox(d) {
    const s = d.steps || {};
    const c = s.current;
    let body = '<p class="ct-big">' + esc(s.total ? s.done + ' of ' + s.total + ' steps done' : 'No steps yet') + '</p>';
    if (c) {
      body += '<p><b>' + esc(c.title) + '</b></p><p class="ct-cap">' +
        esc(c.owner === 'fundhub' ? 'Our team’s job' : 'The client’s job') +
        (c.state === 'blocked' ? ' · Blocked' + (c.reason ? ': ' + c.reason : '') : '') +
        (c.days_late != null ? ' · ' + plural(c.days_late, 'day', 'days') + ' past its due date' : c.days_on_step != null ? ' · on it ' + plural(c.days_on_step, 'day', 'days') : '') +
        '</p>';
      if (c.paid_alternative && c.paid_alternative.price_cents) {
        body += '<p class="ct-cap">We can do this step for them: ' + esc(money(c.paid_alternative.price_cents)) +
          (c.paid_alternative.label ? ' (' + esc(c.paid_alternative.label) + ')' : '') + '</p>';
      }
    } else if (s.total) body += '<p class="ct-cap">Every step on the list is done.</p>';
    const next = (d.next_steps || []).slice(1);
    if (next.length) {
      body += '<p class="ct-cap">After that:</p><ul class="ct-ul">' + next.map((n) => '<li>' + esc(n.title) +
        (n.owner === 'fundhub' ? ' · our team' : '') + '</li>').join('') + '</ul>';
    }
    return box('Their step', body);
  }

  function payBox(d) {
    const p = d.payments || {};
    let body = '';
    if (p.total_late === null || p.total_late === undefined) {
      body = '<p class="ct-big">Not known yet</p><p class="ct-cap">The bank has not shared payment data, and there is no Fundhub payment plan.</p>';
    } else {
      body = '<p class="ct-big">' + esc(p.total_late === 0 ? 'No late payments' : plural(p.total_late, 'late payment', 'late payments')) + '</p>';
      const lines = [];
      (d.late_accounts || []).forEach((a) => lines.push(esc(a.name || 'An account') + ' · the bank marks this payment late'));
      (d.late_plans || []).forEach((pl) => lines.push(esc(pl.name) + ' · ' + esc(plural(pl.late_payments, 'payment', 'payments')) + ' late' +
        (pl.days_late ? ', ' + esc(plural(pl.days_late, 'day', 'days')) : '') + (pl.late_cents ? ', ' + esc(money(pl.late_cents)) + ' due' : '')));
      if (lines.length) body += '<ul class="ct-ul">' + lines.map((l) => '<li>' + l + '</li>').join('') + '</ul>';
      if (p.bank_late === null) body += '<p class="ct-cap">The bank has not shared card or loan payment data yet.</p>';
    }
    return box('Payments', body);
  }

  function seasonBox(d) {
    const s = d.seasoning || {};
    if (!s.opened) return box('Bank seasoning', '<p class="ct-big">No bank account opened yet</p><p class="ct-cap">The clock starts the day they open one. 30 days is seasoned. 60 and 90 are even better.</p>');
    const rows = (s.accounts || []).map((a) => {
      const words = a.seasoned
        ? 'Seasoned \u00b7 day ' + a.day + (a.better ? '. ' + a.better + '+ days.' : '. ' + (a.next_mark || 60) + ' days is even better.')
        : 'Day ' + a.day + ' of ' + a.of;
      /* One bar from 0 to 90 days with marks at 30 and 60 (the CSS draws them),
         so 30 reads as the gate and 60 and 90 as better. */
      /* The bank's own logo (Plaid first, then the bank book) from the read; none, the name alone. */
      const logo = window.FHBankLogo ? window.FHBankLogo.html(a.logo, a.bank) : '';
      return '<li><span class="ct-bank">' + logo + esc(a.bank) + '</span><span class="ct-cap">' + esc(words) + '</span>' +
        '<span class="ct-bar"><progress max="90" value="' + Math.max(0, Math.min(90, Number(a.day) || 0)) + '" aria-label="' + esc(a.bank + ': ' + words) + '"></progress></span></li>';
    }).join('');
    return box('Bank seasoning', '<p class="ct-big">' + esc(s.seasoned + ' of ' + s.opened + ' seasoned') + '</p><ul class="ct-season">' + rows + '</ul>' +
      '<p class="ct-cap">Marks at 30, 60 and 90 days.</p>');
  }

  function gateBox(d) {
    const g = d.apply_gate || { state: 'unknown', checks: [] };
    const head = g.state === 'open' ? 'Ready to apply' : g.state === 'locked' ? 'Locked' : 'Not known yet';
    const items = (g.checks || []).map((c) => {
      const mark = c.passed === true ? 'Yes' : c.passed === false ? 'No' : 'Not known';
      const tone = c.passed === true ? 'ok' : c.passed === false ? 'no' : 'unknown';
      return '<li class="' + tone + '"><span class="ct-mark">' + mark + '</span><span><b>' + esc(c.label) + '</b><span class="ct-cap">' + esc(c.words) + '</span></span></li>';
    }).join('');
    const f = d.fundability;
    const work = f && f.failing && f.failing.length ? '<p class="ct-cap">UnderwriteIQ says to work on: ' + esc(f.failing.join(', ')) + '.</p>' : '';
    const sample = f && f.sample ? '<p class="ct-cap">This credit report is a sample, not a bureau pull.</p>' : '';
    return box('Can they apply?', '<p class="ct-big">' + esc(head) + '</p><ul class="ct-checks">' + items + '</ul>' + work + sample);
  }

  function nudgeBox(d) {
    const first = d.first_name || 'them';
    const f = state.form && state.form.client === d.client_id ? state.form : null;
    const kind = f ? f.kind : 'help';
    const chan = f ? f.channel : 'sms';
    const body = f ? f.body : ((d.drafts && d.drafts[kind]) || '');
    return '<section class="ct-nudge" aria-labelledby="ctNudgeTitle"><h3 id="ctNudgeTitle">Nudge ' + esc(first) + '</h3>' +
      '<div class="ct-nudge-row">' +
        '<div class="q-field"><label for="ctKind">What to send</label><select class="q-select" id="ctKind">' +
          '<option value="help"' + (kind === 'help' ? ' selected' : '') + '>Help with the next step</option>' +
          '<option value="call"' + (kind === 'call' ? ' selected' : '') + '>Offer a paid consulting call</option></select></div>' +
        '<div class="q-field"><label for="ctChan">Send it by</label><select class="q-select" id="ctChan">' +
          '<option value="sms"' + (chan === 'sms' ? ' selected' : '') + '>Text</option>' +
          '<option value="email"' + (chan === 'email' ? ' selected' : '') + '>Email</option></select></div>' +
      '</div>' +
      '<div class="q-field ct-wide"><label for="ctBody">Message</label><textarea class="q-area" id="ctBody" maxlength="4000">' + esc(body) + '</textarea></div>' +
      '<p class="ct-cap">It goes out through the normal send rules. Quiet hours and opt-outs still apply.</p>' +
      '<div class="q-save"><button class="btn" type="button" data-ct-send="' + esc(d.client_id) + '">' + (chan === 'email' ? 'Send the email' : 'Send the text') + '</button>' +
      '<span class="ct-say" id="ctSay" role="status" aria-live="polite">' + esc((f && f.say) || '') + '</span></div></section>';
  }

  /* ── paint ──────────────────────────────────────────────────────────────── */

  function paintCount() {
    if (!state.ready) return;
    if (state.show === 'behind') {
      $('ctCount').textContent = String(state.behind);
      $('ctCountLabel').textContent = 'falling behind';
      $('ctCmp').textContent = 'of ' + plural(state.total, 'client', 'clients') + ' on a plan' + (state.truncated ? ' (first 500 checked)' : '');
    } else {
      $('ctCount').textContent = String(state.total);
      $('ctCountLabel').textContent = state.total === 1 ? 'client on a plan' : 'clients on a plan';
      $('ctCmp').textContent = plural(state.behind, 'is', 'are') + ' falling behind' + (state.truncated ? ' (first 500 checked)' : '');
    }
  }

  function paint() {
    const list = $('ctList');
    const pages = $('ctPages');
    list.setAttribute('aria-busy', 'false');
    if (state.failed) {
      $('ctCount').textContent = '—';
      $('ctCountLabel').textContent = 'list did not load';
      $('ctCmp').textContent = '';
      list.innerHTML = '<div class="card ct-empty"><p>' + esc(state.failed) + '</p><button class="btn ghost" type="button" data-ct-reload="1">Try again</button></div>';
      pages.hidden = true;
      return;
    }
    paintCount();
    if (!state.items.length) {
      list.innerHTML = state.show === 'behind'
        ? '<div class="card ct-empty"><p>No one is falling behind right now.</p><p>A client shows up here when a step sits ' +
          '9 days, a step is 9 days late, or a payment is late.</p><button class="btn ghost" type="button" data-ct-all="1">Show all clients</button></div>'
        : '<div class="card ct-empty"><p>No clients are on a plan yet.</p><p>A client shows up here once they have steps, a Fundhub payment plan or an opened bank account.</p>' +
          '<a class="btn ghost" href="client-control-panel.html">Open the Client Control Panel</a></div>';
      pages.hidden = true;
      return;
    }
    const draft = document.activeElement && host.contains(document.activeElement) ? document.activeElement.id : '';
    list.innerHTML = state.items.map(rowHtml).join('');
    if (draft && $(draft)) $(draft).focus();
    const prev = state.offset > 0;
    pages.hidden = !(prev || state.hasMore);
    pages.innerHTML = (prev ? '<button class="btn ghost" type="button" data-ct-page="prev">Previous clients</button>' : '') +
      (state.hasMore ? '<button class="btn ghost" type="button" data-ct-page="next">More clients</button>' : '');
  }

  function skeleton() {
    const list = $('ctList');
    list.setAttribute('aria-busy', 'true');
    list.innerHTML = '<div class="ct-skel" aria-hidden="true"></div><div class="ct-skel" aria-hidden="true"></div>';
    $('ctCount').textContent = '—';
    $('ctCmp').textContent = 'Checking your clients…';
  }

  /* ── reads ──────────────────────────────────────────────────────────────── */

  let listSeq = 0;
  function load() {
    const seq = ++listSeq;
    skeleton();
    const q = 'view=tracking&show=' + state.show + (state.mine ? '&mine=1' : '') + '&limit=' + PAGE + '&offset=' + state.offset;
    return api('/api/read/csm-queue?' + q).then((res) => {
      if (seq !== listSeq) return;
      const b = res.body;
      if (res.status !== 200 || !b || !b.ok || b.view !== 'tracking' || !Array.isArray(b.items)) {
        state.ready = false;
        state.failed = 'Could not load where your clients are. ' + problem(res);
        paint();
        return;
      }
      state.ready = true;
      state.failed = null;
      state.items = b.items;
      state.total = Number(b.total) || 0;
      state.behind = Number(b.behind_count) || 0;
      state.hasMore = b.hasMore === true;
      state.truncated = b.truncated === true;
      if (state.open && !state.items.some((r) => r.client_id === state.open)) state.open = null;
      paint();
    });
  }

  function loadDetail(id) {
    delete state.detailFailed[id];
    return api('/api/read/csm-queue?view=tracking&client_id=' + encodeURIComponent(id)).then((res) => {
      const b = res.body;
      if (res.status !== 200 || !b || !b.ok || !b.client) {
        state.detailFailed[id] = 'Could not load this client. ' + problem(res);
      } else {
        state.detail[id] = b.client;
      }
      if (state.open === id) paint();
    });
  }

  function toggle(id) {
    state.open = state.open === id ? null : id;
    if (state.open && (!state.form || state.form.client !== id)) state.form = null;
    paint();
    const btn = host.querySelector('[data-ct-open="' + CSS.escape(id) + '"]');
    if (btn) btn.focus();
    if (state.open && !state.detail[id]) loadDetail(id);
  }

  /* ── the nudge ──────────────────────────────────────────────────────────── */

  function formState(id) {
    const d = state.detail[id];
    if (!state.form || state.form.client !== id) {
      state.form = { client: id, kind: 'help', channel: 'sms', body: (d && d.drafts && d.drafts.help) || '', key: null, say: '' };
    }
    return state.form;
  }

  function outcomeWords(body, first) {
    const who = first || 'them';
    if (body.deduped) return 'That message was already sent.';
    switch (body.outcome) {
      case 'sent': return 'Sent to ' + who + '.';
      case 'deferred': return 'Saved. It goes out when quiet hours end' + (body.detail ? ' (' + new Date(body.detail).toLocaleString('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' Arizona)' : '') + '.';
      case 'blocked': return 'The send rules held it, so nothing went out. Check their opt-out and contact details.';
      case 'no_address': return 'There is no address on file for that, so nothing went out.';
      case 'retry': return 'The message service did not answer. It tries again by itself.';
      default: return 'It did not go out. Check the client’s contact details and try again.';
    }
  }

  function send(id, btn) {
    if (state.busy) return;
    const f = formState(id);
    const text = String(f.body || '').trim();
    const say = $('ctSay');
    if (!text) { say.textContent = 'Write a message first.'; say.className = 'ct-say show err'; return; }
    const d = state.detail[id] || {};
    f.key = f.key || ((window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'ct-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    state.busy = true;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    say.className = 'ct-say';
    say.textContent = '';
    const payload = { client_id: id, channel: f.channel, body: text, idempotency_key: f.key };
    if (f.channel === 'email') payload.subject = 'A note from Chris at Fundhub';
    api('/api/messages', { method: 'POST', body: payload }).then((res) => {
      state.busy = false;
      if (res.status !== 200 || !res.body || !res.body.ok) {
        f.say = problem(res);
        paint();
        const s = $('ctSay'); if (s) s.className = 'ct-say show err';
        return;
      }
      const sentOk = res.body.deduped || ['sent', 'deferred', 'retry'].includes(res.body.outcome);
      f.say = outcomeWords(res.body, d.first_name);
      f.key = null;
      if (sentOk) {
        const at = new Date().toISOString();
        d.last_team_text_at = at;
        state.items.forEach((r) => { if (r.client_id === id) r.last_team_text_at = at; });
      }
      paint();
      const s = $('ctSay'); if (s) s.className = 'ct-say show ' + (sentOk ? 'ok' : 'err');
      const again = host.querySelector('[data-ct-send]'); if (again) again.focus();
    });
  }

  /* ── events ─────────────────────────────────────────────────────────────── */

  host.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || !host.contains(t)) return;
    if (t.dataset.ctOpen) return toggle(t.dataset.ctOpen);
    if (t.dataset.ctRetry) { paint(); return loadDetail(t.dataset.ctRetry); }
    if (t.dataset.ctSend) return send(t.dataset.ctSend, t);
    if (t.dataset.ctReload) return load();
    if (t.dataset.ctAll) { state.show = 'all'; state.offset = 0; $('ctShow').value = 'all'; return load(); }
    if (t.dataset.ctPage) {
      state.offset = t.dataset.ctPage === 'next' ? state.offset + PAGE : Math.max(0, state.offset - PAGE);
      state.open = null;
      return load().then(() => host.scrollIntoView({ block: 'start' }));
    }
  });

  host.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'ctShow' || t.id === 'ctMine') {
      state.show = $('ctShow').value === 'all' ? 'all' : 'behind';
      state.mine = $('ctMine').value === '1';
      state.offset = 0;
      state.open = null;
      clearBanner();
      return load();
    }
    if (!state.open) return;
    const f = formState(state.open);
    if (t.id === 'ctKind') {
      f.kind = t.value === 'call' ? 'call' : 'help';
      const d = state.detail[state.open];
      f.body = (d && d.drafts && d.drafts[f.kind]) || f.body;
      f.key = null; f.say = '';
      paint();
      const k = $('ctKind'); if (k) k.focus();
    } else if (t.id === 'ctChan') {
      f.channel = t.value === 'email' ? 'email' : 'sms';
      f.key = null; f.say = '';
      paint();
      const c = $('ctChan'); if (c) c.focus();
    }
  });

  host.addEventListener('input', (e) => {
    if (e.target.id !== 'ctBody' || !state.open) return;
    const f = formState(state.open);
    f.body = e.target.value;
    f.key = null;
  });

  /* The page's own Refresh button refreshes this list too. */
  const refresh = document.getElementById('qRefresh');
  if (refresh) refresh.addEventListener('click', () => { state.detail = {}; state.detailFailed = {}; load().then(() => { if (state.open) loadDetail(state.open); }); });

  /* A reload can bring back the last picked filters; start from what is shown. */
  state.show = $('ctShow').value === 'all' ? 'all' : 'behind';
  state.mine = $('ctMine').value === '1';
  load();
})();
