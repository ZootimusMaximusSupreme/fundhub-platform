// Unit MAIL: "Mail it for me · $97" on each repair letter, next to "Mail it
// yourself". The real page, with every /api/** answered here from the real
// server modules (src/blueprint/letter-mailing.mjs: read, quote, confirm,
// status, mail, tracker) over an in-memory file. No database, no card, no mail:
// the payment and the mail house are fixtures. Screens are checked and saved
// at 1440, 390 and 320 wide.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { buildBlueprintClientPlan } from '../src/blueprint/client-plan.mjs';
import { preparationGuidance, websitePrompt } from '../src/blueprint/preparation-guidance.mjs';
import { letterCycle } from '../src/blueprint/fulfillment-cycle.mjs';
import { readLetterMailing, quoteLetterMailing, confirmLetterMailing, reconcileLetterMailing, fulfilLetterMailing,
  trackLetterMailings, LetterMailingError, MAILING_AUTHORIZATION, REPAIR_LETTER_SUBTYPE } from '../src/blueprint/letter-mailing.mjs';

const ORG = '10000000-0000-4000-8000-000000000001';
const CLIENT = '20000000-0000-4000-8000-000000000002';
const ACCOUNT = '30000000-0000-4000-8000-000000000003';
const ENGAGEMENT = '40000000-0000-4000-8000-000000000004';
const EVIDENCE = process.env.MAIL_EVIDENCE_DIR || 'ops/workflows/build-evidence/mail';
const WIDTHS = [[1440, 900], [390, 844], [320, 740]];
const BUREAUS = { EX: 'Experian', EQ: 'Equifax', TU: 'TransUnion' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const sha = b => `sha256:${createHash('sha256').update(b).digest('hex')}`;

/* One sample client: one round of three bureau letters, saved as HTML files. */
function world({ mailSupported = true } = {}) {
  const scope = { orgId: ORG, clientId: CLIENT, accountId: ACCOUNT, now: new Date('2026-11-07T18:00:00Z') };
  const files = new Map(), orders = new Map(), letters = new Map(), sent = [];
  const docs = ['EX', 'EQ', 'TU'].map(bureau => {
    const id = randomUUID(), letterId = randomUUID(), key = `fixture-${id}`;
    const body = Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><title>Dispute letter — ${BUREAUS[bureau]} R1</title></head><body><pre>Sample ${BUREAUS[bureau]} dispute letter.</pre></body></html>`);
    files.set(key, body);
    letters.set(letterId, { id: letterId, bureau, status: 'generated' });
    return { id, title: `Dispute letter — ${BUREAUS[bureau]} R1`, subtype: REPAIR_LETTER_SUBTYPE, metadata: { bureau, round: 'R1', target: 'bureau', letterId },
      generated_at: scope.now, version_id: randomUUID(), version_storage_key: key, version_checksum: sha(body), version_mime_type: 'text/html', version_byte_size: body.length };
  });
  const byLetter = id => docs.find(d => d.metadata.letterId === id);
  const repo = {
    client: async () => ({ id: CLIENT, org_id: ORG, email: 'sample@example.test' }),
    letters: async () => docs.map(d => ({ ...d, letter_open: letters.get(d.metadata.letterId).status === 'generated' })),
    orders: async () => [...orders.values()].reverse(), verifiedCustomer: async () => null,
    current: async (s, f) => docs.some(d => d.id === f.documentId && d.version_id === f.versionId && d.version_checksum === f.checksum),
    repairOpen: async (s, f) => letters.get(f.letterId)?.status === 'generated',
    get: async (s, id) => orders.get(id) || null,
    quote: async (s, snapshot, quote_version) => {
      const old = [...orders.values()].find(o => !['mailed', 'cancelled'].includes(o.state));
      if (old && old.quote_version === quote_version) return old;
      if (old) old.state = 'cancelled';
      const id = randomUUID(), o = { id, org_id: ORG, client_id: CLIENT, snapshot, quote_version, price_total_cents: 9700, ledger_status: 'quoted', state: 'quoted', payment_state: 'none',
        created_at: s.now, envelopes: snapshot.files.map(f => ({ id: randomUUID(), order_id: id, org_id: ORG, client_id: CLIENT, state: 'ready', bureau: f.bureau, document_id: f.documentId, snapshot: f, dispute_letter_id: f.letterId })) };
      orders.set(id, o); return o;
    },
    begin: async (s, id) => { const o = orders.get(id); if (o.payment_state !== 'none') return false;
      Object.assign(o, { payment_state: 'creating_checkout', state: 'payment_pending', authorized_at: s.now, authorization_text: MAILING_AUTHORIZATION, attempt_started_at: s.now }); return true; },
    saveHosted: async (s, id, r) => Object.assign(orders.get(id), { state: 'awaiting_payment', payment_state: 'awaiting_payment', checkout_url: r.checkoutUrl, checkout_product_id: r.productId }),
    paid: async (s, id, r) => Object.assign(orders.get(id), { state: 'mail_pending', payment_state: 'paid', provider_payment_ref: r.providerRef, ledger_status: 'paid', ledger_payment_ref: r.providerRef, ledger_amount_paid_cents: 9700 }),
    hold: async (s, id, reason) => Object.assign(orders.get(id), { state: 'needs_review', reason }),
    claim: async (s, id, eid) => { const e = orders.get(id).envelopes.find(x => x.id === eid); const l = letters.get(e.dispute_letter_id);
      if (e.state !== 'ready') return null; if (l.status !== 'generated') throw new LetterMailingError('repair_letter_already_handled', 'already sent');
      l.status = 'sending'; Object.assign(e, { state: 'sending', claim_token: randomUUID(), claimed_at: s.now }); return e; },
    /* CX28: the mail house taking it is not mailed; the repair letter keeps "sending". */
    accepted: async (s, id, e, providerId) => { Object.assign(e, { state: 'accepted', provider_id: providerId, accepted_at: s.now }); },
    envelopeHold: async (s, id, e) => { e.state = 'needs_review'; orders.get(id).state = 'needs_review'; },
    complete: async (s, id) => { const o = orders.get(id); if (o.envelopes.every(e => e.state === 'accepted')) o.state = 'mailed'; },
    checked: async () => {},
    trackable: async limit => [...orders.values()].flatMap(o => o.envelopes).filter(e => e.state === 'accepted' && !e.expected_delivery_at).slice(0, limit),
    /* The same rules as the real track(): dates set once, the repair letter sent only at the reported
       handoff (CX28), the reply date only from the expected delivery date (CX27). */
    track: async (e, facts, now) => { const expected = e.expected_delivery_at || facts?.expectedDeliveryAt || null, wasMailed = e.mailed_at;
      Object.assign(e, { provider_status: facts?.providerStatus ?? e.provider_status, imb_status: facts?.imbStatus ?? e.imb_status,
        mailed_at: e.mailed_at || facts?.mailedAt || null, expected_delivery_at: expected,
        reply_due_at: e.reply_due_at || (expected ? new Date(new Date(expected).getTime() + 30 * 86400000).toISOString() : null), tracked_at: now });
      const mailedNow = !wasMailed && !!e.mailed_at;
      if (mailedNow) letters.get(e.dispute_letter_id).status = 'sent';
      return { mailedNow, orderId: e.order_id, bureau: e.bureau, providerId: e.provider_id, disputeLetterId: e.dispute_letter_id }; }
  };
  let receipt = { status: 'pending' };
  const providers = { capabilities: () => ({ hostedCheckoutSupported: mailSupported, mailSupported }), savedCards: async () => [],
    hosted: async () => ({ ok: true, checkoutUrl: 'https://www.fanbasis.com/sample/s/1', sessionId: 'session_sample', productId: 'product_sample' }),
    readHosted: async () => receipt, charge: async () => { throw new Error('no card is ever charged here'); },
    sendEnvelope: async args => { sent.push(args); return { ok: true, providerId: `letter_sample${sent.length}` }; } };
  const deps = { repo, providers, loadFrom: async () => ({ name: 'Alex Sample', line1: '100 Example Street', line2: null, city: 'Phoenix', state: 'AZ', postalCode: '85004' }),
    loadPdf: async f => files.get(f.storageKey), active: async () => true, readLetterApprovals: async () => new Map(), onRepairEvent: async () => ({ ok: true }) };
  const heldByPaid = docId => [...orders.values()].some(o => o.payment_state === 'paid' && o.envelopes.some(e => e.document_id === docId));
  const repair = () => ({ ok: true, program: null, authorization: { signed: true, packetComplete: true, identityReviewed: true, missing: [], uploads: [] },
    stage: 'Round 1 letters are ready.', currentRound: 'R1', executionOwner: 'client', actions: { canGenerate: false },
    cases: docs.map(d => { const l = letters.get(d.metadata.letterId);
      return { id: `case-${d.metadata.bureau}`, bureau: d.metadata.bureau, round: 'R1', status: 'open', items: [{ id: `item-${d.metadata.bureau}`, creditor: 'Sample Collections', status: l.status === 'sent' ? 'sent' : 'open' }],
        letters: [{ id: l.id, documentId: d.id, bureau: d.metadata.bureau, round: 'R1', target: 'bureau', status: l.status, submission: null,
          canRecordSubmission: l.status === 'generated' && !heldByPaid(d.id), ...letterCycle({ bureau: d.metadata.bureau, versionId: d.version_id, approvals: new Map() }) }] }; }) });
  return { scope, docs, orders, letters, sent, deps, repair, byLetter, pay: () => { receipt = { status: 'paid', providerRef: 'sample_receipt', amountCents: 9700 }; } };
}

async function open(page, w) {
  const writes = [];
  const plans = { orgId: ORG, clientId: CLIENT, version: 1, targetBusinessCount: 1, setupStep: 3, startedAt: '2026-10-01T12:00:00Z', hasExistingBusiness: false,
    homeState: 'AZ', postalCode: '85004', availableCashCents: 600000, monthlyIncomeCents: 750000, cashBufferCents: 200000, oneTimePayoffCents: null, payoffPlan: null,
    businesses: [], existingBusinesses: [], stepProgress: [] };
  const plan = () => buildBlueprintClientPlan({ query: async sql => {
    if (/FROM clients/.test(sql)) return { rows: [{ id: CLIENT, org_id: ORG, first_name: 'Alex', last_name: 'Sample', custom_fields: {} }] };
    return { rows: [] };
  } }, w.scope, { readBusinessPlans: async () => structuredClone(plans),
    readClientProgress: async () => ({ waypoints: [], nextStep: null, scores: { personal: [], business: [] } }), bankStrategy: async () => null,
    preparationGuidance, websitePrompt, rankLocalCreditUnions: async () => ({ status: 'candidates_for_review', source: { name: 'Offline fixture', asOf: '2026-06' }, candidates: [] }),
    readBlueprintPath: async () => null, readCycle: async () => ({ offer: 'implementation', fundable: null, bookCallUrl: null, fullReports: [] }),
    readBlueprintLetterReadiness: async () => ({ state: 'not_ready', usableLetterCount: 0, mailingOrderCount: 0 }) });
  const engagement = { id: ENGAGEMENT, orgId: ORG, clientId: CLIENT, status: 'active', executionOwner: 'client', roundId: null };
  await page.addInitScript(() => localStorage.setItem('fh_token', 'mail-browser-fixture'));
  await page.context().route('https://www.fanbasis.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Sample secure checkout</h1>' }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname, method = route.request().method();
    if (path === '/api/auth/session') return json(route, { ok: true, principal: 'client', staff: { id: ACCOUNT, org_id: ORG, client_id: CLIENT, role: 'client', principal_kind: 'client', name: 'Alex Sample', status: 'active' } });
    if (path === '/api/blueprint/plan') return json(route, await plan());
    if (path === '/api/blueprint/funding' && method === 'GET') return json(route, { ok: true, engagement, state: 'optimize', nextAction: 'Mail your Round 1 letters.', lenders: [], applications: [], submissionsClosed: false, canFinishSubmissions: false });
    if (path === '/api/blueprint/inquiries' && method === 'GET') return json(route, { ok: true, cases: [] });
    if (path === '/api/blueprint/repair' && method === 'GET') return json(route, w.repair());
    if (path === '/api/blueprint/services' && method === 'GET') return json(route, { ok: true, engagement, allowance: { includedAvailable: false }, serviceTypes: [], requests: [], capabilities: {} });
    if (path === '/api/blueprint/letter-mailing') {
      try {
        if (method === 'GET') return json(route, await readLetterMailing({}, w.scope, w.deps));
        const body = route.request().postDataJSON();
        writes.push(body);
        const result = body.action === 'quote' ? await quoteLetterMailing({}, w.scope, body, w.deps)
          : body.action === 'confirm' ? await confirmLetterMailing({}, w.scope, body, w.deps)
          : body.action === 'status' ? await reconcileLetterMailing({}, w.scope, body.orderId, w.deps)
          : null;
        return result ? json(route, result) : json(route, { ok: false, error: 'invalid_input', message: 'Choose an available mailing action.' }, 400);
      } catch (error) {
        if (error instanceof LetterMailingError) return json(route, { ok: false, error: error.code, message: error.message }, error.status);
        throw error;
      }
    }
    if (path.includes('portal-summary')) return json(route, { ok: true, documents: [], scores: {}, soft_pull_complete: true, dispute_consent: { allowed: true }, stage: { key: 'paid' }, upcoming_call: null });
    return json(route, { ok: true, items: [], rows: [], documents: [], payments: [] });
  });
  await page.goto('/app/client-portal.html');
  const host = page.locator('#blueprint-fulfillment');
  await host.locator('[data-bf-action="view"][data-view="repair"]').first().click();
  await expect(host.locator('[data-brm-letter]').first()).toBeVisible();
  return { host, writes };
}

async function checkFormat(page, selector, name) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    const chat = page.locator('#fh-chat-close');
    if (await chat.isVisible().catch(() => false)) await chat.click();
    const target = page.locator(selector).first();
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeVisible();
    const layout = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      const box = el.getBoundingClientRect();
      // A checkbox's target is its label (the host's own pattern), so the label is measured.
      const small = [...el.querySelectorAll('button,a[href],input,select,summary')].filter(c => c.offsetParent && c.type !== 'hidden')
        .map(c => ['checkbox', 'radio'].includes(c.type) && c.closest('label') ? c.closest('label') : c)
        .map(c => ({ text: (c.textContent || c.getAttribute('aria-label') || '').trim().slice(0, 40), w: c.getBoundingClientRect().width, h: c.getBoundingClientRect().height }))
        .filter(c => c.w < 44 || c.h < 44);
      const clipped = [...el.querySelectorAll('*')].filter(c => c.offsetParent && c.scrollWidth > c.clientWidth + 1 && getComputedStyle(c).overflowX !== 'visible').length;
      const outside = [...el.querySelectorAll('*')].filter(c => c.offsetParent && (c.getBoundingClientRect().right > innerWidth + 0.5 || c.getBoundingClientRect().left < -0.5)).length;
      return { pageWide: document.documentElement.scrollWidth, left: box.left, right: box.right, small, clipped, outside };
    }, selector);
    expect(layout.pageWide, `${name} at ${width}: no sideways scroll`).toBeLessThanOrEqual(width);
    expect(layout.left, `${name} at ${width}: starts on the page`).toBeGreaterThanOrEqual(0);
    expect(layout.right, `${name} at ${width}: ends on the page`).toBeLessThanOrEqual(width);
    expect(layout.small, `${name} at ${width}: every control is 44 by 44`).toEqual([]);
    expect(layout.clipped, `${name} at ${width}: nothing clipped inside`).toBe(0);
    expect(layout.outside, `${name} at ${width}: nothing falls off the page`).toBe(0);
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el);
        if (s.position === 'fixed' && el.getBoundingClientRect().bottom >= innerHeight - 2 && el.getBoundingClientRect().top > innerHeight / 2) el.setAttribute('data-mail-shot-hide', '');
      }
      const style = document.createElement('style');
      style.id = 'mail-shot';
      style.textContent = '[data-mail-shot-hide]{visibility:hidden!important}';
      document.head.append(style);
    });
    const tall = Math.ceil(await target.evaluate(el => el.getBoundingClientRect().height));
    if (tall + 160 > height) await page.setViewportSize({ width, height: tall + 160 });
    await target.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await target.screenshot({ path: `${EVIDENCE}/${name}-${width}.png` });
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      document.getElementById('mail-shot')?.remove();
      for (const el of document.querySelectorAll('[data-mail-shot-hide]')) el.removeAttribute('data-mail-shot-hide');
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test('each repair letter offers Mail it yourself and Mail it for me · $97', async ({ page }) => {
  const w = world();
  const { host } = await open(page, w);
  const first = host.locator('.bf-item').first();
  await expect(first.locator('.brm')).toContainText('How to send it');
  await expect(first.getByRole('button', { name: 'Mail it yourself' })).toBeVisible();
  await expect(first.getByRole('button', { name: 'Mail it for me · $97' })).toBeVisible();
  await expect(host.getByRole('button', { name: 'Mail it for me · $97' })).toHaveCount(3);
  await checkFormat(page, '#blueprint-fulfillment .bf-item', 'repair-letter-choice');
  await first.getByRole('button', { name: 'Mail it yourself' }).click();
  await expect(first.locator('details[data-brm-self]')).toHaveAttribute('open', '');
  await expect(first.getByText('How did you submit it?')).toBeVisible();
});

test('Mail it for me: one $97 for the round, the client picks the letters, says yes, and pays on the secure checkout', async ({ page }) => {
  const w = world();
  const { host, writes } = await open(page, w);
  const first = host.locator('.bf-item').first();
  await first.getByRole('button', { name: 'Mail it for me · $97' }).click();
  const panel = first.locator('.brm-panel');
  await expect(panel).toContainText('We mail these for $97');
  await expect(panel.getByRole('checkbox', { name: 'Experian · Round 1' })).toBeChecked();
  await expect(panel.getByRole('checkbox', { name: 'Equifax · Round 1' })).toBeChecked();
  await expect(panel.getByRole('checkbox', { name: 'TransUnion · Round 1' })).toBeChecked();
  await expect(panel).toContainText('From Alex Sample, 100 Example Street, Phoenix, AZ 85004');
  expect(writes.filter(b => b.action === 'quote').at(-1).documentIds).toHaveLength(3);
  await checkFormat(page, '#blueprint-fulfillment .bf-item .brm-panel', 'mail-for-me-review');
  await panel.getByRole('checkbox', { name: 'TransUnion · Round 1' }).uncheck();
  await expect(panel.getByRole('button', { name: 'Pay $97' })).toBeVisible();
  expect(writes.filter(b => b.action === 'quote').at(-1).documentIds.sort()).toEqual([w.docs[0].id, w.docs[1].id].sort());
  await panel.getByRole('button', { name: 'Pay $97' }).click();
  expect(writes.some(b => b.action === 'confirm'), 'no payment starts without the yes box').toBe(false);
  await panel.getByRole('checkbox', { name: /I read these letters/ }).check();
  await panel.getByRole('button', { name: 'Pay $97' }).click();
  await expect(first.locator('.brm')).toContainText('Waiting for payment.');
  const confirm = writes.find(b => b.action === 'confirm');
  expect(confirm.authorization).toBe(true);
  expect(confirm.idempotencyKey).toMatch(/^[a-f0-9]{32}$/);
  await expect(first.getByRole('link', { name: 'Pay $97' })).toHaveAttribute('href', 'https://www.fanbasis.com/sample/s/1');
  await expect(host.locator('.bf-item').nth(2).getByRole('button', { name: 'Mail it for me · $97' })).toBeVisible();
  await checkFormat(page, '#blueprint-fulfillment .bf-item .brm', 'mail-for-me-payment');
  await first.getByRole('button', { name: 'Check payment' }).click();
  await expect(first.locator('.brm-status')).toHaveText('Not paid yet.');
  w.pay();
  await first.getByRole('button', { name: 'Check payment' }).click();
  await expect(first.locator('.brm')).toContainText('Paid. We mail it soon.');
  await expect(first.locator('details[data-brm-self]'), 'Fundhub mails a paid letter, so the client does not').toHaveCount(0);
  expect(w.sent).toHaveLength(0);
});

test('after payment the same mail house path takes the saved letter; the tracker shows sending, mailed, expected delivery and reply due', async ({ page }) => {
  const w = world();
  const { host } = await open(page, w);
  const first = host.locator('.bf-item').first();
  await first.getByRole('button', { name: 'Mail it for me · $97' }).click();
  const panel = first.locator('.brm-panel');
  await panel.getByRole('checkbox', { name: 'Equifax · Round 1' }).uncheck();
  await expect(panel.getByRole('button', { name: 'Pay $97' })).toBeVisible();
  await panel.getByRole('checkbox', { name: 'TransUnion · Round 1' }).uncheck();
  await expect(panel.getByRole('button', { name: 'Pay $97' })).toBeVisible();
  await panel.getByRole('checkbox', { name: /I read these letters/ }).check();
  await panel.getByRole('button', { name: 'Pay $97' }).click();
  await expect(first.locator('.brm')).toContainText('Waiting for payment.');
  w.pay();
  const order = [...w.orders.values()].find(o => o.state === 'awaiting_payment');
  await reconcileLetterMailing({}, w.scope, order.id, w.deps);
  expect((await fulfilLetterMailing({}, w.scope, order.id, w.deps)).status).toBe('mailed');
  expect(w.sent).toHaveLength(1);
  expect(w.sent[0].html).toContain('Sample Experian dispute letter.');
  expect(w.sent[0].pdf).toBeUndefined();
  const events = [];
  const read = (now, letter) => trackLetterMailings({}, { repo: w.deps.repo, now: new Date(now), providers: { readLetter: async () => ({ ok: true, letter }) },
    onRepairEvent: async (_db, event) => { events.push(event); } });
  /* One refresh at a time: wait for this refresh's own mailing read, so an older refresh
     can never re-draw the page in the middle of the next check. */
  const refresh = async () => {
    const read = page.waitForResponse(r => new URL(r.url()).pathname === '/api/blueprint/letter-mailing' && r.request().method() === 'GET');
    await host.locator('[data-bf-action="refresh"]').click();
    await read;
  };
  // CX28: the mail house has it, but it is not mailed: "Sending", the repair file says sending, no email yet.
  await refresh();
  const track = first.locator('.brm-track');
  await expect(track).toBeVisible();
  await expect(track.locator('li').nth(0)).toHaveText('Sending');
  await expect(track.locator('li').nth(1)).toHaveText('Delivery');
  await expect(track.locator('li').nth(2)).toHaveText('Reply due');
  await expect(first.locator('.brm')).not.toContainText('Mailed');
  // The letter card says its status in RPT's plain words ("Sending"), not the raw status.
  await expect(first.locator('.bf-panel').first()).toContainText('Sending');
  await checkFormat(page, '#blueprint-fulfillment .bf-item .brm', 'mail-tracker-sending');
  await read('2026-11-08T12:00:00Z', { status: 'printing', updatedAt: '2026-11-08T10:00:00Z' });
  await refresh();
  await expect(track.locator('li').nth(0)).toHaveText('Sending');
  expect(events, 'still printing: no letters-sent email').toHaveLength(0);
  // PostGrid reports processed_for_delivery, "handed off to the local postal service": Mailed, on that day.
  await read('2026-11-11T12:00:00Z', { status: 'processed_for_delivery', imbStatus: 'out_for_delivery', imbDate: '2026-11-10', updatedAt: '2026-11-09T16:00:00Z' });
  await refresh();
  await expect(track.locator('li').nth(0)).toHaveText(/Mailed\s*Nov 9/);
  await expect(track.locator('li').nth(1)).toHaveText('Out for delivery');
  // CX27: the bureau has not got it yet, so there is no reply date to show.
  await expect(track.locator('li').nth(2)).toHaveText('Reply due');
  await expect(first.locator('.bf-panel').first()).toContainText('Sent');
  expect(events.map(e => e.name)).toEqual(['repair.letters.sent']);
  await expect(first.locator('details[data-brm-self]')).toHaveCount(0);
  await expect(host.locator('.bf-item').nth(1).getByRole('button', { name: 'Mail it for me · $97' })).toBeVisible();
  await checkFormat(page, '#blueprint-fulfillment .bf-item .brm', 'mail-tracker-mailed');
  // PostGrid marks it "completed": its own "most likely delivered". CX26: that is an
  // expected delivery date, never "Delivered". CX27: the reply date counts from it.
  await read('2026-11-13T12:00:00Z', { status: 'completed', imbStatus: 'out_for_delivery', imbDate: '2026-11-11', updatedAt: '2026-11-12T16:00:00Z' });
  await refresh();
  await expect(track.locator('li').nth(0)).toHaveText(/Mailed\s*Nov 9/);
  await expect(track.locator('li').nth(1)).toHaveText(/Expected delivery\s*Nov 12/);
  await expect(track.locator('li').nth(2)).toHaveText(/Reply due\s*Dec 12/);
  await expect(first.locator('.brm')).not.toContainText('Delivered');
  expect(events, 'the letters-sent email goes out once').toHaveLength(1);
  await checkFormat(page, '#blueprint-fulfillment .bf-item .brm', 'mail-tracker-expected-delivery');
});

test('with no mail house set up, the letter still offers Mail it yourself and never shows a $97 button', async ({ page }) => {
  const { host } = await open(page, world({ mailSupported: false }));
  await expect(host.getByRole('button', { name: 'Mail it yourself' })).toHaveCount(3);
  await expect(host.getByRole('button', { name: /Mail it for me/ })).toHaveCount(0);
});
