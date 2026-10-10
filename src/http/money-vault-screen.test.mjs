// /app/money-vault.html — runs money-vault.js's own render functions against
// views built by the REAL vault engine (src/finance/document-vault.mjs, through
// src/http/fixtures/money-vault.sample.mjs) for one sample person: the FinanceOS
// test client "Test Test" and the business "Fundhub LLC", with the doc's own
// example of three bank statements (accepted, rejected, waiting) —
// docs/finance/document-vault.md. Checks the page rules: grouped Personal and
// per business, what is still missing first, the exact upload fields (subtype,
// entity_id), staff controls only for staff, the closer's "file complete" words,
// four states, one primary action, scoped styles, no px font sizes, the shared
// nav, and a phone layout.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { vaultLine } from "../finance/document-vault.mjs";
import { SUBTYPES } from "../documents/kinds.mjs";
import { sampleVault, CLIENT, BUSINESS } from "./fixtures/money-vault.sample.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money-vault.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money-vault.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "money-vault.css"), "utf8");

function load(extra = {}) {
  const sandbox = { window: { ...extra } };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window;
}
const W = load();
const F = W.FHMoneyVault;
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const primaries = (html) => (html.match(/class="vt-btn-primary[ "]/g) || []).length;
const client = () => sampleVault({ variant: "full", audience: "client" });
const staff = () => sampleVault({ variant: "full", audience: "staff" });
const item = (v, key) => v.items.find((i) => i.key === key);
/* The HTML of one paper's row, by its slot. */
function row(html, slot) {
  const start = html.indexOf(`data-item="${slot}"`);
  assert.ok(start > 0, `no row for ${slot}`);
  const end = html.indexOf('<li class="vt-item', start + 10);
  return html.slice(start, end < 0 ? undefined : end);
}
const STATEMENTS = `bank_statements_business:${BUSINESS.id}`;

test("the page loads its script and stylesheet, reads /api/money/vault, uploads to the existing endpoint, and keeps out of the staff shell", () => {
  assert.match(HTML, /<script defer src="money-vault\.js"><\/script>/);
  assert.match(HTML, /<link rel="stylesheet" href="money-vault\.css">/);
  assert.match(HTML, /id="vault-root"/);
  assert.match(HTML, /<div class="app">/);
  assert.doesNotMatch(HTML, /src="shell\.js"/);
  assert.doesNotMatch(HTML, /crm-sidebar\.css/);
  assert.match(JS, /var API = "\/api\/money\/vault"/);
  assert.match(JS, /var UPLOAD = "\/api\/documents-upload"/);
});

test("the shared money nav, with Funding papers as the one current page", () => {
  const nav = HTML.match(/<nav class="mnav"[\s\S]*?<\/nav>/)[0];
  const hrefs = nav.match(/href="([^"]+)"/g).map((h) => h.slice(6, -1));
  assert.deepEqual(hrefs, [
    "/app/financeos.html#overview", "/app/financeos.html#accounts", "/app/financeos.html#credit",
    "/app/financeos.html#declines", "/app/money-vault.html",
    "/app/financeos.html#connections", "/app/financeos.html#payments", "/app/financeos.html#setup"
  ]);
  assert.match(nav, /href="\/app\/money-vault\.html" aria-current="page">Funding papers</);
  assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
  assert.equal(F.withClient("/app/financeos.html#credit", CLIENT.id), `/app/financeos.html?client_id=${CLIENT.id}#credit`);
});

test("it registers as the FinanceOS section the one-page FinanceOS mounts", () => {
  assert.equal(W.FinanceOS.sections.vault.title, "Funding papers");
  assert.equal(typeof W.FinanceOS.sections.vault.mount, "function");
});

test("no px font size anywhere, no font shorthand with a size, no outside script, no new dependency", () => {
  const style = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
  for (const src of [style, CSS, JS]) {
    assert.doesNotMatch(src, /font-size\s*:\s*\d/);
    assert.doesNotMatch(src, /(?:^|[;{\s])font\s*:\s*[^;}]*\d+px/);
  }
  assert.doesNotMatch(HTML, /<script[^>]+src="https?:/, "no outside script");
  assert.doesNotMatch(JS, /require\(|import /, "plain browser script");
});

test("the section's styles all live under .fh-vault, with no hand-rolled shadow", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "");
  const selectors = css.replace(/@media[^{]+\{/g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
  assert.ok(selectors.length > 40);
  for (const sel of selectors) for (const part of sel.split(",")) assert.match(part.trim(), /^\.fh-vault(\s|$)/, part);
  assert.doesNotMatch(CSS, /box-shadow/, "the resting shadow comes from fundhub-brand.css (UI-STANDARDS §12.2)");
});

test("spacing stays on the 8px scale", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = [];
  for (const m of css.matchAll(/(?:^|[;{])\s*(gap|padding(?:-\w+)?|margin(?:-\w+)?)\s*:\s*([^;}]+)/g)) {
    for (const px of m[2].match(/-?\d+px/g) || []) {
      if (![0, 8, 16, 24, 32, 48, 64].includes(Math.abs(parseInt(px, 10)))) bad.push(`${m[1]}:${m[2]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("phone: one column, full-width upload button, and nothing forces the page wider than 375px", () => {
  const phone = CSS.match(/@media \(max-width:760px\)\{([\s\S]*?)\n\}/)[1];
  assert.match(phone, /\.fh-vault \.vt-item\{grid-template-columns:32px minmax\(0,1fr\)\}/);
  assert.match(phone, /\.fh-vault \.vt-side \.vt-btn,\.fh-vault \.vt-side \.vt-btn-primary\{width:100%\}/);
  assert.match(phone, /\.fh-vault \.vt-f\{grid-column:span 12\}/);
  const decls = CSS.replace(/@media[^{]+\{/g, "");
  for (const m of decls.matchAll(/(?:^|[;{])\s*(?:min-)?width\s*:\s*(\d+)px/g)) assert.ok(Number(m[1]) <= 64, m[0]);
  assert.match(CSS, /\.fh-vault \.vt-doc-name\{[^}]*overflow-wrap:anywhere/, "a long file name wraps instead of pushing the page");
});

test("full (the doc's example): the progress, the two groups, and every paper in plain words — from the real engine", () => {
  const v = client();
  assert.equal(v.summary.required, 8);
  const html = F.render(v, { staff: false });
  const t = text(html);
  assert.match(t, /Your funding papers/);
  assert.match(html, /<span class="fh-num">3 of 8<\/span><span>papers ready<\/span>/);
  assert.match(t, /3 ready 2 we're checking 3 left to send/);
  assert.match(t, /Next: send your personal tax returns for the last 2 years\./);
  // Grouped: Personal, then the business by name.
  assert.match(html, /<h2 class="vt-group-name" id="[^"]+">Personal<\/h2><span class="caption vt-group-count">2 of 3 ready<\/span>/);
  assert.match(html, /<h2 class="vt-group-name" id="[^"]+">Fundhub LLC<\/h2><span class="tag vt-tag">Business<\/span><span class="caption vt-group-count">1 of 5 ready<\/span>/);
  assert.ok(html.indexOf(">Personal<") < html.indexOf(">Fundhub LLC<"));
  // Each paper: what it is, why lenders ask, its status in words.
  for (const it of v.items) {
    assert.ok(html.includes(`<h3 class="vt-title">${it.title.replace(/'/g, "&#39;")}</h3>`), it.title);
    assert.ok(t.includes(it.why), it.key);
  }
  assert.match(text(row(html, "id_document:client")), /Accepted/);
  assert.match(text(row(html, "tax_returns_personal:client")), /1 of 2 years ready .* Missing Upload more/);
  assert.match(text(row(html, `certificate_good_standing:${BUSINESS.id}`)), /Too old — send a newer one/);
  assert.match(text(row(html, `ein_letter:${BUSINESS.id}`)), /Sent — we're checking Nothing to do now\./);
  // The doc's three statements: accepted, rejected with the reason, waiting.
  const st = text(row(html, STATEMENTS));
  assert.match(st, /1 of 3 months ready/);
  assert.match(st, /Sent — we're checking/);
  assert.match(st, /fundhub-llc-jul\.pdf Sent Oct 1 · Accepted · good through Oct 31, 2026/);
  assert.match(st, /fundhub-llc-aug\.pdf Sent Oct 1 · Not accepted What to fix: Page 2 is missing/);
  assert.match(st, /fundhub-llc-sep\.pdf Sent Oct 5 · We're checking it/);
  assert.doesNotMatch(st, /good through Jan 5, 2027/, "a file nobody checked yet gets no good-through date");
  assert.match(text(row(html, `certificate_good_standing:${BUSINESS.id}`)), /Too old — it was good through Sep 28, 2026/);
  // The unlabelled scan is said plainly at the bottom.
  assert.match(t, /Other files you sent .* scan-0412\.pdf Sent 16 hours ago · We're checking it/);
});

test("what is still missing comes first: in each group, then the group itself", () => {
  const v = client();
  const order = F.groupsOf(v, false).map((g) => [g.name, g.items.map((i) => i.key)]);
  assert.deepEqual(order, [
    ["Personal", ["tax_returns_personal", "id_document", "proof_of_address"]],
    ["Fundhub LLC", ["tax_returns_business", "certificate_good_standing", "bank_statements_business", "ein_letter", "articles_of_organization"]]
  ]);
  // A group that is all done waits below one that still needs something.
  const v2 = client();
  for (const it of v2.items) if (it.scope.kind === "client") it.status = "accepted";
  assert.deepEqual(F.groupsOf(v2, false).map((g) => g.name), ["Fundhub LLC", "Personal"]);
  // Staff see what waits for their review first.
  assert.deepEqual(F.groupsOf(staff(), true)[0].items.map((i) => i.key).slice(0, 2), ["bank_statements_business", "ein_letter"]);
});

test("one primary action: the upload on the first paper the client still owes", () => {
  const html = F.render(client(), { staff: false });
  assert.equal(primaries(html), 1);
  assert.match(row(html, "tax_returns_personal:client"), /<button type="button" class="vt-btn-primary" data-act="pick" data-slot="tax_returns_personal:client">Upload more/);
  assert.match(row(html, `tax_returns_business:${BUSINESS.id}`), /class="vt-btn" data-act="pick"[^>]*>Upload</);
  assert.match(row(html, `certificate_good_standing:${BUSINESS.id}`), />Upload a newer one</);
  assert.doesNotMatch(row(html, `ein_letter:${BUSINESS.id}`), /data-act="pick"/, "one file already being checked: no second upload");
  assert.match(row(html, STATEMENTS), />Upload more</, "statements take several files, so more can go while one is checked");
  assert.doesNotMatch(row(html, "id_document:client"), /data-act="pick"/, "an accepted paper has nothing to send");
});

test("every upload control is labelled, takes only what the server keeps, and says so", () => {
  const html = F.render(client(), { staff: false });
  const r = row(html, STATEMENTS);
  assert.match(r, /<input type="file" class="vt-file" id="vt-\d+" data-slot="bank_statements_business:[^"]+" accept="application\/pdf,image\/jpeg,image\/png,\.pdf,\.jpg,\.jpeg,\.png" multiple tabindex="-1" aria-hidden="true" aria-label="Choose a file for Business bank statements, last 3 months">/);
  assert.doesNotMatch(html, /<input type="file"[^>]* hidden[ >]/, "never display:none — an old iPhone will not open the picker");
  assert.match(CSS, /\.fh-vault \.vt-file\{position:absolute;width:1px;height:1px;opacity:0;/);
  assert.match(r, /Upload more<span class="vt-sr"> — Business bank statements, last 3 months<\/span>/);
  assert.match(text(r), /PDF, JPG or PNG · you can pick more than one file/);
  assert.doesNotMatch(row(html, `certificate_good_standing:${BUSINESS.id}`), / multiple/, "one certificate, one file");
  assert.equal(F.okFile({ name: "scan.pdf", type: "application/pdf" }), true);
  assert.equal(F.okFile({ name: "IMG_0001.JPG", type: "" }), true);
  assert.equal(F.okFile({ name: "photo.heic", type: "image/heic" }), false, "the server sniffs and refuses HEIC");
});

test("an upload sends the line's exact fields: the right subtype, and entity_id only for a business paper", () => {
  const v = client();
  assert.deepEqual({ ...F.uploadFields(item(v, "bank_statements_business"), "") },
    { kind: "client_upload", subtype: "business_bank_statement", entity_id: BUSINESS.id });
  assert.deepEqual({ ...F.uploadFields(item(v, "id_document"), "") }, { kind: "client_upload", subtype: "id_document" });
  assert.deepEqual({ ...F.uploadFields(item(v, "certificate_good_standing"), "") },
    { kind: "client_upload", subtype: "certificate_good_standing", entity_id: BUSINESS.id });
  // Staff uploading for a client add the client's id (the endpoint needs it for staff).
  assert.deepEqual({ ...F.uploadFields(item(v, "tax_returns_personal"), CLIENT.id) },
    { kind: "client_upload", subtype: "tax_return", client_id: CLIENT.id });
  // Every subtype a line can send is one the upload endpoint knows.
  for (const it of v.items) assert.ok(SUBTYPES.client_upload.includes(F.uploadFields(it, "").subtype), it.key);
  assert.equal(F.uploadPath(item(v, "id_document")), "/api/documents-upload");
  assert.equal(F.uploadPath({ upload: { endpoint: "https://evil.example/x" } }), "/api/documents-upload", "never a path off our own api");
});

test("the upload goes out as multipart to the existing endpoint, with the fields and the file, signed in", async () => {
  const appended = [];
  const calls = [];
  class FakeForm { append(k, v, name) { appended.push([k, typeof v === "string" ? v : `file:${name}`]); } }
  const win = load({
    FormData: FakeForm,
    localStorage: { getItem: (k) => (k === "fh_token" ? "tok-123" : null) },
    fetch: (p, init) => { calls.push([p, init]); return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, documents: [{ id: "d1" }] }) }); }
  });
  const it = item(client(), "bank_statements_business");
  const res = await win.FHMoneyVault.sendUpload(win.FHMoneyVault.uploadPath(it), win.FHMoneyVault.uploadFields(it, ""),
    [{ name: "fundhub-llc-aug-v2.pdf" }]);
  assert.equal(res.status, 200);
  assert.deepEqual(appended, [
    ["kind", "client_upload"], ["subtype", "business_bank_statement"], ["entity_id", BUSINESS.id],
    ["file", "file:fundhub-llc-aug-v2.pdf"]
  ]);
  const [p, init] = calls[0];
  assert.equal(p, "/api/documents-upload");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.authorization, "Bearer tok-123");
  assert.equal(init.headers["content-type"], undefined, "the browser writes the multipart boundary");
  assert.ok(init.body instanceof FakeForm);
});

test("a staff-added paper: the client sees it marked, and where an untyped upload goes", () => {
  const customItems = [
    { id: "c0000000-0000-4000-8000-0000000000a1", kind: "custom", item_key: "custom_aaaa0001", entity_id: BUSINESS.id,
      title: "Business license", note: "The bank asked for your city business license.", subtype: "business_license", need: 1,
      created_at: "2026-10-07T10:00:00.000Z" },
    { id: "c0000000-0000-4000-8000-0000000000a2", kind: "custom", item_key: "custom_aaaa0002", entity_id: null,
      title: "Voided check", note: null, subtype: null, need: 1, created_at: "2026-10-07T10:01:00.000Z" }
  ];
  const v = sampleVault({ variant: "full", audience: "client", extra: { customItems } });
  const html = F.render(v, { staff: false });
  const license = row(html, `custom_aaaa0001:${BUSINESS.id}`);
  assert.match(license, /<h3 class="vt-title">Business license<\/h3><span class="tag vt-tag">Added by Fundhub<\/span>/);
  assert.match(text(license), /The bank asked for your city business license\./);
  assert.deepEqual({ ...F.uploadFields(item(v, "custom_aaaa0001"), "") },
    { kind: "client_upload", subtype: "business_license", entity_id: BUSINESS.id });
  // No file type: it uploads as "other", and the line says a person files it.
  assert.deepEqual({ ...F.uploadFields(item(v, "custom_aaaa0002"), "") }, { kind: "client_upload", subtype: "other" });
  assert.match(text(row(html, "custom_aaaa0002:client")), /a Fundhub person files it here after you send it/);
  assert.match(text(F.render(sampleVault({ variant: "full", audience: "staff", extra: { customItems } }), { staff: true })),
    /Added by staff/);
});

test("staff controls are hidden for clients: only a client id from the desk AND a staff answer turn them on", () => {
  assert.equal(F.isStaffView(client(), CLIENT.id), false, "the server said client");
  assert.equal(F.isStaffView(staff(), ""), false, "no client id from a staff desk");
  assert.equal(F.isStaffView(staff(), CLIENT.id), true);
  const html = F.render(client(), { staff: false });
  assert.doesNotMatch(html, /data-act="(accept|reject|change|sort-accept|sort-reject)"/);
  assert.doesNotMatch(html, /data-form="add"|Add a paper|Staff only|Files to sort/);
  assert.doesNotMatch(html, /Sam Staff|document reader/, "a client never sees who decided");
  assert.doesNotMatch(html, /credentials\/notion-scrape|Source:/, "no rule sources on a client screen");
});

test("staff review: Accept and Reject on each file waiting, Change on decided ones, the files to sort, and Add a paper", () => {
  const v = staff();
  const html = F.render(v, { staff: true });
  const t = text(html);
  assert.match(t, /^ ?Funding papers/);
  assert.match(t, /3 ready 2 need your review 3 the client still has to send 1 file to sort/);
  assert.match(t, /Next: check 2 papers waiting for your review\./);
  // The Sep statement and the EIN letter wait for review.
  const st = row(html, STATEMENTS);
  assert.match(st, /class="vt-btn-primary vt-btn-s" data-act="accept" data-doc="0d0c0000-0000-4000-8000-000000000006"/, "the first file waiting is the one filled button");
  assert.match(st, /data-act="reject" data-doc="0d0c0000-0000-4000-8000-000000000006"/);
  assert.equal(primaries(html), 1);
  assert.match(row(html, `ein_letter:${BUSINESS.id}`), /class="vt-btn vt-btn-s" data-act="accept" data-doc="0d0c0000-0000-4000-8000-000000000008"/);
  // Decided files get one quiet Change; the opposite decision behind it.
  assert.match(st, /data-act="change" data-to="reject">Change<span class="vt-sr"> the decision on fundhub-llc-jul\.pdf/);
  assert.match(st, /data-act="change" data-to="accept">Change<span class="vt-sr"> the decision on fundhub-llc-aug\.pdf/);
  // Who decided, for staff.
  assert.match(text(st), /Accepted by Sam Staff · Oct 2/);
  assert.match(text(row(html, "id_document:client")), /Accepted by the document reader/);
  // Accepting a statement asks how many months it covers and its last day (both optional, both from the server's rule).
  assert.match(st, /<label for="vt-\d+">How many months does this file cover\?<\/label><input id="vt-\d+" class="vt-field" type="number" inputmode="numeric" min="1" max="24" step="1" value="1" data-field="covers">/);
  assert.match(st, /<label for="vt-\d+">Last day on the statement<\/label><input id="vt-\d+" class="vt-field" type="date" max="2026-10-07" data-field="period_end">/);
  assert.match(text(st), /It counts for 3 months after this date\. Leave it empty to count from the day it was sent\./);
  // A reject needs a reason, and the form says the client reads it.
  assert.match(st, /<label for="vt-\d+">What should the client fix\?<\/label><input id="vt-\d+" class="vt-field" type="text" maxlength="300"/);
  assert.match(text(st), /The client sees these words\./);
  // The EIN letter is one plain file: Accept needs no form.
  assert.doesNotMatch(row(html, `ein_letter:${BUSINESS.id}`), /data-form="accept"/);
  // Files to sort: the reason in words, and a choice of every line.
  assert.match(t, /Staff only Files to sort/);
  assert.match(t, /scan-0412\.pdf Sent 16 hours ago · No paper type was picked when it was sent\./);
  assert.match(html, /<option value="bank_statements_business:386c687a-167d-4d44-a000-8d50b5a80191">Business bank statements, last 3 months — Fundhub LLC<\/option>/);
  // Add a paper: for the client or one business, the two staff-addable file types, 1–24 files.
  const add = html.slice(html.indexOf('<details class="card vt-add"'));
  assert.match(add, /<summary>Add a paper <span class="caption">Staff only<\/span><\/summary>/);
  assert.match(add, /<option value="">Personal<\/option><option value="386c687a-167d-4d44-a000-8d50b5a80191">Fundhub LLC<\/option>/);
  assert.match(add, /<option value="business_license">Business license<\/option><option value="proof_of_income">Pay stubs or W-2<\/option>/);
  assert.match(add, /maxlength="120"/);
  assert.match(add, /name="need" type="number" inputmode="numeric" min="1" max="24"/);
  for (const [, sub] of add.matchAll(/<option value="([a-z_]+)">/g)) assert.ok(SUBTYPES.client_upload.includes(sub), sub);
});

test("every staff control is labelled: each form field has its label, and each button says what it does", () => {
  const html = F.render(staff(), { staff: true });
  const ids = [...html.matchAll(/<(?:input|select)[^>]* id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 10);
  for (const id of ids) {
    const labelled = html.includes(`<label for="${id}">`) || new RegExp(`id="${id}"[^>]*aria-label="`).test(html);
    assert.ok(labelled, `field ${id} has no label`);
  }
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const m of html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)) {
    assert.doesNotMatch(text(m[1]), /^\s*(Submit|OK|Go)\s*$/i);
  }
});

test("file complete: the banner with the closer's own words, and nothing left to press", () => {
  const v = sampleVault({ variant: "complete" });
  assert.equal(v.complete, true);
  const html = F.render(v, { staff: false });
  const t = text(html);
  assert.match(t, /File complete All 8 papers are ready\. You do not need to send anything else\./);
  assert.match(t, /What your closer sees “?Document vault: file complete — 8 of 8 items accepted\./);
  assert.doesNotMatch(html, /vt-progress/);
  assert.equal(primaries(html), 0, "nothing to do, so no filled button");
  // The banner says exactly what the closer's task note says.
  assert.equal(F.closerLine(v), vaultLine({ complete: true, summary: v.summary }));
  const waived = { summary: { required: 8, accepted: 7, waived: 1 } };
  assert.equal(F.closerLine(waived), vaultLine({ complete: true, summary: waived.summary }));
  assert.match(text(F.render(sampleVault({ variant: "complete", audience: "staff" }), { staff: true })), /What the closer sees/);
});

test("empty: nothing sent yet — every paper missing, and the first one to send is the one action", () => {
  const html = F.render(sampleVault({ variant: "empty" }), { staff: false });
  const t = text(html);
  assert.match(html, /<span class="fh-num">0 of 8<\/span>/);
  assert.match(t, /8 left to send/);
  assert.doesNotMatch(t, /0 ready|0 we're checking/, "a zero is left out of the words");
  assert.match(t, /Next: send a photo of your driver's license or passport\./);
  assert.equal(primaries(html), 1);
  assert.match(row(html, "id_document:client"), /class="vt-btn-primary" data-act="pick"/);
  // A vault with no lines at all says what will appear here.
  assert.match(text(F.render({ ok: true, audience: "client", items: [], scopes: [] }, { staff: false })), /No papers on your list yet/);
  assert.match(F.render({ ok: true, audience: "staff", items: [], scopes: [BUSINESS] }, { staff: true }), /<details class="card vt-add" id="vt-add" open>/);
});

test("error: what failed in the person's words, and one way forward", () => {
  const html = F.renderError("nodb", false);
  assert.match(html, /role="alert"/);
  assert.match(text(html), /We could not load your papers Our database is not answering right now/);
  assert.match(html, /data-act="retry">Try again</);
  assert.equal(primaries(html), 1);
  assert.match(text(F.renderError("forbidden", true)), /Only owner, admin and sales manager logins can open a client's funding papers\./);
  assert.equal(F.classify({ status: 401, body: null }), "signin");
  assert.equal(F.classify({ status: 403, body: { ok: false } }), "forbidden");
  assert.equal(F.classify({ status: 400, body: { error: "client_id is required and must be a uuid" } }), "needclient");
  assert.equal(F.classify({ status: 503, body: { db: "down" } }), "nodb");
  assert.equal(F.classify({ status: 200, body: { ok: true } }), "server", "an answer with no lines is not a vault");
  assert.equal(F.classify({ status: 200, body: client() }), "ok");
});

test("loading: skeletons in the real layout, marked busy", () => {
  const html = F.renderLoading(false);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /vt-skel/);
  assert.match(text(html), /Loading your papers…/);
  assert.match(text(F.renderLoading(true)), /Loading this client's papers…/);
});

test("status is a word and a shape, never colour alone", () => {
  const html = F.render(client(), { staff: false });
  assert.match(html, /class="vt-item is-done" data-item="id_document:client"><span class="vt-mark" aria-hidden="true">✓<\/span>/);
  assert.match(html, /class="vt-item is-missing" data-item="tax_returns_personal:client"><span class="vt-mark" aria-hidden="true">○<\/span>/);
  assert.match(html, /class="vt-item is-checking" data-item="bank_statements_business:[^"]+"><span class="vt-mark" aria-hidden="true">…<\/span>/);
  assert.match(html, /class="vt-item is-old" data-item="certificate_good_standing:[^"]+"><span class="vt-mark" aria-hidden="true">↻<\/span>/);
  assert.equal(F.statusOf({ status: "rejected" }, false).word, "Not accepted — send a new one");
  assert.equal(F.statusOf({ status: "rejected" }, false).mark, "✗");
  assert.equal(F.statusOf({ status: "waived" }, false).word, "Not needed");
  assert.equal(F.statusOf({ status: "uploaded" }, true).word, "Needs your review");
  assert.equal(F.statusOf({ status: "nonsense" }, false).word, "Missing", "an unknown status is never shown as done");
});

test("refusals are said in words: uploads and staff changes", () => {
  assert.equal(F.uploadProblem({ status: 400, body: { error: "invalid_file_type", filename: "a.heic" } }), "a.heic: That file type does not work. Send a PDF, JPG or PNG.");
  assert.match(F.uploadProblem({ status: 413, body: null }), /too big/);
  assert.match(F.uploadProblem({ status: 404, body: { error: "no such business" } }), /could not find that business/);
  assert.equal(F.uploadProblem({ status: 0, body: null }), "We could not reach the server. Check your connection and try again.");
  assert.equal(F.actProblem({ status: 409, body: { error: "unfiled" } }), "Pick the paper this file is for first.");
  assert.match(F.actProblem({ status: 400, body: { error: "invalid_period_end" } }), /not in the future/);
  assert.match(F.actProblem({ status: 403, body: { ok: false } }), /Only owner, admin and sales manager/);
});

test("a file's name, a reason and a business name are escaped, never run", () => {
  const v = client();
  const it = item(v, "bank_statements_business");
  it.documents[0].filename = "<img src=x onerror=alert(1)>.pdf";
  it.documents[1].reason = "<script>alert(1)</script>";
  it.scope.name = "<b>Evil</b> LLC";
  v.scopes[0].name = "<b>Evil</b> LLC";
  const html = F.render(v, { staff: true });
  assert.doesNotMatch(html, /<img src=x|<script>alert|<b>Evil<\/b>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
