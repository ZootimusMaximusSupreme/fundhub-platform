/* Fundhub app data layer — the one place a screen asks for real records.
 *
 * Every call resolves; none reject. A screen that asks for data it cannot get
 * keeps whatever it already rendered, so a backend outage degrades to the
 * built-in sample markup rather than to a blank page.
 *
 * ONE NAMED EXCEPTION: read()'s `params` argument. That is not a runtime
 * condition — a backend being down, a record not existing — it is the
 * calling screen's own code being wrong, and this file's history says a
 * silent one is worse than a crash. finance-os.html once passed a pre-built
 * query STRING where read() wanted a params OBJECT; `for (var k in params)`
 * iterated the string's characters instead of throwing, and the result was a
 * malformed request that still came back looking like an answer — 400 on an
 * endpoint that validates its parameters, and a silently wrong org-wide
 * roll-up on one that does not. See read() below: a non-object, non-undefined
 * `params` throws synchronously, on purpose, rather than being handed to the
 * loop that produced that bug.
 *

 * The return shape is always { ok, source, data, error }:
 *   ok:false source:"unauthorized" — signed out, or the session is stale
 *   ok:false source:"nodb"         — the DATABASE said it was down (503, or
 *                                    db:"down" in the body). Nothing else.
 *   ok:false source:"server"       — the API answered, and the answer was an
 *                                    error our own code produced. See below.
 *   ok:false source:"offline"      — /api/* is not deployed or unreachable
 *   ok:false source:"notfound"     — backend is fine; that record does not exist
 *   ok:false source:"badrequest"   — backend is fine; the parameter was bad
 *   ok:false source:"nodata"       — the screen had nothing to ask about
 *   ok:false source:"demo"         — demo session, no read attempted
 *   ok:true  source:"api"          — real rows
 *
 * "notfound"/"badrequest" are NOT outages. A screen must report them as a read
 * that did not come back, with a reason, never as "backend unavailable" — see
 * the reference wiring in client-control-panel.html. No failure message calls
 * what is left on screen "sample": this layer does not know what the screen is
 * still showing, and UI-STANDARDS §6 forbids sample data dressed as real.
 *
 * "nodb" vs "server" is the same class of distinction and it was got wrong for
 * the same reason (audit m17). Every non-ok body used to be classified "nodb",
 * so a handler that threw — netlify/functions/api.mjs:334 answers 500
 * { ok:false, error:"internal_error" }, and :327 answers 500
 * { ok:false, error:"handler_no_response" } — reached the user as a database
 * outage. Whoever got paged spent it checking Postgres while the fault sat in
 * the function logs. "nodb" is now reserved for the database saying so itself.
 *
 * Screens must branch on `ok` and never assume `data` is populated. See
 * client-control-panel.html for the reference wiring.
 */
window.FHData = (function () {
  "use strict";

  function token() {
    try { return localStorage.getItem("fh_token") || ""; } catch (e) { return ""; }
  }

  // Signing in through demo mode stores a sentinel token; it is not a real
  // credential and must not be presented as one.
  function isDemo() {
    try {
      if (localStorage.getItem("fh_demo") !== "1") return false;
      var t = localStorage.getItem("fh_token") || "";
      // A live staff token must hit the API. The old /crm.html pack set
      // fh_demo=1 while leaving a real token in place, which painted fake
      // people on fundhub.ai. Offline demo still uses token "demo" / "demo-token".
      if (t && t !== "demo" && t !== "demo-token") return false;
      return true;
    } catch (e) { return false; }
  }

  function fail(source, error) {
    return { ok: false, source: source, data: null, error: error };
  }

  /* Prefer a sentence the server wrote for a person over a machine code.
     APIs in this repo often answer { error: "some_code", message: "Plain words." }.
     Older screens showed `error` and people saw "write_failed" / "invalid_template_key"
     instead of the sentence that told them what to do. A value that is only
     snake_case with no spaces is treated as an internal code and skipped when a
     real message exists; when only the code is present, we still fall back to a
     plain sentence rather than leaking the code onto the screen. */
  function userFacing(d, fallback) {
    var msg = d && typeof d.message === "string" ? d.message.trim() : "";
    if (msg) return msg;
    var err = d && typeof d.error === "string" ? d.error.trim() : "";
    if (err && /\s/.test(err)) return err; // already a sentence
    if (err && !/^[a-z][a-z0-9_]*$/.test(err)) return err;
    return fallback || "That did not work. Try again.";
  }

  function get(path) {
    if (isDemo()) {
      return Promise.resolve(fail("demo", "demo session — no backend read attempted"));
    }
    var t = token();
    var started;
    // fetch() rejects rather than throws in a browser, but the "no reader ever
    // rejects" contract above is load-bearing — no screen wraps its call in a
    // .catch — so it must hold even if fetch is missing or throws outright.
    try {
      started = fetch(path, {
        headers: t ? { accept: "application/json", authorization: "Bearer " + t }
                   : { accept: "application/json" }
      });
    } catch (e) {
      return Promise.resolve(fail("offline", (e && e.message) || "fetch unavailable"));
    }
    return Promise.resolve(started).then(function (r) {
      if (r.status === 401 || r.status === 403) return fail("unauthorized", "not signed in");
      // A 404 is TWO different things and they must not share a banner. The
      // router's fallthrough says error:"not_found" with the unmatched path,
      // which means /api/* really is not deployed. An endpoint that ran and
      // found no such row is a working backend answering honestly, and telling
      // the user "backend unavailable" for a stale id in the URL is a lie.
      if (r.status === 404) {
        return r.json().then(function (d) {
          return (d && d.error === "not_found" && typeof d.path === "string")
            ? fail("offline", "/api/* not deployed")
            : fail("notfound", "no such record");
        }).catch(function () {
          return fail("offline", "/api/* not deployed");
        });
      }
      if (r.status === 400) {
        return r.json().then(function (d) {
          return fail("badrequest", userFacing(d, "That request was not accepted."));
        }).catch(function () { return fail("badrequest", "That request was not accepted."); });
      }
      return r.json().then(function (d) {
        // THE DATABASE GETS TO SPEAK FOR ITSELF, AND NOTHING ELSE SPEAKS FOR IT.
        // These are the only two signals that actually come from the database
        // layer: a 503 raised by the connection guard (see the note in
        // src/http/middleware/requireAuth.mjs:73) or an explicit db:"down" from
        // /api/health. Anything else claiming "the database is down" is a guess.
        if (r.status === 503 || (d && d.db === "down")) {
          return fail("nodb", userFacing(d, "The database is not reachable right now."));
        }
        /* A CRASHED HANDLER IS NOT A DATABASE OUTAGE (audit m17). This line used
           to read fail("nodb", ...) for every body that was not ok, which meant
           a 500 out of netlify/functions/api.mjs:327 or :334 — our code throwing
           or forgetting to answer — was announced to the user as the database
           being unreachable.

           What this code can honestly tell apart at this point: it has a status
           and a parsed JSON body, so it knows the server ran, chose a status,
           and wrote a reply. What it CANNOT tell is WHY the handler failed —
           api.mjs:334 wraps every thrown error identically, a database error
           among them. So "server" claims only what is observable: our side
           answered with an error, and the database did not report itself down.
           explain() words it that way on purpose; see the note there. */
        if (!d || d.ok !== true) {
          return fail("server", userFacing(d, "Something went wrong. Try again in a moment."));
        }
        return { ok: true, source: "api", data: d, error: null };
      }).catch(function () {
        return fail("offline", "response was not JSON");
      });
    }).catch(function (e) {
      return fail("offline", (e && e.message) || "network error");
    });
  }

  return {
    /* GET /api/dashboard/clients → data.clients[]

       opts.fulfillment asks that endpoint to ALSO work out each client's next
       action and the six rollup tiles. It is OPT-IN because that costs eleven
       extra reads and only the pipeline page's Fulfillment lens uses them.
       Called with no opts — as every other screen calls it — the request and
       the reply are byte for byte what they have always been. */
    clients: function (limit, opts) {
      return get("/api/dashboard/clients?limit=" + encodeURIComponent(limit || 200) +
                 (opts && opts.fulfillment ? "&fulfillment=1" : ""));
    },
    /* GET /api/dashboard/client?id= → data.client, .transactions, .crs_results,
       .messages, .tasks */
    client: function (id) {
      if (!id) return Promise.resolve(fail("nodata", "no client id in the URL"));
      return get("/api/dashboard/client?id=" + encodeURIComponent(id));
    },
    /* GET /api/dashboard/kpis?period= → company money + funnel KPIs. */
    kpis: function (period) {
      return get("/api/dashboard/kpis?period=" + encodeURIComponent(period || "7d"));
    },
    /* GET /api/read/ops-pulse?period= → pulse + two briefs. Read only. */
    opsPulse: function (period) {
      return get("/api/read/ops-pulse?period=" + encodeURIComponent(period || "7d"));
    },
    /* GET /api/messages-outbound → the outbound queue's status. Read only.
       Loading a page must only read, so the Outbound Mail panel asks with a
       GET; sending and settings stay on write() as POSTs (hole N3). */
    outboxStatus: function () {
      return get("/api/messages-outbound");
    },
    /* POST /api/ops/hire-closer — hire task + LinkedIn when the calendar is packed. */
    hireCloser: function () {
      return this.write("/api/ops/hire-closer", {});
    },

    /* GET /api/dashboard/pipeline → data.stages[] with .cards[], each stage
       carrying its own count and money so a column can never disagree with
       the cards under it. */
    pipeline: function (key) {
      return get("/api/dashboard/pipeline?key=" + encodeURIComponent(key || "sales"));
    },

    /* GET /api/dashboard/pipeline-counts → data.counts, a { pipeline_key: n }
       map covering every rail in one request. The rail tabs need the number
       only, so this replaces fetching each rail's whole board to measure it. */
    pipelineCounts: function () {
      return get("/api/dashboard/pipeline-counts");
    },
    /* GET /api/tasks → data.tasks[] */
    tasks: function (opts) {
      var o = opts || {};
      var q = "?done=" + (o.done === true ? "true" : "false");
      if (o.clientId) q += "&client_id=" + encodeURIComponent(o.clientId);
      return get("/api/tasks" + q);
    },
    /* GET /api/tasks?role= / ?mine=1 — the role queues from 041. */
    taskQueue: function (opts) {
      var o = opts || {};
      var q = "?done=" + (o.done === true ? "true" : "false");
      if (o.role) q += "&role=" + encodeURIComponent(o.role);
      if (o.mine) q += "&mine=1";
      if (o.unclaimed) q += "&unclaimed=1";
      if (o.limit) q += "&limit=" + encodeURIComponent(o.limit);
      if (o.offset) q += "&offset=" + encodeURIComponent(o.offset);
      return get("/api/tasks" + q);
    },

    /* The Unit 9 read endpoints. Each returns { ok, items, count, limit,
       offset, hasMore } — read() unwraps to the same { ok, source, data }
       shape as everything else so a screen branches once. */
    read: function (resource, params) {
      // A pre-built query string, or any other non-object, is refused rather
      // than iterated. `for (var k in o)` over a string walks its character
      // indices ("0","1","2"…) rather than throwing, which is what let a
      // malformed request stand in for a real one — see the file header.
      // Arrays are excluded too: typeof [] === "object", but iterating one
      // the same way produces the identical index-key shape as a string.
      if (params !== undefined && params !== null &&
          (typeof params !== "object" || Array.isArray(params))) {
        throw new TypeError(
          'FHData.read("' + resource + '", params) — params must be an object ' +
          "or omitted, not " + (Array.isArray(params) ? "an array" : typeof params) +
          ". A pre-built query string here silently corrupts the request instead " +
          "of failing loudly — build the query with an object, not with qs()."
        );
      }
      var q = [];
      var o = params || {};
      for (var k in o) {
        if (Object.prototype.hasOwnProperty.call(o, k) && o[k] != null && o[k] !== "") {
          q.push(encodeURIComponent(k) + "=" + encodeURIComponent(o[k]));
        }
      }
      return get("/api/read/" + resource + (q.length ? "?" + q.join("&") : ""));
    },

    commissions:     function (p) { return this.read("commissions", p); },
    commissionRules: function () { return get("/api/commission-rules"); },
    invoices:        function (p) { return this.read("invoices", p); },
    documents:       function (p) { return this.read("documents", p); },

    /* GET /api/documents-download?id= → data.document.download.{url,expiresAt}
       A FRESH link to a file that is already saved.

       Not under /api/read/, so it does not go through read() above.

       WHY IT IS A SEPARATE CALL AND NOT A FIELD ON documents(). A signed link is
       a bearer credential with a clock on it: anyone holding the URL can fetch
       the bytes until it expires, sign-in or no sign-in. Attaching one to every
       row of a 200-row list would mint 200 live credentials to answer a question
       nobody asked, and drop all of them into any log or cache that keeps a copy
       of that response. This mints exactly one, when somebody clicks.

       The link is short-lived on purpose (fifteen minutes, fixed server-side —
       the query string cannot ask for longer). Open it, do not store it: a link
       held in a variable across a long session will stop working, and the fix is
       to call this again rather than to ask for a longer life. */
    documentDownload: function (id) {
      return get("/api/documents-download?id=" + encodeURIComponent(id || ""));
    },

    /* GET /api/applications?client_id= → data.applications[] and data.decisions[]
       — every bank this client has applied to, what the bank said, and how much
       it approved.

       Not under /api/read/, so it does not go through read() above; it is the
       same handler the client control panel POSTs a bank yes/no to.

       WHY A SCREEN NEEDS THIS THROUGH THE DATA LAYER AND NOT A RAW fetch. The
       count of approvals still waiting on a dollar amount now LEADS the client
       control panel, and a headline number has to be able to tell "we looked
       and nothing is waiting" from "we could not look". A raw fetch cannot: a
       failed read and an empty file both arrive as no rows. get() classifies
       the failure (source: unauthorized / nodb / server / offline …) so the
       screen can say "could not check" out loud, in the house wording, instead
       of quietly showing an all-clear it never established. */
    applications: function (clientId) {
      if (!clientId) return Promise.resolve(fail("nodata", "no client id in the URL"));
      return get("/api/applications?client_id=" + encodeURIComponent(clientId));
    },

    fundingRounds:   function (p) { return this.read("funding-rounds", p); },
    affiliates:      function (p) { return this.read("affiliates", p); },
    partners:        function (p) { return this.read("partners", p); },
    messageTemplates:function (p) { return this.read("message-templates", p); },
    staff:           function (p) { return this.read("staff", p); },
    entitlements:    function (p) { return this.read("entitlements", p); },
    portalContracts: function (p) { return this.read("portal-contracts", p); },
    portalSummary:   function (p) { return this.read("portal-summary", p); },
    failedEvents:    function (p) { return this.read("failed-events", p); },
    /* The staff reply inbox — public/app/messaging.html.

       THREE CALLS, THREE DIFFERENT QUESTIONS, and they are separate on purpose:
         inbox()          every thread in the company, newest activity first
         conversations()  ONE client's threads — the per-client panel, and the
                          endpoint the Closer Dashboard already used. Reused
                          rather than reimplemented; it requires a client_id and
                          that requirement is deliberate (see its handler).
         thread()         the messages inside one conversation

       inbox() takes no id at all, which is the whole point of an inbox: it is
       the list of things you do not already know about. Scoping is the
       session's company, applied server-side. */
    inbox: function (p) { return this.read("inbox", p); },
    conversations: function (p) { return this.read("conversations", p); },
    thread: function (conversationId, limit) {
      if (!conversationId) return Promise.resolve(fail("nodata", "no conversation selected"));
      return this.read("messages", { conversation_id: conversationId, limit: limit || 200 });
    },

    /* GET /api/read/search?q= — the global CRM search. Groups clients,
       contracts, documents, conversations and pipeline cards. An empty `q`
       is a real empty answer from the endpoint, not a client-side skip. */
    search: function (p) {
      var o = p || {};
      return this.read("search", { q: o.q, limit: o.limit });
    },

    /* sendMessage — a staff member's reply. POST /api/messages.

       Goes through write(), so a demo session refuses rather than attempting it,
       and a 400 comes back as "badrequest" rather than as an outage. The reply
       to a 200 carries an `outcome` the screen prints in plain words: accepted
       is not the same as delivered, and a message held for quiet hours must not
       be reported as a failure the user should retype. */
    sendMessage: function (payload) {
      return this.write("/api/messages", payload || {});
    },

    /* The LOCAL inquiry_log queue. Not /api/inquiry — that proxies the external
       case runtime and returns its shape, not these columns. */
    inquiries:       function (p) { return this.read("inquiries", p); },
    /* GET /api/inquiries?recent=letters → data.letters[] — the letter and portal
       rows of inquiry_attempts, newest first, for the Specialist desk's "Recent
       Letters Issued" block. Not a /api/read/ resource, so it calls get()
       directly the way pipelineCounts and commissionRules do. */
    recentLetters:   function (limit) {
      return get("/api/inquiries?recent=letters" +
        (limit ? "&limit=" + encodeURIComponent(limit) : ""));
    },
    inquiryCases:    function (p) { return this.read("inquiry-cases", p); },

    /* GET /api/partner-brand — not under /api/read, so it gets its own reader
       rather than a path-traversal through read(). Partner funnel lane only —
       see docs/specs/BRAND-THEMING-SPEC.md. */
    brand: function (partnerId) {
      if (!partnerId) return Promise.resolve(fail("nodata", "no partner id"));
      return get("/api/partner-brand?partner_id=" + encodeURIComponent(partnerId));
    },

    /* GET /api/org-brand — this company's CRM theme. No org id in the URL; the
       server scopes to the caller's session. */
    orgBrand: function () {
      return get("/api/org-brand");
    },

    /* ---------------------------------------------------------------------
       write — the POST half. Same contract as get(): it ALWAYS resolves, never
       rejects, and returns the same { ok, source, data, error } shape, so a
       screen branches on `ok` exactly once whether it is reading or writing.

       WHY THIS IS HERE AND NOT IN EACH SCREEN. Until the Finance OS screens
       landed, every wired screen was read-only and this file had no writer, so
       the first screen that needed to POST would have hand-rolled the token
       header, the JSON encoding and the status classification — and the next
       five would have hand-rolled them again, slightly differently. Six copies
       of "how do we tell a 403 from an outage" is six chances to tell a user
       the database is down when their session simply expired. One copy, here.

       IT REUSES get()'s CLASSIFICATION DELIBERATELY, including the distinction
       audit m17 was about: a crashed handler is source:"server", and only the
       database saying so itself is source:"nodb".

       A 501 IS NOT AN OUTAGE AND MUST NOT BE REPORTED AS ONE. The eight
       /api/finance/* routes are registered before their handlers are finished
       and answer 501 not_implemented in the meantime — deliberately, so a
       feature cannot be built and left unreachable (netlify/functions/api.mjs).
       That is "built, not finished", which is a true and useful thing to put in
       front of somebody; "we could not reach the server" is not. It gets its own
       source so a screen can say so.

       DEMO SESSIONS DO NOT WRITE. A demo session holds a sentinel token, not a
       credential. A read under one falls back to sample markup harmlessly; a
       WRITE under one would either be rejected or, worse, accepted — so it is
       refused here rather than attempted. */
    write: function (path, body) {
      if (isDemo()) {
        return Promise.resolve(fail("demo", "demo session — no write attempted"));
      }
      var t = token();
      var headers = { accept: "application/json", "content-type": "application/json" };
      if (t) headers.authorization = "Bearer " + t;
      var started;
      try {
        started = fetch(path, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(body || {})
        });
      } catch (e) {
        return Promise.resolve(fail("offline", (e && e.message) || "fetch unavailable"));
      }
      return Promise.resolve(started).then(function (r) {
        if (r.status === 401 || r.status === 403) return fail("unauthorized", "not signed in, or not allowed");
        if (r.status === 501) {
          return r.json().then(function (d) {
            return fail("unbuilt", userFacing(d, "That action is not built yet."));
          }).catch(function () { return fail("unbuilt", "That action is not built yet."); });
        }
        if (r.status === 404) {
          return r.json().then(function (d) {
            return (d && d.error === "not_found" && typeof d.path === "string")
              ? fail("offline", "/api/* not deployed")
              : fail("notfound", userFacing(d, "That record was not found."));
          }).catch(function () { return fail("offline", "/api/* not deployed"); });
        }
        if (r.status === 400 || r.status === 409) {
          // 409 is "the record moved under you, look again" — a real answer the
          // user can act on, not a fault. It shares the badrequest source
          // because both mean "the backend is fine, the request was not".
          return r.json().then(function (d) {
            return fail("badrequest", userFacing(d, "That request was not accepted."));
          }).catch(function () { return fail("badrequest", "That request was not accepted."); });
        }
        return r.json().then(function (d) {
          if (r.status === 503 || (d && d.db === "down")) {
            return fail("nodb", userFacing(d, "The database is not reachable right now."));
          }
          if (!d || d.ok !== true) {
            return fail("server", userFacing(d, "Something went wrong. Try again in a moment."));
          }
          return { ok: true, source: "api", data: d, error: null };
        }).catch(function () {
          return fail("offline", "response was not JSON");
        });
      }).catch(function (e) {
        return fail("offline", (e && e.message) || "network error");
      });
    },

    /* ---------------------------------------------------------------------
       uploadFiles — POST /api/documents-upload as multipart/form-data.
       Same { ok, source, data, error } contract as get()/write() so a screen
       branches on `ok` exactly once whichever call it made — but it does NOT
       reuse write(): write() JSON.stringifies its body and sets
       content-type: application/json, both wrong for a file. The browser sets
       multipart's boundary itself, so content-type must be left unset here.

       files — an array of File/Blob objects (e.g. from an <input type=file>
       or a drop event). fields — plain string key/values (client_id, subtype).
       DEMO SESSIONS DO NOT UPLOAD, same reasoning as write(). */
    uploadFiles: function (path, files, fields) {
      if (isDemo()) {
        return Promise.resolve(fail("demo", "demo session — no upload attempted"));
      }
      if (!files || !files.length) {
        return Promise.resolve(fail("badrequest", "no files to upload"));
      }
      var t = token();
      var headers = { accept: "application/json" };
      if (t) headers.authorization = "Bearer " + t;

      var form = new FormData();
      var f = fields || {};
      for (var k in f) {
        if (Object.prototype.hasOwnProperty.call(f, k) && f[k] != null) form.append(k, f[k]);
      }
      for (var i = 0; i < files.length; i++) form.append("file", files[i], files[i].name);

      var started;
      try {
        started = fetch(path, { method: "POST", headers: headers, body: form });
      } catch (e) {
        return Promise.resolve(fail("offline", (e && e.message) || "fetch unavailable"));
      }
      return Promise.resolve(started).then(function (r) {
        if (r.status === 401 || r.status === 403) return fail("unauthorized", "not signed in, or not allowed");
        if (r.status === 404) {
          return r.json().then(function (d) {
            return (d && d.error === "not_found" && typeof d.path === "string")
              ? fail("offline", "/api/* not deployed")
              : fail("notfound", "no such record");
          }).catch(function () { return fail("offline", "/api/* not deployed"); });
        }
        if (r.status === 400) {
          return r.json().then(function (d) {
            return fail("badrequest", userFacing(d, "That request was not accepted."));
          }).catch(function () { return fail("badrequest", "That request was not accepted."); });
        }
        return r.json().then(function (d) {
          if (r.status === 503 || (d && d.db === "down")) {
            return fail("nodb", userFacing(d, "The database is not reachable right now."));
          }
          if (!d || d.ok !== true) {
            return fail("server", userFacing(d, "Something went wrong. Try again in a moment."));
          }
          return { ok: true, source: "api", data: d, error: null };
        }).catch(function () {
          return fail("offline", "response was not JSON");
        });
      }).catch(function (e) {
        return fail("offline", (e && e.message) || "network error");
      });
    },

    /* The query string is how a screen is told which record to show. */
    param: function (name) {
      try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; }
    },

    /* ---------------------------------------------------------------------
       banner — the one place a screen says where its numbers came from.
       Duplicated by hand in the first two wired screens; hoisted here so the
       remaining nineteen cannot drift from it.

         real   — these are database rows
         sample — built-in sample markup, backend not queried (demo)
         error  — backend could not answer; keep dashes, do not invent people

       NO COLOURED BAR, ANY TONE. Owner call 2026-08-28: "I want all the color
       bars gone from entire crm, look amatuer dont you think?" This painted a
       full-width mint, peach or rose strip across the bottom edge of every
       screen that reads anything. What each tone does now:

         sample — renders nothing. Suppressed 2026-08-27, a day before the
                  rest; kept suppressed.
         real   — renders nothing. "live documents", "live file · 6 payments"
                  is a developer's receipt, not something staff act on, and it
                  was the green bar. The LIVE pill in the top bar already says
                  the screen is on real data.
         error  — STILL SAYS SO. A read that failed leaves dashes on screen and
                  something has to explain them. It renders in the app's own
                  dark chrome, the same ink as the top bar, with the sentence
                  in coral. A coloured word is not a coloured bar.

       RULE: a live screen never keeps sample people. Empty stays empty.
       --------------------------------------------------------------------- */
    _parts: {},
    banner: function (tone, text, key) {
      var el = document.getElementById("fh-data-banner");
      if (!el) {
        el = document.createElement("div");
        el.id = "fh-data-banner";
        el.setAttribute("role", "status");
        document.body.appendChild(el);
      }

      /* A screen can have MORE THAN ONE data source, and the first version of
         this let them overwrite each other — products-commissions reported its
         ledger and silently dropped the product ladder, because whichever
         wire() resolved last won. Each source now keys its own part and the
         banner shows all of them, with the worst tone winning: one failed read
         must not be hidden behind another that succeeded. */
      this._parts[key || text] = { tone: tone, text: text };
      var parts = Object.keys(this._parts).map(function (k) { return this._parts[k]; }, this);

      /* Only a failed read reaches the strip now — "sample" was dropped on
         2026-08-27 and "real" on 2026-08-28, both owner calls; see the block
         comment above. A screen where everything loaded shows no strip at all
         and reserves no space for one, which is the ordinary case: nothing
         along the bottom edge. */
      parts = parts.filter(function (p) { return p.tone === "error"; });
      if (!parts.length) {
        el.style.display = "none";
        el.textContent = "";
        document.documentElement.style.setProperty("--fh-statusbar", "0px");
        return el;
      }
      el.style.display = "";

      /* Everything left is an error, so there is no worst tone to work out any
         more. More than one read can fail at once and each still gets said. */
      text = parts.map(function (p) { return p.text; }).join("  ·  ");

      /* App chrome, not a colour block: the same ink as the top bar, with the
         sentence in coral. --alert is the brand's coral and shell.js paintBrand
         repaints it per company, so a white-label tenant gets its own alert
         colour here instead of a hardcoded one. */
      el.style.cssText =
        "position:fixed;left:0;right:0;bottom:0;z-index:2147482000;padding:7px 14px;" +
        "background:#0A0A0A;color:var(--alert,#F2A69B);border-top:1px solid #26262B;" +
        "font:600 11px/1.4 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.05em;text-align:center";
      el.textContent = text;
      document.documentElement.style.setProperty("--fh-statusbar", (el.offsetHeight || 32) + "px");
      return el;
    },

    /* explain — turn a failed read into the right banner, once, so nineteen
       screens do not each invent their own wording for "no backend". */
    explain: function (res, what) {
      var detail = (res && res.error) || "no detail";
      if (res && res.source === "demo") {
        this.banner("sample", "sample " + what + " — demo session, the backend was not queried", what);
      } else if (res && res.source === "unauthorized") {
        /* 401 and 403 arrive here as the SAME source (see get(): both map to
           "unauthorized"), so this file cannot tell "signed out" from "signed
           in but not allowed". The old wording picked one and told a client who
           WAS signed in that they were not — a lie on screen, and the reason
           they stopped trusting the page. It also called what was left on the
           screen "sample", which is not this layer's to promise. Say the two
           possibilities, assert neither, and give a next step. */
        this.banner("error", "We could not load " + what + ". This account may not be " +
          "allowed to see it, or may need to be signed in again. If signing in again does " +
          "not help, ask your advisor.", what);
      } else if (res && res.source === "unbuilt") {
        // 501 from a route that is registered but whose handler is not finished.
        // "Sample" tone, not "error": nothing is broken and nothing is down —
        // this part of the product is not built yet, which is a different
        // sentence and sends the reader somewhere different.
        this.banner("sample", what + " — this part is not built yet (" + detail + ")", what);
      } else if (res && (res.source === "notfound" || res.source === "badrequest")) {
        // The backend answered. Nothing is broken except what was asked for, so
        // this is a "sample" tone with a reason, not an outage.
        this.banner("sample", "We could not load " + what + " — " +
          (res.source === "notfound" ? "no matching record" : "the request was rejected") +
          " (" + detail + "). Check the link you followed, or ask your advisor.", what);
      } else if (res && res.source === "nodb") {
        // The database itself said so — a 503 from the connection guard, or
        // db:"down" from /api/health. This is the one case where naming the
        // database is a fact and not a guess.
        this.banner("error", "We could not load " + what + " — the database is not answering (" +
          detail + "). Try again in a few minutes.", what);
      } else if (res && res.source === "server") {
        /* AUDIT m17. The old wording here was "backend unavailable", and every
           500 out of a crashed handler arrived carrying source "nodb", so the
           screen named the database for a fault that was in our own code.

           It does not say "the database is fine". It cannot know that —
           netlify/functions/api.mjs:334 wraps a database error and a null
           dereference into the identical 500. It says the two things that are
           true: our side broke while answering, and the database did not report
           a problem of its own. An honest vague message sends the reader to the
           right place; a confident wrong one sends them to Postgres for an hour. */
        this.banner("error", "We could not load " + what + " — something went wrong on our side " +
          "while answering. The database did not report a problem. (" + detail + ") " +
          "Try again in a few minutes.", what);
      } else if (res && res.source === "offline") {
        // No reply came back at all — no status, no body. Distinct from the two
        // above, which both mean somebody answered and the answer was bad.
        this.banner("error", "We could not load " + what + " — we could not reach the server (" +
          detail + "). Check your connection and try again.", what);
      } else {
        // Genuinely unclassified. Say that, rather than picking a system to blame.
        this.banner("error", "We could not load " + what + " — the read failed and we cannot " +
          "tell why (" + ((res && res.source) || "unknown") + ": " + detail + "). " +
          "Try again, and tell your advisor if it keeps failing.", what);
      }
    },

    /* wire — the whole flow for a screen: fetch, hand rows to paint(), and on
       failure leave the markup alone and say why.

       THREE outcomes, not two, and conflating the last two is a lie the first
       version of this told: a read that SUCCEEDS but returns no rows is not a
       backend failure. An empty documents table on a fresh database is correct,
       and reporting "backend unavailable" for it sends someone hunting a
       connection problem that does not exist.

         paint() returns a string  → real   (rows rendered)
         paint() returns falsy     → empty  (read fine, nothing to show)
         res.ok false / threw      → error/sample (per explain())            */
    wire: function (promise, what, paint) {
      var self = this;
      return promise.then(function (res) {
        if (res && res.ok) {
          var note = null;
          try { note = paint(res.data); }
          catch (e) { self.banner("error", "We could not show " + what + " — the page failed to " +
            "draw it (" + e.message + "). Reload the page.", what); return; }
          if (note) { self.banner("real", note, what); return; }
          // Connected, queried, nothing there. Do not keep sample people.
          self.banner("sample", "no " + what + " in the database yet", what);
          return;
        }
        self.explain(res, what);
      }).catch(function (e) {
        self.banner("error", "We could not load " + what + " — " +
          (e && e.message ? e.message : "the read failed") + ". Try again in a few minutes.", what);
      });
    }
  };
})();
