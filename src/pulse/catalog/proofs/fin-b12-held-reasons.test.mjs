// Batch 12, generation 2: exact browser proofs for the repaired Documents status filter and Galaxy legend
// and hand-off threads. Fake /api answers have the same shape as saved rows; nothing reads live data.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OWNER, startScreens } from "./s4-screen-harness.mjs";
import { proofRows } from "./fin-b12-kit.mjs";

const proof = proofRows(import.meta.url);

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

// Every offered option has a saved state that can fill it.
const EXPECTED = [
  ["", "Any status", DOCUMENTS.map((d) => d.title)],
  ["del-pending", "Not delivered", ["Never sent", "Queued to send"]],
  ["del-bounced", "Bounced", ["Send bounced", "Send failed"]],
  ["sig-pending", "Awaiting signature", ["Waiting on signer"]],
  ["sig-expired", "Signature expired", ["Signing window over"]],
];

test("documents status filter: every offered status lists exactly its saved rows", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Status filter select/, async () => {
    const handlers = {
      "/api/read/documents": { ok: true, count: DOCUMENTS.length, limit: 200, offset: 0, hasMore: false, items: DOCUMENTS },
      "/api/read/contracts": { ok: true, items: [] },
    };
    const { page, errors } = await open("/app/documents.html", { session: OWNER, handlers });
    await page.waitForFunction((n) => document.querySelectorAll("#body tr td:first-child").length === n, DOCUMENTS.length);
    const titles = () => page.locator("#body tr td:first-child > div:first-child").allTextContents();

    const options = await page.locator("#statusFilter option").evaluateAll((els) => els.map((el) => [el.value, el.textContent.trim()]));
    assert.deepEqual(options, EXPECTED.map(([value, label]) => [value, label]));

    for (const [value, label, want] of EXPECTED) {
      await page.locator("#statusFilter").selectOption(value);
      await page.waitForFunction((n) => document.querySelectorAll("#body tr td:first-child > div:first-child").length === n, want.length);
      assert.deepEqual((await titles()).sort(), [...want].sort(), `${label}: lists exactly its documents`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("documents status filter: removed generation options have no saved database state", () => {
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

async function openSky(open, answer = FEED) {
  const opened = await open("/app/galaxy.html", {
    session: OWNER, clock: true, init: SKY_SPY,
    handlers: { "/api/read/company-activity": answer },
  });
  await opened.page.waitForFunction(() => /LIVE/.test(document.querySelector("#livePill")?.textContent || ""));
  return opened;
}

const census = (page) => page.locator("#census").innerText();
const drawnText = (page) => page.evaluate(() => [...window.__drawn.keys()]);

test("galaxy legend: size and brightness stay tied to the saved feed", { timeout: 180_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Legend strip/, async () => {
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

    // Let the animation run for two minutes. With no new feed, output and presence stay unchanged.
    await page.clock.runFor(120_000);
    const after = await panel();
    assert.deepEqual(after, first, "the animation never changes saved output");
    assert.match(await census(page), /0 working/, "off-shift workers stay idle");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("galaxy legend: pace swatches match the canvas and a saved blocked agent reaches the census", async (t) => {
  const { open } = await startScreens(t);
  const blocked = { ...FEED, nodes: [person("staff:a", "Casey Reed", "CR"), { ...person("agent:a", "Guarded Agent", "GA"), kind: "agent", state: "blocked", out: 5 }] };
  const { page } = await openSky(open, blocked);
  const swatches = await page.evaluate(() => Object.fromEntries(["n", "g", "a", "r"].map((k) => {
    const el = document.querySelector(`.legend .sw.${k}`);
    return [k, getComputedStyle(el).backgroundColor];
  })));
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
  // C = {neutral, green, amber, red} in galaxy.html's palette; read from the source so a change shows up here.
  const html = fs.readFileSync(path.join(ROOT, "public/app/galaxy.html"), "utf8");
  const palette = Object.fromEntries(["neutral", "green", "amber", "red"].map((k) => [k, html.match(new RegExp(`${k}:'(#[0-9A-Fa-f]{6})'`))[1]]));
  assert.deepEqual(swatches, { n: rgb(palette.neutral), g: rgb(palette.green), a: rgb(palette.amber), r: rgb(palette.red) });

  assert.match(await census(page), /1 blocked/, "the blocked state from the feed reaches the legend census");
  // The feed's own builder derives output from saved agent_runs and blocked state from the shadow log.
  const feed = fs.readFileSync(path.join(ROOT, "src/galaxy/company-activity.mjs"), "utf8");
  assert.match(feed, /const out = Number\(row\.runs_today \|\| 0\);/);
  assert.match(feed, /const state = blocked \? "blocked" : \(recent \? "active" : "idle"\);/);
  assert.match(feed, /FROM agent_shadow_log l/);
  assert.match(feed, /l\.reason IN \('guardrail_halt', 'guardrail_block'\)/);
  assert.doesNotMatch(feed, /const out = Number\(row\.sort_order/);
  await page.close();
});

test("galaxy rails: no saved route draws no thread, and one saved route keeps its exact label", { timeout: 180_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Rail pulses/, async () => {
    const empty = await openSky(open);
    assert.deepEqual(FEED.routes, [], "the feed carries no hand-off route");
    await empty.page.clock.runFor(120_000);
    const without = await drawnText(empty.page);
    assert.equal(without.some((s) => s.includes("handoff —") || s.includes("  →  ")), false,
      "no route means no invented thread");
    await empty.page.close();

    const exactFeed = { ...FEED, routes: [["staff:a", "staff:b", "handoff — Dana Whitfield"]] };
    const exact = await openSky(open, exactFeed);
    let names = [];
    for (let step = 0; step < 8; step += 1) {
      await exact.page.clock.runFor(1000);
      names = await drawnText(exact.page);
      if (names.includes("handoff — Dana Whitfield")) break;
    }
    assert.ok(names.includes("handoff — Dana Whitfield"), "the saved route label is drawn exactly");
    assert.ok(names.includes("Casey Reed  →  Jordan Lee"), "the saved route endpoints are used");
    assert.deepEqual(exact.errors, []);
    await exact.page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
