/* Fundhub teleprompter — rolls the open shoot's scripts, one after another.
 *
 * Spec docs/specs/marketing-machine-2026-10-04.md §8.1 (the web version) and
 * §8.2 (Shoot Day); design docs/specs/command-center-design-2026-10-05.md §3.4.
 * Unit X5. The clock, the keys and the touch moves are ported from v1
 * (tools/teleprompter/index.html), which stays as it is.
 *
 * WHAT IT READS. GET /api/marketing/shoot — the same answer the Shoot tab
 * reads. It rolls shoot.scripts in the shoot's order, starting at the first one
 * with no Got it mark. Each script shows its ad number, its angle name and the
 * exact take file name (marketing/ads/NAMING.md), worked out on the server.
 *
 * WHAT IT WRITES. POST /api/marketing/shoot/mark {request_id, shoot_id,
 * root_script_id, mark}: Got it or Another take, pressed at the end of a script
 * on the screen or on the remote. Each press gets its own request_id and goes
 * through a queue kept in this phone's storage, so a press made with no
 * connection, or signed out, is sent later and counted once.
 *
 * KEYS (v1's, kept): Space, Enter, PageDown play and pause; the arrows change
 * the speed; PageUp restarts the take. At the END of a script: Space, Enter,
 * PageDown mean Got it, and PageUp means Another take. Settings > Learn remote
 * adds any remote's buttons to each of six slots, per device.
 *
 * MIRROR. Flip left-right for a beam-splitter rig, and up-down for rigs that
 * need it. The text, the countdown, the progress bar and the reading line flip
 * together. Each device keeps its own setting.
 *
 * NO SHELL. Like present.html this page has no sidebar and no shell.js. It reads
 * the sign-in from localStorage fh_token and shows a sign-in wall without it.
 *
 * The pure helpers are on window.FundhubTeleprompter so
 * src/ui/teleprompter.test.mjs can prove them without a browser.
 */
(function (root) {
  "use strict";

  /* ── pure helpers ───────────────────────────────────────────────────── */

  var NOT_CAPS = { LLC: 1, LLCS: 1, SBA: 1, FICO: 1, OPM: 1, ROI: 1, CEO: 1, NAICS: 1, USA: 1, US: 1, AI: 1, OK: 1, ID: 1, TV: 1, CTA: 1, VSL: 1, WPM: 1 };
  var MIN_WPM = 80, MAX_WPM = 260;

  /** NAMING.md: `{Offer} Ad {n} — {angle} Take {k}.mp4`, or null when a part is missing. */
  function fileName(s, takeNo) {
    if (!s || !s.offer_word || !s.angle_name) return null;
    var ad = s.ad_id == null ? "" : String(s.ad_id);
    if (!/^(0|[1-9][0-9]{0,8})$/.test(ad)) return null;
    if (!(takeNo >= 1) || Math.floor(takeNo) !== takeNo) return null;
    return s.offer_word + " Ad " + ad + " — " + s.angle_name + " Take " + takeNo + ".mp4";
  }

  /** CAPS words go bold, except the acronyms v1 lets through. */
  function isCaps(tok) {
    var w = String(tok).replace(/[^A-Za-z]/g, "");
    return w.length >= 2 && w === w.toUpperCase() && !NOT_CAPS[w];
  }

  /**
   * The paragraphs to roll: [{text, cue}]. A bullets-style script rolls its
   * parts and each cue is its own paragraph that holds (spec §8.1 bullets
   * mode). Everything else rolls the teleprompter text, split on blank lines.
   */
  function paragraphsFor(s) {
    var parts = s && Array.isArray(s.parts) ? s.parts.filter(function (p) { return p && typeof p.text === "string" && p.text.trim(); }) : [];
    var bullets = s && s.style === "bullets" && !s.first_line_only && parts.some(function (p) { return p.kind === "cue"; });
    if (bullets) {
      return parts.map(function (p) { return { text: p.text.trim(), cue: p.kind === "cue" }; });
    }
    var text = s && typeof s.teleprompter_text === "string" ? s.teleprompter_text : (s && s.body) || "";
    return String(text).replace(/\r/g, "").split(/\n\s*\n/).map(function (p) { return p.trim(); })
      .filter(Boolean).map(function (p) { return { text: p, cue: false }; });
  }

  /** The first script to roll: the first with no Got it, else the first. */
  function firstToRoll(scripts) {
    for (var i = 0; i < scripts.length; i++) if (!scripts[i].got_it) return i;
    return scripts.length ? 0 : -1;
  }

  /** The next script with no Got it after `from`, wrapping round; -1 when every one is marked. */
  function nextToRoll(scripts, from) {
    for (var k = 1; k <= scripts.length; k++) {
      var i = (from + k) % scripts.length;
      if (!scripts[i].got_it) return i;
    }
    return -1;
  }

  /** The script after one press, as the server will count it (applyMark in src/marketing/shoot-plan.mjs). */
  function afterMark(s, mark) {
    var takes = (s.takes > 0 ? s.takes : 0) + 1;
    var takeNo = (s.take_no > 0 ? s.take_no : 1) + 1;
    var out = {};
    for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) out[k] = s[k];
    out.takes = takes;
    out.got_it = mark === "got_it" ? true : !!s.got_it;
    out.last_take_file_name = s.take_file_name || null;
    out.take_no = takeNo;
    out.take_file_name = fileName(s, takeNo);
    return out;
  }

  /** One name for a key press, whatever the remote sends. */
  function keyId(e) {
    if (!e) return "";
    if (e.key && e.key !== "Unidentified") return "key:" + e.key;
    if (e.code) return "code:" + e.code;
    return "keyCode:" + (e.keyCode || 0);
  }

  var DEFAULT_KEYS = {
    play: ["key: ", "key:Enter", "key:PageDown"],
    faster: ["key:ArrowUp", "key:ArrowRight"],
    slower: ["key:ArrowDown", "key:ArrowLeft"],
    restart: ["key:PageUp"],
    got_it: [],
    another_take: []
  };

  /**
   * What a key does. `atEnd`: the script has finished rolling, so play keys
   * mean Got it and restart keys mean Another take (spec §8.1). Learned keys
   * win over v1's defaults.
   */
  function actionFor(id, learned, atEnd) {
    var slots = ["got_it", "another_take", "play", "restart", "faster", "slower"];
    var i, slot;
    var L = learned || {};
    for (i = 0; i < slots.length; i++) {
      slot = slots[i];
      if (L[slot] && L[slot].indexOf(id) >= 0) return mapEnd(slot, atEnd);
    }
    for (i = 0; i < slots.length; i++) {
      slot = slots[i];
      if (DEFAULT_KEYS[slot].indexOf(id) >= 0) return mapEnd(slot, atEnd);
    }
    return null;
  }
  function mapEnd(slot, atEnd) {
    if (atEnd && slot === "play") return "got_it";
    if (atEnd && slot === "restart") return "another_take";
    if (!atEnd && (slot === "got_it" || slot === "another_take")) return slot === "got_it" ? "play" : "restart";
    return slot;
  }

  /** A fresh request id for one press. */
  function requestId() {
    try { if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID(); } catch (e) { /* fall through */ }
    return "tp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  /** "1:05" */
  function clock(sec) {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  root.FundhubTeleprompter = {
    fileName: fileName, isCaps: isCaps, paragraphsFor: paragraphsFor, firstToRoll: firstToRoll,
    nextToRoll: nextToRoll, afterMark: afterMark, keyId: keyId, actionFor: actionFor,
    requestId: requestId, clock: clock, DEFAULT_KEYS: DEFAULT_KEYS, MIN_WPM: MIN_WPM, MAX_WPM: MAX_WPM
  };

  var doc = root.document;
  if (!doc || !doc.getElementById || !doc.getElementById("stage")) return;

  /* ── the page ───────────────────────────────────────────────────────── */

  var LS = {
    get: function (k, d) { try { var v = root.localStorage.getItem("fhtp." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { root.localStorage.setItem("fhtp." + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  function token() { try { return root.localStorage.getItem("fh_token") || ""; } catch (e) { return ""; } }

  var S = Object.assign({ wpm: 150, font: 48, line: 26, pause: 0.8, mirror: false, flipV: false, countdown: true }, LS.get("settings", {}));
  var learned = LS.get("keys", {});
  var queue = LS.get("queue", []);

  var $ = function (id) { return doc.getElementById(id); };
  var stage = $("stage"), flip = $("flip"), content = $("content"), line = $("line"), bar = $("bar"), countEl = $("count");
  var words = [], times = [], holds = [], kf = [], total = 0, t = 0, playing = false, last = 0, takeWord = 0, seeked = false, curIdx = -1;
  var countTimer = null, dimTimer = null, wake = null, holding = -1, released = {};
  var data = null, scripts = [], cur = -1, atEnd = false, learning = null, pollTimer = null, signedOut = false;

  /* ── talking to the server ──────────────────────────────────────────── */

  function api(method, path, body) {
    var h = { accept: "application/json" };
    var tk = token();
    if (tk) h.authorization = "Bearer " + tk;
    if (body) h["content-type"] = "application/json";
    return root.fetch("/api/" + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d }; });
      }, function () { return { status: 0, data: null }; });
  }

  function load(first) {
    return api("GET", "marketing/shoot?wpm=" + S.wpm).then(function (r) {
      if (r.status === 401) return showWall("Sign in to use the teleprompter.");
      if (r.status === 403) return showWall("The teleprompter is for the owner and admins.");
      if (r.status === 200 && r.data) {
        LS.set("cache", r.data);
        $("offline").hidden = true;
        take(r.data, first);
        return;
      }
      var cached = LS.get("cache", null);
      if (cached && first) {
        $("offline").hidden = false;
        $("offline").textContent = r.status === 0
          ? "No connection. Showing the shoot as it was last saved on this phone."
          : "The shoot did not load. Showing the copy saved on this phone.";
        take(cached, first);
        return;
      }
      if (first) showEmpty(r.status === 0 ? "No connection, and no shoot is saved on this phone yet." : "The shoot did not load. Try again in a minute.", true);
    });
  }

  function take(d, first) {
    if (queue.length && !first) return; // presses still waiting: keep what this phone already shows
    data = d;
    var list = d.shoot && Array.isArray(d.shoot.scripts) ? d.shoot.scripts : [];
    var curRoot = cur >= 0 && scripts[cur] ? scripts[cur].root_script_id : null;
    var curId = cur >= 0 && scripts[cur] ? scripts[cur].id : null;
    scripts = list.slice();
    if (!d.shoot) return showEmpty("No shoot is planned. Pick the scripts on the Shoot tab and save the plan.", false);
    if (!scripts.length) return showEmpty("This shoot has no scripts left to film.", false);
    $("empty").hidden = true;
    if (first || curRoot == null) {
      var want = paramRoot();
      var at = want ? indexOfRoot(want) : -1;
      open(at >= 0 ? at : firstToRoll(scripts));
      return;
    }
    var i = indexOfRoot(curRoot);
    if (i < 0) { open(firstToRoll(scripts)); return; }
    cur = i;
    if (scripts[i].id !== curId && !playing && !countTimer) open(i); else header();
  }

  function paramRoot() {
    try { return new URL(root.location.href).searchParams.get("script"); } catch (e) { return null; }
  }
  function indexOfRoot(r) {
    for (var i = 0; i < scripts.length; i++) if (scripts[i].root_script_id === r) return i;
    return -1;
  }

  function enqueue(body) {
    queue.push({ path: "marketing/shoot/mark", body: body });
    LS.set("queue", queue);
    flush();
  }

  var flushing = false;
  function flush() {
    if (flushing || !queue.length) return;
    flushing = true;
    var item = queue[0];
    api("POST", item.path, item.body).then(function (r) {
      flushing = false;
      if (r.status === 200) {
        signedOut = false;
        queue.shift(); LS.set("queue", queue);
        $("pending").hidden = !queue.length;
        if (queue.length) flush();
        return;
      }
      if (r.status === 400 || r.status === 404 || r.status === 403) {
        queue.shift(); LS.set("queue", queue);
        say((r.data && r.data.message) || "That press was not saved.");
        $("pending").hidden = !queue.length;
        if (queue.length) flush();
        return;
      }
      $("pending").hidden = false;
      $("pending").textContent = r.status === 401
        ? "Signed out. Your marks are saved on this phone and send after you sign in."
        : "No connection. Your marks are saved on this phone and send when you are back online.";
      if (r.status === 401) signedOut = true;
    });
  }
  root.addEventListener("online", flush);

  /* ── the wall, the empty page, a short message ──────────────────────── */

  function showWall(msg) {
    stop();
    $("wall").hidden = false;
    $("wall-msg").textContent = msg;
  }
  function showEmpty(msg, retry) {
    stop();
    scripts = []; cur = -1;
    content.innerHTML = "";
    $("empty").hidden = false;
    $("empty-msg").textContent = msg;
    $("empty-retry").hidden = !retry;
    $("s-ad").textContent = "";
    $("s-title").textContent = "No script";
    $("s-file").textContent = "";
    $("b-copy").hidden = true;
  }
  var sayTimer = null;
  function say(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(function () { el.hidden = true; }, 4200);
  }

  /* ── one script ─────────────────────────────────────────────────────── */

  function header() {
    var s = scripts[cur];
    if (!s) return;
    var take = s.take_no > 0 ? s.take_no : 1;
    $("s-ad").textContent = "Ad " + (s.ad_id || "?") + " · Take " + take + " · " + (cur + 1) + " of " + scripts.length +
      (s.first_line_only ? " · first line only" : s.needs_retake ? " · retake" : "");
    $("s-title").textContent = s.angle_name || s.title || "Untitled script";
    var unknown = "File name unknown: " + (s.take_name_problem || "a part of the name is missing.");
    $("s-file").textContent = s.take_file_name ? s.take_file_name : unknown;
    $("s-file").classList.toggle("unknown", !s.take_file_name);
    $("b-copy").hidden = !s.take_file_name;
    $("end-take").textContent = s.take_file_name
      ? "Name this clip: " + s.take_file_name
      : unknown;
    $("end-head").textContent = "That was take " + take + " of Ad " + (s.ad_id || "?") + ".";
  }

  function open(i) {
    stop();
    hideEnd();
    cur = i;
    var s = scripts[i];
    if (!s) return;
    header();
    render(paragraphsFor(s));
    takeWord = 0; t = 0; seeked = false; released = {}; holding = -1;
    markStart(); apply();
  }

  function render(paras) {
    content.innerHTML = ""; words = []; curIdx = -1; holds = [];
    paras.forEach(function (p) {
      var el = doc.createElement("p");
      if (p.cue) el.className = "cue";
      var first = words.length;
      p.text.split(/\s+/).forEach(function (tok) {
        if (!tok) return;
        if (tok === "↑") {
          var u = doc.createElement("span"); u.className = "up"; u.textContent = "↑";
          el.appendChild(u); el.appendChild(doc.createTextNode(" ")); return;
        }
        var sp = doc.createElement("span");
        sp.className = "w" + (isCaps(tok) ? " caps" : "");
        sp.textContent = tok;
        sp.dataset.i = words.length;
        el.appendChild(sp); el.appendChild(doc.createTextNode(" "));
        words.push({ el: sp, end: /[.!?]["”’')]*$/.test(tok), comma: /[,;:]["”’')]*$/.test(tok), last: false, cue: p.cue });
      });
      if (words.length > first) {
        words[words.length - 1].last = true;
        if (p.cue) holds.push(first);
      }
      content.appendChild(el);
    });
    applyFont(); layout();
  }

  /* ── the clock: words per minute, held steady by time, never by frames ─ */

  function timeline() {
    var spw = 60 / S.wpm, at = 0; times = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i]; times[i] = at;
      w.dur = spw * (1 + (w.end ? 0.35 : (w.comma ? 0.15 : 0)));
      at += w.dur; if (w.last && i < words.length - 1) at += S.pause;
    }
    total = at;
  }
  function layout() {
    var keep = progress(); timeline();
    var lines = [], L = null;
    for (var i = 0; i < words.length; i++) {
      var e = words[i].el, top = e.offsetTop + (e.offsetParent ? e.offsetParent.offsetTop : 0), left = e.offsetLeft, w = e.offsetWidth, h = e.offsetHeight;
      if (!L || Math.abs(top - L.top) > h * 0.5) { L = { top: top, h: h, left: left, right: left + w }; lines.push(L); }
      else { L.right = Math.max(L.right, left + w); L.left = Math.min(L.left, left); }
      words[i].line = L; words[i].x = left;
    }
    kf = []; var prevY = -1e9;
    function push(tt, y) { y = Math.max(y, prevY); prevY = y; kf.push({ t: tt, y: y }); }
    for (var j = 0; j < words.length; j++) {
      var wd = words[j], LL = wd.line, span = Math.max(1, LL.right - LL.left);
      push(times[j], LL.top + LL.h * ((wd.x - LL.left) / span));
      if (wd.last) {
        var endT = times[j] + wd.dur;
        push(endT, LL.top + LL.h);
        if (j < words.length - 1) push(endT + S.pause * 0.5, LL.top + LL.h);
      }
    }
    if (!kf.length) kf = [{ t: 0, y: 0 }];
    restore(keep); apply();
  }
  function seg(tt) { var lo = 0, hi = kf.length - 1; if (tt <= kf[0].t) return 0; if (tt >= kf[hi].t) return hi; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (kf[m].t <= tt) lo = m; else hi = m; } return lo; }
  function yAt(tt) { var k = seg(tt); if (k >= kf.length - 1) return kf[kf.length - 1].y; var a = kf[k], b = kf[k + 1], d = b.t - a.t; return d > 0 ? a.y + (b.y - a.y) * ((tt - a.t) / d) : b.y; }
  function tAt(y) { if (y <= kf[0].y) return kf[0].t; var n = kf.length - 1; if (y >= kf[n].y) return kf[n].t; var lo = 0, hi = n; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (kf[m].y <= y) lo = m; else hi = m; } var a = kf[lo], b = kf[hi], d = b.y - a.y; return d > 0 ? a.t + (b.t - a.t) * ((y - a.y) / d) : a.t; }
  function progress() { if (!kf.length) return null; var k = seg(t), a = kf[k], b = kf[k + 1]; return { k: k, f: b && b.t > a.t ? (t - a.t) / (b.t - a.t) : 0 }; }
  function restore(p) { if (!p || !kf.length) { t = Math.min(t, total); return; } var k = Math.min(p.k, kf.length - 1), a = kf[k], b = kf[k + 1]; t = b ? a.t + (b.t - a.t) * p.f : a.t; }
  function wordAt(tt) { var lo = 0, hi = times.length - 1; if (hi < 0) return -1; if (tt < times[0]) return 0; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (times[m] <= tt) lo = m; else hi = m; } return times[hi] <= tt ? hi : lo; }

  /* ── drawing ─────────────────────────────────────────────────────────── */

  function readPx() { return stage.clientHeight * S.line / 100; }
  function apply() {
    if (!kf.length) { content.style.transform = ""; return; }
    var off = yAt(t) - readPx() + (words[0] ? words[0].el.offsetHeight * 0.15 : 0);
    content.style.transform = "translate3d(0," + (-off).toFixed(1) + "px,0)";
    line.style.top = readPx() + "px";
    var idx = t >= total ? words.length : wordAt(t);
    if (idx !== curIdx) {
      var a = Math.min(idx, curIdx < 0 ? 0 : curIdx), b = Math.max(idx, curIdx < 0 ? 0 : curIdx);
      if (curIdx < 0) { a = 0; b = words.length; }
      for (var i = a; i < b && i < words.length; i++) words[i].el.classList.toggle("read", i < idx);
      curIdx = idx;
    }
    $("progress-fill").style.width = (total > 0 ? Math.min(100, (t / total) * 100) : 0).toFixed(2) + "%";
    $("s-time").textContent = S.wpm + " wpm · " + clock(total - t) + " left";
  }
  function frame(now) {
    if (!playing) return;
    var dt = (now - last) / 1000; last = now; if (dt > 0.25) dt = 0.25;
    var next = Math.min(total, t + dt);
    // Bullets mode: a cue holds on the reading line until the next press.
    for (var h = 0; h < holds.length; h++) {
      var ht = times[holds[h]];
      if (!released[holds[h]] && ht > t - 1e-6 && ht <= next && holds[h] > takeWord) {
        t = ht; apply(); hold(holds[h]); return;
      }
    }
    t = next; apply();
    if (t >= total) { finish(); return; }
    root.requestAnimationFrame(frame);
  }

  /* ── play, pause, restart, hold, the end of a script ────────────────── */

  function setPlayIcon() {
    var on = playing || countTimer;
    $("play-ico").innerHTML = on ? '<path d="M7 5h3v14H7zM14 5h3v14h-3z"/>' : '<path d="M8 5l11 7-11 7z"/>';
    $("play").setAttribute("aria-label", playing ? "Pause" : "Play");
  }
  function go() {
    playing = true; holding = -1; $("cuehold").hidden = true;
    last = root.performance.now(); root.requestAnimationFrame(frame);
    setPlayIcon(); rolling(true); lockScreen();
  }
  function start(withCount) {
    if (!words.length) return;
    hideEnd();
    if (seeked) { takeWord = Math.max(0, wordAt(t)); t = times[takeWord] || 0; seeked = false; released = {}; markStart(); apply(); }
    if (t >= total) { t = times[takeWord] || 0; released = {}; apply(); }
    if (withCount && S.countdown) {
      var n = 3; countEl.textContent = n; countEl.hidden = false; setPlayIcon(); rolling(true);
      countTimer = setInterval(function () { n--; if (n <= 0) { cancelCount(); go(); } else countEl.textContent = n; }, 800);
      setPlayIcon();
    } else go();
  }
  function cancelCount() { if (countTimer) { clearInterval(countTimer); countTimer = null; } countEl.hidden = true; setPlayIcon(); }
  function stop() { playing = false; cancelCount(); setPlayIcon(); rolling(false); }
  function hold(i) { holding = i; released[i] = true; playing = false; setPlayIcon(); $("cuehold").hidden = false; }
  function toggle() {
    if (atEnd) return gotIt();
    if (holding >= 0) return go();
    if (playing || countTimer) { stop(); return; }
    var atTake = Math.abs(t - (times[takeWord] || 0)) < 0.01;
    start(atTake || seeked || t >= total);
  }
  function restart() { stop(); hideEnd(); seeked = false; released = {}; holding = -1; $("cuehold").hidden = true; t = times[takeWord] || 0; apply(); start(true); }
  function setTake(i) { stop(); hideEnd(); takeWord = i; t = times[i] || 0; seeked = false; released = {}; markStart(); apply(); }
  function markStart() { words.forEach(function (w, i) { w.el.classList.toggle("start", i === takeWord && takeWord > 0); }); }
  function rolling(on) {
    clearTimeout(dimTimer);
    if (on) dimTimer = setTimeout(function () { doc.body.classList.add("rolling"); }, 1500);
    else doc.body.classList.remove("rolling");
  }
  function lockScreen() {
    try {
      if (root.navigator.wakeLock && !wake) root.navigator.wakeLock.request("screen").then(function (l) { wake = l; l.addEventListener("release", function () { wake = null; }); }).catch(function () {});
    } catch (e) { /* no wake lock here */ }
  }
  doc.addEventListener("visibilitychange", function () {
    if (doc.visibilityState === "visible") { if (playing) lockScreen(); flush(); }
  });

  function finish() {
    stop();
    atEnd = true;
    $("end").hidden = false;
    $("cuehold").hidden = true;
  }
  function hideEnd() { atEnd = false; $("end").hidden = true; }

  function markThis(mark) {
    var s = scripts[cur];
    if (!s || !data || !data.shoot) return;
    enqueue({ request_id: requestId(), shoot_id: data.shoot.id, root_script_id: s.root_script_id, mark: mark });
    var before = s.take_file_name;
    scripts[cur] = afterMark(s, mark);
    return before;
  }
  function gotIt() {
    var kept = markThis("got_it");
    hideEnd();
    say(kept ? "Got it. Keep " + kept + "." : "Got it. Saved.");
    var n = nextToRoll(scripts, cur);
    if (n < 0) {
      stop();
      header();
      $("done").hidden = false;
      return;
    }
    open(n);
  }
  function anotherTake() {
    markThis("another_take");
    hideEnd();
    header();
    restart();
  }

  /* ── speed ───────────────────────────────────────────────────────────── */

  function setWpm(v) {
    var p = progress();
    S.wpm = Math.max(MIN_WPM, Math.min(MAX_WPM, Math.round(v / 5) * 5));
    save(); timeline(); layout(); restore(p); apply(); syncSettings();
  }
  function save() { LS.set("settings", S); }

  /* ── touch: tap pauses or picks a start word; drag moves through ────── */

  var drag = null;
  stage.addEventListener("pointerdown", function (e) {
    if (e.button > 0) return;
    drag = { y: e.clientY, y0: yAt(t), moved: false, was: playing || !!countTimer };
    try { stage.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ }
  });
  stage.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var dy = (e.clientY - drag.y) * (S.flipV ? -1 : 1);
    if (!drag.moved && Math.abs(dy) > 8) { drag.moved = true; stop(); hideEnd(); }
    if (drag.moved) { t = tAt(drag.y0 - dy); seeked = true; apply(); }
  });
  stage.addEventListener("pointerup", function (e) {
    if (!drag) return;
    var d = drag; drag = null;
    if (d.moved) return;
    if (d.was) { stop(); return; }
    if (holding >= 0) { go(); return; }
    if (atEnd) return;
    var el = doc.elementFromPoint(e.clientX, e.clientY), w = el && el.closest ? el.closest(".w") : null;
    if (w) setTake(+w.dataset.i); else toggle();
  });
  stage.addEventListener("pointercancel", function () { drag = null; });
  stage.addEventListener("wheel", function (e) {
    e.preventDefault(); stop(); hideEnd();
    t = tAt(yAt(t) + e.deltaY * (S.flipV ? -1 : 1)); seeked = true; apply();
  }, { passive: false });

  /* ── buttons ─────────────────────────────────────────────────────────── */

  $("play").onclick = toggle;
  $("b-restart").onclick = restart;
  $("b-slow").onclick = function () { setWpm(S.wpm - 5); };
  $("b-fast").onclick = function () { setWpm(S.wpm + 5); };
  $("b-lib").onclick = function () { stop(); openSheet("lib"); };
  $("b-set").onclick = function () { stop(); openSheet("set"); };
  $("b-got").onclick = gotIt;
  $("b-again").onclick = anotherTake;
  $("empty-retry").onclick = function () { load(true); };
  $("b-copy").onclick = function () {
    var s = scripts[cur];
    if (!s || !s.take_file_name) return;
    var done = function () { say("Copied: " + s.take_file_name); };
    try {
      root.navigator.clipboard.writeText(s.take_file_name).then(done, function () { say(s.take_file_name); });
    } catch (e) { say(s.take_file_name); }
  };
  Array.prototype.forEach.call(doc.querySelectorAll("[data-close]"), function (b) { b.onclick = closeSheets; });
  function openSheet(id) { closeSheets(); if (id === "lib") drawList(); if (id === "set") drawKeys(); $(id).hidden = false; }
  function closeSheets() { learning = null; ["lib", "set"].forEach(function (id) { $(id).hidden = true; }); }

  function drawList() {
    var list = $("list"); list.innerHTML = "";
    scripts.forEach(function (s, i) {
      var b = doc.createElement("button");
      b.type = "button";
      b.className = "item" + (i === cur ? " on" : "");
      b.innerHTML = '<span class="t"></span><span class="m"></span><span class="p"></span>';
      b.querySelector(".t").textContent = "Ad " + (s.ad_id || "?") + " · " + (s.angle_name || s.title || "Untitled");
      b.querySelector(".m").textContent = s.got_it ? "Got it" : (s.takes > 0 ? s.takes + (s.takes === 1 ? " take" : " takes") : "Not rolled");
      b.querySelector(".p").textContent = s.take_file_name || s.take_name_problem || "";
      b.onclick = function () { $("done").hidden = true; open(i); closeSheets(); };
      list.appendChild(b);
    });
  }

  /* ── settings ────────────────────────────────────────────────────────── */

  function applyFont() {
    content.style.fontSize = S.font + "px";
    flip.classList.toggle("mirror-x", !!S.mirror);
    flip.classList.toggle("mirror-y", !!S.flipV);
  }
  function syncSettings() {
    $("r-wpm").value = S.wpm; $("v-wpm").textContent = S.wpm + " wpm";
    $("r-font").value = S.font; $("v-font").textContent = S.font + " px";
    $("r-line").value = S.line; $("v-line").textContent = S.line + "% from top";
    $("r-pause").value = S.pause; $("v-pause").textContent = Number(S.pause).toFixed(1) + " s";
    $("t-mirror").checked = !!S.mirror; $("t-flipv").checked = !!S.flipV; $("t-count").checked = !!S.countdown;
  }
  $("r-wpm").oninput = function () { setWpm(+this.value); };
  $("r-font").oninput = function () { var p = progress(); S.font = +this.value; save(); applyFont(); layout(); restore(p); apply(); syncSettings(); };
  $("r-line").oninput = function () { S.line = +this.value; save(); apply(); syncSettings(); };
  $("r-pause").oninput = function () { var p = progress(); S.pause = +this.value; save(); layout(); restore(p); apply(); syncSettings(); };
  $("t-mirror").onchange = function () { S.mirror = this.checked; save(); applyFont(); };
  $("t-flipv").onchange = function () { S.flipV = this.checked; save(); applyFont(); };
  $("t-count").onchange = function () { S.countdown = this.checked; save(); };

  /* Learn remote: tap a slot, press the remote's button, it is saved on this device. */
  var SLOT_WORDS = { play: "Play and pause", faster: "Faster", slower: "Slower", restart: "Restart the take", got_it: "Got it (end of a script)", another_take: "Another take (end of a script)" };
  function drawKeys() {
    var box = $("learn"); box.innerHTML = "";
    Object.keys(SLOT_WORDS).forEach(function (slot) {
      var row = doc.createElement("button");
      row.type = "button";
      row.className = "item learn" + (learning === slot ? " on" : "");
      row.dataset.slot = slot;
      row.innerHTML = '<span class="t"></span><span class="m"></span>';
      row.querySelector(".t").textContent = SLOT_WORDS[slot];
      var got = (learned[slot] || []).map(function (k) { return k.replace(/^(key|code|keyCode):/, "").replace(/^ $/, "Space"); });
      row.querySelector(".m").textContent = learning === slot ? "Press the button now" : (got.length ? got.join(", ") : "Not learned");
      row.onclick = function () { learning = learning === slot ? null : slot; drawKeys(); };
      box.appendChild(row);
    });
  }
  $("b-forget").onclick = function () { learned = {}; LS.set("keys", learned); learning = null; drawKeys(); say("Learned buttons cleared. The keyboard keys still work."); };

  /* ── the remote and the keyboard ─────────────────────────────────────── */

  doc.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    var id = keyId(e);
    if (learning) {
      if (e.key === "Escape") { learning = null; drawKeys(); return; }
      e.preventDefault();
      Object.keys(learned).forEach(function (k) { learned[k] = (learned[k] || []).filter(function (x) { return x !== id; }); });
      learned[learning] = (learned[learning] || []).concat([id]);
      LS.set("keys", learned);
      say("Saved: that button is now " + SLOT_WORDS[learning] + ".");
      learning = null; drawKeys();
      return;
    }
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "Escape") { closeSheets(); return; }
    if (tag === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
    if (!$("lib").hidden || !$("set").hidden) return;
    if (!$("wall").hidden) return;
    var act = actionFor(id, learned, atEnd);
    if (!act) return;
    e.preventDefault();
    if (act === "play") toggle();
    else if (act === "faster") setWpm(S.wpm + 5);
    else if (act === "slower") setWpm(S.wpm - 5);
    else if (act === "restart") restart();
    else if (act === "got_it") { if (atEnd) gotIt(); }
    else if (act === "another_take") { if (atEnd) anotherTake(); }
  });

  var rz = null;
  root.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(layout, 120); });
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { layout(); });

  /* Poll every 5 seconds while the page is visible and nothing is rolling,
     so a reorder or a mark from the Shoot tab shows here (spec §8.1). */
  function poll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(function () {
      if (doc.visibilityState === "visible" && !playing && !countTimer && holding < 0 && $("wall").hidden) {
        flush();
        if (!signedOut) load(false).then(poll, poll); else poll();
      } else poll();
    }, 5000);
  }

  syncSettings();
  if (queue.length) { $("pending").hidden = false; }
  if (!token()) showWall("Sign in to use the teleprompter.");
  else { load(true).then(function () { flush(); poll(); }); }

  root.__fhtp = {
    state: function () { return { t: t, total: total, words: words.length, playing: playing, atEnd: atEnd, holding: holding, wpm: S.wpm, cur: cur, queue: queue.length, script: scripts[cur] || null }; },
    finish: function () { stop(); t = total; apply(); finish(); }
  };
})(typeof window !== "undefined" ? window : globalThis);
