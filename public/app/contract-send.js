/* Shared send helper for Present and Closer Dashboard.
 *
 * Reuses POST /api/contracts { create_draft, then send }. That path already
 * emails through notifySigners (compose/dispatch) when mail is on. This file
 * does not add a provider. It returns the sign link so the closer can copy it.
 *
 * SENDING A CONTRACT TAKES NO TYPED INPUT (owner decision 2026-09-03, F27).
 * Chris, verbatim: "it should already have that information. Just send it. We
 * don't need to, like, enter in the information." The system already holds the
 * client, the offer, the price and the template, so createDraft on the server
 * fills every blank from src/config/offers.mjs and this file sends `values`
 * only when a screen genuinely has some.
 */
(function (root) {
  "use strict";

  /* How long a second press of Send on the SAME contract is refused for.
   *
   * F24 on the same walk: the pay-link button gave no feedback, a closer pressed
   * it twice, and the client got two emails carrying two DIFFERENT live checkout
   * links for one sale. A contract send is the same shape — two presses make two
   * drafts, two documents and two sign links, and the client has no way to know
   * which one counts. The window is short on purpose: a genuine resend (the
   * client lost the email) is a real and common thing, and the server already
   * handles it properly by re-minting a link on the SAME contract. */
  var SEND_COOLDOWN_MS = 8000;

  /* Keyed by client + wording, not global: sending two different contracts to
     two different clients at once is ordinary work and must not be blocked. */
  var inFlight = {};
  var lastSentAt = {};

  function sendKey(opts) {
    return String((opts && opts.clientId) || "") + "|" + String((opts && opts.templateId) || "");
  }

  function errText(r) {
    if (!r) return "Could not send.";
    var e = r.error;
    if (e && typeof e === "object") return e.message || e.error || "Could not send.";
    if (typeof e === "string" && e) return e;
    return "Could not send.";
  }

  function linkUrl(data) {
    var links = (data && data.links) || [];
    if (links[0]) return links[0].url || links[0].path || "";
    var link = data && data.link;
    if (!link) return "";
    if (typeof link === "string") return link;
    return link.url || link.path || "";
  }

  function listWordings() {
    if (!root.FHData) {
      return Promise.resolve({ ok: false, error: "data.js failed to load", items: [] });
    }
    return root.FHData.read("contracts", { view: "templates", active_only: "1" }).then(function (r) {
      if (!r.ok) return { ok: false, error: errText(r), items: [] };
      var items = (r.data && (r.data.items || r.data.templates)) || [];
      return {
        ok: true,
        items: items.filter(function (t) { return t && t.active !== false; })
      };
    });
  }

  function pickTemplate(items, templateKey) {
    if (!items || !items.length || !templateKey) return null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].template_key === templateKey) return items[i];
    }
    return null;
  }

  /* THE BROWSER NO LONGER KNOWS ANY CONTRACT DEFAULTS, and that is the fix
     rather than an omission.
   *
   * This used to return { company_name: "Fundhub", company_email: ... } plus a
   * consent term, and a screen dropped those into editable boxes. On 2026-09-03
   * a closer typed the CLIENT's company over company_name and it rendered as the
   * SELLER — "Between: Sim Five Academy LLC ("we")" on a Fundhub agreement
   * (F28). The seller is Fundhub LLC on every client contract and is now written
   * into the template's words, so there is nothing here to fill in.
   *
   * The prices are not mirrored here either. A second copy of the price list, in
   * a second language, meeting the contract sentences from the other side, is
   * exactly the arrangement that let $1,000-charged-once render as $1,000 a
   * month (db/migrations/273_repair_fee_charged_once.sql). One source:
   * defaultContractValues() in src/config/offers.mjs, applied by the server.
   *
   * Kept, returning nothing, because closer-call.js still calls it. */
  function defaultBlankValues() {
    return {};
  }

  function fillBlankInputs(values) {
    values = values || {};
    Array.prototype.forEach.call(document.querySelectorAll("[data-blank]"), function (el) {
      var k = el.getAttribute("data-blank");
      if (k && values[k] != null && values[k] !== "") el.value = values[k];
    });
  }

  /** True while a send for this exact client + wording is still in the air. */
  function isSending(opts) {
    return inFlight[sendKey(opts)] === true;
  }

  function sendToClient(opts) {
    opts = opts || {};
    var amountCents = opts.amountCents;
    if (!root.FHData) {
      return Promise.resolve({ ok: false, error: "data.js failed to load" });
    }
    if (!opts.clientId) {
      return Promise.resolve({ ok: false, error: "Open this from a client." });
    }
    if (!opts.templateId) {
      return Promise.resolve({ ok: false, error: "Pick a wording first." });
    }

    var key = sendKey(opts);
    if (inFlight[key]) {
      return Promise.resolve({
        ok: false, pending: true,
        error: "Still sending. Wait for this one to finish."
      });
    }
    var since = Date.now() - (lastSentAt[key] || 0);
    if (since < SEND_COOLDOWN_MS) {
      return Promise.resolve({
        ok: false, cooldown: true,
        error: "Already sent a moment ago. Give it a few seconds before sending again."
      });
    }

    inFlight[key] = true;
    var payload = {
      action: "create_draft",
      client_id: opts.clientId,
      template_id: opts.templateId
    };
    /* Omitted entirely when there is nothing to say. The server fills every
       blank from the offer catalogue, and posting `{}` versus omitting it are
       the same thing to it — but omitting says plainly that this screen has no
       typed input to contribute. */
    if (opts.values && Object.keys(opts.values).length) payload.values = opts.values;
    if (amountCents !== undefined) payload.amount_cents = amountCents;

    return root.FHData.write("/api/contracts", payload).then(function (r) {
      if (!r.ok) return { ok: false, error: errText(r) };
      var id = r.data && r.data.contract && r.data.contract.id;
      if (!id) return { ok: false, error: "The draft did not save." };
      var sendPayload = { action: "send", id: id };
      if (amountCents !== undefined) sendPayload.amount_cents = amountCents;
      return root.FHData.write("/api/contracts", sendPayload).then(function (r2) {
        if (!r2.ok) return { ok: false, error: errText(r2) };
        var links = (r2.data && r2.data.links) || [];
        /* Stamped only on a send that actually went. A failed attempt must be
           retryable straight away — a cooldown on a failure would leave the
           closer staring at a dead button with a client on the phone. */
        lastSentAt[key] = Date.now();
        return {
          ok: true,
          link: linkUrl(r2.data),
          links: links,
          message: (r2.data && r2.data.message) || "Sent. Copy the link and give it to the client."
        };
      });
    }).then(function (out) {
      delete inFlight[key];
      return out;
    }, function (err) {
      delete inFlight[key];
      return { ok: false, error: (err && err.message) || "Could not send." };
    });
  }

  function copyText(text) {
    if (!text) return Promise.resolve(false);
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      return root.navigator.clipboard.writeText(text).then(function () { return true; })
        .catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  root.FHContractSend = {
    SEND_COOLDOWN_MS: SEND_COOLDOWN_MS,
    listWordings: listWordings,
    pickTemplate: pickTemplate,
    defaultBlankValues: defaultBlankValues,
    fillBlankInputs: fillBlankInputs,
    isSending: isSending,
    sendToClient: sendToClient,
    copyText: copyText,
    linkUrl: linkUrl
  };
})(window);
