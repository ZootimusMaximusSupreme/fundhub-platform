// The iPad mirror rig and the pocket remote. The film page stays unflipped
// until ?mirror=1 or the Mirror control. The remote uses the same film key
// and the script edit route. Record and Play stay the two film buttons.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const SRC = fs.readFileSync(path.join(APP, "teleprompter.js"), "utf8");
const HTML = fs.readFileSync(path.join(APP, "teleprompter.html"), "utf8");
const REMOTE_SRC = fs.readFileSync(path.join(APP, "teleprompter-remote.js"), "utf8");
const REMOTE_HTML = fs.readFileSync(path.join(APP, "teleprompter-remote.html"), "utf8");

function load(file) {
  const ctx = createContext({ console });
  runInContext(fs.readFileSync(path.join(APP, file), "utf8"), ctx);
  return ctx;
}

describe("iPad mirror rig", () => {
  const T = load("teleprompter.js").FundhubTeleprompter;

  test("the phone page stays unflipped until the link or a saved switch turns the mirror on", () => {
    assert.equal(JSON.stringify(T.rigLook(T.rigQuery(""), {})), JSON.stringify({ mirror: false, flipV: false, rot: 0 }));
    assert.equal(T.rigTransform(T.rigLook(T.rigQuery(""), {})), "");
    assert.equal(T.rigLook(T.rigQuery("?mirror=1"), { mirror: false }).mirror, true);
    assert.equal(T.rigLook(T.rigQuery("?mirror=true"), {}).mirror, true);
    assert.equal(T.rigLook(T.rigQuery("?mirror=0"), { mirror: true }).mirror, false);
    assert.equal(T.rigLook(T.rigQuery(""), { mirror: true }).mirror, true);
    assert.equal(T.rigLook(T.rigQuery("?rot=180"), {}).rot, 180);
    assert.equal(T.rigLook(T.rigQuery("?rot=90"), { rot: 180 }).rot, 90);
    assert.equal(T.rigLook(T.rigQuery("?rot=45"), {}).rot, 0);
    assert.equal(T.rigLook(T.rigQuery(""), { rot: 270 }).rot, 270);
    assert.equal(T.rigTransform({ mirror: true, flipV: false, rot: 0 }), "scaleX(-1)");
    assert.equal(T.rigTransform({ mirror: true, flipV: true, rot: 0 }), "scale(-1, -1)");
    assert.equal(T.rigTransform({ mirror: true, flipV: false, rot: 180 }), "rotate(180deg) scaleX(-1)");
    assert.deepEqual([0, 90, 180, 270].map((n) => T.nextRot(n)), [90, 180, 270, 0]);
  });

  test("Mirror and Turn are not the two film buttons", () => {
    assert.match(HTML, /id="b-mirror"/);
    assert.match(HTML, /id="b-turn"/);
    assert.match(HTML, /id="b-remote"/);
    assert.match(HTML, /teleprompter-remote\.html/);
    const controlsAt = HTML.indexOf('<div id="controls">');
    const controls = HTML.slice(controlsAt, HTML.indexOf("</div>", controlsAt));
    assert.match(controls, /id="b-rec"/);
    assert.match(controls, /id="play"/);
    assert.doesNotMatch(controls, /id="b-mirror"/);
    assert.doesNotMatch(controls, /id="b-turn"/);
    assert.doesNotMatch(controls, /id="b-stop"/);
    assert.match(SRC, /flip\.style\.transform = S\.rot \? rigTransform/);
    assert.match(SRC, /rigQ\.mirror != null \|\| rigQ\.rot != null\) save\(\)/);
    assert.match(HTML, /id="flip"/);
  });
});

describe("pocket remote", () => {
  const R = load("teleprompter-remote.js").FundhubTeleprompterRemote;

  test("play, pause, and a script save use the same shoot key and the edit route", () => {
    assert.equal(R.filmKeyFrom("?k=abc.def"), "abc.def");
    assert.equal(R.filmKeyFrom(""), "");
    assert.equal(R.filmPageHref("abc", true), "/app/teleprompter.html?k=abc&mirror=1");
    assert.equal(R.firstScriptIndex([{ got_it: true }, { got_it: false }]), 1);
    const rolling = R.stepPlay({ playing: true, t: 0, words: 2 }, 0.5, 60);
    assert.equal(rolling.playing, true);
    assert.equal(rolling.t, 0.5);
    const held = R.stepPlay({ playing: false, t: 0.5, words: 2 }, 5, 60);
    assert.equal(held.playing, false);
    assert.equal(held.t, 0.5);
    const done = R.stepPlay({ playing: true, t: 1.9, words: 2 }, 0.2, 60);
    assert.equal(done.playing, false);
    assert.equal(R.wordAtTime(0.5, 60, 2), 0);
    const body = R.editPayload({ id: "11111111-1111-4111-8111-111111111111", version: 3 }, "New line.\n", "req-1");
    assert.equal(JSON.stringify(body), JSON.stringify({
      request_id: "req-1",
      id: "11111111-1111-4111-8111-111111111111",
      version: 3,
      body: "New line.\n"
    }));
    assert.equal("parts" in body, false);
    assert.match(REMOTE_SRC, /x-shoot-film/);
    assert.match(REMOTE_SRC, /marketing\/scripts\/edit/);
    assert.match(REMOTE_SRC, /marketing\/shoot\?wpm=/);
    assert.match(REMOTE_HTML, /The recording phone still cannot pause the iPad or change the words\./);
    assert.match(REMOTE_HTML, /id="remote-play"/);
    assert.match(REMOTE_HTML, /id="remote-save"/);
    assert.doesNotMatch(REMOTE_HTML, /login\.html/);
    assert.doesNotMatch(REMOTE_HTML, /shell\.js/);
    assert.doesNotMatch(REMOTE_SRC, /twilio|messages\/send|sms/i);
    assert.doesNotMatch(REMOTE_HTML + REMOTE_SRC, /FundHub/);
  });
});

describe("a phone never keeps a stray turn (owner call 2026-10-10)", () => {
  test("a saved turn is dropped on a phone, kept on a tablet, and a link's ?rot= still wins", () => {
    const T = load("teleprompter.js").FundhubTeleprompter;
    assert.equal(T.turnFor(90, true, false), 0);
    assert.equal(T.turnFor(270, true, false), 0);
    assert.equal(T.turnFor(90, true, true), 90);
    assert.equal(T.turnFor(90, false, false), 90);
    assert.equal(T.turnFor(0, true, false), 0);
  });
});
