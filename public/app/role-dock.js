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
  let pinned = false;
  let timer;
  let lastPayload;
  let lastToken;

  function setExpanded(value) {
    document.body.dataset.expanded = String(value);
    $('toggle').setAttribute('aria-expanded', String(value));
    $('toggle').setAttribute('aria-label', value ? 'Collapse Fundhub Dock' : 'Expand Fundhub Dock');
    native({ type: value ? 'expand' : 'collapse' });
  }
  function state(name) {
    for (const id of ['loading', 'empty', 'error']) $(id).dataset.active = String(id === name);
    sections.hidden = Boolean(name);
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
  function dateLabel(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
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
      for (const other of sections.querySelectorAll('.item-toggle[aria-expanded="true"]')) other.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-expanded', String(opening));
    });
    wrap.append(button, detail);
    return wrap;
  }
  function render(payload) {
    lastPayload = payload;
    sections.replaceChildren();
    let urgent = 0;
    let itemIndex = 0;
    const groups = Array.isArray(payload.sections) ? payload.sections : [];
    for (const group of groups) {
      const section = text('section', '', 'section');
      const head = text('div', '', 'section-head');
      head.append(text('h2', group.label || roleLabels[group.role] || group.role || 'Your work'));
      const items = Array.isArray(group.items) ? group.items : [];
      head.append(text('span', `${items.length} update${items.length === 1 ? '' : 's'}`));
      section.append(head);
      const sopHref = safeHref(group.sopHref);
      if (sopHref) {
        const sop = text('a', 'Scripts & SOPs', 'sop-link');
        sop.href = sopHref;
        section.append(sop);
      }
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
  }
  async function refresh() {
    if (!lastPayload) state('loading');
    try {
      const token = localStorage.getItem('fh_token');
      if (lastToken !== undefined && token !== lastToken) {
        lastPayload = null;
        sections.replaceChildren();
        $('badge').hidden = true;
        state('loading');
      }
      lastToken = token;
      const headers = { accept: 'application/json' };
      if (token && token !== 'demo') headers.authorization = `Bearer ${token}`;
      const response = await fetch('/api/read/dock', { headers, credentials: 'same-origin', cache: 'no-store' });
      if (localStorage.getItem('fh_token') !== token) return;
      if (response.status === 401 || response.status === 403) {
        lastPayload = null;
        sections.replaceChildren();
        $('badge').hidden = true;
        state('error');
        native({ type: 'authExpired' });
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (localStorage.getItem('fh_token') !== token) return;
      if (!payload || payload.ok !== true) throw new Error('Invalid Dock data');
      render(payload);
    } catch (_) {
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
    for (const open of sections.querySelectorAll('.item-toggle[aria-expanded="true"]')) open.setAttribute('aria-expanded', 'false');
    $('toggle').focus();
  });
  $('refresh').addEventListener('click', refresh);
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
    if (!link) return;
    const href = safeHref(link.href);
    if (!href) { event.preventDefault(); return; }
    if (native({ type: 'open', href })) event.preventDefault();
  });
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    if (event.data?.type === 'dock-toggle') { pinned = !pinned; setExpanded(pinned); }
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== 'fh_token') return;
    lastPayload = null;
    sections.replaceChildren();
    $('badge').hidden = true;
    refresh();
  });
  refresh();
  setInterval(refresh, 60_000);
})();
