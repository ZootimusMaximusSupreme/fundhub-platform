(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const native = (message) => {
    const handler = window.webkit?.messageHandlers?.dock;
    if (!handler) return false;
    handler.postMessage(message);
    return true;
  };
  const sections = $('sections');
  const roleLabels = { owner: 'Founder', admin: 'Admin', sales_manager: 'Sales manager', setter: 'Setter', closer: 'Closer', outbound_rep: 'Bank relationships', inquiry_specialist: 'Inquiry removal', funding_advisor: 'Funding advisor', csm: 'Client success', client: 'Your funding' };
  const metaCampaignsUrl = 'https://adsmanager.facebook.com/adsmanager/manage/campaigns?business_id=1475597360226485&nav_entry_point=mbs_sub_nav&act=982103620742368#';
  let pinned = false;
  let timer;
  let lastPayload;
  let lastToken;
  let feedVersion=0;
  let feedAbort=null;

  function setExpanded(value) {
    document.body.dataset.expanded = String(value);
    $('toggle').setAttribute('aria-expanded', String(value));
    $('toggle').setAttribute('aria-label', value ? 'Collapse Fundhub Dock' : 'Expand Fundhub Dock');
    native({ type: value ? 'expand' : 'collapse' });
    if (!value) stopPresence();
    else if (selectedCallId && lastPayload) render(lastPayload);
  }
  function state(name) {
    for (const id of ['loading', 'empty', 'error']) $(id).dataset.active = String(id === name);
    sections.hidden = Boolean(name);
    if (name) { $('role-overview').replaceChildren(); $('role-overview').hidden = true; }
  }
  function safeHref(href) {
    try {
      const url = new URL(href, location.origin);
      return url.origin === location.origin && (url.pathname.startsWith('/app/') || url.pathname === '/progress.html') ? url.href : null;
    } catch (_) { return null; }
  }
  function text(tag, value, className) {
    const el = document.createElement(tag);
    el.textContent = value == null ? '' : String(value);
    if (className) el.className = className;
    return el;
  }
  function dateLabel(value, timeZone) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', ...(timeZone?{timeZone}:{}) }).format(date);
  }
  let selectedCallId = null;
  let activeViewer = null;
  let presentation = null;
  let presenceAbort = null;
  let presenceTimeout = null;
  let presenceEpoch = 0;
  let serverOffset = 0;
  let lastPresentNotice = null;
  let pendingPresentation = null;
  const timerStore = 'fh_dock_presentation_timer';
  const handoffLabels = {problem:'Problem',goal:'Goal',computer_ready:'Computer ready',time_confirmed:'Time confirmed',frame_warmed:'Call framed',app_on_phone:'App on phone',triage_personal_or_business:'Funding type',triage_problem:'Stuck point',triage_goal:'Target',employment_status:'Employment',employment_details:'Work details',annual_personal_income:'Personal income',income_verification:'Income proof',complete_at:'Handoff completed'};
  function stopPresence() {
    presenceEpoch++;
    clearTimeout(presenceTimeout);
    presenceAbort?.abort();
    presenceAbort = null;
  }
  function clearPrivateState() {
    stopPresence();selectedCallId = null;activeViewer = null;presentation = null;lastPresentNotice=null;pendingPresentation=null;
    try { sessionStorage.removeItem(timerStore); } catch (_) {}
  }
  function closeDetails(except) {
    for (const button of sections.querySelectorAll('.item-toggle,.call-toggle')) {
      if (button === except) continue;
      button.setAttribute('aria-expanded','false');
      const panel = document.getElementById(button.getAttribute('aria-controls'));
      if (panel?.classList.contains('call-details')) panel.hidden = true;
    }
    if (!except?.classList.contains('call-toggle')) {selectedCallId=null;stopPresence();}
  }
  function duration(ms) {
    const seconds = Math.max(0,Math.floor(ms/1000));
    return `${Math.floor(seconds/3600) ? `${Math.floor(seconds/3600)}:` : ''}${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  }
  function updateClocks() {
    const now = Date.now()+serverOffset;
    for (const node of sections.querySelectorAll('[data-starts-at]')) {
      const remaining = Date.parse(node.dataset.startsAt)-now;
      node.textContent = remaining > 0 ? `Starts in ${duration(remaining)}` : `Started ${duration(-remaining)} ago`;
    }
    const clock = $('presentation-clock');
    if (clock && presentation) clock.textContent = duration(Date.now()-presentation.startedAt);
  }
  function restoreTimer(viewer) {
    if (activeViewer && viewer !== activeViewer) clearPrivateState();
    activeViewer = viewer;
    if (presentation) return;
    try {
      const stored = JSON.parse(sessionStorage.getItem(timerStore) || 'null');
      if (stored?.viewer === viewer && typeof stored.taskId === 'string' && Number.isFinite(stored.startedAt)
        && stored.startedAt <= Date.now() && Date.now()-stored.startedAt < 86_400_000) presentation = stored;
      else sessionStorage.removeItem(timerStore);
    } catch (_) {}
  }
  function timerNode() {
    const wrap = text('div','','presentation-timer');
    if (!presentation) {wrap.append(text('p','Present opens a separate, client-only view. Share that tab in Meet, not this Dock.'));return wrap;}
    wrap.append(text('span','Present timer'));
    const clock = text('strong','','presentation-clock');clock.id='presentation-clock';wrap.append(clock);
    const stop = text('button','Stop timer','calendar-button');stop.type='button';
    stop.addEventListener('click',()=>{presentation=null;pendingPresentation=null;try{sessionStorage.removeItem(timerStore);}catch(_){} if(lastPayload)render(lastPayload);});
    wrap.append(stop);return wrap;
  }
  function meetHref(value) {
    try {const url=new URL(value);return url.protocol==='https:' && url.hostname==='meet.google.com' && !url.username && !url.password
      && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname) ? `${url.origin}${url.pathname}` : null;}catch(_){return null;}
  }
  async function pollPresence(call, node) {
    stopPresence();
    if (document.body.dataset.expanded!=='true' || selectedCallId!==call.taskId) return;
    if(!call.bookingId){node.textContent='Meet status unavailable for this call. You can still join.';return;}
    const epoch=presenceEpoch,token=localStorage.getItem('fh_token'),viewer=activeViewer;
    presenceAbort=new AbortController();
    node.textContent='Checking Meet…';node.title='';
    try {
      const response=await fetch(`/api/read/meet-presence?client_id=${encodeURIComponent(call.clientId)}`,{headers:{accept:'application/json',...(token && token!=='demo'?{authorization:`Bearer ${token}`}:{})},credentials:'same-origin',cache:'no-store',signal:presenceAbort.signal});
      const data=response.ok?await response.json():null;
      if (epoch!==presenceEpoch || viewer!==activeViewer || token!==localStorage.getItem('fh_token') || selectedCallId!==call.taskId || document.body.dataset.expanded!=='true') return;
      const age=Date.now()+serverOffset-Date.parse(data?.checkedAt);
      if (data?.ok!==true || !Number.isFinite(age) || age < -300000 || age>60000 || data.status==='unavailable' || data.bookingId!==call.bookingId) node.textContent='Meet status unavailable. You can still join.';
      else if (data.status==='empty') node.textContent='No active Meet session for this call.';
      else if (data.status==='available' && Number.isInteger(data.presence?.participantCount) && data.presence.participantCount>=0) {
        const count=data.presence.participantCount;
        node.textContent=`${count} participant${count===1?'':'s'} in Meet · lead identity not verified.`;
      } else node.textContent='Meet status unavailable. You can still join.';
      if(data?.ok===true && ['available','empty'].includes(data.status) && data.bookingId===call.bookingId && Number.isFinite(age) && age>=-300000 && age<=60000){const checked=text('time',`Checked ${dateLabel(data.checkedAt,'America/Phoenix')}`,'meet-checked');checked.dateTime=data.checkedAt;checked.title=data.checkedAt;node.append(checked);}
    } catch (_) {if(epoch===presenceEpoch)node.textContent='Meet status unavailable. You can still join.';}
    if (epoch===presenceEpoch && selectedCallId===call.taskId && document.body.dataset.expanded==='true') presenceTimeout=setTimeout(()=>pollPresence(call,node),12000);
  }
  function calendarNode(calendar) {
    const wrap=text('div','','closer-calendar');
    wrap.append(text('h3',"Today's calls"));
    if (!calendar || calendar.status!=='available' || !Array.isArray(calendar.calls)) {
      wrap.append(text('p','Your calendar could not update. Refresh the Dock to try again.','calendar-state'));return wrap;
    }
    const viewer=`${calendar.viewer?.orgId || ''}:${calendar.viewer?.staffId || ''}`;
    restoreTimer(viewer);
    serverOffset=Number.isFinite(Date.parse(calendar.asOf))?Date.parse(calendar.asOf)-Date.now():0;
    wrap.append(timerNode());
    const calls=[...calendar.calls];
    const next=calls.findIndex(call=>call.taskId===calendar.nextCallId);
    if(next>0)calls.unshift(...calls.splice(next,1));
    if(!calls.length){wrap.append(text('p','No more booked calls today. Your next calls will appear here.','calendar-state'));return wrap;}
    for(const call of calls){
      const card=text('div','','calendar-call');card.dataset.taskId=call.taskId;
      const toggle=text('button','','call-toggle');toggle.type='button';
      const open=selectedCallId===call.taskId;toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-controls',`dock-call-${call.taskId}`);
      const label=text('span','','call-heading');label.append(text('strong',call.name || 'Name not saved'));
      label.append(text('span',`${call.taskId===calendar.nextCallId?'Next · ':''}${dateLabel(call.startsAt,calendar.timeZone || 'America/Phoenix')}`,'call-time'));toggle.append(label);
      toggle.append(text('span','⌄','call-chevron'));card.append(toggle);
      const countdown=text('p','','call-countdown');countdown.dataset.startsAt=call.startsAt;card.append(countdown);
      const detail=text('div','','call-details');detail.id=`dock-call-${call.taskId}`;detail.hidden=!open;
      const actions=text('div','','call-actions');
      const meet=meetHref(call.meetHref);
      if(meet){const join=text('button','Join Meet','calendar-button');join.type='button';join.addEventListener('click',()=>{if(!native({type:'joinMeet',href:meet}))window.open(meet,'_blank','noopener,noreferrer');});actions.append(join);}
      else detail.append(text('p','Meet link not available.','calendar-state'));
      const present=safeHref(call.presentHref);
      const parsed=present?new URL(present):null;
      if(parsed?.pathname==='/app/present.html' && parsed.searchParams.get('contact')===call.clientId && parsed.searchParams.get('audience')==='1'){
        const link=text('a','Present ↗','calendar-button calendar-present');link.href=present;link.target='_blank';link.rel='noopener noreferrer';link.dataset.audience='true';
        link.addEventListener('click',event=>{
          if(lastToken!==localStorage.getItem('fh_token')){event.preventDefault();clearPrivateState();return;}
          if(presentation && presentation.taskId!==call.taskId){event.preventDefault();notice.textContent='Stop the current Present timer before starting another call.';return;}
          if(pendingPresentation){event.preventDefault();notice.textContent='Opening the client-only view…';return;}
          const startedNew=!presentation;
          const requestId=crypto.randomUUID();
          presentation ||= {viewer:activeViewer,taskId:call.taskId,clientId:call.clientId,startedAt:Date.now()};
          pendingPresentation={requestId,taskId:call.taskId,startedAt:presentation.startedAt,startedNew};
          if(native({type:'present',href:present,requestId}))event.preventDefault();else pendingPresentation=null;
          try{sessionStorage.setItem(timerStore,JSON.stringify(presentation));}catch(_){}
          notice.textContent='Present requested. Share only the client-only view in Meet; this timer does not start recording.';lastPresentNotice=notice;
          const old=wrap.querySelector('.presentation-timer');old?.replaceWith(timerNode());updateClocks();
        });actions.append(link);
      }
      detail.append(actions);
      const notice=text('p','','call-notice');notice.setAttribute('role','status');detail.append(notice);
      const presence=text('p','Meet status unavailable.','call-presence');presence.setAttribute('aria-live','polite');detail.append(presence);
      detail.append(text('h4','Setter handoff'));
      const handoff=call.setterHandoff && typeof call.setterHandoff==='object'?call.setterHandoff:{};
      const entries=Object.entries(handoff).filter(([key,value])=>handoffLabels[key] && ['string','boolean','number'].includes(typeof value));
      const handoffList=text('dl','','call-facts');
      for(const [key,value] of entries){handoffList.append(text('dt',handoffLabels[key]),text('dd',typeof value==='boolean'?(value?'Yes':'No'):value));}
      if(entries.length)detail.append(handoffList);else detail.append(text('p','No setter handoff saved.','calendar-state'));
      detail.append(text('h4','Survey'));
      const survey=text('dl','','call-facts');
      for(const answer of Array.isArray(call.survey)?call.survey:[]){survey.append(text('dt',`${answer.label || answer.key}${answer.source==='setter'?' · setter update':''}`),text('dd',answer.value || 'Not shared'));}
      if(survey.children.length)detail.append(survey);else detail.append(text('p','No survey answers saved.','calendar-state'));
      card.append(detail);
      toggle.addEventListener('click',()=>{
        const opening=toggle.getAttribute('aria-expanded')!=='true';closeDetails(toggle);stopPresence();
        toggle.setAttribute('aria-expanded',String(opening));detail.hidden=!opening;selectedCallId=opening?call.taskId:null;
        if(opening && document.body.dataset.expanded==='true')pollPresence(call,presence);
      });
      wrap.append(card);
      if(open && document.body.dataset.expanded==='true')queueMicrotask(()=>{if(detail.isConnected)pollPresence(call,presence);});
    }
    return wrap;
  }

  function metricNode(metric) {
    const el = text('div', '', 'metric');
    const periodLabels = { today: 'today', '24h': '24h', '7d': '7d', this_month: 'month', now: '' };
    let value = metric.unavailableReason ? null : Number(metric.value);
    if (value != null && Number.isFinite(value)) {
      if (metric.unit === 'cents') value = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value / 100);
      else if (metric.unit === 'ratio') value = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(value);
      else value = new Intl.NumberFormat().format(value);
    } else value = '—';
    el.append(text('strong', value));
    const period = periodLabels[metric.period] || '';
    el.append(text('span', `${metric.label || metric.key || 'Metric'}${period ? ` · ${period}` : ''}`));
    el.title = metric.unavailableReason || (metric.asOf ? `As of ${new Date(metric.asOf).toLocaleString()}` : '');
    return el;
  }
  function itemNode(item, index) {
    const wrap = text('div', '', 'item');
    wrap.dataset.urgency = ['urgent', 'overdue', 'attention'].includes(item.urgency) ? 'urgent' : ['due', 'soon'].includes(item.urgency) ? 'due' : 'normal';
    const button = text('button', '', 'item-toggle');
    button.type = 'button';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', `dock-detail-${index}`);
    button.append(text('span', '', 'item-dot'));
    button.append(text('span', item.title || 'Update', 'item-label'));
    button.append(text('span', dateLabel(item.dueAt), 'item-due'));
    button.append(text('span', '›', 'item-chevron'));
    const detail = text('div', '', 'item-detail');
    detail.id = `dock-detail-${index}`;
    detail.append(text('p', item.detail || 'Open this item for details.'));
    const href = safeHref(item.href);
    if (href) {
      const link = text('a', 'Open task ↗');
      link.href = href;
      detail.append(link);
    }
    button.addEventListener('click', () => {
      const opening = button.getAttribute('aria-expanded') !== 'true';
      closeDetails(button);
      button.setAttribute('aria-expanded', String(opening));
    });
    wrap.append(button, detail);
    return wrap;
  }
  function render(payload) {
    lastPayload = payload;
    stopPresence();
    sections.replaceChildren();
    let urgent = 0;
    let itemIndex = 0;
    const groups = Array.isArray(payload.sections) ? payload.sections : [];
    const overview = $('role-overview');
    overview.replaceChildren();
    overview.hidden = groups.length < 2;
    if (groups.length > 1) {
      overview.append(text('strong', 'At a glance'));
      for (const group of groups) {
        const row = text('div', '', 'role-overview-row');
        const label = group.role === 'owner' ? 'Owner' : group.label || roleLabels[group.role] || group.role || 'Role';
        const items = Array.isArray(group.items) ? group.items : [];
        const calendar = group.role === 'closer' ? group.calendar : null;
        const calls = calendar?.status === 'available' && Array.isArray(calendar.calls) ? calendar.calls : null;
        const nextCall = calendar?.nextCallId && calls?.find(call => call.taskId === calendar.nextCallId);
        const summary = nextCall ? `Next call: ${nextCall.name || dateLabel(nextCall.startsAt, calendar.timeZone) || 'scheduled'}`
          : items.length ? items[0].title || 'Update'
          : calendar && !calls ? 'Calendar unavailable'
          : calls ? `${calls.length} ${calls.length === 1 ? 'call' : 'calls'} today`
          : `${items.length} updates`;
        row.append(text('b', label), text('span', summary));
        row.title = `${label}: ${summary}`;
        overview.append(row);
      }
    }
    $('meta-campaigns').hidden = payload.identity?.kind !== 'staff' || !groups.some(group => group.role === 'owner');
    for (const group of groups) {
      const section = text('section', '', 'section');
      const head = text('div', '', 'section-head');
      head.append(text('h2', group.label || roleLabels[group.role] || group.role || 'Your work'));
      const items = (Array.isArray(group.items) ? group.items : []).filter(item => !(group.role==='closer' && group.calendar && String(item.id).startsWith('call:')));
      head.append(text('span', group.role==='closer' && Array.isArray(group.calendar?.calls) ? `${group.calendar.calls.length} calls today` : `${items.length} update${items.length === 1 ? '' : 's'}`));
      section.append(head);
      const sopHref = safeHref(group.sopHref);
      if (sopHref) {
        const sop = text('a', 'Scripts & SOPs', 'sop-link');
        sop.href = sopHref;
        section.append(sop);
      }
      if(group.role==='closer') section.append(calendarNode(group.calendar));
      const metrics = Array.isArray(group.metrics) ? group.metrics : [];
      if (metrics.length) {
        const row = text('div', '', 'metric-row');
        for (const metric of metrics) row.append(metricNode(metric));
        section.append(row);
      }
      for (const item of items) {
        if (['urgent', 'overdue', 'attention'].includes(item.urgency)) urgent++;
        section.append(itemNode(item, itemIndex++));
      }
      if (!items.length && !metrics.length) section.append(text('p', 'Nothing needs attention right now.'));
      sections.append(section);
    }
    $('identity').textContent = payload.identity?.kind === 'client' ? 'Client' : 'Team';
    $('badge').hidden = urgent === 0;
    $('badge').textContent = urgent > 9 ? '9+' : String(urgent);
    $('updated').textContent = payload.generatedAt ? `Updated ${dateLabel(payload.generatedAt)}` : 'Updated now';
    state(groups.length ? null : 'empty');
    native({ type: 'count', count: groups.length, urgent });
    updateClocks();
  }
  async function refresh() {
    const version=++feedVersion;feedAbort?.abort();feedAbort=new AbortController();
    if (!lastPayload) state('loading');
    try {
      const token = localStorage.getItem('fh_token');
      if (lastToken !== undefined && token !== lastToken) {
        clearPrivateState();
        lastPayload = null;
        sections.replaceChildren();
        $('badge').hidden = true;
        $('meta-campaigns').hidden = true;
        state('loading');
      }
      lastToken = token;
      const headers = { accept: 'application/json' };
      if (token && token !== 'demo') headers.authorization = `Bearer ${token}`;
      const response = await fetch('/api/read/dock', { headers, credentials: 'same-origin', cache: 'no-store', signal:feedAbort.signal });
      if (version!==feedVersion || localStorage.getItem('fh_token') !== token) return;
      if (response.status === 401 || response.status === 403) {
        clearPrivateState();
        lastPayload = null;
        sections.replaceChildren();
        $('badge').hidden = true;
        $('meta-campaigns').hidden = true;
        state('error');
        native({ type: 'authExpired' });
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (version!==feedVersion || localStorage.getItem('fh_token') !== token) return;
      if (!payload || payload.ok !== true) throw new Error('Invalid Dock data');
      render(payload);
    } catch (_) {
      if(version!==feedVersion)return;
      if (!lastPayload) state('error');
      else $('updated').textContent = 'Offline · showing last update';
    }
  }
  $('toggle').addEventListener('click', () => { pinned = !pinned; setExpanded(pinned); });
  $('close').addEventListener('click', () => { pinned = false; setExpanded(false); });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    pinned = false;
    setExpanded(false);
    closeDetails();
    $('toggle').focus();
  });
  $('refresh').addEventListener('click', refresh);
  $('meta-campaigns').addEventListener('click', () => {
    if (lastToken !== localStorage.getItem('fh_token')) { $('meta-campaigns').hidden = true; return; }
    if ($('meta-campaigns').hidden || lastPayload?.identity?.kind !== 'staff' || !lastPayload.sections?.some(group => group.role === 'owner')) return;
    if (!native({ type: 'openExternal', href: metaCampaignsUrl })) window.open(metaCampaignsUrl, '_blank', 'noopener,noreferrer');
  });
  $('retry').addEventListener('click', refresh);
  $('side').addEventListener('click', () => {
    const side = document.body.dataset.side === 'right' ? 'left' : 'right';
    document.body.dataset.side = side;
    $('side').setAttribute('aria-label', `Move Dock to ${side === 'left' ? 'right' : 'left'} side`);
    native({ type: 'side', side });
  });
  document.body.addEventListener('mouseenter', () => { clearTimeout(timer); if (!pinned) setExpanded(true); });
  document.body.addEventListener('mouseleave', () => { if (!pinned) timer = setTimeout(() => setExpanded(false), 350); });
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link || link.dataset.audience==='true') return;
    const href = safeHref(link.href);
    if (!href) { event.preventDefault(); return; }
    if (native({ type: 'open', href })) event.preventDefault();
  });
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    if(event.data?.type==='dock-present-result' && pendingPresentation?.requestId===event.data.requestId){
      const pending=pendingPresentation;pendingPresentation=null;
      if(!event.data.ok && pending.startedNew && presentation?.taskId===pending.taskId && presentation.startedAt===pending.startedAt){presentation=null;try{sessionStorage.removeItem(timerStore);}catch(_){} if(lastPayload)render(lastPayload);}
      const message=event.data.ok?'Client-only view opened. Share only that view in Meet.':'Present could not open. Check your sign-in and try again.';
      if(lastPresentNotice?.isConnected)lastPresentNotice.textContent=message;else $('updated').textContent=message;
    }
    if (event.data?.type === 'dock-toggle') { pinned = !pinned; setExpanded(pinned); }
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== 'fh_token') return;
    clearPrivateState();
    lastPayload = null;
    sections.replaceChildren();
    $('badge').hidden = true;
    $('meta-campaigns').hidden = true;
    native({type:'sessionChanged'});
    refresh();
  });
  refresh();
  setInterval(refresh, 60_000);
  setInterval(updateClocks, 1000);
})();
