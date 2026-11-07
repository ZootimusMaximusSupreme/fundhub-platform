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
    const applicable = rows(progress?.waypoints).filter(w => w.closedBy !== 'ongoing' && w.verifyKind !== 'no_new_credit' && !['skipped','not_applicable'].includes(w.state));
    const completed = applicable.filter(done).length+(plans?.startedAt?1:0);
    const total=applicable.length+(plans?1:0);
    return {completed,total,percent:total?Math.round(completed/total*100):0};
  }
  function opportunity(data) {
    return data?.creditContext?.opportunity || data?.opportunity || data?.progress?.opportunity || {};
  }
  function impact(next, model) {
    if (next?.impactText) return next.impactText;
    const key = next?.verifyKind === 'paydown' ? 'utilization' : /ein/i.test(next?.key||'') ? 'ein'
      : /llc|formation/i.test(next?.key||'') ? 'formation' : /bank/i.test(next?.key||'') ? 'bank_preparation' : null;
    const step = rows(model.steps).find(s=>s.key===key);
    if (typeof step?.liftCents === 'number' && step.liftCents > 0) return `Your utilization plan models ${money(step.liftCents)} more personal funding capacity.`;
    return 'This step clears a requirement on your path to funding.';
  }
  function reports(data) {
    /* The full credit report for each soft pull (public/app/blueprint-cycle.js). */
    const cycle = window.FHBlueprintCycle?.reports?.(data);
    if (cycle) return cycle;
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
    return `<section class="bj-funding"><div class="bj-heading"><h3>Funding opportunity</h3><span class="bj-label">Estimate</span></div>
      <p class="bj-fundability-state">${esc(readiness)}</p><p class="bj-caption">Personal funding capacity</p><div class="bj-capacity">${money(p.currentCents)}${typeof p.projectedCents==='number'&&p.projectedCents!==p.currentCents?` <span aria-label="projected after plan">→ ${money(p.projectedCents)}</span>`:''}</div>
      ${typeof p.liftCents==='number'&&p.liftCents>0?`<p class="bj-impact">${money(p.liftCents)} potential lift in the modeled plan</p>`:''}
      <div class="bj-businesses">${businesses.length?businesses.map(b=>{const item=b;return `<div><strong>${esc(b.name)}</strong><span>${typeof item.currentCents==='number'?money(item.currentCents):esc(blockerLabels[rows(item.blockers)[0]]||'Business checks needed')}</span></div>`;}).join(''):'<p class="bj-caption">Add your businesses to track each company separately.</p>'}</div>
      <div class="bj-total"><strong>Total funding picture</strong><span>${typeof combined.currentCents==='number'?money(combined.currentCents):'CSM review needed'}</span></div>
      ${blockers.length?`<ul class="bj-blockers" aria-label="Remaining fundability checks">${blockers.slice(0,4).map(b=>`<li>${esc(blockerLabels[b]||'Team review needed')}</li>`).join('')}</ul>`:''}<p class="bj-caption">Each business needs its own report.</p>${link('See fundability in FinanceOS','/app/financeos.html#fundability')}</section>`;
  }
  /* Each pull's date sits under its score, and no pull shows no date: three
     side-by-side columns crushed "Not pulled yet" on a phone (QA20). */
  function credit(data) {
    const scores=rows(data?.progress?.scores?.personal),businessScores=rows(data?.progress?.scores?.business);
    return `<section class="bj-credit"><h3>Credit & reports</h3><dl>${['experian','equifax','transunion'].map(b=>{const s=scores.find(x=>String(x.bureau).toLowerCase()===b);return `<div><dt>${labels[b]}</dt><dd>${typeof s?.score==='number'?`${esc(s.score)}<br><small>${date(s.pulledAt)}</small>`:'Not pulled yet'}</dd></div>`;}).join('')}</dl>
      <p class="bj-caption">${businessScores.length?`${businessScores.length} business profile${businessScores.length===1?'':'s'} tracked. Report availability is shown separately for each company.`:'Business credit is tracked separately for each company. Add the matching business report when available.'}</p>
      <div class="bj-actions">${reports(data)}${button('Soft-pull access & report status','credit')}</div></section>`;
  }
  function roadmap(data) {
    const progress=data?.progress||{},nextId=data.businessPlans?.startedAt?progress.nextStep?.waypointId:null;
    const waypoints=rows(progress.waypoints).filter(w=>w.closedBy!=='ongoing'&&w.verifyKind!=='no_new_credit'&&!['skipped','not_applicable'].includes(w.state));
    return `<section class="bj-roadmap"><div class="bj-heading"><h3>Your waypoints</h3>${link('View all progress','/progress.html')}</div><ol><li class="bj-step" data-state="${data.businessPlans?.startedAt?'done':'current'}"><div><span class="bj-state">${data.businessPlans?.startedAt?'✓ Complete':'Your next step'}</span><h4>Blueprint onboarding</h4></div></li>${waypoints.slice(0,5).map(w=>`<li class="bj-step" data-state="${done(w)?'done':String(w.id)===String(nextId)?'current':['blocked','awaiting_review'].includes(w.state)?'waiting':'upcoming'}"><div><span class="bj-state">${done(w)?'✓ Complete':String(w.id)===String(nextId)?(w.owner==='client'?'Your next step':'Fundhub team check'):w.state==='blocked'?'Help needed':'Upcoming'}</span><h4>${esc(w.title)}</h4></div>${String(w.id)===String(nextId)?link('Continue','/progress.html#waypoints'):''}</li>`).join('')||`<li class="bj-step" data-state="current"><div><span class="bj-state">Your next step</span><h4>Start your Blueprint onboarding</h4><p class="bj-caption">Confirm your starting point, then build your business plans.</p></div></li>`}</ol></section>`;
  }
  /* ── "Your path" (src/waypoints/blueprint-path.mjs, field `path` on the plan) ──
     Bank logos come from the server's one seam (pickBankLogo): Plaid's logo,
     then the bank book file. Anything else is not drawn; the name shows alone. */
  const safeLogo = l => l && typeof l.src === 'string' && (/^\/assets\/lenders\/[a-z0-9][a-z0-9._-]*\.(png|svg|jpe?g|webp)$/i.test(l.src) || /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(l.src)) ? l.src : null;
  const logo = (l,name) => {const src=safeLogo(l);return src?`<img class="bj-logo" src="${esc(src)}" alt="${esc(l.alt||name+' logo')}" width="28" height="28" loading="lazy" decoding="async">`:'';};
  const bankName = (b) => `<span class="bj-bank">${logo(b?.logo,b?.name)}<span>${esc(b?.name||'Bank')}</span></span>`;
  const day = value => value && /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(value.slice(0,10)+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}) : null;
  const stateWords = {done:'✓ Complete',open:'Upcoming',in_progress:'In progress',in_review:'Waiting for the Fundhub team',waiting:'Waiting on earlier steps',blocked:'Help needed',ongoing:'Ongoing'};
  /* What UnderwriteIQ measures for the step, as the engine prints it. No points. */
  const impactChip = s => s.impact?`<span class="bj-impact-chip" data-kind="${esc(s.impactKind||'none')}">${esc(s.impact)}</span>`:'';
  /* The bank plan's own tags (unit TL, src/finance/tradeline-inventory.mjs): the client
     already banks here, or already holds this product. */
  const bankTags = b => {const t=[b?.existingRelationship?'<span class="bj-chip" data-tier="fundable">Existing relationship</span>':'',b?.hasAccount?'<span class="bj-chip">You already have this</span>':''].filter(Boolean).join('');return t?`<div class="bj-tagline">${t}</div>`:'';};
  function pathStep(s) {
    const b=s.bank;
    const state=s.isNext?'current':s.state==='done'?'done':['waiting','blocked','in_review'].includes(s.state)?'waiting':'upcoming';
    const label=s.isNext?(s.owner==='client'?'Your next step':'Fundhub team check'):(stateWords[s.state]||'Upcoming');
    const bank=b?`<dl class="bj-bankfacts"><div><dt>Deposit</dt><dd>${esc(b.targetCents==null?'Not set':money(b.targetCents))}</dd></div><div><dt>Open by</dt><dd>${esc(day(b.openBy)||'Not set')}</dd></div><div><dt>Leave it in</dt><dd>${esc(b.seasoningDays==null?'Not in the bank book':b.seasoningDays+'+ days')}</dd></div><div><dt>Status</dt><dd>${esc(b.tracker?.text||'Not on your bank plan yet')}</dd></div></dl>`:'';
    const wait=s.waitingOn?.length?`<p class="bj-caption">Waits for: ${esc(s.waitingOn.join(', '))}.</p>`:'';
    const extra=s.kind==='chexsystems'&&s.statusText?`<p class="bj-caption">${esc(s.statusText)}</p>`:'';
    const control=s.kind==='chexsystems'&&s.state!=='done'?button(s.uploads?.length?'Open my ChexSystems step':'Check my ChexSystems report','chexsystems'):'';
    return `<li class="bj-step" data-state="${state}" data-path-key="${esc(s.key)}"><div><span class="bj-state">${esc(label)}</span><h4>${b?logo(b.logo,b.name):''}${esc(s.title)}</h4>${b?bankTags(b):''}${bank}${wait}${extra}${impactChip(s)}</div>${control}</li>`;
  }
  function pathRoadmap(path) {
    const steps=rows(path.steps);
    const miles=rows(path.milestones);
    return `<section class="bj-roadmap bj-pathsteps"><div class="bj-heading"><h3>Your waypoints</h3>${link('View all progress','/progress.html')}</div><p class="bj-caption">${esc(path.counts?.done??0)} of ${esc(path.counts?.total??0)} steps complete.</p>
      ${miles.length?`<h4 class="bj-subhead">Measured on your credit pulls</h4><ul class="bj-miles">${miles.map(m=>`<li data-state="${esc(m.state)}"><div><strong>${esc(m.title)}</strong></div><span class="bj-impact-chip" data-kind="${m.state==='done'?'done':'open'}">${esc(m.impact||'')}</span></li>`).join('')}</ul>`:''}
      <h4 class="bj-subhead">Your steps</h4><ol class="bj-pathlist">${steps.map(pathStep).join('')}</ol></section>`;
  }
  /* The engine's own change between the first and the newest pull: its dollars
     exactly, and what moved in plain words, never its × numbers (QA25). ×1.0 is
     the engine's top mark: card use under 10%, or 3 or more of your own accounts
     (estimate-preapprovals.js and derive-consumer-signals.js in
     vendor/underwriteiq-full/api/lite/crs/). */
  const topMark={utilization:'card use is under 10%',thinFile:'you have 3 or more of your own accounts'};
  function changeLine(ch) {
    const d=ch?.deltaCents;
    if(typeof d!=='number'||!Number.isFinite(d)||d===0)return '';
    const why=d>0?rows(ch.moved).filter(m=>m.to===1&&m.from<1&&topMark[m.modifier]).map(m=>topMark[m.modifier]).join(' and '):'';
    return `<p class="bj-impact">${d>0?'+':'-'}${esc(money(Math.abs(d)))}${why?` now that ${esc(why)}`:' funding'}</p>`;
  }
  function pathPanel(path) {
    const f=path.funding||{},c=path.cards||{},fd=path.fundability;
    const fund=typeof f.todayCents==='number'?`${money(f.todayCents)}${typeof f.projectedCents==='number'&&f.projectedCents!==f.todayCents?` <span aria-label="once the plan is done">→ ${money(f.projectedCents)}</span>`:''}`:'Report needed';
    const cards=typeof c.todayPct==='number'?`${esc(c.todayPct)}% → ${esc(c.targetPct)}% or less on each card`:'Report needed';
    return `<section class="bj-path"><div class="bj-heading"><div><span class="bj-label">Your path</span><h3>Funding you qualify for</h3></div>${fd?`<span class="bj-chip" data-tier="${esc(fd.tier)}">${esc(fd.text)}</span>`:'<span class="bj-chip">Fundability not measured yet</span>'}</div>
      <div class="bj-pathfund">${fund}</div><p class="bj-caption">UnderwriteIQ estimate from your newest credit pull.</p>
      ${changeLine(f.change)}
      <dl class="bj-pathfacts"><div><dt>Card limit used</dt><dd>${cards}</dd></div><div><dt>Fundability</dt><dd>${esc(fd?.text||'Not measured yet')}</dd></div><div><dt>Business funding</dt><dd>${esc(f.business?.unlocked?'Modeled for your business':(f.business?.text||'Unlocks after your first business is on file'))}</dd></div></dl><div class="bj-ahead" data-bj-ahead hidden></div></section>`;
  }
  /* The cash plan, one step at a time (src/waypoints/blueprint-path.mjs
     allocateDeposits). The what-if amount re-runs the same steps here; it only
     changes the view and is never saved as the client's cash. */
  let lastCash=null;
  function allocate(put,list) {
    let left=Math.max(0,Math.round(Number(put))||0),next=null;
    const out=rows(list).map(r=>{
      if(r.status==='deposited'||r.status==='not_set')return {...r,giveCents:0};
      const need=r.needCents,give=Math.min(left,need);left-=give;
      const target=r.fromBook?'the bank book amount':'the amount on your plan';
      const row=give>=need?{...r,giveCents:give,status:'covered',words:r.seasoningDays?`Fully covered. Leave it in for ${r.seasoningDays}+ days.`:'Fully covered.'}
        :give>0?{...r,giveCents:give,status:'partial',words:`Start with ${money(give)}. Add ${money(need-give)} to reach ${target}.`}
        :{...r,giveCents:0,status:'waiting',words:'Waits for more cash.'};
      if(!next&&row.status!=='covered')next={bank:r.bank,amountCents:need-give};
      return row;
    });
    return {rows:out,next};
  }
  function cashRows(list) {
    return rows(list).map(r=>`<li data-status="${esc(r.status)}">${bankName({name:r.bank,logo:r.logo})}<span class="bj-caption">${esc(r.words||'')}${r.openBy?` Open by ${esc(day(r.openBy))}.`:''}</span><strong>${typeof r.targetCents==='number'?`${esc(money(r.giveCents||0))} <small>of ${esc(money(r.targetCents))}</small>`:'Not set'}</strong></li>`).join('');
  }
  /* Every bank is "covered" only when every deposit amount is known and covered;
     a bank with no amount yet is named instead. */
  const notSetLine = list => {const names=rows(list).filter(r=>r.status==='not_set').map(r=>r.bank);return names.length?`Deposit not set yet for ${names.join(', ')}.`:null;};
  const nextLine = (next,list) => next?`Your next ${money(next.amountCents)} goes to ${next.bank}.`:(notSetLine(list)||'Every bank on your plan is covered.');
  const dollars = cents => (Math.max(0,cents)/100).toFixed(2).replace(/\.00$/,'');
  /* One line: where the cash figure comes from, and the cushion kept for bills. */
  function cashSource(cash) {
    const bits=[cash.haveSource==='connected_personal'?'Connected personal accounts':cash.haveSource==='reported_on_plan'?'Saved on your plan':null,
      typeof cash.bufferCents==='number'?`${money(cash.bufferCents)} kept for bills`:null].filter(Boolean);
    return bits.length?`<p class="bj-caption">${esc(bits.join(' · '))}</p>`:'';
  }
  function cashPanel(cash) {
    if (!cash||cash.status==='no_banks') return '';
    lastCash=cash;
    const have=typeof cash.haveCents==='number'?`${cash.haveIsFloor?'At least ':''}${money(cash.haveCents)}`:null;
    const planned=['planned','covered','partly_set'].includes(cash.status)&&typeof cash.freeCents==='number';
    const needs=rows(cash.rows).filter(r=>typeof r.needCents==='number'&&!['deposited','not_set'].includes(r.status)).reduce((n,r)=>n+r.needCents,0);
    const max=Math.max(100000,Math.ceil(Math.max(needs,cash.freeCents||0)/100000)*100000);
    const whatIf=planned&&needs>0?`<div class="bj-whatif"><label><span>What if you put in <output data-bj-put-out>${esc(money(cash.freeCents))}</output>?</span><input type="range" data-bj-put min="0" max="${max}" step="10000" value="${Math.min(cash.freeCents,max)}" aria-label="What-if amount to put into your bank accounts"></label><label class="bj-exact"><span>Exact amount ($)</span><input type="number" data-bj-put-exact min="0" step="0.01" inputmode="decimal" value="${esc(dollars(cash.freeCents))}" aria-label="Exact what-if amount in dollars"></label></div>`:'';
    return `<section class="bj-cash" id="bj-cash"><span class="bj-label">Your cash plan</span><h3>${have?`You have ${esc(have)} in cash`:'Add your cash to plan your deposits'}</h3>${cashSource(cash)}
      ${planned?`<p class="bj-nextbank" data-bj-cashnext>${esc(nextLine(cash.next,cash.rows))}</p>`:`<p class="bj-impact">${esc(cash.message||'')}</p>`}
      ${whatIf}<ul class="bj-cashrows" data-bj-cashrows>${cashRows(cash.rows)}</ul>
      ${cash.shortText?`<p class="bj-caption" data-bj-short>${esc(cash.shortText)}</p>`:''}
      ${cash.note?`<p class="bj-caption"><strong>${esc(cash.note)}</strong></p>`:''}</section>`;
  }
  /* The slider and the exact amount stay in step: the slider moves in $100
     steps, the exact field takes any amount, and the plan uses the exact one. */
  document.addEventListener('input',event=>{
    const slider=event.target.closest?.('[data-bj-put]'),exact=event.target.closest?.('[data-bj-put-exact]');
    if((!slider&&!exact)||!lastCash)return;
    const panel=(slider||exact).closest('.bj-cash');if(!panel)return;
    let cents;
    if(exact){
      const n=Number(exact.value);if(exact.value===''||!Number.isFinite(n)||n<0)return;
      cents=Math.round(n*100);
      const range=panel.querySelector('[data-bj-put]');if(range)range.value=String(cents);
    }else{
      cents=Math.max(0,Math.round(Number(slider.value))||0);
      const field=panel.querySelector('[data-bj-put-exact]');if(field)field.value=dollars(cents);
    }
    const plan=allocate(cents,lastCash.rows);
    const list=panel.querySelector('[data-bj-cashrows]');if(list)list.innerHTML=cashRows(plan.rows);
    const next=panel.querySelector('[data-bj-cashnext]');if(next)next.textContent=nextLine(plan.next,plan.rows);
    const out=panel.querySelector('[data-bj-put-out]');if(out)out.textContent=money(cents);
    const short=panel.querySelector('[data-bj-short]');if(short)short.hidden=cents!==lastCash.freeCents;
  });
  function bizPanel(biz) {
    if (!biz) return '';
    const words={done:'Done',review:'Review',missing:'Needed',needed:'Needed',recommended:'Recommended',to_do:'To do',on_file:'On file',not_on_list:'Review'};
    return `<section class="bj-biz"><div class="bj-heading"><div><span class="bj-label">Your businesses</span><h3>One business at a time</h3></div>${button('Add a business','businesses')}</div><p class="bj-caption">Start with one. Add more when you are ready.</p>
      ${rows(biz.list).length?`<div class="bj-bizgrid">${rows(biz.list).map(b=>`<article><span class="bj-label">${b.first?'First business':'Later'}</span><h4>${esc(b.name||'Business plan')}</h4>${b.activity?`<p class="bj-caption">${esc(b.activity)}</p>`:''}<dl>${rows(b.items).map(i=>`<div data-status="${esc(i.status)}"><dt>${esc(i.label)} · ${esc(words[i.status]||i.status)}</dt><dd>${esc(i.text||'')}</dd></div>`).join('')}</dl></article>`).join('')}</div>`:'<p>Add your first business to see its checklist.</p>'}
</section>`;
  }
  function chexPanel(path) {
    const g=path.chexsystems||{},step=g.step||{};
    const doneNow=step.state==='done';
    return `<section class="bj-chex" id="bj-chex"><div class="bj-heading"><div><span class="bj-label">Before you open a bank account</span><h3>${esc(g.title||'Check your ChexSystems report')}</h3></div><span class="bj-chip" data-tier="${doneNow?'fundable':''}">${esc(doneNow?'Done':step.state==='in_review'?'Uploaded':'To do')}</span></div>
      ${g.caution?`<p class="bj-impact">${esc(g.caution)}</p>`:''}
      <ol class="bj-ol">${rows(g.steps).map(t=>`<li>${g.link?.url&&g.link.label&&String(t).includes(g.link.label)?String(t).split(g.link.label).map(esc).join(`<a href="${esc(g.link.url)}" target="_blank" rel="noopener noreferrer">${esc(g.link.label)} ↗</a>`):esc(t)}</li>`).join('')}</ol>
      ${step.statusText?`<p class="bj-caption">${esc(step.statusText)}</p>`:''}
      <div class="bj-actions">${doneNow?'':button(rows(step.uploads).length?'Open my ChexSystems step':'Upload my report','chexsystems')}${button('Ask the Fundhub team','support')}${link('Ask your AI helper','/app/financeos.html#helper')}</div>
      <h4 class="bj-subhead">Opening the account</h4><ol class="bj-ol">${rows(g.opening).map(t=>`<li>${esc(t)}</li>`).join('')}</ol></section>`;
  }
  /* ── The look-ahead inside "Funding you qualify for" (unit S,
     src/finance/fundhub-lookahead.mjs; Chris's spot, 2026-11-07). pathPanel()
     paints an empty slot; the page that drew it calls lookahead(host, request)
     with its own request(), so sign-in checks and the sample demo apply. One read
     (GET /api/money/fundability?view=lookahead) holds the 3/6/9/12 picks, so a
     pick repaints without asking again. A read that is not the look-ahead, or a
     file with no pull, leaves the slot hidden. Every figure is UnderwriteIQ's.
     When the page reads its file again (Refresh, sign-in, a new sample stage) it
     calls refreshLookahead() first: the old estimate leaves the card and the next
     lookahead() asks the engine again (CX30). */
  const AHEAD_PICKS=[3,6,9,12];
  const ahead={look:null,months:9,request:null,seq:0,pending:false};
  const aheadPoint=(look,m)=>rows(look?.points).find(p=>p&&p.months===m&&p.scenario==='plan')||null;
  const tierText=t=>t==='fundable'?'Fundable':t==='not_fundable'?'Not fundable yet':'Not measured yet';
  function aheadHtml(look,m) {
    const p=aheadPoint(look,m);
    if(!look||look.view!=='lookahead'||look.has_pull!==true||!p)return '';
    const fund=typeof p.funding_estimate_cents==='number'&&Number.isFinite(p.funding_estimate_cents)?money(p.funding_estimate_cents):tierText(p.tier);
    const now=look.now?.fundhub_score?.score,later=p.fundhub_score?.score;
    const score=typeof later==='number'?(typeof now==='number'&&now!==later?`${now} → ${later}`:String(later)):'Not measured yet';
    const picks=AHEAD_PICKS.map(n=>`<button type="button" data-bj-ahead-month="${n}" aria-pressed="${n===m?'true':'false'}">${n} mo</button>`).join('');
    return `<div class="bj-ahead-head"><span class="bj-label">In ${esc(m)} months on your plan · estimate</span><strong class="bj-ahead-fund">${esc(fund)}</strong></div>
      <dl class="bj-aheadfacts"><div><dt>Fundhub score</dt><dd>${esc(score)}</dd></div><div><dt>Fundability</dt><dd>${esc(tierText(p.tier))}</dd></div></dl>
      <div class="bj-ahead-picks" role="group" aria-label="Look ahead">${picks}</div>`;
  }
  function paintAhead() {
    const html=ahead.look?aheadHtml(ahead.look,ahead.months):'';
    for(const slot of document.querySelectorAll?.('[data-bj-ahead]')||[]){slot.innerHTML=html;slot.hidden=!html;}
  }
  function loadAhead(m) {
    const seq=++ahead.seq,ask=ahead.request;
    ahead.pending=true;
    Promise.resolve().then(()=>ask('/api/money/fundability?view=lookahead'+(m===9?'':'&months='+m))).then(body=>{
      if(seq!==ahead.seq)return;
      ahead.pending=false;
      if(body&&body.view==='lookahead'&&body.has_pull===true&&aheadPoint(body,m)){ahead.look=body;ahead.months=m;}
      paintAhead();
    },()=>{if(seq===ahead.seq){ahead.pending=false;paintAhead();}});
  }
  /* The saved estimate and any read still on its way are dropped, so a late
     answer from before the Refresh can never paint over the new one. If a slot is
     on the page already, the engine is asked again right away; otherwise the next
     lookahead() asks. Either Blueprint page can call this for both. */
  function refreshLookahead() {
    ahead.seq++;ahead.look=null;ahead.pending=false;
    paintAhead();
    if(typeof ahead.request==='function'&&(document.querySelectorAll?.('[data-bj-ahead]')||[]).length)loadAhead(ahead.months);
  }
  function lookahead(host,request) {
    if(typeof request!=='function'||!host?.querySelector?.('[data-bj-ahead]'))return;
    ahead.request=request;
    if(ahead.look){paintAhead();return;}
    /* A read is on its way: it paints every slot on the page when it lands. */
    if(ahead.pending)return;
    loadAhead(ahead.months);
  }
  document.addEventListener('click',event=>{
    const b=event.target?.closest?.('[data-bj-ahead-month]');if(!b)return;
    const m=Number(b.dataset.bjAheadMonth);if(!AHEAD_PICKS.includes(m))return;
    if(ahead.look&&aheadPoint(ahead.look,m)){ahead.months=m;paintAhead();document.querySelector?.(`[data-bj-ahead-month="${m}"]`)?.focus?.();return;}
    if(ahead.request)loadAhead(m);
  });
  function render({data={},next={},control='',hasFundingEngine=false,moneyOverview=null,fundingState=null}={}) {
    /* A preparation buyer UnderwriteIQ calls fundable stops here (public/app/blueprint-cycle.js). */
    const stop=window.FHBlueprintCycle?.stop?.(data,hasFundingEngine);
    if(stop){next={...next,title:stop.title,detail:stop.detail,impactText:stop.impact};control=stop.control;}
    const progress=data.progress||{},model=opportunity(data),path=data.path&&Array.isArray(data.path.steps)?data.path:null;
    /* The readiness meter keeps the live checklist (waypoints and business setup);
       the path's own "N of M steps complete" line sits on the path list. */
    const counts=checklist(progress,data.businessPlans);
    const started=Boolean(data.businessPlans?.startedAt);
    const title=started?(next.title||'Review your next step'):'Start your Blueprint';
    const detail=started?(next.detail||'Follow the next action from your saved plan.'):'Tell us your starting point and add your businesses. We’ll guide the credit, company setup, and banking work along the way.';
    const nextControl=started?control:button(Number(data.businessPlans?.setupStep)>0?'Continue setup':'Start my plan','onboarding');
    const milestone=started&&counts.completed===1?'Onboarding complete':counts.completed?`${counts.completed} waypoint${counts.completed===1?'':'s'} completed`:'Your first milestone: complete onboarding';
    return `<div class="bj-summary" data-blueprint-journey>
      <section class="bj-next"><div><span class="bj-label">Your next step</span><h2>${esc(title)}</h2><p>${esc(detail)}</p><p class="bj-impact">${esc(started?impact(next,model):'Set a clear starting point so your next action fits your credit and each business.')}</p><div class="bj-actions">${nextControl}</div></div><aside class="bj-readiness"><span class="bj-value">${counts.percent}%</span><span>Blueprint steps complete</span><progress value="${counts.percent}" max="100" aria-label="Blueprint checklist completion"></progress><small>${counts.completed} of ${counts.total} applicable waypoints</small><p class="bj-milestone">${esc(path?.milestone&&started?'Next milestone: '+path.milestone.replace(/^Unlocks after /,''):milestone)}</p><small>Checklist progress is separate from fundability.</small></aside></section>
      ${path?pathPanel(path)+cashPanel(path.cash):''}${funding(model,data.businessPlans,fundingState)}${credit(data)}${path?pathRoadmap(path)+chexPanel(path)+bizPanel(path.businesses):roadmap(data)}
      <section class="bj-finance"><h3>FinanceOS</h3><p class="bj-caption">Your accounts, cash flow, credit, and financial plan in the same workspace.</p><dl><div><dt>Personal cash</dt><dd>${moneyOverview?.cash?.personal?.cents==null?'Account connection needed':money(moneyOverview.cash.personal.cents)}</dd></div><div><dt>Business cash</dt><dd>${moneyOverview?.cash?.business?.cents==null?'Account connection needed':money(moneyOverview.cash.business.cents)}</dd></div></dl><p class="bj-caption">Cash stays separate by owner. ${moneyOverview?.sandbox?'Fictional sample accounts.':''}</p>${link('Open FinanceOS','/app/financeos.html')}</section>
      <section class="bj-help"><h3>Do it yourself. Get help along the way.</h3><p class="bj-caption">Tools and instructions are included. Your CSM can help choose the right service.</p><div class="bj-actions">${button('Add or manage businesses','businesses')}${button('DIY & $97 mailed letters','letters')}${button('Repair: per round or full','repair-help')}${button('Aged business options','aged-help')}${hasFundingEngine?button('Funding engine & paid help','funding'):button('Upgrade or request funding help','upgrade')}</div><p class="bj-caption">${hasFundingEngine?'Your implementation offer includes the funding engine.':'Your preparation offer does not include the funding engine. Ask your CSM about an upgrade or assisted funding.'}</p></section>
    </div>`;
  }
  window.FHBlueprintJourney={render,route,checklist,logo,lookahead,refreshLookahead,aheadHtml};
  document.addEventListener('click',event=>{const el=event.target.closest('[data-bj-action]');if(!el)return;document.dispatchEvent(new CustomEvent('fh:blueprint-navigate',{detail:{action:el.dataset.bjAction,documentId:el.dataset.document||null}}));});
})();
