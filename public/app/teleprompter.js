/* Fundhub teleprompter — rolls the open shoot's scripts, one after another.
 *
 * Spec docs/specs/marketing-machine-2026-10-04.md §8.1 (the web version) and
 * §8.2 (Shoot Day); design docs/specs/command-center-design-2026-10-05.md §3.4;
 * owner needs docs/specs/teleprompter-requirements-2026-10-06.md (v2: taps,
 * edit on the fly, the change pulse, iPad, mirror). Unit X5, then v2. The
 * clock and the keys are ported from v1 (tools/teleprompter/index.html), which
 * stays as it is.
 *
 * WHAT IT READS. GET /api/marketing/shoot — the same answer the Shoot tab
 * reads. It rolls shoot.scripts in the shoot's order, starting at the first one
 * with no Got it mark. Each script shows its ad number, its angle name and the
 * exact take file name (marketing/ads/NAMING.md), worked out on the server.
 * GET /api/marketing/script?id= for a script's history (every version), and
 * GET /api/marketing/health once in a while to say honestly whether the repo
 * copy is held (no GITHUB_REPO_TOKEN yet).
 *
 * WHAT IT WRITES. POST /api/marketing/shoot/mark {request_id, shoot_id,
 * root_script_id, mark}: Got it or Another take, through a queue kept in this
 * phone's storage, so a press made offline or signed out is sent later and
 * counted once. And POST /api/marketing/scripts/edit — the shipped edit route,
 * the one store — for every change to the words (teleprompter-edits.js).
 *
 * TOUCH (owner, 2026-10-07, the film page). Tap the words: they pause if they
 * are rolling, and they play if they are stopped. The camera keeps recording.
 * The tap waits a short beat so a double tap is not also a play or a pause.
 * Double tap: a text cursor lands in the words at that spot. The phone keyboard
 * comes up. He edits the live script there. No extra edit box. Save still sends
 * those words through the script edit route. Drag up: the words roll up (next
 * lines come from below). Drag down: the words go down with the thumb. A blank
 * gap keeps that same speed. Hold a line to change the whole line. The touch
 * rules are the pure gestureStep below. scriptDelta turns an upward drag into
 * words rolling up.
 *
 * KEYS (v1's, kept): Space, Enter, PageDown play and pause; the arrows change
 * the speed; PageUp restarts the take. At the END of a script: Space, Enter,
 * PageDown mean Got it, and PageUp means Another take. Settings > Learn remote
 * adds any remote's buttons to each of six slots, per device.
 *
 * MIRROR. Flip left-right for a beam-splitter rig, and up-down for rigs that
 * need it. The text, the countdown, the progress bar and the reading line flip
 * together. Each device keeps its own setting. Editing shows the words the
 * right way round while the box is open.
 *
 * NO SHELL. Like present.html this page has no sidebar, no shell.js, and no
 * sign-in. The Shoot tab link carries a film key (?k=). That key reads this
 * shoot, marks takes, and saves edits. This page never sends you to a login page.
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

  /** Bullets mode: the parts roll, and each cue holds (spec §8.1). */
  function isBullets(s) {
    var parts = s && Array.isArray(s.parts) ? s.parts.filter(function (p) { return p && typeof p.text === "string" && p.text.trim(); }) : [];
    return !!(s && s.style === "bullets" && !s.first_line_only && parts.some(function (p) { return p.kind === "cue"; }));
  }

  /**
   * The paragraphs to roll: [{text, cue}]. A bullets-style script rolls its
   * parts and each cue is its own paragraph that holds (spec §8.1 bullets
   * mode). Everything else rolls the teleprompter text, split on blank lines.
   */
  function paragraphsFor(s) {
    if (isBullets(s)) {
      return s.parts.filter(function (p) { return p && typeof p.text === "string" && p.text.trim(); })
        .map(function (p) { return { text: p.text.trim(), cue: p.kind === "cue" }; });
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

  /** The Next button: the next script with no Got it, else simply the next one in film order; -1 at the end. */
  function nextInOrder(scripts, from) {
    var n = nextToRoll(scripts, from);
    if (n >= 0 && n !== from) return n;
    return from + 1 < scripts.length ? from + 1 : -1;
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

  /* ── the touch rules (owner, 2026-10-07) ─────────────────────────────── */

  /** A finger that moves less than this is a tap. */
  var TAP_SLOP = 10;
  /** A second tap this soon, and this close, is a cursor — not play or pause. */
  var DBL_MS = 320;
  var DBL_SLOP = 48;
  /** A finger held this long without moving is a long press: edit that line. */
  var LONG_MS = 550;
  /** A flick at least this fast (px per ms) keeps the words moving in scroll mode. */
  var FLING_MIN = 0.35;

  function gestureStart() { return { down: null, lastTap: null, pending: null }; }

  /**
   * One touch event in, what the page must do out. Pure: the page owns the
   * clock and the words; this owns only what a finger means.
   *   g     the gesture state (gestureStart())
   *   ev    {type:'down'|'move'|'up'|'timer'|'settle'|'cancel', x, y, t}
   *         'timer' is the page's long-press check, LONG_MS after a down.
   *         'settle' is the page's short wait after a tap (DBL_MS). One tap
   *         becomes play or pause only then. Two taps never do.
   *   mode  'rolling' (rolling or counting down) | 'paused' | 'scroll'
   * Returns {g, acts}. acts, in order:
   *   {do:'pause'}      one tap while rolling, after the short wait
   *   {do:'resume'}     one tap while paused or in scroll mode, after the wait
   *   {do:'caret', x, y} two quick taps: put the cursor there. No play, no pause.
   *   {do:'grab'}       a finger started dragging: stop the auto-scroll
   *   {do:'drag', dy}   the finger moved dy pixels (down is positive). scriptDelta
   *                     rolls the words up when the thumb moves up.
   *   {do:'fling', v}   in scroll mode, let go fast: keep moving at v px/ms
   *   {do:'edit', x, y} a long press: edit the line under the finger
   *   {do:'edit-focus'} the long-press finger lifted: open the keyboard now
   *                     (iPhone opens it only inside a touch)
   * A tap does not pause or play until 'settle'. A double tap drops that wait.
   */
  function gestureStep(g, ev, mode) {
    var out = {
      down: g && g.down ? Object.assign({}, g.down) : null,
      lastTap: g ? g.lastTap : null,
      pending: g && g.pending ? { do: g.pending.do, at: g.pending.at } : null
    };
    var acts = [];
    var d = out.down;
    if (ev.type === "down") {
      var prev = out.lastTap;
      var dbl = !!(prev && (ev.t - prev.t) <= DBL_MS
        && Math.abs(ev.x - prev.x) <= DBL_SLOP && Math.abs(ev.y - prev.y) <= DBL_SLOP);
      out.down = { x: ev.x, y: ev.y, t: ev.t, lastY: ev.y, lastT: ev.t, moved: false, long: false, v: 0, dbl: dbl };
    } else if (ev.type === "move" && d) {
      if (!d.moved && !d.long && (Math.abs(ev.x - d.x) > TAP_SLOP || Math.abs(ev.y - d.y) > TAP_SLOP)) {
        d.moved = true;
        out.lastTap = null;
        out.pending = null;
        acts.push({ do: "grab" });
        acts.push({ do: "drag", dy: ev.y - d.y });
      } else if (d.moved) {
        acts.push({ do: "drag", dy: ev.y - d.lastY });
      }
      if (d.moved) {
        var dt = ev.t - d.lastT;
        if (dt > 0) d.v = 0.8 * ((ev.y - d.lastY) / dt) + 0.2 * d.v;
        d.lastY = ev.y;
        d.lastT = ev.t;
      }
    } else if (ev.type === "up" && d) {
      out.down = null;
      if (d.long) {
        acts.push({ do: "edit-focus" });
      } else if (d.moved) {
        if (mode === "scroll" && Math.abs(d.v) >= FLING_MIN && ev.t - d.lastT < 120) acts.push({ do: "fling", v: d.v });
      } else {
        var prevTap = out.lastTap;
        var near = prevTap && (ev.t - prevTap.t) <= DBL_MS
          && Math.abs(ev.x - prevTap.x) <= DBL_SLOP && Math.abs(ev.y - prevTap.y) <= DBL_SLOP;
        if (near) {
          out.lastTap = null;
          out.pending = null;
          acts.push({ do: "caret", x: ev.x, y: ev.y });
        } else {
          var nowMode = mode;
          if (out.pending) {
            acts.push({ do: out.pending.do });
            nowMode = out.pending.do === "pause" ? "paused" : "rolling";
          }
          out.lastTap = { x: ev.x, y: ev.y, t: ev.t, mode: nowMode };
          out.pending = { do: nowMode === "rolling" ? "pause" : "resume", at: ev.t };
        }
      }
    } else if (ev.type === "settle") {
      if (out.pending && ev.t - out.pending.at >= DBL_MS) {
        acts.push({ do: out.pending.do });
        out.pending = null;
        out.lastTap = null;
      }
    } else if (ev.type === "timer" && d) {
      if (!d.moved && !d.long && ev.t - d.t >= LONG_MS) {
        d.long = true;
        out.lastTap = null;
        out.pending = null;
        acts.push({ do: "edit", x: d.x, y: d.y });
      }
    } else if (ev.type === "cancel") {
      out.down = null;
    }
    return { g: out, acts: acts };
  }

  /**
   * How far the script moves for a finger or a wheel.
   * dy: screen pixels. Down is positive. A wheel's deltaY uses the same sign.
   * Positive result moves forward: the words travel up, and the next lines
   * come from below. Thumb up does that. Thumb down moves the words down
   * with the hand. flipV is the upside-down glass: the thumb still feels
   * the same on that rig.
   */
  function scriptDelta(dy, flipV) {
    return -dy * (flipV ? -1 : 1);
  }

  /** A fresh request id for one press or one save. */
  function requestId() {
    try { if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID(); } catch (e) { /* fall through */ }
    return "tp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  /** "1:05" */
  function clock(sec) {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  /**
   * Where to roll on from after paragraph `edited` changed: the same word if it
   * sat after the change (moved by the words added or taken out), the start of
   * the changed paragraph if it sat inside it, and the same word if before.
   *   oldCounts / newCounts  words per paragraph, before and after
   */
  function wordAfterEdit(word, edited, oldCounts, newCounts) {
    var start = function (counts, p) { var n = 0; for (var i = 0; i < p && i < counts.length; i++) n += counts[i]; return n; };
    var total = function (counts) { return start(counts, counts.length); };
    var oldStart = start(oldCounts, edited), oldEnd = oldStart + (oldCounts[edited] || 0);
    var out;
    if (word < oldStart) out = word;
    else if (word < oldEnd) out = start(newCounts, edited);
    else out = word + (total(newCounts) - total(oldCounts));
    return Math.max(0, Math.min(out, Math.max(0, total(newCounts) - 1)));
  }

  /**
   * What we ask the front camera for. 4K is 3840×2160. 1080p is 1920×1080.
   * frameRate ideal is the highest the camera listed (or 60 before we know).
   * ideal, not a stretched picture: the phone may give less, and we keep that.
   */
  function cameraAsk(mode, maxFps) {
    var uhd = mode !== "1080p";
    var fps = maxFps > 0 ? maxFps : 60;
    return {
      facingMode: "user",
      width: { ideal: uhd ? 3840 : 1920 },
      height: { ideal: uhd ? 2160 : 1080 },
      frameRate: { ideal: fps }
    };
  }

  /** VSLs and thank-you videos stay 4K. Ads may use the 1080p choice. */
  function stays4K(s) {
    if (!s) return false;
    if (String(s.script_format || "").toLowerCase() === "vsl") return true;
    var blob = [s.title, s.angle_name, s.take_file_name, s.funnel_key, s.style].filter(Boolean).join(" ").toLowerCase();
    if (/\bvsl\b/.test(blob)) return true;
    if (/thank[- ]?you/.test(blob)) return true;
    return false;
  }

  /** The real size the camera gave. 3840×2160 and 2160×3840 are both 4K. A smaller picture is not. */
  function cameraReport(got, want) {
    var w = got && got.width ? got.width : 0;
    var h = got && got.height ? got.height : 0;
    var fps = got && got.frameRate ? Math.round(got.frameRate) : 0;
    var four = (w >= 3840 && h >= 2160) || (w >= 2160 && h >= 3840);
    var hd = w >= 1920 && h >= 1080;
    var label = four ? "4K" : hd ? "1080p" : (w && h ? (w + "×" + h) : "no picture");
    var line = label + (fps ? " · " + fps + " fps" : "");
    var short = "";
    if (want === "4k" && !four) short = "This camera tops out at " + (w && h ? (w + "×" + h) : "a smaller size") + ". It is not 4K.";
    else if (want === "1080p" && !hd) short = "This camera tops out at " + (w && h ? (w + "×" + h) : "a smaller size") + ". It is not 1080p.";
    return { line: line, short: short, width: w, height: h, fps: fps };
  }

  /**
   * One scroll speed through a blank.
   * keys: [{t, y, blank}] in order. blank on a key means the step that lands
   * on that key is empty space (the gap between paragraphs).
   * The pace is the speed of the other steps that actually move (pixels per
   * second). A blank that was faster is stretched so it matches that pace.
   * A blank that was already slower stays slower (more time to breathe).
   * Later times shift by the same amount. y does not change.
   */
  function paceThroughBlanks(keys) {
    var src = keys || [];
    var out = [];
    if (!src.length) return out;
    if (src.length === 1) return [{ t: src[0].t, y: src[0].y }];
    var dySum = 0, dtSum = 0, i, dy, dt;
    for (i = 1; i < src.length; i++) {
      if (src[i].blank) continue;
      dy = src[i].y - src[i - 1].y;
      dt = src[i].t - src[i - 1].t;
      if (dy > 0.5 && dt > 1e-6) { dySum += dy; dtSum += dt; }
    }
    var pace = dtSum > 0 ? dySum / dtSum : 0;
    var t = src[0].t;
    out.push({ t: t, y: src[0].y });
    for (i = 1; i < src.length; i++) {
      dy = src[i].y - src[i - 1].y;
      dt = src[i].t - src[i - 1].t;
      var use = dt > 0 ? dt : 0;
      if (src[i].blank && dy > 0.5 && pace > 0) {
        var need = dy / pace;
        if (need > use) use = need;
      }
      t += use;
      out.push({ t: t, y: src[i].y });
    }
    return out;
  }

  /**
   * The red line is the top reading point. The word sits on it.
   * safeTop is the phone clock band. This is not the middle of the page.
   */
  function readingLinePx(safeTop) {
    var safe = safeTop > 0 ? safeTop : 0;
    return Math.round(safe + 8);
  }

  /** Line position: just under the clock, through the top of the word being read. */
  function readingLineTop(safeTop, lineHeight) {
    var h = lineHeight > 0 ? lineHeight : 0;
    return readingLinePx(safeTop) + h * 0.45;
  }

  /** Pause keeps this scroll time. It does not jump back to the start. */
  function pausePlace(t) { return t; }

  /**
   * Which half the words use when the phone is sideways.
   * iPhone: front camera on the left in landscape-primary, on the right in
   * landscape-secondary. Portrait uses the full width. Unknown landscape
   * defaults to the left, then flips when the other orientation is known.
   * info: { type, angle, landscape }
   */
  function cameraWordSide(info) {
    var o = info || {};
    var type = String(o.type || "");
    if (type === "landscape-primary") return "left";
    if (type === "landscape-secondary") return "right";
    if (type === "portrait-primary" || type === "portrait-secondary") return "full";
    var angle = typeof o.angle === "number" ? o.angle : null;
    if (angle === 90) return "left";
    if (angle === -90 || angle === 270) return "right";
    if (angle === 0 || angle === 180) return "full";
    if (o.landscape === true) return "left";
    return "full";
  }

  /** Hardware volume key, if the browser actually sends one. 1 faster, -1 slower, 0 otherwise. */
  function volumeKeyDir(key, code) {
    var k = String(key || "");
    var c = String(code || "");
    if (k === "VolumeUp" || k === "AudioVolumeUp" || c === "VolumeUp" || c === "AudioVolumeUp") return 1;
    if (k === "VolumeDown" || k === "AudioVolumeDown" || c === "VolumeDown" || c === "AudioVolumeDown") return -1;
    return 0;
  }

  /** A real volumechange on a media element. No step when the level did not move. */
  function volumeLevelDir(prev, next) {
    if (typeof prev !== "number" || typeof next !== "number") return 0;
    if (next > prev + 0.001) return 1;
    if (next < prev - 0.001) return -1;
    return 0;
  }

  /** Where time t on the old scroll lands after paceThroughBlanks. */
  function scrollTime(oldKeys, newKeys, t) {
    if (!oldKeys || !oldKeys.length || !newKeys || !newKeys.length) return t;
    if (t <= oldKeys[0].t) return newKeys[0].t;
    var n = oldKeys.length - 1;
    if (t >= oldKeys[n].t) return newKeys[n].t + (t - oldKeys[n].t);
    var lo = 0, hi = n;
    while (hi - lo > 1) {
      var m = (lo + hi) >> 1;
      if (oldKeys[m].t <= t) lo = m; else hi = m;
    }
    var od = oldKeys[hi].t - oldKeys[lo].t;
    if (!(od > 0)) return newKeys[hi].t;
    var f = (t - oldKeys[lo].t) / od;
    return newKeys[lo].t + (newKeys[hi].t - newKeys[lo].t) * f;
  }

  root.FundhubTeleprompter = {
    fileName: fileName, isCaps: isCaps, isBullets: isBullets, paragraphsFor: paragraphsFor, firstToRoll: firstToRoll,
    nextToRoll: nextToRoll, nextInOrder: nextInOrder, afterMark: afterMark, keyId: keyId, actionFor: actionFor,
    gestureStart: gestureStart, gestureStep: gestureStep, scriptDelta: scriptDelta, wordAfterEdit: wordAfterEdit,
    requestId: requestId, clock: clock, DEFAULT_KEYS: DEFAULT_KEYS, MIN_WPM: MIN_WPM, MAX_WPM: MAX_WPM,
    TAP_SLOP: TAP_SLOP, DBL_MS: DBL_MS, DBL_SLOP: DBL_SLOP, LONG_MS: LONG_MS, FLING_MIN: FLING_MIN,
    cameraAsk: cameraAsk, stays4K: stays4K, cameraReport: cameraReport,
    paceThroughBlanks: paceThroughBlanks, scrollTime: scrollTime,
    readingLinePx: readingLinePx, readingLineTop: readingLineTop, pausePlace: pausePlace,
    cameraWordSide: cameraWordSide, volumeKeyDir: volumeKeyDir, volumeLevelDir: volumeLevelDir
  };

  var doc = root.document;
  if (!doc || !doc.getElementById || !doc.getElementById("stage")) return;
  var E = root.FundhubTeleprompterEdits;

  /* ── the page ───────────────────────────────────────────────────────── */

  var LS = {
    get: function (k, d) { try { var v = root.localStorage.getItem("fhtp." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { root.localStorage.setItem("fhtp." + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  function token() { try { return root.localStorage.getItem("fh_token") || ""; } catch (e) { return ""; } }
  function filmKey() {
    try { return new URL(root.location.href).searchParams.get("k") || ""; } catch (e) { return ""; }
  }

  /* A tablet gets bigger words by default (read from the camera distance). */
  var bigScreen = false;
  try { bigScreen = Math.min(root.screen.width, root.screen.height) >= 700; } catch (e) { /* no screen */ }
  var S = Object.assign({ wpm: 150, font: bigScreen ? 64 : 48, line: 26, pause: 0.8, mirror: false, flipV: false, countdown: true, measure: 30, cam: "4k" }, LS.get("settings", {}));
  var learned = LS.get("keys", {});
  var queue = LS.get("queue", []);

  var $ = function (id) { return doc.getElementById(id); };
  var stage = $("stage"), flip = $("flip"), content = $("content"), line = $("line"), countEl = $("count");
  var words = [], times = [], holds = [], kf = [], total = 0, t = 0, playing = false, last = 0, takeWord = 0, seeked = false, curIdx = -1;
  var countTimer = null, dimTimer = null, wake = null, holding = -1, released = {};
  var data = null, scripts = [], cur = -1, atEnd = false, learning = null, pollTimer = null, signedOut = false;
  var scrollMode = false, flingRaf = 0, gest = gestureStart(), longTimer = null, tapSnap = null;
  var editing = null, textEdit = null, repoHeld = false, healthAt = 0, shownParas = "";

  /* ── talking to the server ──────────────────────────────────────────── */

  function api(method, path, body) {
    var h = { accept: "application/json" };
    var k = filmKey();
    var opts = { method: method, headers: h };
    if (k) {
      h["x-shoot-film"] = k;
      opts.credentials = "omit";
    } else {
      var tk = token();
      if (tk) h.authorization = "Bearer " + tk;
      opts.credentials = "same-origin";
    }
    if (body) {
      h["content-type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return root.fetch("/api/" + path, opts)
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d }; });
      }, function () { return { status: 0, data: null }; });
  }

  function fetchShoot(bare) {
    if (!bare) return api("GET", "marketing/shoot?wpm=" + S.wpm);
    // No token and no cookie. The server already serves this read with no
    // sign-in, so this page never asks the phone to log in on its own.
    return root.fetch("/api/marketing/shoot?wpm=" + S.wpm, {
      method: "GET", credentials: "omit", headers: { accept: "application/json" }
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d }; });
      }, function () { return { status: 0, data: null }; });
  }

  function load(first) {
    var k = filmKey();
    return fetchShoot(false).then(function (r) {
      if (!k && (r.status === 401 || r.status === 403)) return fetchShoot(true);
      return r;
    }).then(function (r) {
      if (k && r.status === 404) {
        if (first) showEmpty("This film link did not open. Tap Open the teleprompter on the Shoot tab again.", false);
        return;
      }
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

  /* An edit still waiting on this phone wins over what the server sent: the
     words on the screen are always the newest Chris typed. */
  function overlay(s) {
    var it = edits.item(s.root_script_id);
    return it ? withWords(s, it.body, it.parts) : s;
  }
  function withWords(s, body, parts) {
    var out = {};
    for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) out[k] = s[k];
    out.body = body;
    out.parts = parts == null ? (body === s.body ? s.parts : null) : parts;
    out.teleprompter_text = E.rolledText(out);
    return out;
  }
  function parasKey(s) { return s ? JSON.stringify(paragraphsFor(s)) : ""; }

  function take(d, first) {
    if (queue.length && !first) return; // presses still waiting: keep what this phone already shows
    if (editing || textEdit) return;   // never redraw under the cursor or the edit box
    data = d;
    var list = d.shoot && Array.isArray(d.shoot.scripts) ? d.shoot.scripts : [];
    var curRoot = cur >= 0 && scripts[cur] ? scripts[cur].root_script_id : null;
    var shown = cur >= 0 ? scripts[cur] : null;
    scripts = list.map(overlay);
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
    if (parasKey(scripts[i]) !== shownParas) {
      // The words changed somewhere else (the Scripts tab, another device).
      if (playing || countTimer || holding >= 0) scripts[i] = shown; // keep rolling what is on screen
      else redraw(-1);
    }
    header();
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
    edits.flush();
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
        ? "That press is saved on this phone. It sends when this film link can reach the shoot."
        : "No connection. Your marks are saved on this phone and send when you are back online.";
      if (r.status === 401) signedOut = true;
    });
  }
  root.addEventListener("online", flush);

  /* ── the edits: one store, the shipped edit route ───────────────────── */

  var edits = E.createSaveQueue({
    store: { get: function () { return LS.get("edits", null); }, set: function (v) { LS.set("edits", v); } },
    send: function (body) { return api("POST", "marketing/scripts/edit", body); },
    live: function (id) { return api("GET", "marketing/script?id=" + encodeURIComponent(id)); },
    requestId: requestId,
    onChange: onEditChange
  });

  function onEditChange(ev) {
    if (ev.type === "saved") savedOne(ev.root, ev.script, ev.warnings);
    if (ev.type === "conflict") { stop(); openPick(ev.root); }
    if (ev.type === "failed") say("That edit did not save: " + ev.message);
    if (ev.type === "resolved" && ev.choice === "theirs" && ev.script) useWords(ev.root, ev.script);
    pulse();
  }

  /* The server has the words: the new version's id and number are what the
     next edit writes on. The shoot copy on this phone gets them too, and the
     Command Center tabs open in this browser are told to read again. */
  function savedOne(rootId, script, warnings) {
    var it = edits.item(rootId);
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      if (s.root_script_id !== rootId) continue;
      s.id = script.id;
      s.version = Number(script.version);
      s.status = script.status || s.status;
      if (!it) { s.body = script.body; s.parts = script.parts == null ? null : script.parts; s.teleprompter_text = E.rolledText(s); }
      s.repo_commit = script.repo_commit == null ? null : script.repo_commit;
    }
    patchCache(rootId, script, !it);
    tellTabs(rootId, script);
    checkHealth(false);
    if (warnings && warnings.length) LS.set("lastWarnings", { root: rootId, warnings: warnings, at: Date.now() });
  }
  function patchCache(rootId, script, words) {
    var c = LS.get("cache", null);
    if (!c || !c.shoot || !Array.isArray(c.shoot.scripts)) return;
    c.shoot.scripts.forEach(function (s) {
      if (s.root_script_id !== rootId) return;
      s.id = script.id; s.version = Number(script.version);
      if (words) { s.body = script.body; s.parts = script.parts == null ? null : script.parts; s.teleprompter_text = E.rolledText(s); }
    });
    LS.set("cache", c);
  }
  function tellTabs(rootId, script) {
    var msg = { type: "script-saved", root_script_id: rootId, id: script.id, version: Number(script.version), at: Date.now() };
    try { if (root.BroadcastChannel) { var ch = new root.BroadcastChannel("fundhub-scripts"); ch.postMessage(msg); ch.close(); } } catch (e) { /* old browser */ }
    try { root.localStorage.setItem("fh.scripts.changed", JSON.stringify(msg)); } catch (e) { /* private mode */ }
  }
  /* Chris picked the saved words over his own: show them. */
  function useWords(rootId, v) {
    var i = indexOfRoot(rootId);
    if (i < 0) return;
    scripts[i] = withWords(scripts[i], v.body, v.parts == null ? null : v.parts);
    scripts[i].id = v.id;
    scripts[i].version = Number(v.version);
    if (i === cur) redraw(-1);
  }

  /* Is the repo copy held? GET marketing/health, at most once a minute. */
  function checkHealth(force) {
    if (!force && Date.now() - healthAt < 60000) return;
    healthAt = Date.now();
    api("GET", "marketing/health").then(function (r) {
      if (r.status !== 200 || !r.data || !r.data.outbox) return;
      var o = r.data.outbox;
      repoHeld = !!o.held_reason || o.token_present === false;
      pulse();
    });
  }

  /* The change pulse: always on screen, even while a script rolls. */
  function pulse() {
    var st = edits.status();
    var el = $("p-save");
    el.textContent = E.statusText(st, repoHeld);
    el.classList.toggle("warn", !!(st.conflicts || st.failed || (st.waiting && st.net !== "ok")));
    el.classList.toggle("busy", !!(st.saving || (st.waiting && st.net === "ok")));
    if (editing) $("e-status").textContent = el.textContent;
  }

  /* ── the empty page, a short message ───────────────────────────────── */

  function showEmpty(msg, retry) {
    stop();
    scripts = []; cur = -1;
    content.innerHTML = "";
    shownParas = "";
    $("empty").hidden = false;
    $("empty-msg").textContent = msg;
    $("empty-retry").hidden = !retry;
    $("s-ad").textContent = "";
    $("s-title").textContent = "No script";
    $("s-file").textContent = "";
    $("p-file").textContent = "";
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
    $("p-file").textContent = s.take_file_name || "File name unknown";
    $("b-copy").hidden = !s.take_file_name;
    $("end-take").textContent = s.take_file_name
      ? "Name this clip: " + s.take_file_name
      : unknown;
    $("end-head").textContent = "That was take " + take + " of Ad " + (s.ad_id || "?") + ".";
  }

  function open(i) {
    if (textEdit) leaveCaret(false);
    endRec();
    stop();
    hideEnd();
    setScroll(false);
    cur = i;
    var s = scripts[i];
    if (!s) return;
    header();
    render(paragraphsFor(s));
    takeWord = 0; t = 0; seeked = false; released = {}; holding = -1;
    markStart(); apply();
    showFace();
    ensureCamera();
  }

  /* Draw the current script again (its words changed) and keep the place:
     `word` is where to roll on from, or -1 for the word on the reading line. */
  function redraw(word) {
    var s = scripts[cur];
    if (!s) return;
    var at = word >= 0 ? word : Math.max(0, wordAt(t));
    var startWas = takeWord;
    render(paragraphsFor(s));
    at = Math.min(at, Math.max(0, words.length - 1));
    takeWord = Math.min(startWas, Math.max(0, words.length - 1));
    t = times[at] || 0;
    seeked = at !== takeWord;
    markStart(); apply(); header();
  }

  function render(paras) {
    content.innerHTML = ""; words = []; curIdx = -1; holds = [];
    shownParas = JSON.stringify(paras);
    paras.forEach(function (p, pi) {
      var el = doc.createElement("p");
      if (p.cue) el.className = "cue";
      el.dataset.p = pi;
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
        words.push({ el: sp, end: /[.!?]["”’')]*$/.test(tok), comma: /[,;:]["”’')]*$/.test(tok), last: false, cue: p.cue, para: pi });
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
    if (editing || textEdit) return;
    var keep = progress(); timeline();
    var lines = [], L = null;
    for (var i = 0; i < words.length; i++) {
      var e = words[i].el, top = e.offsetTop + (e.offsetParent ? e.offsetParent.offsetTop : 0), left = e.offsetLeft, w = e.offsetWidth, h = e.offsetHeight;
      if (!L || Math.abs(top - L.top) > h * 0.5) { L = { top: top, h: h, left: left, right: left + w }; lines.push(L); }
      else { L.right = Math.max(L.right, left + w); L.left = Math.min(L.left, left); }
      words[i].line = L; words[i].x = left;
    }
    kf = []; var prevY = -1e9;
    function push(tt, y, blank) { y = Math.max(y, prevY); prevY = y; kf.push({ t: tt, y: y, blank: !!blank }); }
    for (var j = 0; j < words.length; j++) {
      var wd = words[j], LL = wd.line, span = Math.max(1, LL.right - LL.left);
      // The step into the first word of a new paragraph is the blank gap.
      push(times[j], LL.top + LL.h * ((wd.x - LL.left) / span), j > 0 && words[j - 1].last);
      if (wd.last) {
        var endT = times[j] + wd.dur;
        push(endT, LL.top + LL.h, false);
      }
    }
    if (!kf.length) kf = [{ t: 0, y: 0 }];
    var rawKf = kf;
    kf = paceThroughBlanks(rawKf);
    for (var ti = 0; ti < times.length; ti++) times[ti] = scrollTime(rawKf, kf, times[ti]);
    total = scrollTime(rawKf, kf, total);
    restore(keep); apply();
  }
  function seg(tt) { var lo = 0, hi = kf.length - 1; if (tt <= kf[0].t) return 0; if (tt >= kf[hi].t) return hi; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (kf[m].t <= tt) lo = m; else hi = m; } return lo; }
  function yAt(tt) { var k = seg(tt); if (k >= kf.length - 1) return kf[kf.length - 1].y; var a = kf[k], b = kf[k + 1], d = b.t - a.t; return d > 0 ? a.y + (b.y - a.y) * ((tt - a.t) / d) : b.y; }
  function tAt(y) { if (y <= kf[0].y) return kf[0].t; var n = kf.length - 1; if (y >= kf[n].y) return kf[n].t; var lo = 0, hi = n; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (kf[m].y <= y) lo = m; else hi = m; } var a = kf[lo], b = kf[hi], d = b.y - a.y; return d > 0 ? a.t + (b.t - a.t) * ((y - a.y) / d) : a.t; }
  function progress() { if (!kf.length) return null; var k = seg(t), a = kf[k], b = kf[k + 1]; return { k: k, f: b && b.t > a.t ? (t - a.t) / (b.t - a.t) : 0 }; }
  function restore(p) { if (!p || !kf.length) { t = Math.min(t, total); return; } var k = Math.min(p.k, kf.length - 1), a = kf[k], b = kf[k + 1]; t = b ? a.t + (b.t - a.t) * p.f : a.t; }
  function wordAt(tt) { var lo = 0, hi = times.length - 1; if (hi < 0) return -1; if (tt < times[0]) return 0; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (times[m] <= tt) lo = m; else hi = m; } return times[hi] <= tt ? hi : lo; }

  /* ── drawing ─────────────────────────────────────────────────────────── */

  function measureSafeTop() {
    var n = 0;
    try {
      var d = doc.createElement("div");
      d.style.cssText = "position:fixed;left:0;top:0;height:env(safe-area-inset-top,0px);width:0;visibility:hidden;pointer-events:none;";
      doc.body.appendChild(d);
      n = d.offsetHeight || 0;
      d.remove();
    } catch (e) { n = 0; }
    measureSafeTop.n = n;
    return n;
  }
  function safeTopPx() {
    if (measureSafeTop.n == null) return measureSafeTop();
    return measureSafeTop.n;
  }
  function readPx() {
    var h = words[0] && words[0].el ? words[0].el.offsetHeight : 0;
    return readingLineTop(safeTopPx(), h);
  }
  function apply() {
    if (editing || textEdit) return;
    if (!kf.length) { content.style.transform = ""; return; }
    var off = yAt(t) - readPx();
    content.style.transform = "translate3d(0," + (-off).toFixed(1) + "px,0)";
    line.style.top = readPx() + "px";
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
    var btn = $("play");
    if (!btn) return;
    var label = btn.querySelector("span");
    if (label) label.textContent = "Play";
    btn.setAttribute("aria-label", "Play");
    btn.setAttribute("aria-pressed", (playing || countTimer) ? "true" : "false");
  }
  function go() {
    setScroll(false);
    playing = true; holding = -1; $("cuehold").hidden = true;
    last = root.performance.now(); root.requestAnimationFrame(frame);
    setPlayIcon(); rolling(true); lockScreen();
  }
  function start(withCount) {
    if (!words.length || editing || textEdit) return;
    hideEnd();
    setScroll(false);
    if (seeked) { takeWord = Math.max(0, wordAt(t)); t = times[takeWord] || 0; seeked = false; released = {}; markStart(); apply(); }
    if (t >= total) { t = times[takeWord] || 0; released = {}; apply(); }
    fadeSoon();
    if (withCount && S.countdown) {
      var n = 3; countEl.textContent = n; countEl.hidden = false; setPlayIcon(); rolling(true);
      countTimer = setInterval(function () { n--; if (n <= 0) { cancelCount(); go(); } else countEl.textContent = n; }, 800);
      setPlayIcon();
    } else go();
  }
  function cancelCount() { if (countTimer) { clearInterval(countTimer); countTimer = null; } countEl.hidden = true; setPlayIcon(); }
  function stop() {
    var was = playing || !!countTimer;
    playing = false;
    t = pausePlace(t);
    cancelCount(); setPlayIcon(); rolling(false); stopFling();
    if (was) edits.commit(); // a pause is a save point
  }
  function hold(i) { holding = i; released[i] = true; playing = false; setPlayIcon(); $("cuehold").hidden = false; }
  function toggle() {
    if (textEdit) leaveCaret(true);
    if (editing) return;
    if (atEnd) return gotIt();
    if (holding >= 0) return go();
    if (playing || countTimer) { stop(); return; }
    var atTake = Math.abs(t - (times[takeWord] || 0)) < 0.01;
    start(atTake || seeked || t >= total);
  }
  function restart() {
    if (editing) return;
    stop(); hideEnd(); seeked = false; released = {}; holding = -1; $("cuehold").hidden = true;
    t = times[takeWord] || 0; apply();
    endRec(function () { start(true); });
  }
  function markStart() { /* The red line is the only mark. No per-word underline. */ }
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
    else edits.commit();
  });

  function finish() {
    stop();
    endRec();
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
  /* Next script, in film order, with no mark (Got it is the button that marks). */
  function nextScript() {
    if (editing || !scripts.length) return;
    var n = nextInOrder(scripts, cur);
    if (n < 0) { say("This is the last script on the shoot."); return; }
    $("done").hidden = true;
    open(n);
  }

  /* ── speed ───────────────────────────────────────────────────────────── */

  function setWpm(v) {
    var p = progress();
    S.wpm = Math.max(MIN_WPM, Math.min(MAX_WPM, Math.round(v / 5) * 5));
    save(); timeline(); layout(); restore(p); apply(); syncSettings();
    if (playing) last = root.performance.now();
  }
  function save() { LS.set("settings", S); }

  /* ── touch: the gesture rules above, wired to the page ──────────────── */

  function modeNow() { return scrollMode ? "scroll" : (playing || countTimer) ? "rolling" : "paused"; }
  function setScroll(on) {
    scrollMode = !!on;
    $("scrollchip").hidden = !scrollMode;
    doc.body.classList.toggle("scrolling", scrollMode);
    if (!on) stopFling();
  }
  function snap() { return { t: t, seeked: seeked, takeWord: takeWord, released: Object.assign({}, released), holding: holding }; }
  function unsnap(sn) {
    if (!sn) return;
    t = sn.t; seeked = sn.seeked; takeWord = sn.takeWord; released = sn.released; holding = sn.holding;
    $("cuehold").hidden = holding < 0;
    markStart(); apply();
  }
  function moveBy(dy) {
    if (!kf.length) return;
    t = tAt(yAt(t) + scriptDelta(dy, S.flipV));
    seeked = true;
    apply();
  }
  function stopFling() { if (flingRaf) { root.cancelAnimationFrame(flingRaf); flingRaf = 0; } }
  function fling(v) {
    stopFling();
    var lastAt = root.performance.now();
    function step(now) {
      var dt = Math.min(48, now - lastAt); lastAt = now;
      moveBy(v * dt);
      v *= Math.pow(0.95, dt / 16);
      if (Math.abs(v) < 0.02 || !scrollMode) { flingRaf = 0; return; }
      flingRaf = root.requestAnimationFrame(step);
    }
    flingRaf = root.requestAnimationFrame(step);
  }

  var settleTimer = null;
  function cancelSettle() { if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; } }
  function armSettle() {
    cancelSettle();
    settleTimer = setTimeout(function () {
      settleTimer = null;
      feed("settle", null);
    }, DBL_MS + 40);
  }
  function allowSelect(on) {
    var v = on ? "text" : "";
    var call = on ? "default" : "";
    content.style.webkitUserSelect = v;
    content.style.userSelect = v;
    content.style.webkitTouchCallout = call;
    stage.style.webkitUserSelect = v;
    stage.style.userSelect = v;
    stage.style.webkitTouchCallout = call;
    stage.style.touchAction = on ? "manipulation" : "";
    content.style.touchAction = on ? "manipulation" : "";
  }
  /* The words become editable on the first tap, before a second tap can land.
     iPhone only shows the keyboard if the words were already editable when the
     finger went down. A single tap turns this back off when the wait ends. */
  function primeEdit() {
    if (!content || textEdit) return;
    content.setAttribute("contenteditable", "true");
    content.setAttribute("inputmode", "text");
    content.setAttribute("autocapitalize", "sentences");
    allowSelect(true);
  }
  function disarmEdit() {
    if (textEdit) return;
    content.removeAttribute("contenteditable");
    content.removeAttribute("inputmode");
    content.removeAttribute("autocapitalize");
    doc.body.classList.remove("wording");
    allowSelect(false);
  }
  function act(a, e) {
    if (a.do === "pause") {
      if (textEdit) return;
      disarmEdit();
      tapSnap = snap();
      stop();
    } else if (a.do === "resume") {
      if (textEdit) return;
      disarmEdit();
      tapSnap = snap();
      if (scrollMode) setScroll(false);
      if (holding >= 0) { go(); return; }
      var atTake = Math.abs(t - (times[takeWord] || 0)) < 0.01;
      start(atTake || seeked || t >= total);
    } else if (a.do === "caret") {
      cancelSettle();
      placeCaret(a.x, a.y);
      if (e && e.preventDefault) e.preventDefault();
    } else if (a.do === "scroll-on") {
      stop(); unsnap(tapSnap); hideEnd(); setScroll(true);
    } else if (a.do === "scroll-off") {
      stop(); unsnap(tapSnap); setScroll(false);
    } else if (a.do === "grab") {
      stopFling(); stop(); hideEnd();
    } else if (a.do === "drag") {
      moveBy(a.dy);
    } else if (a.do === "fling") {
      fling(a.v);
    } else if (a.do === "edit") {
      if (textEdit) return;
      var el = doc.elementFromPoint(a.x, a.y), p = el && el.closest ? el.closest("#content p") : null;
      beginEdit(p ? Number(p.dataset.p) : paraAtLine(), false);
    } else if (a.do === "edit-focus") {
      if (editing && editing.box) { editing.box.focus(); }
    }
    if (e && (a.do === "edit" || a.do === "edit-focus")) e.preventDefault();
  }
  function feed(type, e) {
    var ev = { type: type, x: e ? e.clientX : 0, y: e ? e.clientY : 0, t: root.performance.now() };
    var r = gestureStep(gest, ev, modeNow());
    gest = r.g;
    r.acts.forEach(function (a) { act(a, e); });
  }

  stage.addEventListener("pointerdown", function (e) {
    if (textEdit) return;
    if (e.button > 0 || editing || atEnd) return;
    if (e.isPrimary === false) return;
    stopFling();
    feed("down", e);
    if (gest.down && gest.down.dbl) {
      cancelSettle();
      clearTimeout(longTimer);
      return;
    }
    if (e.cancelable) e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch (x) { /* old browser */ }
    clearTimeout(longTimer);
    longTimer = setTimeout(function () { feed("timer", null); }, LONG_MS + 10);
  });
  stage.addEventListener("pointermove", function (e) {
    if (textEdit) return;
    if (!gest.down || editing) return;
    feed("move", e);
    if (gest.down && gest.down.moved) clearTimeout(longTimer);
  });
  stage.addEventListener("pointerup", function (e) {
    clearTimeout(longTimer);
    if (textEdit) return;
    if (!gest.down) return;
    feed("up", e);
    if (gest.pending) { primeEdit(); armSettle(); }
    else cancelSettle();
  });
  stage.addEventListener("pointercancel", function () {
    clearTimeout(longTimer);
    if (textEdit) return;
    feed("cancel", null);
    if (gest.pending) armSettle();
  });
  stage.addEventListener("contextmenu", function (e) {
    if (textEdit) return;
    e.preventDefault();
  });
  stage.addEventListener("wheel", function (e) {
    if (editing || textEdit) return;
    e.preventDefault(); stop(); hideEnd();
    moveBy(e.deltaY);
  }, { passive: false });
  content.addEventListener("input", function (e) {
    if (!textEdit) return;
    if (e.target && e.target.id === "edit-box") return;
    syncCaretText();
  });
  content.addEventListener("blur", function () {
    if (!textEdit) return;
    var opened = textEdit.at;
    setTimeout(function () {
      if (!textEdit) return;
      if (doc.activeElement === content) return;
      if (root.performance.now() - opened < 500) {
        try { content.focus({ preventScroll: true }); } catch (err) { /* keep the cursor */ }
        return;
      }
      leaveCaret(true);
    }, 120);
  });

  /* ── edit on the fly ─────────────────────────────────────────────────── */

  function paraAtLine() {
    var i = Math.max(0, Math.min(words.length - 1, wordAt(t)));
    return words[i] ? words[i].para : 0;
  }

  /*
   * Open the edit box on paragraph i, in place. The words around it stay; the
   * script stops (you cannot read and type at once) and rolls on from where
   * you were when you press Done. Every change goes to the waiting list, which
   * saves it a moment after you stop typing, and at once when the box closes.
   */
  function beginEdit(i, focusNow) {
    var s = scripts[cur];
    if (!s || editing) return;
    var paras = paragraphsFor(s);
    if (!paras[i]) return;
    var wasRolling = playing || !!countTimer;
    var place = Math.max(0, wordAt(t));
    stop(); hideEnd(); setScroll(false); closeSheets();
    var p = content.querySelector('p[data-p="' + i + '"]');
    if (!p) return;
    editing = {
      i: i, root: s.root_script_id, base: s, paras: paras, original: paras[i].text,
      bullets: isBullets(s), wasRolling: wasRolling, place: place,
      counts: paras.map(function (x) { return x.text.split(/\s+/).filter(function (w) { return w && w !== "↑"; }).length; })
    };
    doc.body.classList.add("editing");
    $("editbar").hidden = false;
    var box = doc.createElement("textarea");
    box.className = "edit-box";
    box.id = "edit-box";
    box.setAttribute("aria-label", "Change the words in this line");
    box.setAttribute("autocapitalize", "sentences");
    box.value = paras[i].text;
    box.style.fontSize = Math.max(18, Math.min(S.font, 44)) + "px";
    p.hidden = true;
    p.parentNode.insertBefore(box, p);
    editing.box = box;
    grow(box);
    content.style.transform = "translate3d(0," + (-(box.offsetTop - 16)).toFixed(1) + "px,0)";
    box.addEventListener("input", function () { grow(box); typed(); });
    box.addEventListener("blur", function () { edits.commit(); pulse(); });
    box.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); endEdit(); } });
    pulse();
    if (focusNow) box.focus();
  }
  function grow(box) { box.style.height = "auto"; box.style.height = box.scrollHeight + 4 + "px"; }

  function typed() {
    if (!editing) return;
    var r = E.applyEdit(editing.base, editing.paras, editing.i, editing.box.value, editing.bullets);
    if (!r) return;
    if (!E.clean(editing.box.value) && !r.body.trim()) { $("e-status").textContent = "A script cannot be empty. Put some words back."; return; }
    var s = scripts[cur];
    scripts[cur] = withWords(s, r.body, r.parts);
    if (r.changed || edits.item(editing.root)) {
      edits.edit(editing.root, { id: s.id, version: s.version, body: s.body, parts: s.parts }, r.body, r.parts);
    }
    pulse();
  }

  function endEdit() {
    if (!editing) return;
    var ed = editing;
    edits.commit();
    ed.box.blur();
    editing = null;
    doc.body.classList.remove("editing");
    $("editbar").hidden = true;
    var s = scripts[cur];
    var paras = paragraphsFor(s);
    var counts = paras.map(function (x) { return x.text.split(/\s+/).filter(function (w) { return w && w !== "↑"; }).length; });
    var at = paras.length === ed.paras.length ? wordAfterEdit(ed.place, ed.i, ed.counts, counts) : Math.min(ed.place, Math.max(0, counts.reduce(function (a, b) { return a + b; }, 0) - 1));
    redraw(at);
    pulse();
    if (ed.wasRolling) { seeked = false; takeWord = Math.min(takeWord, at); go(); }
  }
  function putBack() {
    if (!editing) return;
    editing.box.value = editing.original;
    grow(editing.box);
    typed();
  }

  /* ── history and the two-versions picker ─────────────────────────────── */

  function el(tag, cls, text) {
    var x = doc.createElement(tag);
    if (cls) x.className = cls;
    if (text != null) x.textContent = text;
    return x;
  }
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    try { return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" }); } catch (e) { return iso; }
  }
  function diffBox(a, b) {
    var box = el("p", "diff");
    E.wordDiff(a, b).forEach(function (seg) {
      var x = el(seg.op === "del" ? "del" : seg.op === "add" ? "ins" : "span", null, seg.text);
      box.appendChild(x);
      box.appendChild(doc.createTextNode(" "));
    });
    return box;
  }

  /* Every version of this script, newest first: who, when, what changed, and
     whether the repo has it. Edits still on this phone are at the top. */
  function openHistory() {
    var s = scripts[cur];
    if (!s) return;
    if (editing) edits.commit();
    closeSheets(true);
    $("hist").hidden = false;
    var list = $("hist-list");
    list.innerHTML = "";
    $("hist-title").textContent = "History: Ad " + (s.ad_id || "?") + " · " + (s.angle_name || s.title || "Untitled");
    list.appendChild(el("p", "note", "Loading every version…"));
    var it = edits.item(s.root_script_id);
    api("GET", "marketing/script?id=" + encodeURIComponent(it ? it.base_id : s.id)).then(function (r) {
      list.innerHTML = "";
      var versions = r.status === 200 && r.data && Array.isArray(r.data.versions) ? r.data.versions : null;
      var liveV = versions ? E.liveOf(versions) : null;
      if (it) {
        var row = el("div", "ver here");
        row.appendChild(el("div", "vh", "On this phone · " + (it.conflict ? "two versions, pick one" : it.failed ? "not saved" : "waiting to save")));
        row.appendChild(diffBox(liveV ? liveV.body : (s.body || ""), it.body));
        list.appendChild(row);
      }
      if (!versions) {
        list.appendChild(el("p", "note", r.status === 0
          ? "History needs a connection. Your edits are safe on this phone and send when you are back online."
          : "The history did not load. Try again in a minute."));
        return;
      }
      versions.forEach(function (v, k) {
        var older = versions[k + 1];
        var row = el("div", "ver");
        row.appendChild(el("div", "vh", "Version " + v.version + " · " + E.whoWrote(v.source) + " · " + when(v.created_at) + (v.status === "superseded" ? "" : " · on the shoot")));
        if (older) {
          var d = E.wordDiff(older.body, v.body);
          row.appendChild(el("div", "vm", E.diffWords(d)));
          row.appendChild(diffBox(older.body, v.body));
        } else {
          row.appendChild(el("div", "vm", "The first words."));
          row.appendChild(el("p", "diff", v.body));
        }
        row.appendChild(el("div", "vm", v.repo_commit ? "In the repo." : "Not in the repo yet."));
        list.appendChild(row);
      });
    });
  }

  /* A 409 (two versions) or a failed save: show the words and let Chris pick. */
  function openPick(rootId) {
    var it = edits.item(rootId);
    if (!it) return;
    if (editing) endEdit();
    closeSheets(true);
    var box = $("pick-body");
    box.innerHTML = "";
    var acts = $("pick-acts");
    acts.innerHTML = "";
    if (it.conflict) {
      var th = it.conflict.theirs;
      $("pick-title").textContent = "Two versions of this script";
      box.appendChild(el("p", "note", "Someone saved this script after you started. Pick the words to keep. Nothing is lost: the other words stay in the history."));
      box.appendChild(el("h3", null, "Your words (on this phone)"));
      box.appendChild(el("p", "words", it.body));
      box.appendChild(el("h3", null, "Saved words · " + E.whoWrote(th.source) + (th.created_at ? " · " + when(th.created_at) : "")));
      box.appendChild(el("p", "words", th.body));
      var mine = el("button", "big primary", "Keep my words");
      mine.type = "button";
      mine.onclick = function () { closeSheets(true); edits.resolve(rootId, "mine"); pulse(); };
      var theirs = el("button", "big", "Use the saved words");
      theirs.type = "button";
      theirs.onclick = function () { closeSheets(true); edits.resolve(rootId, "theirs"); pulse(); };
      acts.appendChild(mine); acts.appendChild(theirs);
    } else if (it.failed) {
      $("pick-title").textContent = "This edit did not save";
      box.appendChild(el("p", "note", it.failed));
      box.appendChild(el("h3", null, "Your words (kept on this phone)"));
      box.appendChild(el("p", "words", it.body));
      var again = el("button", "big primary", "Try again");
      again.type = "button";
      again.onclick = function () { closeSheets(true); edits.retry(rootId); pulse(); };
      var toss = el("button", "big", "Throw these words away");
      toss.type = "button";
      toss.onclick = function () {
        if (!root.confirm("Throw these words away? They are not saved anywhere else.")) return;
        closeSheets(true); edits.drop(rootId); pulse();
      };
      acts.appendChild(again); acts.appendChild(toss);
    } else return;
    $("pick").hidden = false;
  }

  function pulseTap() {
    var list = edits.list();
    for (var i = 0; i < list.length; i++) if (list[i].conflict || list[i].failed) { openPick(list[i].root); return; }
    openHistory();
  }

  /* ── camera: front lens, 4K or 1080p, lineup box, a real video file ── */

  var cam = { stream: null, rec: null, chunks: [], applied: "", opening: "", file: null, gen: 0, stopping: false, again: false, after: null, tick: null, fadeT: null, started: 0, mime: "", fileName: "Take.mp4" };
  var wantRec = false;

  function activeMode() {
    if (stays4K(scripts[cur])) return "4k";
    return S.cam === "1080p" ? "1080p" : "4k";
  }
  function paintPicks() {
    var mode = activeMode();
    var a = $("q-4k"), b = $("q-1080");
    if (a) a.classList.toggle("on", mode === "4k");
    if (b) b.classList.toggle("on", mode === "1080p");
  }
  function camLine(text, bad) {
    var el = $("cam-line");
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
    el.style.color = bad ? "var(--tally)" : "";
    var now = $("cam-now");
    if (now && text) now.textContent = text;
  }
  function showFace() {
    var box = $("cam");
    if (!box || box.hidden) return;
    box.classList.remove("glass");
    clearTimeout(cam.fadeT);
    cam.fadeT = setTimeout(function () { box.classList.add("glass"); }, 5000);
  }
  function fadeSoon() {
    var box = $("cam");
    if (!box || box.hidden) return;
    clearTimeout(cam.fadeT);
    cam.fadeT = setTimeout(function () { box.classList.add("glass"); }, 600);
  }
  function pickMime() {
    if (!root.MediaRecorder || !root.MediaRecorder.isTypeSupported) return "";
    var list = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    for (var i = 0; i < list.length; i++) if (root.MediaRecorder.isTypeSupported(list[i])) return list[i];
    return "";
  }
  function videoBits(width, fps) {
    var hi = fps > 30;
    if (width >= 3840) return hi ? 75000000 : 50000000;
    if (width >= 1920) return hi ? 30000000 : 20000000;
    if (width > 0) return hi ? 16000000 : 10000000;
    return 8000000;
  }
  function isPhone() {
    var ua = (root.navigator && root.navigator.userAgent) || "";
    return /iPhone|iPad|iPod/.test(ua) || (root.navigator.platform === "MacIntel" && root.navigator.maxTouchPoints > 1);
  }
  function downloadFile(file) {
    var url = root.URL.createObjectURL(file);
    var a = doc.createElement("a");
    a.href = url;
    a.download = file.name;
    a.rel = "noopener";
    if (isPhone()) a.target = "_blank";
    doc.body.appendChild(a);
    a.click();
    a.remove();
  }
  function keepFile(chunks) {
    try {
      var type = cam.mime || (chunks[0] && chunks[0].type) || "video/mp4";
      var name = cam.fileName || "Take.mp4";
      if (type.indexOf("webm") >= 0) name = name.replace(/\.mp4$/i, ".webm");
      var file = new root.File(chunks, name, { type: type });
      cam.file = file;
      var btn = $("b-save");
      if (btn) btn.hidden = false;
      if (!isPhone()) downloadFile(file);
      say(isPhone() ? "Take ready. Tap Save the video." : ("Saved " + name));
    } catch (e) {
      camLine("The take did not save. The words still roll.", true);
    }
  }
  function tickRec() {
    if (!cam.rec || cam.rec.state !== "recording") return;
    var el = $("rec-time");
    if (el) el.textContent = clock((Date.now() - cam.started) / 1000);
    cam.tick = setTimeout(tickRec, 500);
  }
  function stopMirrorPump() {
    cam.pumping = false;
    if (cam.pumpRaf) { root.cancelAnimationFrame(cam.pumpRaf); cam.pumpRaf = 0; }
  }
  /* The preview is flipped with CSS. The file is not, so the saved take is
     drawn onto a canvas the same way a mirror looks, then recorded from that. */
  function mirroredRecordStream(stream) {
    var video = $("cam-video");
    if (!video || !stream) return stream;
    var canvas = cam.canvas || doc.createElement("canvas");
    cam.canvas = canvas;
    if (!canvas.captureStream) return stream;
    var track = stream.getVideoTracks()[0];
    var st = track && track.getSettings ? track.getSettings() : {};
    var w = video.videoWidth || st.width || 1280;
    var h = video.videoHeight || st.height || 720;
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    if (!ctx) return stream;
    function draw() {
      if (!cam.pumping) return;
      ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
      try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); } catch (e) { /* frame not ready */ }
      cam.pumpRaf = root.requestAnimationFrame(draw);
    }
    stopMirrorPump();
    cam.pumping = true;
    draw();
    var fps = Math.round(st.frameRate || 30) || 30;
    var out;
    try { out = canvas.captureStream(Math.max(1, fps)); }
    catch (e) { stopMirrorPump(); return stream; }
    var audios = stream.getAudioTracks();
    for (var i = 0; i < audios.length; i++) {
      try { out.addTrack(audios[i]); } catch (err) { /* keep the picture if the sound track will not join */ }
    }
    return out;
  }
  function beginRec() {
    if (!wantRec || !cam.stream) return;
    if (cam.rec && cam.rec.state === "recording") return;
    if (cam.stopping) { cam.again = true; return; }
    if (!root.MediaRecorder) { camLine("This phone cannot save a video file. The words still roll.", true); return; }
    var mime = pickMime();
    cam.mime = mime;
    cam.chunks = [];
    var track = cam.stream.getVideoTracks()[0];
    var st = track && track.getSettings ? track.getSettings() : {};
    var opts = {};
    if (mime) opts.mimeType = mime;
    opts.videoBitsPerSecond = videoBits(st.width || 0, st.frameRate || 30);
    var recStream = mirroredRecordStream(cam.stream);
    var rec;
    try { rec = new root.MediaRecorder(recStream, opts); }
    catch (e1) {
      if (recStream !== cam.stream) stopMirrorPump();
      try { rec = new root.MediaRecorder(cam.stream); }
      catch (e2) { stopMirrorPump(); camLine("This phone cannot save a video file. The words still roll.", true); return; }
    }
    cam.rec = rec;
    var s = scripts[cur];
    cam.fileName = (s && s.take_file_name) ? s.take_file_name : "Take.mp4";
    cam.started = Date.now();
    rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) cam.chunks.push(ev.data); };
    rec.onstop = function () { onRecStop(); };
    try { rec.start(1000); }
    catch (e3) { camLine("The recording did not start. The words still roll.", true); return; }
    var dot = $("rec");
    if (dot) dot.hidden = false;
    var tm = $("rec-time");
    if (tm) tm.textContent = "0:00";
    clearTimeout(cam.tick);
    cam.tick = setTimeout(tickRec, 500);
  }
  function onRecStop() {
    stopMirrorPump();
    cam.stopping = false;
    var dot = $("rec");
    if (dot) dot.hidden = true;
    clearTimeout(cam.tick);
    var chunks = cam.chunks;
    cam.chunks = [];
    var next = cam.after;
    cam.after = null;
    var again = cam.again;
    cam.again = false;
    if (chunks.length) keepFile(chunks);
    if (again) { wantRec = true; beginRec(); }
    else if (next) next();
    ensureCamera();
  }
  function endRec(then) {
    wantRec = false;
    var rec = cam.rec;
    if (!rec || rec.state === "inactive") { if (then) then(); return; }
    cam.stopping = true;
    cam.after = then || null;
    try { rec.stop(); }
    catch (e) { cam.stopping = false; if (then) then(); }
  }
  function ensureRecording() {
    wantRec = true;
    beginRec();
  }
  function attachStream(stream, mode, noMic) {
    if (cam.stream && cam.stream !== stream) {
      cam.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* already stopped */ } });
    }
    cam.stream = stream;
    cam.applied = mode;
    var video = $("cam-video");
    if (video) {
      video.srcObject = stream;
      video.muted = true;
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* a tap may be required before the picture shows */ });
    }
    var box = $("cam");
    if (box) box.hidden = false;
    showFace();
    var track = stream.getVideoTracks()[0];
    var got = track && track.getSettings ? track.getSettings() : {};
    var rep = cameraReport(got, mode);
    var text = rep.short || ("Front camera · " + rep.line);
    if (noMic) text += " · no sound";
    camLine(text, !!rep.short);
    paintPicks();
    if (wantRec) beginRec();
  }
  function ensureCamera() {
    if (cam.rec && cam.rec.state === "recording") return;
    if (cam.stopping) return;
    var mode = activeMode();
    if (cam.stream && cam.applied === mode) { paintPicks(); return; }
    if (cam.opening === mode) return;
    openCamera();
  }
  function openCamera() {
    try {
      var md = root.navigator.mediaDevices;
      if (!md || !md.getUserMedia) { camLine("This browser cannot use the camera. The words still roll.", true); return; }
      var gen = ++cam.gen;
      var mode = activeMode();
      cam.opening = mode;
      camLine(mode === "1080p" ? "Asking the front camera for 1080p at its highest frame rate." : "Asking the front camera for 4K (3840×2160) at its highest frame rate.", false);
      paintPicks();
      function takeStream(stream, noMic, triedExact) {
        if (gen !== cam.gen) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        var track = stream.getVideoTracks()[0];
        if (!track) { cam.opening = ""; camLine("No camera on this phone. The words still roll.", true); return; }
        var caps = track.getCapabilities ? track.getCapabilities() : {};
        var maxFps = caps.frameRate && caps.frameRate.max ? caps.frameRate.max : 60;
        var ask = cameraAsk(mode, maxFps);
        var apply = track.applyConstraints ? track.applyConstraints({ width: ask.width, height: ask.height, frameRate: ask.frameRate }).catch(function () { /* keep the real size */ }) : Promise.resolve();
        apply.then(function () {
          if (gen !== cam.gen) return;
          var facing = track.getSettings && track.getSettings().facingMode;
          if (facing && facing !== "user" && !triedExact) {
            stream.getTracks().forEach(function (t) { t.stop(); });
            var exact = cameraAsk(mode, maxFps);
            exact.facingMode = { exact: "user" };
            md.getUserMedia({ audio: !noMic, video: exact }).then(function (s2) { takeStream(s2, noMic, true); }, function () {
              if (gen === cam.gen) { cam.opening = ""; camLine("The front camera did not start. The words still roll.", true); }
            });
            return;
          }
          cam.opening = "";
          attachStream(stream, mode, noMic);
        });
      }
      md.getUserMedia({ audio: true, video: cameraAsk(mode, 60) }).then(function (s) { takeStream(s, false, false); }, function () {
        md.getUserMedia({ audio: false, video: cameraAsk(mode, 60) }).then(function (s) { takeStream(s, true, false); }, function () {
          if (gen === cam.gen) { cam.opening = ""; camLine("The camera did not start. Allow the camera, then reload. The words still roll.", true); }
        });
      });
    } catch (e) {
      cam.opening = "";
      camLine("The camera did not start. The words still roll.", true);
    }
  }
  function setCamMode(mode) {
    if (mode === "1080p" && stays4K(scripts[cur])) { say("This one stays 4K."); paintPicks(); return; }
    S.cam = mode === "1080p" ? "1080p" : "4k";
    save();
    paintPicks();
    if (cam.rec && cam.rec.state === "recording") { say("The next take uses " + (S.cam === "1080p" ? "1080p" : "4K") + "."); return; }
    cam.applied = "";
    cam.opening = "";
    ensureCamera();
  }
  var MAC_DROPS = [
    { url: "http://127.0.0.1:8787", space: "loopback" },
    { url: "http://CHRISs-Mac-mini.local:8787", space: "local" }
  ];
  function shareOrDownload(file) {
    var nav = root.navigator;
    try {
      if (nav.canShare && nav.canShare({ files: [file] })) {
        nav.share({ files: [file], title: file.name }).catch(function () { downloadFile(file); });
        return;
      }
    } catch (e) { /* fall through to a download */ }
    downloadFile(file);
  }
  function sendOriginal(file) {
    var name = file.name || "Take.mp4";
    function once(i) {
      if (i >= MAC_DROPS.length) return Promise.reject(new Error("drop"));
      var drop = MAC_DROPS[i];
      var ctl = root.AbortController ? new root.AbortController() : null;
      var timer = ctl ? setTimeout(function () { try { ctl.abort(); } catch (e) { /* already done */ } }, 4000) : null;
      var opts = { method: "PUT", body: file };
      if (ctl) opts.signal = ctl.signal;
      try { opts.targetAddressSpace = drop.space; } catch (e) { /* older browser */ }
      return root.fetch(drop.url + "/takes/" + encodeURIComponent(name), opts).then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error("refused");
      }).catch(function () {
        if (timer) clearTimeout(timer);
        return once(i + 1);
      });
    }
    return once(0);
  }
  function saveClick() {
    var file = cam.file;
    if (!file) return;
    sendOriginal(file).then(function () {
      say("Saved " + (file.name || "the video"));
    }, function () {
      shareOrDownload(file);
    });
  }

  function rangeAtPoint(x, y) {
    var range = null;
    try {
      if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(x, y);
      else if (doc.caretPositionFromPoint) {
        var pos = doc.caretPositionFromPoint(x, y);
        if (pos && pos.offsetNode) {
          range = doc.createRange();
          var off = pos.offset || 0;
          var max = pos.offsetNode.nodeType === 3 ? (pos.offsetNode.textContent || "").length : pos.offsetNode.childNodes.length;
          range.setStart(pos.offsetNode, Math.max(0, Math.min(off, max)));
          range.collapse(true);
        }
      }
    } catch (err) { range = null; }
    if (range && content.contains(range.startContainer)) return range;
    var hit = doc.elementFromPoint(x, y);
    var sp = hit && hit.closest ? hit.closest("#content .w, #content .up") : null;
    if (!sp) {
      var ps = content.querySelectorAll("p");
      sp = ps.length ? ps[0] : null;
    }
    if (!sp) return null;
    var node = sp.firstChild;
    while (node && node.nodeType !== 3) node = node.firstChild;
    if (!node) return null;
    var len = node.textContent ? node.textContent.length : 0;
    var rect = sp.getBoundingClientRect();
    var at = rect && x > (rect.left + rect.right) / 2 ? len : 0;
    var made = doc.createRange();
    try { made.setStart(node, Math.max(0, Math.min(at, len))); made.collapse(true); } catch (err2) { return null; }
    return made;
  }
  function placeCaret(x, y) {
    if (atEnd || editing || !scripts[cur]) return;
    if (playing || countTimer) stop();
    hideEnd();
    setScroll(false);
    cancelSettle();
    primeEdit();
    var base = scripts[cur];
    textEdit = {
      root: base.root_script_id, id: base.id, version: base.version,
      body: base.body, parts: base.parts, at: root.performance.now()
    };
    doc.body.classList.add("wording");
    allowSelect(true);
    var range = rangeAtPoint(x, y);
    try { content.focus({ preventScroll: true }); }
    catch (err) { try { content.focus(); } catch (err2) { /* the keyboard needs this tap */ } }
    var sel = root.getSelection ? root.getSelection() : null;
    if (sel) {
      sel.removeAllRanges();
      if (range) { try { sel.addRange(range); } catch (err3) { /* the keyboard is up */ } }
    }
  }
  function flatWords(text) {
    return String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
  function blockText(el) {
    var parts = [];
    function walk(node) {
      if (!node) return;
      if (node.nodeType === 3) { parts.push(node.textContent); return; }
      if (node.nodeName === "BR") { parts.push("\n"); return; }
      var kids = node.childNodes;
      for (var i = 0; i < kids.length; i++) walk(kids[i]);
    }
    walk(el);
    return parts.join("").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  }
  function readCaretParas() {
    var kids = content.children;
    var out = [];
    for (var i = 0; i < kids.length; i++) {
      var node = kids[i];
      if (!node || node.id === "edit-box") continue;
      if (node.nodeName !== "P" && node.nodeName !== "DIV") continue;
      out.push(blockText(node));
    }
    while (out.length && !out[out.length - 1]) out.pop();
    return out;
  }
  function syncCaretText() {
    if (!textEdit) return;
    var s = scripts[cur];
    if (!s || s.root_script_id !== textEdit.root) return;
    var next = readCaretParas();
    var old = paragraphsFor(s);
    var bullets = isBullets(s);
    var curS = s;
    var changed = false;
    if (next.length === old.length) {
      for (var i = 0; i < next.length; i++) {
        if (flatWords(next[i]) === flatWords(old[i].text)) continue;
        var r = E.applyEdit(curS, paragraphsFor(curS), i, next[i], bullets);
        if (!r) return;
        if (!E.clean(next[i]) && !String(r.body || "").trim()) {
          say("A script cannot be empty. Put some words back.");
          return;
        }
        if (r.changed) changed = true;
        curS = withWords(curS, r.body, r.parts);
      }
    } else {
      var body = next.filter(function (para) { return flatWords(para); }).join("\n\n");
      if (!flatWords(body)) {
        say("A script cannot be empty. Put some words back.");
        return;
      }
      if (flatWords(body) !== flatWords(s.body)) {
        curS = withWords(s, body, null);
        changed = true;
      }
    }
    scripts[cur] = curS;
    if (changed || edits.item(textEdit.root)) {
      edits.edit(textEdit.root, {
        id: textEdit.id, version: textEdit.version, body: textEdit.body, parts: textEdit.parts
      }, curS.body, curS.parts);
    }
    pulse();
  }
  function leaveCaret(redrawNow) {
    if (!textEdit) return;
    syncCaretText();
    edits.commit();
    textEdit = null;
    disarmEdit();
    if (redrawNow && scripts[cur]) {
      var at = words.length ? Math.max(0, wordAt(t)) : 0;
      redraw(at);
    }
    pulse();
  }
  function recordClick() {
    if (editing) return;
    ensureCamera();
    ensureRecording();
  }
  function stopRecClick() {
    endRec();
  }
  function saveScript() {
    if (textEdit) syncCaretText();
    if (editing && editing.box) typed();
    var list = edits.list();
    for (var i = 0; i < list.length; i++) {
      if (list[i].conflict || list[i].failed) { openPick(list[i].root); return; }
    }
    edits.commit();
    pulse();
  }

  /* ── buttons ─────────────────────────────────────────────────────────── */

  $("play").onclick = toggle;
  $("b-rec").onclick = recordClick;
  $("b-stop").onclick = stopRecClick;
  $("b-script-save").onclick = saveScript;
  $("wpm-down").onclick = function (e) { e.stopPropagation(); setWpm(S.wpm - 5); };
  $("wpm-up").onclick = function (e) { e.stopPropagation(); setWpm(S.wpm + 5); };
  doc.addEventListener("keydown", function (e) {
    var dir = volumeKeyDir(e.key, e.code);
    if (!dir) return;
    var tag = (e.target && e.target.tagName) || "";
    if (textEdit || (e.target && e.target.isContentEditable)) return;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    e.preventDefault();
    setWpm(S.wpm + dir * 5);
  });
  (function armVideoVolume() {
    var video = $("cam-video");
    if (!video || video.__fhtpVol) return;
    video.__fhtpVol = true;
    var last = null;
    video.addEventListener("volumechange", function () {
      var v = video.volume;
      if (typeof v !== "number") return;
      if (last == null) { last = v; return; }
      var dir = volumeLevelDir(last, v);
      last = v;
      if (dir) setWpm(S.wpm + dir * 5);
    });
  })();
  $("q-4k").onclick = function () { setCamMode("4k"); };
  $("q-1080").onclick = function () { setCamMode("1080p"); };
  $("cam-corner").onclick = function (e) { e.preventDefault(); e.stopPropagation(); showFace(); };
  $("b-save").onclick = saveClick;
  $("e-done").onclick = endEdit;
  $("e-back").onclick = putBack;
  $("e-hist").onclick = function () { openHistory(); };
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
  Array.prototype.forEach.call(doc.querySelectorAll("[data-close]"), function (b) { b.onclick = function () { closeSheets(); }; });
  var SHEETS = ["lib", "set", "hist", "pick"];
  function openSheet(id) { closeSheets(); if (id === "lib") drawList(); if (id === "set") drawKeys(); $(id).hidden = false; }
  function closeSheets(keepEdit) {
    learning = null;
    SHEETS.forEach(function (id) { $(id).hidden = true; });
    if (!keepEdit && editing) editing.box.focus();
  }

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
    content.style.setProperty("--measure", S.measure + "ch");
    flip.classList.toggle("mirror-x", !!S.mirror);
    flip.classList.toggle("mirror-y", !!S.flipV);
  }
  function syncSettings() {
    $("r-wpm").value = S.wpm; $("v-wpm").textContent = S.wpm + " wpm";
    $("r-font").value = S.font; $("v-font").textContent = S.font + " px";
    $("r-measure").value = S.measure; $("v-measure").textContent = S.measure + " letters";
    $("r-line").value = S.line; $("v-line").textContent = S.line + "% from top";
    $("r-pause").value = S.pause; $("v-pause").textContent = Number(S.pause).toFixed(1) + " s";
    $("t-mirror").checked = !!S.mirror; $("t-flipv").checked = !!S.flipV; $("t-count").checked = !!S.countdown;
  }
  $("r-wpm").oninput = function () { setWpm(+this.value); };
  $("r-font").oninput = function () { var p = progress(); S.font = +this.value; save(); applyFont(); layout(); restore(p); apply(); syncSettings(); };
  $("r-measure").oninput = function () { var p = progress(); S.measure = +this.value; save(); applyFont(); layout(); restore(p); apply(); syncSettings(); };
  $("r-line").oninput = function () { S.line = +this.value; save(); apply(); syncSettings(); };
  $("r-pause").oninput = function () { var p = progress(); S.pause = +this.value; save(); layout(); restore(p); apply(); syncSettings(); };
  $("t-mirror").onchange = function () { S.mirror = this.checked; save(); applyFont(); applyCameraSide(); };
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
    if (textEdit || (e.target && e.target.isContentEditable)) {
      if (e.key === "Escape") { e.preventDefault(); leaveCaret(true); }
      return;
    }
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (editing) return;
    if (e.key === "Escape") { closeSheets(); return; }
    if (tag === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
    for (var i = 0; i < SHEETS.length; i++) if (!$(SHEETS[i]).hidden) return;
    var a = actionFor(id, learned, atEnd);
    if (!a) return;
    e.preventDefault();
    if (a === "play") toggle();
    else if (a === "faster") setWpm(S.wpm + 5);
    else if (a === "slower") setWpm(S.wpm - 5);
    else if (a === "restart") restart();
    else if (a === "got_it") { if (atEnd) gotIt(); }
    else if (a === "another_take") { if (atEnd) anotherTake(); }
  });

  function applyCameraSide() {
    measureSafeTop.n = null;
    var info = {};
    try {
      var so = root.screen && root.screen.orientation;
      if (so) {
        if (so.type) info.type = so.type;
        if (typeof so.angle === "number") info.angle = so.angle;
      } else if (typeof root.orientation === "number") info.angle = root.orientation;
      info.landscape = !!(root.matchMedia && root.matchMedia("(orientation: landscape)").matches);
    } catch (e) { /* no orientation api */ }
    var side = cameraWordSide(info);
    if (S.mirror && side === "left") side = "right";
    else if (S.mirror && side === "right") side = "left";
    doc.body.classList.toggle("cam-side-left", side === "left");
    doc.body.classList.toggle("cam-side-right", side === "right");
    doc.body.classList.toggle("tp-portrait", side === "full");
    if (words.length) layout();
  }
  var rz = null;
  root.addEventListener("resize", function () { measureSafeTop.n = null; clearTimeout(rz); rz = setTimeout(function () { applyCameraSide(); }, 120); });
  root.addEventListener("orientationchange", applyCameraSide);
  try {
    var landQ = root.matchMedia && root.matchMedia("(orientation: landscape)");
    if (landQ && landQ.addEventListener) landQ.addEventListener("change", applyCameraSide);
    else if (landQ && landQ.addListener) landQ.addListener(applyCameraSide);
    if (root.screen && root.screen.orientation && root.screen.orientation.addEventListener) {
      root.screen.orientation.addEventListener("change", applyCameraSide);
    }
  } catch (e) { /* orientation events are missing */ }
  applyCameraSide();
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { layout(); });

  /* Poll every 5 seconds while the page is visible and nothing is rolling,
     so a reorder, a mark or new words from the Command Center show here
     (spec §8.1). Waiting edits are sent on the same beat. */
  function poll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(function () {
      if (doc.visibilityState === "visible" && !playing && !countTimer && holding < 0 && !editing && !textEdit) {
        flush();
        if (!signedOut) load(false).then(poll, poll); else poll();
      } else poll();
    }, 5000);
  }

  syncSettings();
  paintPicks();
  pulse();
  root.addEventListener("pagehide", function () { endRec(); });
  ensureCamera();
  if (queue.length) { $("pending").hidden = false; }
  load(true).then(function () { flush(); poll(); checkHealth(true); });

  root.__fhtp = {
    state: function () {
      return {
        t: t, total: total, words: words.length, playing: playing, atEnd: atEnd, holding: holding, wpm: S.wpm, cur: cur,
        queue: queue.length, script: scripts[cur] || null, mode: modeNow(), scrollMode: scrollMode, editing: !!editing,
        word: wordAt(t), edits: edits.status()
      };
    },
    finish: function () { stop(); t = total; apply(); finish(); },
    openSheet: function (id) { openSheet(id); },
    next: function () { nextScript(); }
  };
})(typeof window !== "undefined" ? window : globalThis);
