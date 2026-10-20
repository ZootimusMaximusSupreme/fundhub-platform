// The two screens, read as source.
//
// Neither of these files is imported by anything, so nothing else in the suite
// would notice if one of them stopped calling an endpoint that exists, started
// calling one that does not, or — the failure this file mostly exists for — if
// the CLIENT SIGNING PAGE ever picked up the CRM's session machinery.
//
// public/contract.html is served to people who are not employees. If it ever
// loads shell.js, that script demands a session and redirects; if it ever loads
// data.js, every request it makes carries a staff bearer token out of
// localStorage. Either would be a serious defect and neither would be caught by
// any other test in this repository.
//
// It lives under src/ rather than public/ because package.json's test glob only
// walks src/ and scripts/ (CLAUDE.md §12).

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { OWNER_ADMIN_ACTIONS } from "../../api/contracts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, "../../public");
const CRM = fs.readFileSync(path.join(PUBLIC, "app/contracts.html"), "utf8");
const CLIENT_RAW = fs.readFileSync(path.join(PUBLIC, "contract.html"), "utf8");
/* HTML comments stripped: the page's own header comment explains at length why
   it must never load shell.js or data.js, and a naive text search would find
   those names in the explanation and fail over the very rule it documents. What
   is under test is the page, not its prose. */
const CLIENT = CLIENT_RAW.replace(/<!--[\s\S]*?-->/g, "");
const SHELL = fs.readFileSync(path.join(PUBLIC, "app/shell.js"), "utf8");
const HEADERS = fs.readFileSync(path.join(PUBLIC, "_headers"), "utf8");
const VENDOR = path.join(PUBLIC, "vendor/pdfjs");

/* Every /api/... path a file asks for, deduplicated. */
function apiPaths(src) {
  const out = new Set();
  const re = /["'`](\/api\/[a-z0-9/_-]+)/gi;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return [...out];
}

describe("the Contracts screen (public/app/contracts.html)", () => {
  test("is a CRM screen: it loads the shell and the shared data layer", () => {
    assert.match(CRM, /<script(?:\s+defer)?\s+src="shell\.js"><\/script>/);
    assert.match(CRM, /<script(?:\s+defer)?\s+src="data\.js"><\/script>/);
  });

  test("the shell knows about it, so it is not a page only a typed URL can reach", () => {
    assert.match(SHELL, /"contracts\.html"/);
  });

  test("every endpoint it calls is really routed", () => {
    const called = apiPaths(CRM);
    /* Was >= 2. The screen lost its contract queue on 2026-08-17 (owner
       decision: this is a template loader, not a status board), and its
       /api/auth/session call went with resolveRole(). One literal is left.
       The count was never the point — the routing check below is. */
    assert.ok(called.length >= 1, `expected the screen to call the API, found ${called.length}`);
    for (const p of called) {
      const key = p.replace(/^\/api\//, "");
      assert.ok(Object.prototype.hasOwnProperty.call(ROUTES, key),
        `contracts.html calls ${p}, which is not in the ROUTES map — it would 404`);
    }
  });

  test("it reads through /api/read/contracts and writes through /api/contracts", () => {
    assert.match(CRM, /FHData\.read\("contracts"/);
    assert.match(CRM, /FHData\.write\("\/api\/contracts"/);
  });

  test("every wording write on the page stays owner/admin-gated on the server", () => {
    for (const action of [
      "create_template", "save_template", "archive_template", "upload_template", "save_fields"
    ]) {
      assert.ok(OWNER_ADMIN_ACTIONS.has(action), `${action} lost its owner/admin server gate`);
    }
  });

  test("this page writes wordings, it does not send to a client", () => {
    assert.equal(/id="selClient"/.test(CRM), false, "client picker must leave this admin page");
    assert.equal(/<h2>Send a contract<\/h2>/.test(CRM), false, "send form must leave this admin page");
    assert.equal(/id="btnSend"/.test(CRM), false);
    assert.match(CRM, /id="tplCard"/);
    assert.match(CRM, /id="btnUpload"/);
    assert.match(CRM, /id="btnNewTpl"/);
    assert.match(CRM, /in use/);
  });

  /* De-dup, 2026-08-17: this screen builds contract templates; Documents is
     where sent contracts are watched. The note card has to say so, or the two
     screens read as duplicates of each other again. */
  test("it hands off to Documents for anything already sent", () => {
    assert.match(CRM, /Staff pick it later/);
    assert.match(CRM, /href="documents\.html"/,
      "the screen must link staff to Documents to see what was sent and who signed");
    assert.equal(/id="listBody"/.test(CRM), false, "the contract queue must not come back");
    assert.equal(/id="detailCard"/.test(CRM), false, "the contract detail card must not come back");
  });

  test("it can author wording without a developer — that is the whole point", () => {
    for (const action of ["create_template", "save_template", "archive_template"]) {
      assert.ok(CRM.includes(`action: "${action}"`) || CRM.includes(`"${action}"`),
        `the screen cannot ${action}`);
    }
    assert.match(CRM, /id="tBody"/, "no editor for the contract wording");
  });

  test("the wording panel stays hidden until the resolved session may open the page", () => {
    assert.match(CRM, /id="tplCard"/);
    assert.match(CRM,
      /html:not\(\.fh-page-access-confirmed\) body\{visibility:hidden\}/,
      "the protected page can paint before the shell confirms access");

    const pass2 = SHELL.indexOf("/* ---- pass 2: the session, authoritative ---- */");
    const redirect = SHELL.indexOf("if (ok.indexOf(PAGE) === -1)", pass2);
    const reveal = SHELL.indexOf('classList.add("fh-page-access-confirmed")', pass2);
    assert.ok(pass2 >= 0 && redirect > pass2 && reveal > redirect,
      "the shell must route a refused role away before revealing the page");

    const pass1 = SHELL.slice(
      SHELL.indexOf("/* ---- pass 1: the hint"),
      pass2);
    assert.equal(pass1.includes("fh-page-access-confirmed"), false,
      "a cached role hint must never reveal this protected page");
  });

  test("live wordings never paint the sample-markup banner", () => {
    assert.match(CRM, /return "live wordings · " \+ templates\.length/);
    assert.equal(/if \(!templates\.length\) return null/.test(CRM), false);
    /* The "live contracts" half went to documents-screen.test.mjs with the
       queue itself — see "it never paints a sample banner over real rows". */
  });

  /* MOVED, not dropped (2026-08-17 de-dup):
       · the five contract statuses  → documents-screen.test.mjs
       · the tampered-contract warning → the signing-page block below, which is
         where a tampered document is actually refused. The staff-side display
         of it went with the detail card and has NOT been rebuilt on Documents;
         that gap is recorded on the batch board, and the refusal itself is
         still enforced by src/contracts/sign.mjs (409 content_changed). */

  test("it links back out to another screen", () => {
    const links = [...CRM.matchAll(/href="([a-z0-9-]+\.html)"/g)].map((m) => m[1]);
    assert.ok(links.some((h) => h !== "contracts.html"), "no way out of this screen");
  });
});

describe("the client signing page (public/contract.html)", () => {
  /* ── the important ones ─────────────────────────────────────────────────── */

  test("IT DOES NOT LOAD THE CRM SHELL — a client has no session and must not be asked for one", () => {
    assert.equal(/shell\.js/.test(CLIENT), false,
      "contract.html loads shell.js, which would bounce every client to the login page");
  });

  test("IT DOES NOT LOAD data.js — that attaches a staff token to every request", () => {
    assert.equal(/data\.js/.test(CLIENT), false);
    assert.equal(/FHData/.test(CLIENT), false);
  });

  test("it reads no credential out of storage at all", () => {
    assert.equal(/localStorage|sessionStorage|fh_token|authorization/i.test(CLIENT), false,
      "the signing page must hold no credential but the link it was opened with");
  });

  test("it loads no staff app code beyond isolated type and presentation assets", () => {
    const appRefs = [...CLIENT.matchAll(/(?:src|href)=["'](\/app\/[^"']+)["']/g)].map(m => m[1]);
    assert.deepEqual(appRefs.sort(), [
      "/app/fundhub-astra-client.css", "/app/fundhub-astra.css",
      "/app/fundhub-font.css", "/app/fundhub-font.js"
    ]);
    assert.match(CLIENT, /<body[^>]*data-client-public/, "public signing must never acquire a session gate");
    const isolated = CLIENT.replace(/\/app\/(?:fundhub-font\.(?:css|js)|fundhub-astra(?:-client)?\.css)/g, "");
    assert.equal(/\/app\//.test(isolated), false);
    const type = fs.readFileSync(path.join(PUBLIC, "app/fundhub-font.js"), "utf8");
    assert.doesNotMatch(type, /fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|location\s*[.=]|\/api\//);
    // These two approved additions are CSS-only: no imported resource, data
    // request or credential code is permitted by the presentation allowlist.
    for (const name of ["fundhub-astra.css", "fundhub-astra-client.css"]) {
      const css = fs.readFileSync(path.join(PUBLIC, "app", name), "utf8");
      assert.doesNotMatch(css, /@import\b|url\s*\(|fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|\/api\//i);
    }
  });

  test("it is not indexed — a contract link must not turn up in a search engine", () => {
    assert.match(CLIENT, /<meta name="robots" content="noindex">/);
  });

  /* ── it does the job ────────────────────────────────────────────────────── */

  test("it talks to exactly one endpoint, and that endpoint is routed", () => {
    const called = apiPaths(CLIENT);
    assert.deepEqual(called, ["/api/contracts/sign"]);
    assert.ok(Object.prototype.hasOwnProperty.call(ROUTES, "contracts/sign"));
  });

  /* Came from the Contracts screen on 2026-08-17. The staff-side detail card
     used to assert __integrity and "It cannot be signed"; that card moved off
     the screen in the Documents de-dup. This is the assertion that matters
     more anyway — the person about to sign a tampered document is the one who
     has to be told, and src/contracts/sign.mjs answers 409 content_changed
     regardless of what any screen renders. */
  test("a tampered contract is refused out loud, not hidden", () => {
    assert.match(CLIENT, /cannot be signed/);
    assert.match(CLIENT, /Nothing has been agreed and nothing has been charged/);
  });

  test("it passes the link's own query string straight through, unmodified", () => {
    assert.match(CLIENT, /var qs = location\.search/);
    assert.match(CLIENT, /"\/api\/contracts\/sign" \+ qs/);
  });

  test("it captures a typed name, a ticked box, and posts them", () => {
    assert.match(CLIENT, /id="name"/);
    assert.match(CLIENT, /id="agree"[^>]*type="checkbox"/);
    assert.match(CLIENT, /method: "POST"/);
    assert.match(CLIENT, /signer_name: \$\("name"\)\.value/);
    assert.match(CLIENT, /agreed: \$\("agree"\)\.checked/);
  });

  test("the Sign button starts disabled and is only enabled by an explicit check", () => {
    assert.match(CLIENT, /<button id="go" disabled>/);
    assert.match(CLIENT, /<button id="barGo" disabled>/);
    // Enabling is derived in one place from name + tickbox + no outstanding
    // boxes + the server's own can_sign. Four conditions, one expression — so a
    // future edit cannot enable the button by satisfying only some of them.
    assert.match(CLIENT,
      /var ready = Boolean\(nameOk && \$\("agree"\)\.checked && left\.length === 0 && c && c\.can_sign\)/);
    assert.match(CLIENT, /\$\("go"\)\.disabled = !ready/);
    assert.match(CLIENT, /\$\("barGo"\)\.disabled = !ready/);
  });

  /* The page must never hold its own copy of the wording — that would be a
     second source of truth for the one string that has to be exact. The words,
     the title and even the sentence next to the checkbox all come from the
     server on load. */
  test("it holds no contract wording of its own", () => {
    assert.match(CLIENT, /\$\("body"\)\.textContent = c\.body/);
    assert.match(CLIENT, /\$\("statement"\)\.textContent = c\.signature_statement/);
  });

  test("it uses textContent for the document, so a contract cannot inject markup", () => {
    assert.equal(/\$\("body"\)\.innerHTML/.test(CLIENT), false,
      "the contract body must be rendered as text, never as HTML");
  });

  test("it refuses to offer signing on a document that does not verify", () => {
    assert.match(CLIENT, /if \(c\.verified === false\)/);
    assert.match(CLIENT, /\$\("signPanel"\)\.style\.display = "none"/);
    assert.match(CLIENT, /does not match the copy that was sent to you/);
  });

  test("it tells an expired link apart from a broken one", () => {
    assert.match(CLIENT, /status === 410/);
    assert.match(CLIENT, /This link has expired/);
    assert.match(CLIENT, /status === 404/);
  });

  test("it shows the signed copy back — both parties keep one", () => {
    assert.match(CLIENT, /c\.status === "signed"/);
    assert.match(CLIENT, /Signed by/);
    assert.match(CLIENT, /doneRecord/);
  });

  test("it says plainly what is recorded, before anybody signs", () => {
    assert.match(CLIENT, /date and time/);
    assert.match(CLIENT, /internet address/);
  });

  test("it is not cached, because a document somebody is about to sign must be fresh", () => {
    assert.match(HEADERS, /\/contract\.html\n\s+Cache-Control: public, max-age=0, must-revalidate/);
  });
});

describe("the vendored PDF viewer", () => {
  /* pdf.js is committed rather than fetched from a CDN because this repository
     has NO BUILD STEP — netlify.toml publishes public/ as-is — so a committed
     file is the only way a module reaches the browser. It also means a client
     signing a contract does not depend on a third-party host being up. */
  test("the files are actually in the repository", () => {
    for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs", "VERSION"]) {
      assert.ok(fs.existsSync(path.join(VENDOR, f)), `public/vendor/pdfjs/${f} is missing`);
    }
    assert.ok(fs.statSync(path.join(VENDOR, "pdf.min.mjs")).size > 100000,
      "pdf.min.mjs looks truncated");
  });

  /* THE VERSION IS PINNED TO 4.x ON PURPOSE. pdf.js 6 calls
     Map.prototype.getOrInsertComputed, which is too new for a great many
     browsers in use today and threw outright in the Chromium this was tested
     against. The people opening the signing page are customers on whatever
     device they own, so the widest compatible build is the correct one. */
  test("it is the legacy 4.x build, not the newest", () => {
    const v = fs.readFileSync(path.join(VENDOR, "VERSION"), "utf8").trim();
    assert.match(v, /^4\./,
      `pdf.js is pinned to 4.x for browser compatibility; found ${v}. ` +
      "Read the note in this test before raising it.");
  });

  test("both pages load it from the repository, never from a CDN", () => {
    for (const [name, src] of [["contract.html", CLIENT], ["contracts.html", CRM]]) {
      assert.match(src, /import \* as pdfjsLib from "\/vendor\/pdfjs\/pdf\.min\.mjs"/,
        `${name} does not load the vendored viewer`);
      assert.match(src, /workerSrc = "\/vendor\/pdfjs\/pdf\.worker\.min\.mjs"/,
        `${name} does not point the worker at the vendored file`);
      /* No script is fetched from another host. Checked against real URLs in
         code rather than the word "CDN", which appears in the comment
         explaining why there isn't one. Google Fonts stylesheets are the
         repo-wide convention on every screen and are not scripts. */
      const code = src.replace(/\/\*[\s\S]*?\*\//g, " ");
      assert.equal(/<script[^>]+src="https?:/i.test(code), false,
        `${name} loads a script from another host`);
      assert.equal(/\bfrom\s+["']https?:/i.test(code), false,
        `${name} imports a module from another host`);
    }
  });
});

describe("the Contracts screen — uploading and placing boxes", () => {
  test("a PDF can be uploaded from the screen", () => {
    assert.match(CRM, /id="fileInput"[^>]*accept="application\/pdf/);
    assert.ok(CRM.includes('action: "upload_template"'));
    assert.match(CRM, /readAsDataURL/, "the file is never read into a request body");
  });

  test("the field editor exists and saves through the right action", () => {
    assert.match(CRM, /id="pdfEditor"/);
    assert.match(CRM, /id="pdfPages"/);
    assert.ok(CRM.includes('action: "save_fields"'));
  });

  /* THE POSITION RULE, ON THE SCREEN. Boxes are laid out in PERCENTAGES from
     the same fractions the server stores. If this ever became pixels, every box
     would land somewhere else in the finished PDF than where it was dragged. */
  test("boxes are positioned in percentages, never in pixels", () => {
    assert.match(CRM, /el\.style\.left = \(b\.x \* 100\) \+ "%"/);
    assert.match(CRM, /el\.style\.top = \(b\.y \* 100\) \+ "%"/);
    assert.match(CLIENT, /el\.style\.left = \(f\.x \* 100\) \+ "%"/);
    assert.match(CLIENT, /el\.style\.top = \(f\.y \* 100\) \+ "%"/);
  });

  test("the screen refuses to offer an auto-filled signature, matching the server", () => {
    assert.match(CRM, /if \(b\.type === "signature" \|\| b\.type === "initials"\) b\.source = "manual"/);
  });

  test("several signers can be named on an uploaded PDF", () => {
    assert.match(CRM, /id="btnAddSigner"/);
    assert.ok(CRM.includes("signer_roles"));
  });

  /* "the finished document can be downloaded from the CRM" moved to
     documents-screen.test.mjs — downloading a sent contract is Documents' job
     now. The template PDF the field placer reads is a different call
     (file=template), asserted above. */
});

describe("the client signing page — uploaded documents", () => {
  test("it renders the real pages and lays this signer's boxes over them", () => {
    assert.match(CLIENT, /function renderPdf/);
    assert.match(CLIENT, /function overlayFields/);
    assert.match(CLIENT, /c\.source_kind === "pdf"/);
  });

  test("pages are rendered one after another, not all at once", () => {
    // A long document on a phone runs out of memory doing them in parallel.
    assert.match(CLIENT, /chain = chain\.then/);
  });

  test("an auto-filled box is shown locked and is not an input", () => {
    assert.match(CLIENT, /if \(f\.locked\) \{/);
    // A locked box is a span with the value in it, never an <input> the signer
    // could type over.
    assert.match(CLIENT, /v\.className = "lockval"/);
    assert.match(CLIENT, /\.fld\.locked\{[^}]*cursor:default/);
  });

  test("it says who it is waiting for when it is not this signer's turn", () => {
    assert.match(CLIENT, /error === "not_your_turn"/);
    assert.match(CLIENT, /function waiting/);
  });

  test("there is no decline button — they sign, or they don't", () => {
    assert.equal(/id="declineBtn"/.test(CLIENT), false);
    assert.equal(/I do not want to sign this/.test(CLIENT), false);
  });

  test("it shows the other signers' progress but never their contact details", () => {
    assert.match(CLIENT, /function renderWho/);
    // The server already strips emails from the list; the page must not ask for
    // them back by some other route.
    assert.equal(/s\.email/.test(CLIENT), false,
      "the signing page reads a signer's email, which it is never sent");
  });

  test("the typed name fills the signature box live, before they commit", () => {
    assert.match(CLIENT, /f\.type === "signature" \|\| f\.type === "initials"/);
    assert.match(CLIENT, /repaintSignatures/);
  });
});
