/* Presentation only: keep call tools and the selected client's file together. */
(function () {
  "use strict";
  function ready() {
    var disposition = document.getElementById("closer-disposition");
    if (disposition && window.matchMedia("(max-width:720px)").matches) disposition.open = false;

    var file = document.getElementById("closer-client-file");
    var name = document.getElementById("ccp-who-name");
    function syncFile() {
      var id = window.__FH_CLIENT_ID;
      var loaded = name && name.textContent !== "Loading…" &&
        name.textContent !== "No call right now" && name.textContent !== "Could not load";
      if (!file) return;
      file.hidden = !id || !loaded;
      if (!file.hidden) {
        file.href = "client-control-panel.html?client_id=" + encodeURIComponent(id);
        if (window.FHWorkspaceScope && typeof window.FHWorkspaceScope.setClient === "function") {
          window.FHWorkspaceScope.setClient({ id: id, name: name.textContent.trim() });
        }
      }
    }
    syncFile();
    document.addEventListener("fh:workspace-ready", syncFile);
    if (name) new MutationObserver(syncFile).observe(name, { childList: true, subtree: true, characterData: true });

    // Keep source explanations visible; omit a caption that repeats its label.
    var bands = document.querySelector(".bands");
    function syncFundingLabels() {
      if (!bands) return;
      bands.querySelectorAll(".band").forEach(function (band) {
        var label = band.querySelector(".bl");
        var note = band.querySelector(".bn");
        if (label && note) note.hidden = label.textContent.trim() === note.textContent.trim();
      });
    }
    syncFundingLabels();
    if (bands) new MutationObserver(syncFundingLabels).observe(bands, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
