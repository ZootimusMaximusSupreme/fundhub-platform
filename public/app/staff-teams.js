/* Presentation and keyboard access only. Business handlers remain in the page. */
(function () {
  "use strict";
  var editor = document.getElementById("editor");
  var returnFocus = null;
  var wasOpen = false;
  var tabs = Array.from(document.querySelectorAll(".tab"));
  document.querySelector(".tabs").setAttribute("role", "tablist");
  document.querySelector(".tabs").setAttribute("aria-label", "Team workspace");
  function syncTabs() {
    tabs.forEach(function (tab) {
      var active = tab.classList.contains("on");
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
  }
  tabs.forEach(function (tab, index) {
    tab.id = "team-tab-" + tab.dataset.tab;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", "tab-" + tab.dataset.tab);
    var panel = document.getElementById("tab-" + tab.dataset.tab);
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    tab.addEventListener("click", syncTabs);
    tab.addEventListener("keydown", function (event) {
      var next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      tabs[next].click();
      tabs[next].focus();
    });
  });
  syncTabs();
  function decorateRoster() {
    document.querySelectorAll("#rosterBody tr[data-id] .nm").forEach(function (name) {
      if (name.querySelector("button")) return;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "person-open";
      button.textContent = name.textContent;
      button.setAttribute("aria-label", "Edit " + name.textContent);
      name.textContent = "";
      name.appendChild(button);
    });
  }
  var roster = document.getElementById("rosterBody");
  new MutationObserver(decorateRoster).observe(roster, {childList: true});
  decorateRoster();
  document.querySelectorAll("table th").forEach(function (th) { th.scope = "col"; });
  var switches = document.querySelectorAll(".editor .sw");
  function syncSwitches() {
    switches.forEach(function (control) {
      control.setAttribute("aria-checked", String(control.classList.contains("on")));
    });
  }
  switches.forEach(function (control) {
    new MutationObserver(syncSwitches).observe(control, {attributes: true, attributeFilter: ["class"]});
  });
  function editorState() {
    var open = editor.classList.contains("open");
    editor.inert = !open;
    if (open && !wasOpen) {
      returnFocus = document.activeElement;
      document.getElementById("ed_first").focus();
    }
    if (!open && wasOpen) {
      var focus = returnFocus;
      if (!focus || !focus.isConnected) focus = document.getElementById("addBtn");
      focus.focus();
    }
    wasOpen = open;
    syncSwitches();
  }
  new MutationObserver(editorState).observe(editor, {attributes: true, attributeFilter: ["class"]});
  editorState();
  editor.addEventListener("keydown", function (event) {
    if (event.key === "Escape") { event.preventDefault(); document.getElementById("edClose").click(); return; }
    if (event.key !== "Tab") return;
    var controls = Array.from(editor.querySelectorAll('button,input,select,a[href],[tabindex="0"]')).filter(function (control) {
      return !control.disabled && control.getClientRects().length;
    });
    var first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
})();
