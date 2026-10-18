/* Presentation navigation only. Existing data, gates and action handlers own the file. */
(function () {
  'use strict';
  var tabs = Array.from(document.querySelectorAll('[data-workspace-tab]'));
  var views = Array.from(document.querySelectorAll('.workspace-view'));
  if (!tabs.length) return;
  var access = document.getElementById('ccp-tab-access');
  var role = '';
  try { role = String(localStorage.getItem('fh_role') || '').toLowerCase(); } catch (e) {}
  if (access && role !== 'owner' && role !== 'admin') access.hidden = true;

  function tabFor(key) {
    return tabs.find(function (tab) { return !tab.hidden && tab.dataset.workspaceTab === key; });
  }
  function activate(key, options) {
    options = options || {};
    var tab = tabFor(key) || tabFor('overview');
    if (!tab) return;
    tabs.forEach(function (item) {
      var chosen = item === tab;
      item.setAttribute('aria-selected', String(chosen));
      item.tabIndex = chosen ? 0 : -1;
    });
    views.forEach(function (view) { view.hidden = view.id !== tab.getAttribute('aria-controls'); });
    if (options.write) history.pushState(null, '', '#' + tab.getAttribute('aria-controls'));
    if (options.focus) tab.focus({ preventScroll: true });
    if (options.reset) {
      var main = document.querySelector('.workspace-main');
      if (main) main.scrollTop = 0;
      if (window.matchMedia('(max-width:760px)').matches) {
        document.querySelector('.workspace-tabs').scrollIntoView({ block: 'start' });
      }
    }
  }
  function reveal(target, focus) {
    if (!target) return;
    var view = target.closest('.workspace-view');
    if (!view) return;
    activate(view.id.replace('ccp-view-', ''));
    var group = target.closest('.group-body[hidden]');
    if (group) {
      var toggle = document.querySelector('[aria-controls="' + group.id + '"]');
      if (toggle) toggle.click();
    }
    var details = target.closest('details');
    if (details && target.tagName !== 'SUMMARY') details.open = true;
    if (focus && view) requestAnimationFrame(function () { target.scrollIntoView({ block: 'nearest' }); });
  }
  function fromAddress(event) {
    var id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }
    if (!id) { activate('overview'); return; }
    var target = document.getElementById(id);
    if (target && target.matches('[data-workspace-tab]')) activate(target.dataset.workspaceTab);
    else if (target) {
      reveal(target, true);
      if (event && event.type === 'popstate') {
        var view = target.closest('.workspace-view');
        var selected = view && tabFor(view.id.replace('ccp-view-', ''));
        if (selected) selected.focus({ preventScroll: true });
      }
    }
  }
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () { activate(tab.dataset.workspaceTab, { write: true, reset: true }); });
    tab.addEventListener('keydown', function (event) {
      var visible = tabs.filter(function (item) { return !item.hidden; });
      var index = visible.indexOf(tab), next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % visible.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + visible.length) % visible.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = visible.length - 1;
      else return;
      event.preventDefault();
      activate(visible[next].dataset.workspaceTab, { write: true, focus: true, reset: true });
    });
  });
  document.addEventListener('click', function (event) {
    var opener = event.target.closest('[data-workspace-open]');
    if (opener) activate(opener.dataset.workspaceOpen, { write: true, focus: true, reset: true });
    var anchor = event.target.closest('a[href^="#"]');
    if (anchor) {
      var target = document.getElementById(anchor.getAttribute('href').slice(1));
      if (target) reveal(target, true);
    }
  });
  /* Any existing action that focuses or scrolls to a field can reveal its section. */
  document.addEventListener('focusin', function (event) { reveal(event.target); });
  document.addEventListener('ccp:reveal', function (event) {
    var target = typeof event.detail === 'string' ? document.getElementById(event.detail) : event.detail;
    reveal(target, true);
  });
  window.addEventListener('hashchange', fromAddress);
  window.addEventListener('popstate', fromAddress);
  fromAddress();

  var retry = document.getElementById('ccp-file-retry');
  var clientName = document.getElementById('ccp-name');
  if (retry && clientName) {
    var showRetry = function () { retry.hidden = clientName.textContent !== 'Could not load this file'; };
    new MutationObserver(showRetry).observe(clientName, { childList: true, characterData: true, subtree: true });
    retry.addEventListener('click', function () { location.reload(); });
    showRetry();
  }

  var action = document.getElementById('ccp-task-open');
  var taskDestinations = {
    clear_fraud_alert: ['credit', 'Review credit & inquiries'],
    get_consent: ['credit', 'Review permission'],
    pull_crs: ['credit', 'Review bureau pulls'],
    send_letters: ['credit', 'Review inquiry work'],
    remove_inquiries: ['credit', 'Review inquiry work'],
    collect_documents: ['records', 'Open client records'],
    review_disputes: ['credit', 'Review credit & inquiries'],
    review_funding_file: ['funding', 'Review funding'],
    prepare_next_round: ['funding', 'Review funding'],
    apply_for_funding: ['funding', 'Review funding'],
    ready_to_fund: ['overview', 'Review funding round']
  };
  document.addEventListener('ccp:next-action', function (event) {
    if (!action) return;
    var destination = taskDestinations[event.detail && event.detail.key];
    action.hidden = !destination;
    if (destination) {
      action.dataset.workspaceOpen = destination[0];
      action.textContent = destination[1] + ' →';
    }
  });
})();
