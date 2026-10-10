/* Pocket remote for one shoot. Same film key as the iPad (?k=).
 *
 * It reads GET /api/marketing/shoot with the header x-shoot-film.
 * Play and Pause move the words on THIS phone.
 * Save words posts POST /api/marketing/scripts/edit, the same route the
 * iPad uses, so the repo outbox gets the new script. No new login.
 * It does not text anyone.
 *
 * The iPad does not follow this Play button. There is no shared play
 * state on the shoot route. The recording phone is not this page.
 */
(function (root) {
  "use strict";

  function queryValue(search, name) {
    var found = null;
    String(search || "").replace(/^\?/, "").split("&").forEach(function (bit) {
      if (!bit) return;
      var i = bit.indexOf("=");
      var key = i < 0 ? bit : bit.slice(0, i);
      var val = i < 0 ? "" : bit.slice(i + 1);
      try { key = decodeURIComponent(key.replace(/\+/g, " ")); } catch (e) { /* keep the raw key */ }
      if (key !== name) return;
      try { val = decodeURIComponent(val.replace(/\+/g, " ")); } catch (e2) { /* keep the raw value */ }
      found = val;
    });
    return found;
  }

  function filmKeyFrom(search) {
    return queryValue(search, "k") || "";
  }

  function filmPageHref(key, mirror) {
    var q = [];
    if (key) q.push("k=" + encodeURIComponent(key));
    if (mirror) q.push("mirror=1");
    return "/app/teleprompter.html" + (q.length ? "?" + q.join("&") : "");
  }

  /** The first script that is not marked Got it, else the first one. */
  function firstScriptIndex(scripts) {
    var list = Array.isArray(scripts) ? scripts : [];
    for (var i = 0; i < list.length; i++) if (list[i] && !list[i].got_it) return i;
    return list.length ? 0 : -1;
  }

  function wordsOf(text) {
    return String(text == null ? "" : text).trim().split(/\s+/).filter(Boolean);
  }

  /**
   * Move the pocket play clock. dt is seconds. A pause keeps the same time.
   * At the end, playing turns off and the time stays on the last word.
   */
  function stepPlay(state, dt, wpm) {
    var words = Math.max(0, Number(state && state.words) || 0);
    var speed = Number(wpm);
    if (!(speed > 0)) speed = 150;
    var per = 60 / speed;
    var total = words * per;
    var t = Number(state && state.t) || 0;
    if (t < 0) t = 0;
    if (!state || !state.playing) return { playing: false, t: t, words: words, total: total };
    t += Number(dt) || 0;
    if (words === 0 || t >= total) return { playing: false, t: words === 0 ? 0 : total, words: words, total: total };
    return { playing: true, t: t, words: words, total: total };
  }

  function wordAtTime(t, wpm, count) {
    var n = Math.max(0, Number(count) || 0);
    if (!n) return 0;
    var speed = Number(wpm);
    if (!(speed > 0)) speed = 150;
    var i = Math.floor((Number(t) || 0) / (60 / speed));
    if (i < 0) i = 0;
    if (i >= n) return n - 1;
    return i;
  }

  /**
   * The body the edit route already accepts. Parts are left off on purpose:
   * a changed body with no parts is the route's own rule, and the file still
   * goes to the repo outbox.
   */
  function editPayload(script, text, requestId) {
    return {
      request_id: requestId,
      id: script && script.id,
      version: script ? Number(script.version) : NaN,
      body: String(text == null ? "" : text).replace(/\r/g, "")
    };
  }

  function requestId() {
    try { if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID(); } catch (e) { /* fall through */ }
    return "remote-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  root.FundhubTeleprompterRemote = {
    filmKeyFrom: filmKeyFrom,
    filmPageHref: filmPageHref,
    firstScriptIndex: firstScriptIndex,
    wordsOf: wordsOf,
    stepPlay: stepPlay,
    wordAtTime: wordAtTime,
    editPayload: editPayload,
    requestId: requestId
  };

  var doc = root.document;
  if (!doc || !doc.getElementById || !doc.getElementById("remote-play")) return;

  var R = root.FundhubTeleprompterRemote;
  var $ = function (id) { return doc.getElementById(id); };
  var key = "";
  try { key = R.filmKeyFrom(new URL(root.location.href).search); } catch (e) { key = ""; }
  var scripts = [];
  var cur = -1;
  var play = { playing: false, t: 0, words: 0 };
  var wpm = 150;
  var last = 0;
  var raf = 0;

  function say(text) {
    var el = $("remote-status");
    if (el) el.textContent = text;
  }

  function api(method, path, body) {
    var headers = { accept: "application/json" };
    if (key) headers["x-shoot-film"] = key;
    var opts = { method: method, headers: headers, credentials: key ? "omit" : "same-origin" };
    if (!key) {
      var token = "";
      try { token = root.localStorage.getItem("fh_token") || ""; } catch (e) { token = ""; }
      if (token) headers.authorization = "Bearer " + token;
    }
    if (body) {
      headers["content-type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return root.fetch("/api/" + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) { return { status: r.status, data: data }; });
    }, function () { return { status: 0, data: null }; });
  }

  function current() { return cur >= 0 ? scripts[cur] : null; }

  function paintWords() {
    var box = $("remote-roll");
    if (!box) return;
    var text = ($("remote-body") && $("remote-body").value) || "";
    var list = R.wordsOf(text);
    play.words = list.length;
    var at = R.wordAtTime(play.t, wpm, list.length);
    box.textContent = "";
    list.forEach(function (word, i) {
      var sp = doc.createElement("span");
      sp.textContent = word + " ";
      if (i === at) sp.className = "now";
      box.appendChild(sp);
    });
    var mark = box.querySelector(".now");
    if (mark && mark.scrollIntoView) mark.scrollIntoView({ block: "center" });
  }

  function paintPlay() {
    var btn = $("remote-play");
    if (!btn) return;
    var word = play.playing ? "Pause" : "Play";
    btn.textContent = word;
    btn.setAttribute("aria-label", word);
    btn.setAttribute("aria-pressed", play.playing ? "true" : "false");
  }

  function stopLoop() {
    if (raf) root.cancelAnimationFrame(raf);
    raf = 0;
  }

  function frame(now) {
    if (!play.playing) return;
    if (!last) last = now;
    var dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    play = R.stepPlay(play, dt, wpm);
    paintWords();
    paintPlay();
    if (play.playing) raf = root.requestAnimationFrame(frame);
    else stopLoop();
  }

  function toggle() {
    paintWords();
    if (play.playing) {
      play.playing = false;
      stopLoop();
    } else if (!play.words) {
      play.playing = false;
      say("There are no words to play.");
    } else {
      var stepped = R.stepPlay({ playing: true, t: play.t, words: play.words }, 0, wpm);
      if (stepped.t >= stepped.total) play.t = 0;
      play.playing = true;
      last = 0;
      raf = root.requestAnimationFrame(frame);
    }
    paintPlay();
  }

  function fillScripts(list) {
    var sel = $("remote-script");
    if (!sel) return;
    sel.textContent = "";
    list.forEach(function (s, i) {
      var opt = doc.createElement("option");
      opt.value = String(i);
      opt.textContent = "Ad " + (s.ad_id || "?") + " · " + (s.angle_name || s.title || "Untitled");
      sel.appendChild(opt);
    });
    sel.hidden = list.length < 2;
  }

  function showScript(i) {
    if (i < 0 || i >= scripts.length) {
      $("remote-body").value = "";
      $("remote-roll").textContent = "";
      say(key ? "This shoot has no scripts." : "This link has no film key. Open it from the shoot.");
      return;
    }
    cur = i;
    var s = scripts[i];
    var sel = $("remote-script");
    if (sel) sel.value = String(i);
    $("remote-body").value = s.body || "";
    play = { playing: false, t: 0, words: R.wordsOf(s.body).length };
    stopLoop();
    paintPlay();
    paintWords();
    $("remote-title").textContent = s.angle_name || s.title || "This script";
  }

  function takePage(data) {
    var shoot = data && data.shoot;
    scripts = shoot && Array.isArray(shoot.scripts) ? shoot.scripts : [];
    if (data && data.wpm) wpm = Number(data.wpm) || 150;
    fillScripts(scripts);
    var ipad = $("remote-ipad");
    if (ipad) ipad.href = R.filmPageHref(key, true);
    if (!scripts.length) {
      showScript(-1);
      return;
    }
    showScript(R.firstScriptIndex(scripts));
    say("Same shoot as the iPad. Play moves the words on this phone.");
  }

  function load() {
    say("Loading the shoot…");
    return api("GET", "marketing/shoot?wpm=150").then(function (r) {
      if (r.status === 200 && r.data) return takePage(r.data);
      if (r.status === 404) return say("This film link did not open. Open the shoot link again.");
      if (r.status === 0) return say("No connection. The words stayed on this phone.");
      say((r.data && r.data.message) || "The shoot did not load.");
    });
  }

  function saveWords() {
    var s = current();
    if (!s) return say("No script to save.");
    var text = $("remote-body").value;
    if (!String(text || "").trim()) return say("The script is empty. Nothing was saved.");
    if (text.replace(/\r/g, "") === String(s.body || "").replace(/\r/g, "")) return say("No change to save.");
    play.playing = false;
    stopLoop();
    paintPlay();
    var body = R.editPayload(s, text, R.requestId());
    say("Saving…");
    api("POST", "marketing/scripts/edit", body).then(function (r) {
      if (r.status === 200 && r.data && r.data.script) {
        s.id = r.data.script.id;
        s.version = Number(r.data.script.version);
        s.body = r.data.script.body;
        $("remote-body").value = s.body || text;
        say("Saved. The iPad shows these words the next time its words are paused.");
        return;
      }
      if (r.status === 409) return say("The iPad has newer words. Load this page again, then save.");
      if (r.status === 404) return say("This film link cannot save that script.");
      if (r.status === 0) return say("No connection. The words stayed on this phone.");
      say((r.data && r.data.message) || "That edit did not save.");
    });
  }

  $("remote-play").onclick = toggle;
  $("remote-save").onclick = saveWords;
  $("remote-body").addEventListener("focus", function () {
    play.playing = false;
    stopLoop();
    paintPlay();
  });
  $("remote-body").addEventListener("input", function () {
    if (play.playing) return;
    play.t = 0;
    paintWords();
  });
  var sel = $("remote-script");
  if (sel) sel.onchange = function () {
    showScript(Number(sel.value));
  };
  var ipad = $("remote-ipad");
  if (ipad) ipad.href = R.filmPageHref(key, true);
  load();
})(typeof window !== "undefined" ? window : globalThis);
