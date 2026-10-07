// The Declines block on the client control panel (#bp-group → #bp-declines) —
// runs ccp-declines.js's own render functions against the staff view the REAL
// store builds from the sample decline (the Blueprint sim client, see
// src/blueprint/decline-defense.test.db.mjs), with the Chase rows of the real lender
// book file (docs/legacy-strong/lenders-legacy-strong.csv).
//
// Checks: every worded plan line shows its source; a blank says it is a blank
// and gives a box to write it; lender-book lines only for the roles that may
// read the book; the letter's own words; the four states; the outcome control;
// the panel carries one container, one stylesheet and one script tag; scoped
// styles with no px font size and no hand-rolled shadow.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { recordDecline, readDeclines } from "../blueprint/decline-defense.mjs";
import { memoryDb, SIM_CLIENT, SIM_APPLICATIONS, SIM_SAMPLE_LETTER } from "../blueprint/decline-defense.test.db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const APP = path.join(ROOT, "public/app");
const PANEL = fs.readFileSync(path.join(APP, "client-control-panel.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "ccp-declines.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "ccp-declines.css"), "utf8");

/* The real lender book file, parsed with a small CSV reader (quoted fields). */
function parseCsv(raw) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quoted) {
      if (ch === '"' && raw[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] || null])));
}
const BOOK = parseCsv(fs.readFileSync(path.join(ROOT, "docs/legacy-strong/lenders-legacy-strong.csv"), "utf8"))
  .filter((r) => /^chase( bank)?$/i.test(r.name))
  .map((r, i) => ({ ...r, id: `b0000000-0000-4000-8000-00000000000${i + 1}` }));

async function staffView({ canSeeBook = true, eligible = true } = {}) {
  const db = memoryDb({ client: SIM_CLIENT, applications: SIM_APPLICATIONS, lenders: BOOK, buyer: true });
  await recordDecline(db, { orgId: SIM_CLIENT.org_id, clientId: SIM_CLIENT.id, by: { kind: "client" }, source: "client_paste",
    input: { application_id: SIM_APPLICATIONS[0].id, text: SIM_SAMPLE_LETTER } });
  const out = await readDeclines(db, { orgId: SIM_CLIENT.org_id, clientId: SIM_CLIENT.id, viewer: { kind: "staff", canSeeBook } });
  return { ...out.staff, eligible };
}

const sandbox = { window: {} };
vm.runInNewContext(JS, sandbox);
const F = sandbox.window.FHCcpDeclines;
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

test("the panel carries one container, one stylesheet and one script tag — the logic lives in its own file", () => {
  assert.match(PANEL, /<div class="bp-sec" id="bp-declines">\s*<div class="cp-sec-title card-title">Declines<\/div>\s*<div id="bp-declines-root" aria-live="polite">/);
  assert.equal((PANEL.match(/<link rel="stylesheet" href="ccp-declines\.css">/g) || []).length, 1);
  assert.equal((PANEL.match(/<script defer src="ccp-declines\.js"><\/script>/g) || []).length, 1);
  const group = PANEL.slice(PANEL.indexOf('id="bp-group"'), PANEL.indexOf('id="bp-declines-root"'));
  assert.ok(group.includes('id="bp-body"'), "the Declines block sits inside the Capital Blueprint group");
  assert.match(JS, /"\/api\/blueprint\/declines"/);
  assert.match(JS, /"\/api\/documents-upload"/);
  assert.match(JS, /"decline_letter"/);
});

test("styles: all under #bp-declines, no px font size, no hand-rolled shadow, 8px spacing", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = css.split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
  for (const sel of selectors) for (const part of sel.split(",")) assert.match(part.trim(), /^#bp-declines(\s|$)/, part);
  assert.doesNotMatch(CSS, /font-size|box-shadow/);
  assert.doesNotMatch(JS, /font-size/);
  for (const m of css.matchAll(/(?:^|[;{])\s*(gap|padding(?:-\w+)?|margin(?:-\w+)?)\s*:\s*([^;}]+)/g)) {
    for (const px of m[2].match(/-?\d+px/g) || []) assert.ok([0, 8, 16, 24, 32, 48, 64].includes(Math.abs(parseInt(px, 10))), `${m[1]}:${m[2]}`);
  }
});

test("full: reasons with the letter's words and their sources; every worded step shows its source", async () => {
  const s = await staffView();
  const html = F.render(s);
  const t = text(html);
  assert.match(t, /1 decline on this file · 1 open/);
  assert.match(t, /Chase · Ink Business Cash/);
  assert.match(t, /Too many recent credit checks Letter: “Too many inquiries in the last 12 months” Source: vendor\/underwriteiq-crs\/sandbox\/exp\.json bureau score factor 8 \(Fundhub repo\)/);
  assert.match(t, /Needs a person to read\. Part of the letter did not match a reason we know/);
  const bankLine = t.slice(t.indexOf("Bank line"), t.indexOf("Plan Agent steps"));
  assert.match(bankLine, /Letter: 800-453-9719/);
  assert.doesNotMatch(bankLine, /888-397-3742/, "the credit bureau's line is not the bank's");
  assert.match(t, /Source: Notion page: Preparing Funding Plan — Track, Update \+ Owner call: ops\/workflows\/blueprint-launch-2026-10-06\.md/,
    "a line citing two kinds names each one");
  const d = s.declines[0];
  for (const st of d.steps.filter((x) => !x.blank)) {
    assert.ok(html.includes(`Source: ${st.source_ref.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")}`), `${st.key} shows no source`);
  }
  assert.match(t, /Calling DENIED — Step 3 \+ Application Tips — Handling Denials \(Notion playbook page\)/);
  assert.match(t, /Agent steps sit on the ops task until the money agent takes them/);
});

test("a blank says it is a blank and gives a box to write it — never made-up words", async () => {
  const s = await staffView();
  const html = F.render(s);
  const blank = s.declines[0].steps.find((x) => x.blank);
  assert.ok(blank, "the inquiries reason has no sourced talking point, so its line is a blank");
  assert.match(html, /Blank — no source covers this\./);
  assert.match(html, new RegExp(`data-fill="${blank.key}"`));
  assert.match(html, new RegExp(`data-act="step" data-step="${blank.key}" data-status="done">Save and mark done`));
});

test("lender-book lines only for the roles that may read the book", async () => {
  const advisor = F.render(await staffView({ canSeeBook: true }));
  const closer = F.render(await staffView({ canSeeBook: false }));
  assert.match(text(advisor), /From the lender book/);
  assert.match(text(advisor), /Relationship Manager/i, "a Chase book tip about the RM reaches the advisor");
  assert.doesNotMatch(text(advisor), /net worth|monthly spend/i, "income and spend tips are left out for everyone");
  assert.doesNotMatch(text(closer), /From the lender book/);
  assert.match(text(closer), /Lender-book lines are for the funding advisor/);
  assert.match(text(advisor), /A relationship manager is on file for this bank/);
});

test("timing, call date, outcome and the next funding sequence note", async () => {
  const s = await staffView();
  const html = F.render(s);
  const t = text(html);
  assert.match(t, /If they will not reconsider, call again — at least 4 times/);
  assert.match(t, /If you would like us to reconsider, please call 1-800-453-9719 within 30 days\. Source: the bank's letter \(pasted\)/);
  assert.match(t, /No call date set\. Staff pick it — nothing here picks a day/);
  for (const o of ["open", "approved_on_recon", "still_declined", "reapply_later"]) assert.match(html, new RegExp(`<option value="${o}"`));
  assert.match(t, /Approved amount \(optional — blank means not told yet\)/);
  const later = F.renderDecline({ ...s.declines[0], outcome: "reapply_later", outcome_words: "Re-apply later", reapply_on: "2027-01-15", next_sequence_note: "Chase · Ink Business Cash: re-apply on or after Jan 15, 2027." }, { open: true });
  assert.match(text(later), /Note for the next funding sequence: Chase · Ink Business Cash: re-apply on or after Jan 15, 2027\. It does not set that date\./);
});

test("the record form: applications without a decline, bureau boxes, and bank emails to start from", async () => {
  const s = await staffView();
  s.bank_emails = [{ id: "e1", subject: "About your application", preview: "Unfortunately we cannot approve <b>this</b>" }];
  const form = F.renderForm(s);
  assert.match(form, /American Express · Blue Business Plus — Applied/);
  assert.doesNotMatch(form, /value="c0000000-0000-4000-8000-000000000001"/, "Chase already has its decline");
  for (const b of ["experian", "equifax", "transunion"]) assert.match(form, new RegExp(`data-bureau="${b}"`));
  assert.match(form, /data-act="use-email" data-email="0">Use this email/);
  assert.doesNotMatch(form, /<b>this<\/b>/, "an email preview is escaped");
});

test("empty: no declines yet — says so, and the record form is open", () => {
  const html = F.render({ eligible: true, declines: [], applications: [], bank_emails: [], next_sequence_notes: [] });
  assert.match(text(html), /No declines on this file/);
  assert.match(html, /<details class="more dec-new" id="bp-dec-new" open>/);
});

test("not a Blueprint buyer: no record form, and the block says why", () => {
  const html = F.render({ eligible: false, declines: [], applications: [], bank_emails: [] });
  assert.doesNotMatch(html, /bp-dec-new|data-act="record"/);
  assert.match(text(html), /has not paid for the Capital Blueprint/);
});

test("loading, error and no client: words, never a blank box", () => {
  assert.match(F.renderLoading(), /aria-busy="true">Loading declines/);
  const err = F.renderError("The database is not reachable right now.");
  assert.match(err, /role="alert"/);
  assert.match(err, /data-act="retry">Try again</);
  assert.match(F.renderNoClient(), /Open a client file first/);
  assert.equal(F.problem({ status: 403, body: { error: "not_blueprint_buyer" } }), "This client has not paid for the Capital Blueprint, so this is not available for them.");
  assert.equal(F.problem({ status: 0, body: null, transport: true }), "Could not reach the server. Check your connection and try again.");
});

test("the letter text is shown escaped", async () => {
  const s = await staffView();
  const html = F.renderDecline({ ...s.declines[0], letter_text: "<img src=x onerror=alert(1)>" });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
