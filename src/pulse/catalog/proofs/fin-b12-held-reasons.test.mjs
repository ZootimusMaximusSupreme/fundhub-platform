// Batch 12, generation 2: the three rows that stay not attachable, held by what the REAL page does.
//
// fin-b12-rows.test.mjs holds each reason to the page source with patterns. This file holds it to the
// behaviour: the real page in Chromium, fake /api answers shaped exactly like the saved rows, and a
// judgement of what the page paints. A held reason is a finding, not a proof: each test below is GREEN
// while the product is wrong and goes RED the day the product is fixed, which is the signal to attach
// the row for real. Nothing here reads live data, and none of it is called proof.
//
//   documents.html Status filter select   two of its six options can never list a saved document
//   galaxy.html    Legend strip           size and brightness are moved on dice after the feed loads
//   galaxy.html    Rail pulses + threads  a hand-off thread names a real client that handed nothing

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OWNER, startScreens } from "./s4-screen-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DAY = 86_400_000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
const daysAhead = (n) => new Date(Date.now() + n * DAY).toISOString();

// ───────────────────────── documents.html: Status filter select ─────────────────────────

// The documents table forces generated_at on every row (NOT NULL DEFAULT now()), so a saved document
// always has one. Every row below carries it, and the delivery words are the table's own CHECK list.
const document = (id, title, over) => ({
  id, kind: "contract", subtype: "funding_agreement", title, client_name: "Dana Whitfield",
  created_at: daysAgo(6), generated_at: daysAgo(6), delivered_at: null, delivery_status: "not_delivered",
  signature_required: false, signed_at: null, expires_at: null, mime_type: "application/pdf", current_version: 1,
  ...over,
});

const DOCUMENTS = [
  document("d1", "Delivered contract", { delivery_status: "delivered", delivered_at: daysAgo(3) }),
  document("d2", "Never sent", { delivery_status: "not_delivered" }),
  document("d3", "Send bounced", { delivery_status: "bounced" }),
  document("d4", "Send failed", { delivery_status: "failed" }),
  document("d5", "Waiting on signer", { delivery_status: "sent", delivered_at: daysAgo(2), signature_required: true, expires_at: daysAhead(20) }),
  document("d6", "Signing window over", { delivery_status: "sent", delivered_at: daysAgo(9), signature_required: true, expires_at: daysAgo(1) }),
  document("d7", "Queued to send", { delivery_status: "pending" }),
];

// What each of the six options lists for those seven saved rows, in the order the page offers them.
// Not generated and Generation failed are the dead ones. The other four are the positive control: they
// show the page does filter, so an empty list for the dead two is the options and not the harness.
const EXPECTED = [
  ["", "Any status", DOCUMENTS.map((d) => d.title)],
  ["gen-pending", "Not generated", []],
  ["gen-failed", "Generation failed", []],
  ["del-pending", "Not delivered", ["Never sent", "Queued to send"]],
  ["del-bounced", "Bounced", ["Send bounced", "Send failed"]],
  ["sig-pending", "Awaiting signature", ["Waiting on signer"]],
  ["sig-expired", "Signature expired", ["Signing window over"]],
];

test("documents status filter: with real-shaped rows four options list documents and Not generated and Generation failed list nothing", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  const handlers = {
    "/api/read/documents": { ok: true, count: DOCUMENTS.length, limit: 200, offset: 0, hasMore: false, items: DOCUMENTS },
    "/api/read/contracts": { ok: true, items: [] },
  };
  const { page, errors } = await open("/app/documents.html", { session: OWNER, handlers });
  await page.waitForFunction((n) => document.querySelectorAll("#body tr td:first-child").length === n, DOCUMENTS.length);
  const titles = () => page.locator("#body tr td:first-child > div:first-child").allTextContents();

  const options = await page.locator("#statusFilter option").evaluateAll((els) => els.map((el) => [el.value, el.textContent.trim()]));
  assert.deepEqual(options, EXPECTED.map(([value, label]) => [value, label]), "the select still offers exactly these six statuses plus Any");

  for (const [value, label, want] of EXPECTED) {
    await page.locator("#statusFilter").selectOption(value);
    if (want.length) {
      await page.waitForFunction((n) => document.querySelectorAll("#body tr td:first-child > div:first-child").length === n, want.length);
      assert.deepEqual((await titles()).sort(), [...want].sort(), `${label}: lists exactly its documents`);
    } else {
      await page.waitForFunction(() => /Nothing matches that filter\./.test(document.querySelector("#body")?.innerText || ""));
      assert.deepEqual(await titles(), [], `${label}: lists nothing, whatever the saved rows say`);
    }
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test("documents status filter: the table cannot hold a document that is not generated, and has no generation failure column", () => {
  const sql = fs.readFileSync(path.join(ROOT, "db/migrations/030_documents.sql"), "utf8");
  const table = sql.slice(sql.indexOf("CREATE TABLE documents ("), sql.indexOf("CREATE TABLE documents (") + 6000);
  const tableEnd = table.indexOf("\n);");
  const documentsTable = table.slice(0, tableEnd);
  assert.match(documentsTable, /generated_at\s+timestamptz NOT NULL DEFAULT now\(\)/, "every saved document has a generated time");
  assert.doesNotMatch(documentsTable, /generation_(failed|error|status)|gen_failed|render_failed|generate_error/i, "no generation failure column");
  // No later migration relaxes that column or adds a generation failure column.
  const later = fs.readdirSync(path.join(ROOT, "db/migrations")).filter((f) => f > "030_documents.sql" && f.endsWith(".sql"));
  for (const file of later) {
    const text = fs.readFileSync(path.join(ROOT, "db/migrations", file), "utf8");
    assert.doesNotMatch(text, /ALTER TABLE (public\.)?documents[^;]*generated_at[^;]*DROP NOT NULL/i, `${file} leaves generated_at required`);
    assert.doesNotMatch(text, /ALTER TABLE (public\.)?documents[^;]*ADD COLUMN[^;]*(generation|gen)_(failed|error|status)/i, `${file} adds no generation failure column`);
  }
});

// ───────────────────────── galaxy.html: legend strip, rail pulses, hand-off threads ─────────────────────────

// Fixed dice, so a run is repeatable. Also remembers where every string was drawn on the canvas,
// because the sky is a canvas and its words are not in the page.
const SKY_SPY = `
(() => {
  let seed = 20261014;
  Math.random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const drawn = new Map();
  window.__drawn = drawn;
  const original = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
    drawn.set(String(text), [x, y]);
    return original.call(this, text, x, y, ...rest);
  };
})();
`;

// Two people off shift, exactly as src/galaxy/company-activity.mjs builds them: state idle, the team's own
// pool of lines, output = events today + calls today (1 + 1), pace = output / 8 for a closer, and routes: [].
const person = (id, name, ini) => ({
  id, c: "sales", kind: "human", name, ini, role: "Closer", state: "idle", tempo: 0.25,
  out: 2, pace: 0.25, unit: "calls", act: "Idle — no open shift",
  pool: ["On a client call", "Logging a call outcome", "Prepping the next dial", "Chasing docs"],
  shift: "—", on: "off shift",
  stats: [["Events today", "1"], ["Calls today", "1"], ["Open shift", "no"], ["State", "IDLE"]],
  files: [], tl: [["—", "No timeline yet"]], is_demo: false,
});
const FEED = {
  ok: true, simulated: false, demo_mode: false,
  nodes: [person("staff:a", "Casey Reed", "CR"), person("staff:b", "Jordan Lee", "JL")],
  kpis: [], clients: ["Dana Whitfield"], routes: [],
};

async function openSky(open) {
  const opened = await open("/app/galaxy.html", {
    session: OWNER, clock: true, init: SKY_SPY,
    handlers: { "/api/read/company-activity": FEED },
  });
  await opened.page.waitForFunction(() => /LIVE/.test(document.querySelector("#livePill")?.textContent || ""));
  return opened;
}

const census = (page) => page.locator("#census").innerText();
const drawnText = (page) => page.evaluate(() => [...window.__drawn.keys()]);

test("galaxy legend: with nothing changed in the saved feed, the sky moves size and brightness on its own", { timeout: 180_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, errors } = await openSky(open);

  // What the feed says, drawn the first second: two people, none working, output 1 + 1 each.
  await page.clock.runFor(300);
  assert.match(await census(page), /2<\/b> workers|2 workers/, "two workers");
  assert.match(await census(page), /0 working/, "the feed says nobody is working right now");

  // Zoom into the team and open Casey Reed's day, the way a person does.
  const box = await page.locator("#sky").boundingBox();
  const padX = Math.min(Math.max(box.width * 0.11, 92), 190);
  const teamX = box.x + padX + 0.165 * (box.width - 2 * padX);
  const teamY = box.y + 66 + 0.44 * (box.height - 66 - 44);
  await page.mouse.click(teamX, teamY);
  await page.clock.runFor(2500);
  const at = await page.evaluate(() => window.__drawn.get("Casey Reed"));
  assert.ok(at, "the worker's name is drawn once the team is in focus");
  await page.mouse.click(box.x + at[0], box.y + at[1]);
  await page.waitForFunction(() => document.querySelector("#panel")?.classList.contains("open"));

  const panel = async () => {
    const text = await page.locator("#panelBody").innerText();
    const number = (label) => Number((text.match(new RegExp(label + "\\s+(\\d+)")) || [])[1]);
    return { events: number("Events today"), calls: number("Calls today"), total: number("Total events") };
  };
  const first = await panel();
  assert.equal(first.events + first.calls, 2, "the saved rows add up to 2 for this person");

  // Let the sky run. Nothing in the feed changes. The figure the panel calls "Output today" must stay at 2
  // if the legend is true. It does not.
  let now = first;
  for (let step = 0; step < 40 && !(now.total > now.events + now.calls); step += 1) {
    await page.clock.runFor(3000);
    now = await panel();
  }
  assert.ok(now.total > now.events + now.calls, `Total events (${now.total}) climbs past the saved events + calls (${now.events} + ${now.calls}) with no new saved row`);

  // And brightness: both people were off shift in the feed. The sky counts them as working.
  let working = await census(page);
  for (let step = 0; step < 40 && !/[12] working/.test(working); step += 1) {
    await page.clock.runFor(3000);
    working = await census(page);
  }
  assert.match(working, /[12] working/, "a person with no open shift and no recent event is counted as working");
  assert.deepEqual(errors, []);
  await page.close();
});

test("galaxy legend: the pace swatches are the colours the canvas uses, and the feed can never send blocked", async (t) => {
  const { open } = await startScreens(t);
  const { page } = await openSky(open);
  const swatches = await page.evaluate(() => Object.fromEntries(["n", "g", "a", "r"].map((k) => {
    const el = document.querySelector(`.legend .sw.${k}`);
    return [k, getComputedStyle(el).backgroundColor];
  })));
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
  // C = {neutral, green, amber, red} in galaxy.html's palette; read from the source so a change shows up here.
  const html = fs.readFileSync(path.join(ROOT, "public/app/galaxy.html"), "utf8");
  const palette = Object.fromEntries(["neutral", "green", "amber", "red"].map((k) => [k, html.match(new RegExp(`${k}:'(#[0-9A-Fa-f]{6})'`))[1]]));
  assert.deepEqual(swatches, { n: rgb(palette.neutral), g: rgb(palette.green), a: rgb(palette.amber), r: rgb(palette.red) });

  // The feed's own builder: a person is active or idle, an agent is active or idle. Blocked is never sent.
  const feed = fs.readFileSync(path.join(ROOT, "src/galaxy/company-activity.mjs"), "utf8");
  const states = [...feed.matchAll(/\bconst state = ([^;\n]+);/g)].map((m) => m[1].trim());
  assert.deepEqual(states, ['open || recent ? "active" : "idle"', 'live ? "active" : "idle"']);
  assert.doesNotMatch(feed, /"blocked"/, "no state called blocked leaves the server");
  // And an agent's size is a constant (3 or 1 by sort order), not output.
  assert.match(feed, /const out = Number\(row\.sort_order \|\| 0\) > 0 \? 3 : 1;/);
});

test("galaxy rails: a hand-off thread names a real client that handed nothing, when the saved feed holds no route", { timeout: 180_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, errors } = await openSky(open);
  assert.deepEqual(FEED.routes, [], "the feed carries no hand-off route");
  assert.deepEqual(FEED.nodes.flatMap((n) => n.files), [], "and no worker has touched a file");

  let names = [];
  for (let step = 0; step < 40; step += 1) {
    await page.clock.runFor(3000);
    names = await drawnText(page);
    if (names.includes("handoff — Dana Whitfield")) break;
  }
  assert.ok(names.includes("handoff — Dana Whitfield"), "a thread is drawn with the real client's name on it");
  assert.ok(names.includes("Casey Reed  →  Jordan Lee"), "from one worker to the next one in the list");
  assert.deepEqual(errors, []);
  await page.close();
});
