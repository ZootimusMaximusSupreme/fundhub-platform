// The "Lender packet" card on the funding-papers screen (Finance OS unit I3).
// Runs money-vault.js's own render functions in Node against the vault answer
// the REAL engine builds for the sample person, with `packets` from the REAL
// packet builder (src/finance/lender-packet.mjs) — so the card reads exactly what
// GET /api/money/vault answers. Checks: a row per packet, what is missing in
// plain words, the download button only when a file can go in, the one filled
// button on the screen, the four states, and the words after a download.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { packetsFromVault } from "../finance/lender-packet.mjs";
import { sampleVault, BUSINESS } from "./fixtures/money-vault.sample.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const JS = fs.readFileSync(path.join(APP, "money-vault.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "money-vault.css"), "utf8");

const sandbox = { window: {} };
vm.runInNewContext(JS, sandbox);
const F = sandbox.window.FHMoneyVault;

const SNAPSHOT = { id: "dddd0000-0000-4000-8000-000000000001", subtype: "funding_snapshot", title: "Funding Snapshot" };
const ANALYSIS = { id: "dddd0000-0000-4000-8000-000000000002", subtype: "credit_analysis_report", title: "Credit Analysis Report" };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const primaries = (html) => (html.match(/class="vt-btn-primary[ "]/g) || []).length;
function withPackets(variant, audience, papers) {
  const v = sampleVault({ variant, audience });
  v.packets = JSON.parse(JSON.stringify(packetsFromVault(v, { fundhubPapers: papers })));
  return v;
}
function card(html) {
  const start = html.indexOf('class="card vt-packet"');
  assert.ok(start > 0, "no packet card");
  return html.slice(start, html.indexOf("</section>", start));
}

test("the card: one row per packet, each with what is ready and a download button", () => {
  const html = F.render(withPackets("full", "client", [SNAPSHOT]), { staff: false });
  const c = card(html);
  const t = text(c);
  assert.match(t, /Lender packet/);
  assert.match(t, /One PDF of every paper that is ready\. Send it to the lender\./);
  assert.match(t, /Personal 3 of 5 papers ready · 4 files in the PDF/);
  assert.match(t, /Fundhub LLC Business 2 of 7 papers ready · 3 files in the PDF/);
  assert.deepEqual([...c.matchAll(/data-act="packet" data-packet="([^"]+)"/g)].map((m) => m[1]), ["personal", BUSINESS.id]);
  // The card sits right under the progress card, before the paper groups.
  assert.ok(html.indexOf("vt-progress") < html.indexOf("vt-packet") && html.indexOf("vt-packet") < html.indexOf("vt-groups"));
});

test("what is missing, in the client's words and in staff's words", () => {
  const client = text(card(F.render(withPackets("full", "client", [SNAPSHOT]), { staff: false })));
  assert.match(client, /Personal tax returns, last 2 years — 1 of 2 years ready/);
  assert.match(client, /Credit summary — not on file yet/);
  assert.match(client, /Business bank statements, last 3 months — sent, we're checking it/);
  assert.match(client, /Certificate of Good Standing — too old, send a newer one/);
  assert.match(client, /Business tax returns, last 2 years — not sent yet/);
  const staff = text(card(F.render(withPackets("full", "staff", [SNAPSHOT]), { staff: true })));
  assert.match(staff, /EIN confirmation letter — needs your review/);
  assert.match(staff, /Business tax returns, last 2 years — the client has not sent it/);
  assert.match(staff, /One PDF of this client's ready papers\./);
});

test("the caption never promises a paper the list says is missing (Codex CX9)", () => {
  // The sample's credit summary is not on file, and the list says so.
  for (const staff of [false, true]) {
    const t = text(card(F.render(withPackets("full", staff ? "staff" : "client", [SNAPSHOT]), { staff })));
    assert.match(t, /Credit summary — /, "the list says the credit summary is missing");
    assert.doesNotMatch(t, /plus (your|the) funding letter|funding letter and credit summary/, "so the caption does not say the PDF has it");
  }
});

test("one filled button on the screen: the packet is filled only when nothing else is the next step", () => {
  const busy = F.render(withPackets("full", "client", [SNAPSHOT]), { staff: false });
  assert.equal(primaries(busy), 1);
  assert.doesNotMatch(card(busy), /vt-btn-primary/, "an upload is the client's next step, so the packet stays outline");
  const done = F.render(withPackets("complete", "client", [SNAPSHOT, ANALYSIS]), { staff: false });
  assert.equal(primaries(done), 1);
  assert.match(card(done), /class="vt-btn-primary" data-act="packet" data-packet="personal"/);
  assert.match(text(card(done)), /Every paper is ready\./);
});

test("no file to put in: no button, a plain sentence instead", () => {
  const html = F.render(withPackets("empty", "client", []), { staff: false });
  const c = card(html);
  assert.doesNotMatch(c, /data-act="packet"/);
  assert.match(text(c), /Nothing is ready to put in it yet\./);
});

test("the other states: no packets in the read means no card; a failed check says so with no button", () => {
  const plain = sampleVault({ variant: "full" });
  assert.doesNotMatch(F.render(plain, { staff: false }), /vt-packet/);
  const failed = { ...plain, packets: null, packets_error: "could_not_check" };
  const c = card(F.render(failed, { staff: false }));
  assert.match(text(c), /We could not check the lender packet just now/);
  assert.doesNotMatch(c, /data-act="packet"/);
  assert.match(F.renderLoading(false), /aria-busy="true"/);
  assert.match(F.renderError("server", false), /role="alert"/);
});

test("after a download: plain words, naming any file that did not fit", () => {
  const v = withPackets("full", "client", [SNAPSHOT]);
  const personal = v.packets[0];
  assert.equal(F.packetSaved(personal, []), "Saved your lender packet.");
  assert.equal(
    F.packetSaved(personal, [{ id: personal.papers[1].files[0].id, reason: "too_big" }]),
    "Saved your lender packet. Not in it: aps-bill-september.pdf (too big to add). Send that one on its own."
  );
  assert.match(F.packetSaved(personal, [{ id: "x", reason: "could_not_open" }, { id: "y", reason: "not_supported" }]),
    /one file \(could not be opened\), one file \(is not a PDF or photo\)\. Send those on their own\./);
  assert.equal(F.packetProblem({ status: 409, body: { error: "nothing_ready" } }), "Nothing is ready to put in the packet yet.");
  assert.equal(F.packetProblem({ status: 404, body: {} }), "We could not find that packet. Reload the page and try again.");
  assert.match(F.packetProblem({ status: 0 }), /could not reach the server/);
  assert.equal(F.dispositionName('attachment; filename="lender-packet-personal-2026-10-07.pdf"'), "lender-packet-personal-2026-10-07.pdf");
  assert.equal(F.dispositionName('attachment; filename="../evil name.pdf"'), "lender-packet.pdf");
  assert.deepEqual(F.parseLeftOut("not json"), []);
});

test("the card's styles are scoped, use no pixel font sizes, and stack on a phone", () => {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "");
  const rules = bare.split("}").filter((r) => /vt-pk|vt-packet/.test(r));
  assert.ok(rules.length >= 8);
  for (const r of rules) {
    const sel = r.split("{")[0].trim();
    assert.ok(sel.split(",").every((s) => s.trim().startsWith(".fh-vault")), sel);
    assert.doesNotMatch(r, /font-size/);
  }
  assert.match(CSS, /@media \(max-width:760px\)\{[\s\S]*\.fh-vault \.vt-pk\{grid-template-columns:minmax\(0,1fr\)\}/);
});
