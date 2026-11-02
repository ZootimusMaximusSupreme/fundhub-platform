// One-click access to the complete saved CRS PDF from the closer call controls.
// The signed download URL is minted only at click time; it is never retained.
(function () {
  "use strict";
  function ready() {
    var button = document.getElementById("fh-credit-report");
    var state = document.getElementById("fh-credit-report-state");
    var name = document.getElementById("ccp-who-name");
    if (!button || !state || !window.FHData) return;
    var loadedClient = null;
    var documentId = null;
    function say(message) { state.textContent = message; state.hidden = !message; }
    function load() {
      var clientId = window.__FH_CLIENT_ID;
      if (!clientId || clientId === loadedClient) return;
      loadedClient = clientId;
      documentId = null;
      button.hidden = true;
      say("Checking credit report…");
      window.FHData.documents({ client_id: clientId, kind: "deliverable", limit: 100 }).then(function (response) {
        if (loadedClient !== clientId) return;
        if (!response || !response.ok) { say("Credit report could not load."); return; }
        var rows = response.data && response.data.items || [];
        var report = rows.find(function (row) { return row.subtype === "crs_full_credit_report"; });
        if (!report) { say("No credit report on file yet."); return; }
        documentId = report.id;
        button.hidden = false;
        say("");
      }).catch(function () { if (loadedClient === clientId) say("Credit report could not load."); });
    }
    button.addEventListener("click", function () {
      if (!documentId) return;
      button.disabled = true;
      button.textContent = "Opening…";
      window.FHData.documentDownload(documentId).then(function (response) {
        var url = response && response.ok && response.data && response.data.document &&
          response.data.document.download && response.data.document.download.url;
        if (url) { window.open(url, "_blank", "noopener"); say(""); }
        else say("Credit report could not open. Try again.");
      }).catch(function () { say("Credit report could not open. Try again."); })
        .finally(function () { button.disabled = false; button.textContent = "Credit report"; });
    });
    load();
    document.addEventListener("fh:workspace-ready", load);
    if (name) new MutationObserver(load).observe(name, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
