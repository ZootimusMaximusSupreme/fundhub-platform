/* Shared client journey. All values come from the saved plan and current report. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rows = value => Array.isArray(value) ? value : [];
  const money = cents => typeof cents === 'number' && Number.isFinite(cents)
    ? new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:0}).format(cents / 100) : 'Review needed';
  const date = value => value && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'No report date';
  const labels = {experian:'Experian',equifax:'Equifax',transunion:'TransUnion'};
  const blockerLabels = {
    genuine_credit_report_required:'Credit report needed',
    formed_business_not_on_file:'Business record needed',formation_evidence_required:'State filing proof needed',
    ein_evidence_required:'EIN proof needed',matched_business_credit_report_required:'Matching business report needed',
    business_age_required:'Business history needed',business_report_association_ambiguous:'Business report needs review',
    current_engine_does_not_expose_safe_capacity:'Report needs review',business_capacity_incomplete:'Business checks incomplete',
    shared_personal_guarantee_overlap_not_modeled:'CSM review of shared personal credit needed'
  };
  function route(path) {
    if (!window.FHBlueprintDemo?.active) return path;
    const url = new URL(path,location.origin);
    url.searchParams.set('demo','1');url.searchParams.set('blueprint','full');
    url.searchParams.set('offer',window.FHBlueprintDemo.offer);
    return url.pathname+url.search+url.hash;
  }
  const button = (text, action, extra='') => `<button type="button" data-bj-action="${esc(action)}" ${extra}>${esc(text)}</button>`;
  const link = (text,path) => `<a href="${esc(route(path))}">${esc(text)}</a>`;
  const done = waypoint => Boolean(waypoint?.completedAt) || ['done','completed','verified'].includes(waypoint?.state);
  function checklist(progress,plans) {
    const applicable = rows(progress?.waypoints).filter(w => w.closedBy !== 'ongoing' && w.verifyKind !== 'no_new_credit' && w.state !== 'not_applicable');
    const completed = applicable.filter(done).length+(plans?.startedAt?1:0);
    const total=applicable.length+(plans?1:0);
    return {completed,total,percent:total?Math.round(completed/total*100):0};
  }
  function opportunity(data) {
    return data?.creditContext?.opportunity || data?.opportunity || data?.progress?.opportunity || {};
  }
  function impact(next, model) {
    const key = next?.verifyKind === 'paydown' ? 'utilization' : /ein/i.test(next?.key||'') ? 'ein'
      : /llc|formation/i.test(next?.key||'') ? 'formation' : /bank/i.test(next?.key||'') ? 'bank_preparation' : null;
    const step = rows(model.steps).find(s=>s.key===key);
    if (typeof step?.liftCents === 'number' && step.liftCents > 0) return `Your utilization plan models ${money(step.liftCents)} more personal funding capacity. This is the joint paydown scenario, counted once.`;
    return 'This step clears a requirement on your path to funding. Dollar impact appears when your report supports an estimate.';
  }
  function reports(data) {
    const personal = rows(data?.progress?.scores?.personal);
    const report = personal.find(r=>r.reportDocumentId);
    if (report) return button('Open full credit report','document',`data-document="${esc(report.reportDocumentId)}"`);
    if (window.FHBlueprintDemo?.active && data?.creditContext?.reportId) return `<a href="${esc(window.FHBlueprintDemo.previewUrl('document','credit-report'))}" target="_blank" rel="noopener noreferrer">Open full sample credit report</a>`;
    return link('Open credit reports','/progress.html#cScores');
  }
  function funding(model,businessPlans,fundingState) {
    const p=model.personal||{},combined=model.combined||{};
    const planned=rows(businessPlans?.businesses);
    const businesses=rows(model.businesses).length?rows(model.businesses):[...planned,...rows(businessPlans?.existingBusinesses).filter(b=>!planned.some(p=>p.businessId===b.id))];
    const stateLabels={needs_file:'Report needed',optimize:'Preparing your credit file',held:'Waiting on a required step',ready:'Permitted bank ready',awaiting_response:'Waiting for bank responses',managed:'Fundhub is running this round',completed:'Purchased round complete'};
    const readiness=stateLabels[fundingState]||(model.personal?.currentCents==null?'Report review needed':'Credit modeled · business checks open');
    const blockers=[...new Set([...rows(p.blockers),...rows(model.businesses).flatMap(b=>rows(b.blockers))])];
    return `<section class="bj-funding"><div class="bj-heading"><h3>Funding opportunity</h3><span class="bj-label">Modeled from your report</span></div>
      <p class="bj-fundability-state">${esc(readiness)}</p><p class="bj-caption">Personal funding capacity</p><div class="bj-capacity">${money(p.currentCents)}${typeof p.projectedCents==='number'?` <span aria-label="projected after plan">→ ${money(p.projectedCents)}</span>`:''}</div>
      ${typeof p.liftCents==='number'&&p.liftCents>0?`<p class="bj-impact">${money(p.liftCents)} potential lift in the modeled plan</p>`:''}
      <div class="bj-businesses">${businesses.length?businesses.map(b=>{const item=b;return `<div><strong>${esc(b.name)}</strong><span>${typeof item.currentCents==='number'?money(item.currentCents):esc(blockerLabels[rows(item.blockers)[0]]||'Business checks needed')}</span></div>`;}).join(''):'<p class="bj-caption">Add your businesses to track each company separately.</p>'}</div>
      <div class="bj-total"><strong>Total funding picture</strong><span>${typeof combined.currentCents==='number'?money(combined.currentCents):'CSM review needed'}</span></div>
      ${blockers.length?`<ul class="bj-blockers" aria-label="Remaining fundability checks">${blockers.slice(0,4).map(b=>`<li>${esc(blockerLabels[b]||'Team review needed')}</li>`).join('')}</ul>`:''}<p class="bj-caption">Personal credit is counted once. Company estimates need matching business reports and overlap review. Estimates are not approvals.</p>${link('See fundability in FinanceOS','/app/financeos.html#fundability')}</section>`;
  }
  function credit(data) {
    const scores=rows(data?.progress?.scores?.personal),businessScores=rows(data?.progress?.scores?.business);
    return `<section class="bj-credit"><h3>Credit & reports</h3><dl>${['experian','equifax','transunion'].map(b=>{const s=scores.find(x=>String(x.bureau).toLowerCase()===b);return `<div><dt>${labels[b]}</dt><dd>${typeof s?.score==='number'?esc(s.score):'Not pulled yet'}</dd><small>${date(s?.pulledAt)}</small></div>`;}).join('')}</dl>
      <p class="bj-caption">${businessScores.length?`${businessScores.length} business credit file${businessScores.length===1?'':'s'} tracked.`:'Business credit is tracked separately for each company. Add the matching business report when available.'}</p>
      <div class="bj-actions">${reports(data)}${button('Soft-pull access & report status','credit')}</div></section>`;
  }
  function roadmap(data) {
    const progress=data?.progress||{},nextId=data.businessPlans?.startedAt?progress.nextStep?.waypointId:null;
    const waypoints=rows(progress.waypoints).filter(w=>w.closedBy!=='ongoing'&&w.verifyKind!=='no_new_credit');
    return `<section class="bj-roadmap"><div class="bj-heading"><h3>Your waypoints</h3>${link('View all progress','/progress.html')}</div><ol><li class="bj-step" data-state="${data.businessPlans?.startedAt?'done':'current'}"><div><span class="bj-state">${data.businessPlans?.startedAt?'✓ Complete':'Your next step'}</span><h4>Blueprint onboarding</h4></div></li>${waypoints.slice(0,5).map(w=>`<li class="bj-step" data-state="${done(w)?'done':String(w.id)===String(nextId)?'current':['blocked','awaiting_review'].includes(w.state)?'waiting':'upcoming'}"><div><span class="bj-state">${done(w)?'✓ Complete':String(w.id)===String(nextId)?(w.owner==='client'?'Your next step':'Fundhub team check'):w.state==='blocked'?'Help needed':'Upcoming'}</span><h4>${esc(w.title)}</h4></div>${String(w.id)===String(nextId)?link('Continue','/progress.html#waypoints'):''}</li>`).join('')||`<li class="bj-step" data-state="current"><div><span class="bj-state">Your next step</span><h4>Start your Blueprint onboarding</h4><p class="bj-caption">Confirm your starting point, then build your business plans.</p></div></li>`}</ol></section>`;
  }
  function render({data={},next={},control='',hasFundingEngine=false,moneyOverview=null,fundingState=null}={}) {
    const progress=data.progress||{},counts=checklist(progress,data.businessPlans),model=opportunity(data);
    const started=Boolean(data.businessPlans?.startedAt);
    const title=started?(next.title||'Review your next step'):'Start your Blueprint';
    const detail=started?(next.detail||'Follow the next action from your saved plan.'):'Tell us your starting point and add your businesses. We’ll guide the credit, company setup, and banking work along the way.';
    const nextControl=started?control:button(Number(data.businessPlans?.setupStep)>0?'Continue setup':'Start my plan','onboarding');
    const milestone=started&&counts.completed===1?'Onboarding complete':counts.completed?`${counts.completed} waypoint${counts.completed===1?'':'s'} completed`:'Your first milestone: complete onboarding';
    return `<div class="bj-summary" data-blueprint-journey>
      <section class="bj-next"><div><span class="bj-label">Your next step</span><h2>${esc(title)}</h2><p>${esc(detail)}</p><p class="bj-impact">${esc(started?impact(next,model):'Set a clear starting point so your next action fits your credit and each business.')}</p><div class="bj-actions">${nextControl}</div></div><aside class="bj-readiness"><span class="bj-value">${counts.percent}%</span><span>Blueprint steps complete</span><progress value="${counts.percent}" max="100" aria-label="Blueprint checklist completion"></progress><small>${counts.completed} of ${counts.total} applicable waypoints</small><p class="bj-milestone">${esc(milestone)}</p><small>Checklist progress is separate from fundability.</small></aside></section>
      ${funding(model,data.businessPlans,fundingState)}${credit(data)}${roadmap(data)}
      <section class="bj-finance"><h3>FinanceOS</h3><p class="bj-caption">Your accounts, cash flow, credit, and financial plan in the same workspace.</p><dl><div><dt>Personal cash</dt><dd>${moneyOverview?.cash?.personal?.cents==null?'Account connection needed':money(moneyOverview.cash.personal.cents)}</dd></div><div><dt>Business cash</dt><dd>${moneyOverview?.cash?.business?.cents==null?'Account connection needed':money(moneyOverview.cash.business.cents)}</dd></div></dl><p class="bj-caption">Cash stays separate by owner. ${moneyOverview?.sandbox?'Fictional sample accounts.':''}</p>${link('Open FinanceOS','/app/financeos.html')}</section>
      <section class="bj-help"><h3>Do it yourself. Get help along the way.</h3><p class="bj-caption">Tools and instructions are included. Your CSM can help choose the right service.</p><div class="bj-actions">${button('Add or manage businesses','businesses')}${button('DIY & $97 mailed letters','letters')}${button('Repair: per round or full','repair-help')}${button('Aged business options','aged-help')}${hasFundingEngine?button('Funding engine & paid help','funding'):button('Upgrade or request funding help','upgrade')}</div><p class="bj-caption">${hasFundingEngine?'Your implementation offer includes the funding engine.':'Your preparation offer does not include the funding engine. Ask your CSM about an upgrade or assisted funding.'}</p></section>
    </div>`;
  }
  window.FHBlueprintJourney={render,route,checklist};
  document.addEventListener('click',event=>{const el=event.target.closest('[data-bj-action]');if(!el)return;document.dispatchEvent(new CustomEvent('fh:blueprint-navigate',{detail:{action:el.dataset.bjAction,documentId:el.dataset.document||null}}));});
})();
