import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { FULL, SAMPLE, NONE, REPAIR, HOLD } from "../../e2e/fixtures/present-blueprint-demo-ctx.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = fs.readFileSync(path.join(ROOT, "public/app/present-proof-wall.js"), "utf8");
const DECK = JSON.parse(fs.readFileSync(path.join(ROOT, "marketing/landing-pages/slo/client-wins/deck.json"), "utf8"));
const IDS = ["u-6500-discover", "d-24k-navy", "d-70k-loc"];

function load() {
  const styles = [];
  const clicks = [];
  const document = {
    head: { appendChild(el) { styles.push(el); } },
    createElement(tag) { return { tagName: tag, id: "", textContent: "" }; },
    getElementById(id) { return styles.find((el) => el.id === id) || null; },
    addEventListener(type, fn) { if (type === "click") clicks.push(fn); }
  };
  const window = { document };
  window.window = window;
  runInContext(SCRIPT, createContext({ window, document, console }));
  return { V: window.FHDeckVisuals, styles, clicks };
}
function ids(html) { return [...html.matchAll(/data-proof-id="([^"]+)"/g)].map((m) => m[1]); }
function words(html) { return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); }
function tap(env, fixture, index) {
  const host = {
    innerHTML: "",
    getAttribute(name) { return name === "data-client" ? fixture.clientId : null; }
  };
  const btn = {
    getAttribute(name) { return name === "data-fhv-proof-act" ? "show:" + index : null; },
    closest(selector) { return selector === "[data-fhv-proof-act]" ? this : selector === '[data-fhv="proof-wall"]' ? host : null; }
  };
  env.clicks[0]({ target: btn, preventDefault() {} });
  return host.innerHTML;
}

test("every proof card is backed by a verified, PII-blurred source crop", () => {
  const env = load();
  const sources = env.V._proofWall.sources;
  assert.deepEqual(Array.from(sources, (s) => s.id), IDS);
  for (const source of sources) {
    const card = DECK.cards.find((c) => c.id === source.id);
    assert.ok(card && card.kind === "win", source.id);
    assert.match(card.verified, /PII blurred/);
    assert.equal(source.amount, card.amount_dollars);
    assert.equal(source.alt, card.alt);
    const sourceCrop = path.join(ROOT, card.crop);
    const publicCrop = path.join(ROOT, "public", source.src.replace(/^\//, ""));
    assert.ok(fs.statSync(sourceCrop).size > 0, source.id + " crop exists");
    assert.deepEqual(fs.readFileSync(publicCrop), fs.readFileSync(sourceCrop), source.id + " uses the verified crop unchanged");
  }
});

describe("P-01 proof wall", () => {
  for (const fixture of [FULL, SAMPLE, NONE, REPAIR, HOLD]) {
    test(`${fixture.clientId}: uses source approvals and keeps the right state`, () => {
      const env = load();
      const html = env.V.proofWall(structuredClone(fixture));
      assert.match(html, /^<div class="fhv-proof-wall fh-astra-workspace" data-fhv="proof-wall"/);
      assert.equal((html.match(/data-layout="win" data-photo="off" data-name="off" data-amount="on"/g) || []).length, 3);
      assert.equal((html.match(/data-slot="approval-screenshot"/g) || []).length, 3);
      assert.equal((html.match(/data-slot="dollar-amount"/g) || []).length, 3);
      assert.equal((html.match(/data-fhv-proof-act="show:/g) || []).length, 3);
      assert.match(words(html), /Their results came from their files\. Each lender decides your application\./);
      assert.doesNotMatch(words(html), /Client Name|Client quote|testimonial/i);
      assert.deepEqual([...ids(html)].sort(), [...IDS].sort());
      assert.equal(env.styles.length, 1);
      assert.equal(env.clicks.length, 1);
      if (fixture.sample) assert.match(html, /Sample file/);
      else assert.doesNotMatch(html, /Sample file/);
      assert.deepEqual(ids(html), IDS, "other clients stay in fixed source order");
      const selected = tap(env, fixture, 2);
      assert.match(selected, /data-fhv-proof-act="show:2" aria-pressed="true"/);
      assert.equal((selected.match(/is-active/g) || []).length, 1);
      assert.deepEqual(ids(selected), ids(html), "a tap keeps the proof order");
      assert.equal(env.V.proofWall(structuredClone(fixture)).match(/is-active/g).length, 1, "selection survives a deck re-render");
    });
  }
});
