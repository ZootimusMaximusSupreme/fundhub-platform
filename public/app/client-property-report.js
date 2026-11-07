(function () {
  "use strict";
  function start() {
    var box = document.getElementById("ccp-property-report");
    if (!box) return;
    var state = document.getElementById("ccp-property-state");
    var result = document.getElementById("ccp-property-result");
    var consent = document.getElementById("ccp-property-consent");
    var consentText = document.getElementById("ccp-property-consent-text");
    var order = document.getElementById("ccp-property-order");
    var refresh = document.getElementById("ccp-property-refresh");
    var clientId = "", token = "", role = "", current = null, generation = 0, loading = false;
    var permitted = ["owner", "admin", "funding_advisor"];
    function context() {
      var query = new URLSearchParams(location.search);
      try { return { id: query.get("id") || query.get("client_id") || query.get("client") || query.get("contact") || "",
        token: localStorage.getItem("fh_token") || "", role: localStorage.getItem("fh_role") || "" }; }
      catch (e) { return { id: "", token: "", role: "" }; }
    }
    function same(snapshot) { var value = context(); return snapshot.id === value.id && snapshot.token === value.token && snapshot.role === value.role; }
    function clear() {
      generation += 1; current = null; loading = false; result.replaceChildren();
      consent.checked = false; consent.disabled = false; consentText.textContent = "";
      consent.closest("label").hidden = true; order.hidden = true; order.disabled = true;
    }
    function headers() { return { "Content-Type": "application/json", Authorization: "Bearer " + token }; }
    function line(parent, tag, words) { var el = document.createElement(tag); el.textContent = words; parent.appendChild(el); return el; }
    function money(value) { return typeof value === "number" ? value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "Unknown"; }
    var words = {
      identity_required: "The client's saved secure identity is incomplete. Use the existing client approval link to complete it.",
      property_consent_required: "Record the client's separate permission before ordering this report.",
      property_not_configured: "The property connection is not ready. Ask the desk to check the connection.",
      property_service_unavailable: "The property service could not answer. Reload the saved report before trying again.",
      provider_identity_mismatch: "The returned report did not match this client. The team needs to review it.",
      identity_changed: "This client's saved identity changed. The earlier report needs review and its values are hidden.",
      property_provider_uncertain: "The provider may have received this request. The team must check the receipt before another order.",
      provider_in_progress: "The report request is saved and may still be running. Reload to check its result."
    };
    function render(data) {
      current = data;
      result.replaceChildren();
      consent.checked = false;
      consent.disabled = false;
      consentText.textContent = data.consent ? data.consent.text : consentText.textContent;
      var mayOrder = data.mayOrder === true;
      order.hidden = !mayOrder;
      var clientApproved = !!(data.clientConsent && data.clientConsent.valid);
      consent.closest("label").hidden = !mayOrder || clientApproved;
      order.disabled = !mayOrder || !clientApproved;
      if (data.status === "completed" && data.report) {
        var report = data.report;
        state.textContent = "Saved property report · " + (data.environment === "sandbox" ? "Sandbox test data · " : "") + (data.checkedAt ? new Date(data.checkedAt).toLocaleString() : "Date unknown");
        line(result, "p", "Borrower-owned properties: " + report.summary.ownedPropertyCount + " · Foreclosure activity events: " + report.summary.foreclosureEventCount);
        line(result, "p", "Current mortgage balance, current equity and current valuation: unknown.");
        line(result, "p", "CRS receipt: " + (data.providerRequestId || "Unavailable"));
        (report.properties || []).forEach(function (property) {
          var detail = document.createElement("details");
          var address = property.address || {};
          line(detail, "summary", [address.line1, address.city, address.state, address.zip].filter(Boolean).join(", ") || "Address not returned");
          line(detail, "p", property.borrowerOwnedAsset ? "Provider marked this as a borrower-owned asset." : "Associated address; not marked as a borrower-owned asset.");
          line(detail, "p", "Provider's current owners: " + ((property.providerCurrentOwners || []).join(", ") || "Unknown"));
          line(detail, "p", "Recorded recent sale price: " + money(property.recordedRecentSalePrice));
          (property.transactions || []).forEach(function (transaction) {
            line(detail, "p", [transaction.recordedAt || "Date unknown", transaction.documentType || transaction.description || "Recorded transaction",
              "Original recorded loan amount: " + money(transaction.originalLoanAmount),
              "Recorded sale price: " + money(transaction.salePrice), transaction.lender || "Lender unknown"].join(" · "));
          });
          if (property.transactionsTruncated) line(detail, "p", "Showing the first 100 of " + property.transactionCount + " recorded transactions.");
          result.appendChild(detail);
        });
      } else if (data.status === "empty") {
        state.textContent = !data.connectionReady ? words.property_not_configured : !data.identityReady ? words.identity_required : "No property report is saved. Get the client's permission, then run one report.";
      } else state.textContent = words[data.reason] || "This property request needs team review. Reload to read its saved status.";
      if (mayOrder && clientApproved) line(result, "p", "The client approved the property report on their authorization form.");
    }
    function load() {
      var snapshot = context();
      if (!same({ id: clientId, token: token, role: role })) { clear(); loading = false; }
      clientId = snapshot.id; token = snapshot.token; role = snapshot.role;
      box.hidden = !clientId || !token || permitted.indexOf(role) < 0;
      if (box.hidden || loading || document.getElementById("ccp-view-credit").hidden) return;
      loading = true;
      var run = ++generation;
      state.textContent = "Loading saved property report…";
      fetch("/api/finance/property-report?client_id=" + encodeURIComponent(clientId), { headers: headers(), cache: "no-store" })
        .then(function (r) { return r.json().then(function (data) { if (!r.ok || !data.ok) throw new Error(data.error); return data; }); })
        .then(function (data) { if (run === generation && same(snapshot)) render(data); })
        .catch(function () { if (run === generation && same(snapshot)) { clear(); consent.closest("label").hidden = true; state.textContent = words.property_service_unavailable; } })
        .finally(function () { if (run === generation && same(snapshot)) loading = false; });
    }
    consent.addEventListener("change", function () { order.disabled = !consent.checked || !current || current.mayOrder !== true; });
    refresh.addEventListener("click", load);
    order.addEventListener("click", function () {
      var clientApproved = !!(current && current.clientConsent && current.clientConsent.valid);
      if (!current || !current.mayOrder || (!clientApproved && !consent.checked) || loading) return;
      var snapshot = context(), run = ++generation;
      if (!same({ id: clientId, token: token, role: role })) { clear(); load(); return; }
      var operationId;
      try {
        operationId = crypto.randomUUID();
      } catch (e) { state.textContent = "This browser could not create the request reference. Reload before ordering."; return; }
      loading = true; order.disabled = true; consent.disabled = true;
      state.textContent = "Requesting this client's property report…";
      fetch("/api/finance/property-report", { method: "POST", headers: headers(), body: JSON.stringify({
        client_id: clientId, operation_id: operationId, consent_accepted: !clientApproved && consent.checked, consent_version: current.consent.version
      }) }).then(function (r) { return r.json().then(function (data) { if (!r.ok || !data.ok) throw new Error(data.error); return data; }); })
        .then(function (data) { if (run === generation && same(snapshot)) render(data); })
        .catch(function (error) { if (run === generation && same(snapshot)) { clear(); consent.closest("label").hidden = true; state.textContent = words[error.message] || words.property_provider_uncertain; } })
        .finally(function () { if (run === generation && same(snapshot)) { loading = false; consent.disabled = false; } });
    });
    document.addEventListener("click", function (event) {
      if (event.target.closest && event.target.closest('[data-workspace-tab="credit"], [data-workspace-open="credit"]')) setTimeout(load, 0);
    });
    document.addEventListener("ccp:client", load);
    window.addEventListener("storage", function () { if (!same({ id: clientId, token: token, role: role })) { clear(); box.hidden = true; } });
    window.addEventListener("pagehide", clear);
    load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
