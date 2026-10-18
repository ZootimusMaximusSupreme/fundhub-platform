/* Presentation and keyboard affordances; journey state and APIs stay in journeys.html. */
(() => {
  const flow = document.getElementById('canvas');
  const inspector = document.querySelector('.panel');
  const fields = document.getElementById('pbody');
  if (!flow || !inspector || !fields) return;
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'jr-back-to-flow';
  back.textContent = 'Back to journey';
  back.addEventListener('click', () => {
    const target = flow.querySelector('.nrow[aria-selected="true"] .node') || flow;
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
    if (target.matches('button')) target.focus({ preventScroll: true });
  });
  inspector.prepend(back);
  document.addEventListener('click', event => {
    if (event.target.closest('#canvas .node') && window.matchMedia('(max-width:920px)').matches) {
      inspector.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  });
  document.addEventListener('keydown', event => {
    const tab = event.target.closest('#jlist .jrow, .ptabs .ptab');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
      (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next].click();
    tabs[next].focus();
    tabs[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  function labelFields() {
    fields.querySelectorAll('.fld').forEach((field, index) => {
      const label = field.querySelector('label');
      const input = field.querySelector('input,textarea,select');
      if (!label || !input) return;
      if (!input.id) input.id = 'jr-field-' + index;
      if (label.htmlFor !== input.id) label.htmlFor = input.id;
    });
  }
  function labelBranches() {
    const ask = flow.querySelector('#askin');
    if (ask) ask.setAttribute('aria-label', 'Describe a journey change');
    flow.querySelectorAll('.lanes').forEach(lanes => {
      const labels = lanes.previousElementSibling?.querySelectorAll('.tag') || [];
      [...lanes.children].forEach((lane, index) => {
        const label = labels[index]?.textContent || 'Path ' + (index + 1);
        lane.dataset.jrPath = label;
        lane.setAttribute('role', 'group');
        lane.setAttribute('aria-label', label);
      });
    });
  }
  new MutationObserver(labelFields).observe(fields, { childList: true, subtree: true });
  new MutationObserver(labelBranches).observe(flow, { childList: true, subtree: true });
  labelFields();
  labelBranches();
})();
