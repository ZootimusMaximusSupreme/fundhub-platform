// /app/money-helper.html — the lessons on the helper screen (Finance OS wave 4, unit ED):
// the "Learn the basics" topic buttons, the "From: <doc>." line under a lesson answer, and the
// fixed official-site button. Runs money-helper.js's own render functions in Node, against the
// same role-play thread the screen's other tests use (fixtures/money-helper.sample.json).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { LEARN_TOPICS, topicByKey, topicGuidance, topicReply } from "../finance/money-education.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const JS = fs.readFileSync(path.join(APP, "money-helper.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "money-helper.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-helper.sample.json"), "utf8"));
const NOW = Date.parse("2026-10-07T16:56:00.000Z");

const sandbox = { window: {} };
vm.runInNewContext(JS, sandbox);
const H = sandbox.window.FHMoneyHelper;
const fixture = () => JSON.parse(JSON.stringify(FIXTURE));
const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const plain = (x) => JSON.parse(JSON.stringify(x));
const lessonTurn = (question) => ({
  id: "t9", kind: "message", actor: "client", input: question, task_id: null, status: "answered",
  reply: topicReply(topicGuidance(question)), actions: [], brain: "rules", model: null,
  reason_words: "Answered by the rules helper: the AI helper's computer is off right now.",
  created_at: "2026-10-07T16:55:00.000Z", answered_at: "2026-10-07T16:55:01.000Z"
});

describe("the lessons the screen offers", () => {
  test("the topic buttons are the server's own list, word for word", () => {
    assert.deepEqual(plain(H.LEARN), plain(LEARN_TOPICS));
  });

  test("the one official-site button is the ChexSystems lesson's own address", () => {
    const link = topicByKey("chexsystems").link;
    assert.deepEqual(plain(H.OFFICIAL), [{ text: link.text, label: link.label, url: link.url }]);
  });

  test("Learn the basics: seven buttons above the box to type in, each sending its own question", () => {
    const html = H.render(fixture(), { now: NOW });
    const buttons = [...html.matchAll(/<button type="button" class="btn" data-act="learn" data-text="([^"]+)">([^<]+)<\/button>/g)];
    assert.deepEqual(buttons.map((m) => [m[1], m[2]]), LEARN_TOPICS.map((t) => [esc(t.ask), esc(t.title)]));
    assert.ok(html.indexOf('class="learn"') < html.indexOf('class="composer"'), "the lessons sit above the box to type in");
    assert.match(html, /<p class="caption learn-t">Learn the basics<\/p>/);
    assert.equal((html.match(/class="btn-primary"/g) || []).length, 1, "Send is still the one primary button");
    const empty = fixture();
    empty.turns = [];
    const first = H.render(empty, { now: NOW });
    assert.equal((first.match(/data-act="suggest"/g) || []).length, 3, "the three ways to start are unchanged");
    assert.equal((first.match(/data-act="learn"/g) || []).length, 7);
  });

  test("no lesson buttons where nothing can be sent: the helper stopped or switched off", () => {
    const stopped = fixture();
    stopped.helper.halted = true;
    assert.doesNotMatch(H.render(stopped, { now: NOW }), /data-act="learn"/);
    const off = fixture();
    off.helper.on = false;
    assert.doesNotMatch(H.render(off, { now: NOW }), /data-act="learn"/);
  });

  test("while a message is sending, the lesson buttons wait too", () => {
    const html = H.render(fixture(), { now: NOW, sending: true });
    assert.equal((html.match(/data-act="learn"[^>]* disabled>/g) || []).length, 7);
  });
});

describe("a lesson answer on the screen", () => {
  test("the lesson's words, then 'From: <doc>.' on its own small line, and one fixed button to chexsystems.com", () => {
    const html = H.renderTurn(lessonTurn("What is ChexSystems?"), NOW);
    assert.ok(html.includes(`<div class="bubble">${esc(topicByKey("chexsystems").answer)}\n<span class="caption cite">From: Blueprint lessons.</span></div>`));
    assert.ok(html.includes('<div class="links"><a class="btn" href="https://www.chexsystems.com" target="_blank" rel="noopener noreferrer">Open chexsystems.com</a></div>'));
    assert.match(html, /Rules<\/span> · <span class="why">Answered by the rules helper/);
  });

  test("two lessons: each doc on its own line", () => {
    const html = H.renderTurn(lessonTurn("What are inquiries and what is seasoning?"), NOW);
    assert.equal((html.match(/<span class="caption cite">From: /g) || []).length, 2);
    assert.doesNotMatch(html, /class="links"/, "no official site named, so no button");
  });

  test("an AI answer that ends its last line with the doc gets the same small line", () => {
    assert.equal(H.replyHtml("Pay before the statement closes. From: Card Paydown lesson."),
      'Pay before the statement closes.\n<span class="caption cite">From: Card Paydown lesson.</span>');
  });

  test("every other answer is drawn exactly as before, with no button", () => {
    for (const t of FIXTURE.turns) {
      assert.equal(H.replyHtml(t.reply), esc(t.reply), t.id);
      assert.equal(H.officialLinks(t.reply), "", t.id);
    }
    assert.equal(H.replyHtml(null), "");
  });

  test("a reply never becomes a link: its words stay text, and the button's address is always the fixed one", () => {
    const sly = 'Go to chexsystems.com.evil.example/<script>alert(1)</script> now';
    const html = H.replyHtml(sly);
    assert.doesNotMatch(html, /<a |<script/);
    assert.ok(html.includes("&lt;script&gt;"));
    const links = H.officialLinks(sly);
    assert.deepEqual([...links.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ["https://www.chexsystems.com"]);
  });
});

describe("styles for the lessons", () => {
  test("the topic buttons wrap and stay full size; the doc line is a caption; every control is at least 44px tall", () => {
    assert.match(CSS, /\.fh-helper \.learn-topics\{display:flex;flex-wrap:wrap;gap:8px;min-width:0\}/);
    assert.match(CSS, /\.fh-helper \.btn-primary,\.fh-helper \.btn\{min-height:44px;/);
    assert.match(CSS, /\.fh-helper \.btn-text\{min-height:44px;/);
    assert.match(CSS, /\.fh-helper \.cite\{color:var\(--text-dim\)\}/);
  });
});
