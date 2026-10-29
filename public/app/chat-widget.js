/* Fundhub chat widget — Ask / Knowledge / Message (docs/CRM-CHAT-WIDGET-SPEC.md).
   Mounted by shell.js on every CRM screen; portal mounts a client-only variant. */
(function () {
  if (typeof window === "undefined" || window.__fhChatMounted) return;
  window.__fhChatMounted = true;

  var STYLE =
    "#fh-chat-fab{position:fixed;right:18px;bottom:18px;z-index:2147482800;" +
    "width:52px;height:52px;border-radius:16px;border:1px solid #E4E4E7;background:#0A0A0A;" +
    "color:#fff;font:600 13px/1 Inter,system-ui,sans-serif;cursor:pointer;" +
    "box-shadow:0 12px 32px rgba(0,0,0,.22)}" +
    "#fh-chat-panel{position:fixed;right:18px;bottom:82px;z-index:2147482801;" +
    "width:min(380px,calc(100vw - 24px));height:min(560px,calc(100vh - 110px));" +
    "background:#fff;color:#0A0A0A;border:1px solid #E4E4E7;border-radius:14px;" +
    "box-shadow:0 24px 60px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden}" +
    "#fh-chat-panel.open{display:flex}" +
    "#fh-chat-panel .hd{display:flex;align-items:center;gap:8px;padding:12px 14px;" +
    "border-bottom:1px solid #E4E4E7;font:600 13px/1.2 Inter,system-ui,sans-serif}" +
    "#fh-chat-panel .modes{display:flex;gap:4px;padding:8px 10px;border-bottom:1px solid #F4F4F5}" +
    "#fh-chat-panel .mode{flex:1;border:1px solid #E4E4E7;background:#FAFAFA;border-radius:8px;" +
    "padding:7px 6px;font:600 11px/1 Inter,system-ui,sans-serif;cursor:pointer;color:#52525B}" +
    "#fh-chat-panel .mode.on{background:#0A0A0A;color:#fff;border-color:#0A0A0A}" +
    "#fh-chat-panel .mode.internal-hint.on{background:#1D4ED8;border-color:#1D4ED8}" +
    "#fh-chat-body{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}" +
    "#fh-chat-body .msg{max-width:92%;padding:9px 11px;border-radius:10px;font:500 12.5px/1.45 Inter,system-ui,sans-serif}" +
    "#fh-chat-body .msg.me{align-self:flex-end;background:#0A0A0A;color:#fff}" +
    "#fh-chat-body .msg.them{align-self:flex-start;background:#F4F4F5;color:#0A0A0A}" +
    "#fh-chat-body .msg.internal{align-self:flex-start;background:#EFF6FF;border:1px solid #BFDBFE}" +
    "#fh-chat-body .msg .src{display:block;margin-top:6px;font:500 11px/1.35 Inter,system-ui,sans-serif;opacity:.75}" +
    "#fh-chat-body .msg a{color:inherit}" +
    "#fh-chat-foot{border-top:1px solid #E4E4E7;padding:10px;display:flex;flex-direction:column;gap:8px}" +
    "#fh-chat-foot .row{display:flex;gap:8px}" +
    "#fh-chat-foot input,#fh-chat-foot select{flex:1;border:1px solid #E4E4E7;border-radius:8px;" +
    "padding:9px 10px;font:500 13px/1.3 Inter,system-ui,sans-serif}" +
    "#fh-chat-foot button{border:0;border-radius:8px;background:#0A0A0A;color:#fff;" +
    "padding:9px 12px;font:600 12px/1 Inter,system-ui,sans-serif;cursor:pointer}" +
    "#fh-chat-foot .hint{font:500 10.5px/1.35 Inter,system-ui,sans-serif;color:#71717A}";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function token() {
    try { return localStorage.getItem("fh_token") || ""; } catch (e) { return ""; }
  }

  function api(path, opts) {
    var t = token();
    var headers = { accept: "application/json", "content-type": "application/json" };
    if (t && t !== "demo") headers.authorization = "Bearer " + t;
    return fetch(path, Object.assign({ headers: headers }, opts || {}))
      .then(function (response) {
        return response.json().catch(function () {
          return { ok: false, error: "invalid_response" };
        }).then(function (data) {
          /* A non-2xx response never means "saved", even if a gateway or
             upstream accidentally returned a JSON body containing ok:true. */
          if (!response.ok) return {
            ok: false,
            error: (data && data.error) || ("http_" + response.status)
          };
          return data;
        });
      }).catch(function () {
        /* Do not leave an uncaught promise and a false outgoing bubble when a
           phone loses connection between tapping Send and receiving the ACK. */
        return { ok: false, error: "network_unavailable" };
      });
  }

  var PRECALL_GREETING =
    "Your call is coming up. Any questions you want us to know before we talk? Type them here and your advisor will see them.";

  function mount(opts) {
    opts = opts || {};
    var isPortal = !!opts.portal;
    var isDemo = !!opts.demo;
    var hadCall = opts.hadCall === true;
    var autoOpenPrecall = opts.autoOpenPrecall === true ||
      (isPortal && opts.autoOpenPrecall !== false && !hadCall);
    var style = document.createElement("style");
    style.id = "fh-chat-style";
    style.textContent = STYLE;
    (document.head || document.documentElement).appendChild(style);

    var fab = document.createElement("button");
    fab.id = "fh-chat-fab";
    fab.type = "button";
    fab.setAttribute("aria-label", "Open chat");
    fab.textContent = "Chat";
    document.body.appendChild(fab);

    var panel = document.createElement("div");
    panel.id = "fh-chat-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Fundhub chat");
    panel.innerHTML =
      '<div class="hd"><span>Fundhub chat</span><span style="flex:1"></span>' +
      '<button type="button" id="fh-chat-close" style="border:0;background:transparent;cursor:pointer;font:600 12px Inter,system-ui,sans-serif">Close</button></div>' +
      '<div class="modes" id="fh-chat-modes"></div>' +
      '<div id="fh-chat-body"></div>' +
      '<div id="fh-chat-foot"></div>';
    document.body.appendChild(panel);

    var state = {
      mode: isPortal ? "message" : "system",
      msgKind: isPortal ? "portal" : "internal",
      peerId: "",
      clientId: "",
      conversationId: null,
      staffId: ""
    };
    var pollTimer = null;

    var modes = isPortal
      ? [{ id: "message", label: "Message staff" }]
      : [
          { id: "system", label: "Ask system" },
          { id: "knowledge", label: "Knowledge" },
          { id: "message", label: "Message" }
        ];

    function paintModes() {
      var el = document.getElementById("fh-chat-modes");
      el.innerHTML = modes.map(function (m) {
        var cls = "mode" + (state.mode === m.id ? " on" : "") +
          (m.id === "message" && state.msgKind === "internal" ? " internal-hint" : "");
        return '<button type="button" class="' + cls + '" data-mode="' + m.id + '">' + esc(m.label) + "</button>";
      }).join("");
      Array.prototype.forEach.call(el.querySelectorAll("[data-mode]"), function (btn) {
        btn.onclick = function () {
          state.mode = btn.getAttribute("data-mode");
          state.conversationId = null;
          paintModes();
          paintFoot();
          if (state.mode === "message" && !isPortal && state.msgKind === "internal" &&
              (state.peerId || state.conversationId)) {
            loadInternalThread();
          } else {
            paintBodyWelcome();
          }
          syncPoll();
        };
      });
    }

    function addMsg(html, cls) {
      var body = document.getElementById("fh-chat-body");
      var div = document.createElement("div");
      div.className = "msg " + (cls || "them");
      div.innerHTML = html;
      body.appendChild(div);
      body.scrollTop = body.scrollHeight;
    }

    function paintBodyWelcome() {
      var body = document.getElementById("fh-chat-body");
      body.innerHTML = "";
      if (state.mode === "system") {
        addMsg("Ask how to use Fundhub — e.g. “how do I send a contract?” If I do not know from product help, I will say so.");
      } else if (state.mode === "knowledge") {
        addMsg("Ask about company SOPs, scripts, and Drive knowledge. Same rules as Company Brain.");
      } else if (isPortal) {
        addMsg(hadCall
          ? "Message your Fundhub team. Replies show in their inbox."
          : PRECALL_GREETING);
      } else {
        addMsg("Staff↔staff is blue and skips quiet-hours rules. Staff↔client uses the real outbound path and compliance gate.");
      }
    }

    function ensureStaffId(done) {
      if (state.staffId || isPortal) {
        done();
        return;
      }
      api("/api/auth/session").then(function (res) {
        if (res && res.staff && res.staff.id) state.staffId = res.staff.id;
        done();
      }, function () { done(); });
    }

    function paintThread(messages) {
      var body = document.getElementById("fh-chat-body");
      if (!body) return;
      body.innerHTML = "";
      if (!messages || !messages.length) {
        paintBodyWelcome();
        return;
      }
      messages.forEach(function (m) {
        var mine = isPortal
          ? m.sender_kind === "client"
          : (state.staffId && m.sender_staff_id === state.staffId);
        var cls = mine ? "me" : (m.channel === "internal" ? "internal" : "them");
        addMsg(esc(m.rendered_body || ""), cls);
      });
    }

    function loadPortalThread() {
      if (!isPortal || isDemo) return;
      api("/api/chat/portal-message").then(function (res) {
        if (!res || !res.ok) return;
        if (res.conversation_id) state.conversationId = res.conversation_id;
        paintThread(res.messages || []);
      });
    }

    function loadInternalThread() {
      if (isPortal || state.mode !== "message" || state.msgKind !== "internal") return;
      /* THE TEAMMATE THIS LOOKUP IS FOR. Every answer below lands later; if the
         pick changed meanwhile, the answer is about someone else. It must not
         paint that person's thread under the new pick, or set its thread id as
         the one the next note is sent into. */
      var forPeer = state.peerId;
      function stale() {
        return state.peerId !== forPeer || state.msgKind !== "internal" || state.mode !== "message";
      }
      ensureStaffId(function () {
        function fetchMsgs(cid) {
          if (stale()) return;
          if (!cid) {
            paintBodyWelcome();
            return;
          }
          state.conversationId = cid;
          api("/api/chat/messages?conversation_id=" + encodeURIComponent(cid)).then(function (res) {
            if (!res || !res.ok || stale()) return;
            paintThread(res.messages || []);
          });
        }
        if (state.conversationId) {
          fetchMsgs(state.conversationId);
          return;
        }
        if (!state.peerId) {
          paintBodyWelcome();
          return;
        }
        api("/api/chat/messages?kind=internal").then(function (res) {
          if (stale()) return;
          if (!res || !res.ok) {
            paintBodyWelcome();
            return;
          }
          var threads = res.threads || [];
          var found = null;
          for (var i = 0; i < threads.length; i++) {
            var parts = threads[i].participants || [];
            for (var j = 0; j < parts.length; j++) {
              if (parts[j] && parts[j].id === state.peerId) {
                found = threads[i];
                break;
              }
            }
            if (found) break;
          }
          if (found) fetchMsgs(found.id);
          else {
            state.conversationId = null;
            paintBodyWelcome();
          }
        });
      });
    }

    function syncPoll() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (!panel.classList.contains("open")) return;
      if (isPortal) {
        if (isDemo) return;
        pollTimer = setInterval(function () {
          if (!panel.classList.contains("open")) return;
          loadPortalThread();
        }, 4000);
        return;
      }
      if (state.mode !== "message" || state.msgKind !== "internal") return;
      if (!state.peerId && !state.conversationId) return;
      pollTimer = setInterval(function () {
        if (!panel.classList.contains("open")) return;
        if (state.mode !== "message" || state.msgKind !== "internal") return;
        loadInternalThread();
      }, 4000);
    }

    function paintFoot() {
      var foot = document.getElementById("fh-chat-foot");
      if (state.mode === "message" && !isPortal) {
        foot.innerHTML =
          '<div class="row">' +
            '<select id="fh-chat-kind">' +
              '<option value="internal"' + (state.msgKind === "internal" ? " selected" : "") + ">Staff (internal)</option>" +
              '<option value="client"' + (state.msgKind === "client" ? " selected" : "") + ">Client</option>" +
            "</select>" +
          "</div>" +
          '<div class="row" id="fh-chat-target-row"></div>' +
          '<div class="row"><input id="fh-chat-input" placeholder="Type a message…" autocomplete="off">' +
          '<button type="button" id="fh-chat-send">Send</button></div>' +
          '<div class="hint" id="fh-chat-hint"></div>';
        document.getElementById("fh-chat-kind").onchange = function (e) {
          state.msgKind = e.target.value;
          state.conversationId = null;
          paintModes();
          fillTarget();
          if (state.msgKind === "internal" && state.peerId) loadInternalThread();
          else paintBodyWelcome();
          syncPoll();
        };
        fillTarget();
      } else {
        foot.innerHTML =
          '<div class="row"><input id="fh-chat-input" placeholder="' +
            (state.mode === "message" ? "Message your team…" : "Ask a question…") +
            '" autocomplete="off">' +
          '<button type="button" id="fh-chat-send">' +
            (state.mode === "message" ? "Send" : "Ask") +
          "</button></div>" +
          '<div class="hint" id="fh-chat-hint"></div>';
      }
      var send = document.getElementById("fh-chat-send");
      var input = document.getElementById("fh-chat-input");
      send.onclick = function () { submit(); };
      input.onkeydown = function (e) {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
      };
    }

    function fillTarget() {
      var row = document.getElementById("fh-chat-target-row");
      var hint = document.getElementById("fh-chat-hint");
      if (!row) return;
      if (state.msgKind === "internal") {
        hint.textContent = "Internal — no quiet hours / TCPA gate.";
        row.innerHTML = '<select id="fh-chat-peer"><option value="">Pick a teammate…</option></select>';
        api("/api/chat/peers").then(function (res) {
          var sel = document.getElementById("fh-chat-peer");
          if (!sel || !res || !res.ok) return;
          var items = res.staff || [];
          sel.innerHTML = '<option value="">Pick a teammate…</option>' +
            items.map(function (s) {
              return '<option value="' + esc(s.id) + '">' + esc(s.name || s.email) + "</option>";
            }).join("");
          sel.value = state.peerId || "";
          sel.onchange = function () {
            state.peerId = sel.value;
            state.conversationId = null;
            if (state.peerId) loadInternalThread();
            else paintBodyWelcome();
            syncPoll();
          };
          if (state.peerId) loadInternalThread();
        });
      } else {
        /* THE CLIENT LIST IS YOUR CLIENTS (owner, 2026-10-20): the clients you
           are the assigned CSM for, from /api/chat/peers. The client this page
           is open on is offered too, so a message from a client's own screen
           still works. Picking a different client drops the old thread, so a
           message can only go to the client on the picker. */
        hint.textContent = "Client message — compliance gate applies.";
        row.innerHTML = '<select id="fh-chat-client"><option value="">Pick one of your clients…</option></select>';
        var pageClient = pageClientId();
        if (pageClient && !state.clientId) state.clientId = pageClient;
        api("/api/chat/peers").then(function (res) {
          var sel = document.getElementById("fh-chat-client");
          if (!sel) return;
          var items = (res && res.ok && res.clients) || [];
          var opts = items.map(function (c) {
            var label = c.name || c.client_code || "Client";
            if (c.name && c.client_code) label += " (" + c.client_code + ")";
            return '<option value="' + esc(c.id) + '">' + esc(label) + "</option>";
          });
          var listed = items.some(function (c) { return c.id === pageClient; });
          if (pageClient && !listed) {
            opts.unshift('<option value="' + esc(pageClient) + '">The client open on this page</option>');
          }
          sel.innerHTML = '<option value="">' +
            (opts.length ? "Pick one of your clients…" : "No clients are assigned to you yet") +
            "</option>" + opts.join("");
          sel.value = state.clientId || "";
          if (sel.value !== state.clientId) state.clientId = "";
          sel.onchange = function () {
            if (sel.value !== state.clientId) state.conversationId = null;
            state.clientId = sel.value;
          };
        });
      }
    }

    /* The client the current screen is open on: ?client_id=, or ?id= on the
       Client Control Panel. A uuid or nothing. */
    function pageClientId() {
      try {
        var u = new URL(location.href);
        var cid = u.searchParams.get("client_id") ||
          (/client-control-panel\.html$/.test(u.pathname) ? u.searchParams.get("id") : "");
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cid || "") ? cid : "";
      } catch (e) {
        return "";
      }
    }

    /* Never paint a message as sent before the server accepts it. Previously
       Send cleared the input and added a right-hand bubble BEFORE validation,
       including when no teammate/client was picked or fetch failed outright.
       Keep the draft and prevent double-clicks until we have a real ACK. */
    var sendBusy = false;
    var sendRetry = null;
    var portalRetry = null;
    function submit() {
      var input = document.getElementById("fh-chat-input");
      var q = (input && input.value || "").trim();
      if (!q || sendBusy) return;
      var mode = state.mode;
      var kind = state.msgKind;
      var peer = state.peerId;
      var client = state.clientId;
      var thread = state.conversationId;
      var send = document.getElementById("fh-chat-send");
      var hint = document.getElementById("fh-chat-hint");
      var originalHint = hint ? hint.textContent : "";

      function status(message, isError) {
        if (!hint || !hint.isConnected) return;
        hint.textContent = message || originalHint;
        if (isError) hint.setAttribute("role", "alert");
        else {
          hint.removeAttribute("role");
          hint.setAttribute("aria-live", "polite");
        }
      }
      if (mode === "message" && !isPortal && kind === "internal" && !peer && !thread) {
        status("Pick a teammate first. Your message has not been sent.", true);
        return;
      }
      if (mode === "message" && !isPortal && kind === "client" && !client) {
        status("Pick one of your clients first. Your message has not been sent.", true);
        return;
      }
      if (isPortal && isDemo) {
        input.value = "";
        addMsg(esc(q), "me");
        addMsg("Sample chat only — no message was sent to staff.");
        return;
      }

      function stillHere() {
        return input.isConnected && state.mode === mode &&
          (isPortal || (state.msgKind === kind &&
            (kind !== "internal" || state.peerId === peer) &&
            (kind !== "client" || state.clientId === client)));
      }
      sendBusy = true;
      input.disabled = true;
      if (send) send.disabled = true;
      status("Saving…", false);
      function finish(response, onSaved) {
        sendBusy = false;
        if (input.isConnected) input.disabled = false;
        if (send && send.isConnected) send.disabled = false;
        /* A slower reply for client A must never paint into client B's chat. */
        if (!stillHere()) return;
        if (!response || !response.ok) {
          status("Not confirmed (" + ((response && response.error) || "request_failed") +
            "). Your draft is kept. Check the thread before retrying.", true);
          return;
        }
        if (input.value.trim() === q) input.value = "";
        sendRetry = null;
        status("", false);
        onSaved(response);
      }

      if (mode === "system" || mode === "knowledge") {
        api("/api/chat/ask", {
          method: "POST",
          body: JSON.stringify({ mode: mode, question: q })
        }).then(function (res) {
          finish(res, function (saved) {
            addMsg(esc(q), "me");
            var answer = (saved.answer && saved.answer.text) || "No answer.";
            var sources = (saved.sources || []).map(function (s) {
              if (s.href) return '<a href="' + esc(s.href) + '">' + esc(s.title || s.href) + "</a>";
              return esc(s.title || s.id || "source");
            }).join(" · ");
            addMsg(esc(answer) + (sources ? '<span class="src">Sources: ' + sources + "</span>" : ""));
          });
        });
        return;
      }

      if (isPortal) {
        /* A timeout can happen AFTER the server saved a note. Retrying the
           unchanged draft must carry the same key to suppress duplicates.
           New text starts a new note. This key never represents SMS delivery. */
        if (!portalRetry || portalRetry.text !== q) {
          portalRetry = { text: q, key: (window.crypto && window.crypto.randomUUID)
            ? window.crypto.randomUUID()
            : String(Date.now()) + "-" + String(Math.random()).slice(2) };
        }
        api("/api/chat/portal-message", {
          method: "POST",
          body: JSON.stringify({ body: q, channel: "sms", idempotency_key: portalRetry.key })
        }).then(function (res) {
          finish(res, function (saved) {
            portalRetry = null;
            state.conversationId = saved.conversation_id;
            addMsg(esc(q), "me"); // Persisted in portal thread, NOT an outbound SMS receipt.
            if (saved.deduped) addMsg("Already saved — your retry did not create a second message.");
            loadPortalThread();
            syncPoll();
          });
        });
        return;
      }

      /* Staff internal and client sends already accept an idempotency key.
         Retain it for a failed/ambiguous response to this exact same draft
         and destination so a manual retry cannot dispatch a second message. */
      var destination = mode + "|" + kind + "|" + peer + "|" + client + "|" + thread;
      if (!sendRetry || sendRetry.text !== q || sendRetry.destination !== destination) {
        var freshKey = (window.crypto && window.crypto.randomUUID)
          ? window.crypto.randomUUID()
          : String(Date.now()) + "-" + String(Math.random()).slice(2);
        sendRetry = { text: q, destination: destination, key: freshKey };
      }
      var retryKey = sendRetry.key;

      if (kind === "internal") {
        var payload = { kind: "internal", body: q, idempotency_key: retryKey };
        if (thread) payload.conversation_id = thread;
        if (peer) payload.peer_staff_id = peer;
        api("/api/chat/messages", { method: "POST", body: JSON.stringify(payload) }).then(function (res) {
          finish(res, function (saved) {
            state.conversationId = saved.conversation_id;
            addMsg(esc(q), "me"); // The internal row exists before this ACK.
            loadInternalThread();
            syncPoll();
          });
        });
        return;
      }

      api("/api/chat/messages", {
        method: "POST",
        body: JSON.stringify({
          kind: "client",
          body: q,
          client_id: client,
          channel: "sms",
          idempotency_key: retryKey
        })
      }).then(function (res) {
        finish(res, function (saved) {
          state.conversationId = saved.conversation_id;
          addMsg(esc(q), "me"); // Saved row, not a carrier delivery receipt.
          var outcome = String(saved.outcome || (saved.message && saved.message.status) || "queued");
          if (saved.deduped) {
            addMsg("Already saved — duplicate retry prevented. Check delivery status.");
          } else if (/blocked|refused|failed|suppressed/i.test(outcome)) {
            addMsg("Not delivered — " + esc(outcome) +
              (saved.detail ? " (" + esc(saved.detail) + ")" : "") + ".");
          } else if (outcome === "sent") {
            addMsg("Sent to provider; final delivery receipt not verified.");
          } else {
            addMsg("Saved — " + esc(outcome) + "; not yet confirmed delivered." +
              (saved.detail ? " (" + esc(saved.detail) + ")" : ""));
          }
        });
      });
    }

    fab.onclick = function () {
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) {
        paintModes();
        paintFoot();
        if (isPortal) {
          loadPortalThread();
        } else if (state.mode === "message" && state.msgKind === "internal" &&
            (state.peerId || state.conversationId)) {
          loadInternalThread();
        } else if (!document.getElementById("fh-chat-body").children.length) {
          paintBodyWelcome();
        }
        var input = document.getElementById("fh-chat-input");
        if (input) input.focus();
        syncPoll();
      } else {
        syncPoll();
      }
    };
    document.getElementById("fh-chat-close").onclick = function () {
      panel.classList.remove("open");
      syncPoll();
    };

    paintModes();
    paintFoot();
    paintBodyWelcome();

    /* Stay closed on first paint. After login settles, pop open so it feels
       like an alert — not already open when they land. */
    if (autoOpenPrecall) {
      var popMs = Number(opts.popAfterMs);
      if (!Number.isFinite(popMs) || popMs < 0) popMs = 1400;
      setTimeout(function () {
        if (panel.classList.contains("open")) return;
        panel.classList.add("open");
        paintModes();
        paintFoot();
        if (isPortal) loadPortalThread();
        else if (!document.getElementById("fh-chat-body").children.length) paintBodyWelcome();
        var precallInput = document.getElementById("fh-chat-input");
        if (precallInput) precallInput.focus();
        syncPoll();
      }, popMs);
    }
  }

  window.FHChat = { mount: mount };
})();
