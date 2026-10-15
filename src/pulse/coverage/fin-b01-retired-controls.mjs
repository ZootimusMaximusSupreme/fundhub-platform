// Controls the map still lists, that the product no longer has (finish-the-853, batch 01).
//
// A row in the coverage map names a screen control. Four of them were taken out of the
// product on purpose, or their page was replaced, and the map was never updated:
//
//   - the closer deck "$ amount" e-book price box and "Send e-book email" button. The deck
//     has no e-book control and the server refuses the send_ebook action (pinned by
//     src/http/closer-deck-present.test.mjs and closer-deck-endpoints.test.mjs).
//   - the /optimize "Pay for Audit" intake. docs/journeys/optimize-actual.md: "The Audit
//     section and the Pay-for-Audit checkout stay removed by owner decision" (2026-08-28).
//     The page only reads its sign-up config; it never posts. ONLY THE PAY FOR AUDIT HALF IS
//     RETIRED. The four boxes and the SMS consent box are still shipped and still write
//     sessionStorage fh_opt, so that row is not "nothing to judge": it is judged live (the
//     intake and the consent code must be on the served page) AND by a browser practice test
//     (e2e/fin-b01-optimize-intake.spec.mjs). It answers PASS, never na.
//   - the /climate "Gate button". The lead-magnet page that held it was reverted
//     (f39cec357) and replaced by the Darwin dashboard, which has no gate.
//
// "Nothing to judge" is only true while the control stays gone. So each row names the live
// files to read (GET only) and what must NOT be in them. The day the control comes back, the
// claim fails and the row goes red, and it stays red until a real check is attached. A page
// that cannot be read is "skip", never a pass. A page that reads fine but no longer looks
// like the page this was written for is a FAIL: the claim cannot be re-checked.
//
// READ ONLY. GET only. No repo file is read at run time.

const EBOOK = /(?:^|[^a-z])e-?book/i;
// What must NOT come back to /optimize: the words of the retired control, and any way a page can post
// (the page's only call to its own door is a GET for its sign-up config; it never posts, never takes
// a payment, and has no checkout). The shipped page holds none of these, so each is a plain test.
const OPTIMIZE_CHECKOUT = [
  { name: "a Pay for Audit control", test: /pay for audit/i },
  { name: "a Pay now control", test: /pay\s*now/i },
  { name: "a checkout", test: /check-?out/i },
  { name: "the Consulting Services Assessment title", test: /Consulting Services Assessment/i },
  { name: "a POST (a method set to post)", test: /\bmethod\s*[:=]\s*["']?\s*post\b/i },
  { name: "an XHR POST", test: /\.open\(\s*["']post["']/i },
  { name: "a beacon send", test: /\bsendBeacon\s*\(/ },
  { name: "a library POST", test: /\.post\s*\(/ },
];
// What must STILL be on the live /optimize page: the intake that was not retired. Each is a plain
// reading of the served page, so a change to the consent line turns the row red by name.
const OPTIMIZE_INTAKE = [
  { name: "the first name box", test: /id="first"/ },
  { name: "the last name box", test: /id="last"/ },
  { name: "the email box", test: /id="email"/ },
  { name: "the mobile box", test: /id="phone"/ },
  { name: "the SMS consent box", test: /id="sms"[^>]*name="sms_consent"|name="sms_consent"[^>]*id="sms"/ },
  { name: "the opt-out wording", test: /Reply STOP to opt out/ },
  { name: "the line that saves the typed values for the hand-off", test: /sessionStorage\.setItem\(\s*["']fh_opt["']/ },
  { name: "sms_consent saved exactly as ticked (sms.checked === true)", test: /sms_consent\s*:\s*sms\.checked\s*===\s*true/ },
];
const CLIMATE_GATE = [
  { name: "a call to /api/public/optimize", test: /\/api\/public\/optimize/ },
  { name: "the unlock-the-full-list gate", test: /unlock the full/i },
  { name: "the $32 assessment", test: /\$32\b/ },
  { name: "the Consulting Services Assessment title", test: /Consulting Services Assessment/i },
];

const DECK = "present.html (+ present.js, contract-send.js)";
const EBOOK_PAGES = Object.freeze([
  { path: "/app/present.html", mustHave: /present\.js/, mustLack: [{ name: "an e-book control", test: EBOOK }] },
  { path: "/app/present.js", mustHave: /closer-deck/, mustLack: [{ name: "an e-book control", test: EBOOK }] },
  { path: "/app/contract-send.js", mustHave: /api\/contracts/, mustLack: [{ name: "an e-book control", test: EBOOK }] },
]);

export const RETIRED_CONTROLS = Object.freeze([
  {
    sourceFile: "desks-f.json",
    surface: DECK,
    control: "'$ amount' e-book price box",
    retired: "the closer deck no longer has an e-book price box",
    pages: EBOOK_PAGES,
  },
  {
    sourceFile: "desks-f.json",
    surface: DECK,
    control: "'Send e-book email': pay link at the typed price, with a placeholder PDF attached",
    retired: "the closer deck no longer has a Send e-book email button and the server refuses send_ebook",
    pages: EBOOK_PAGES,
  },
  {
    sourceFile: "public-pages.json",
    surface: "form:optimize.html#opt",
    control: "Audit intake and Pay for Audit: first name, last name, email, phone, SMS consent. Posts to /api/public/optimize, which mints a Commas checkout on the Consulting Services Assessment title.",
    retired: "the Pay for Audit checkout was removed from /optimize by owner decision, and the page only reads its sign-up config",
    // The intake half is not retired: this row is judged "pass", not "nothing to judge".
    passes: "Pay for Audit is gone and the intake with its SMS consent is still on the page, saved exactly as ticked",
    practice: { spec: "e2e/fin-b01-optimize-intake.spec.mjs" },
    pages: [
      { path: "/optimize", mustHave: /id="opt"/, mustLack: OPTIMIZE_CHECKOUT, mustAlso: OPTIMIZE_INTAKE },
    ],
  },
  {
    sourceFile: "public-pages.json",
    surface: "button:climate/index.html#Gate button: unlock the full",
    control: "Gate button: unlock the full list with the $32 assessment (POST /api/public/optimize returns the Commas checkout) (drawn by bundled scripts; listed from docs/journeys/climate-lead-magnet-intended.md)",
    retired: "the climate lead-magnet page was reverted and replaced by a dashboard that has no gate",
    pages: [
      {
        path: "/climate/",
        mustHave: /_next\/static/,
        mustLack: CLIMATE_GATE,
        // The page is drawn by bundled scripts: read EVERY script the page names (each same-origin
        // <script src>, and each static/chunks/*.js path named in the page), not only the one app
        // chunk. The gate used to be able to come back in any other chunk and stay unseen.
        follow: { max: 40, mustLack: CLIMATE_GATE },
      },
    ],
  },
]);

const keyOf = (item) => `${item?.sourceFile}\0${item?.surface}\0${item?.control}`;
const BY_KEY = new Map(RETIRED_CONTROLS.map((item) => [keyOf(item), item]));

/** The retired-control record for a catalog entry (or for na args), or null. */
export function retiredControlFor(item) {
  return (item && BY_KEY.get(keyOf(item))) || null;
}

const TIMEOUT_MS = 5000;

function say(reason) {
  return String(reason?.message || reason || "unknown read error").replace(/\s+/g, " ").slice(0, 120);
}

/* One GET. Returns { ok:true, text } or { ok:false, status } and never throws. */
async function read(fetchImpl, url) {
  try {
    const response = await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status !== 200) return { ok: false, why: `${url} answered ${response.status}` };
    return { ok: true, text: String(await response.text()) };
  } catch (error) {
    return { ok: false, why: `${url} could not be read: ${say(error)}` };
  }
}

function lacks(text, list) {
  return list.find((item) => item.test.test(text)) || null;
}

/* The pages one control needs, read once per run and shared by every control that names them. */
function cachedReader(fetchImpl, cache) {
  return (url) => {
    if (!cache.has(url)) cache.set(url, read(fetchImpl, url));
    return cache.get(url);
  };
}

async function judgePage(page, base, get) {
  const url = new URL(page.path, base).href;
  const html = await get(url);
  if (!html.ok) return { status: "skip", detail: html.why };
  if (!page.mustHave.test(html.text)) {
    return { status: "FAIL", detail: `${page.path} no longer looks like the page this check was written for, so "the control is gone" cannot be re-checked. Look at it and judge the control again.` };
  }
  const back = lacks(html.text, page.mustLack);
  if (back) return { status: "FAIL", detail: `${page.path} holds ${back.name} again. The control is back and has no proof attached.` };
  if (page.mustAlso) {
    const gone = page.mustAlso.find((item) => !item.test.test(html.text));
    if (gone) {
      return { status: "FAIL", detail: `${page.path} no longer holds ${gone.name}. This part of the control is still live and has to stay as written, so the check cannot pass.` };
    }
  }
  if (!page.follow) return { status: "na" };

  const srcs = scriptsNamedBy(html.text, url, base);
  if (srcs.length === 0) {
    return { status: "FAIL", detail: `${page.path} names no page scripts, so the page's own code cannot be read.` };
  }
  if (srcs.length > page.follow.max) {
    return { status: "FAIL", detail: `${page.path} names ${srcs.length} scripts, more than the ${page.follow.max} this check reads, so the page's own code cannot be read in full.` };
  }
  // Read them side by side (each is a GET with its own 5 second limit), so a slow script cannot hold the
  // lane past its step budget; then judge them in the page's own order.
  const scripts = await Promise.all(srcs.map((src) => get(new URL(src, base).href)));
  // A gate found in one script is red even when another script could not be read.
  for (const [i, script] of scripts.entries()) {
    if (!script.ok) continue;
    const hit = lacks(script.text, page.follow.mustLack);
    if (hit) return { status: "FAIL", detail: `${srcs[i]} holds ${hit.name} again. The control is back and has no proof attached.` };
  }
  const unread = scripts.find((script) => !script.ok);
  if (unread) return { status: "skip", detail: unread.why };
  return { status: "na" };
}

/* Every script one page names, same site only: each <script src>, and each static/chunks/*.js path
   written anywhere in the page (the framework lists the chunks it loads in its page data, written
   relative to its own _next folder, so those are put under the folder the page's own scripts use).
   The order is the page's own and each address is listed once. */
function scriptsNamedBy(text, pageUrl, base) {
  const found = [];
  const add = (raw) => {
    let abs;
    try { abs = new URL(raw, pageUrl); } catch { return; }
    if (abs.origin !== base) return;
    if (!/\.m?js$/i.test(abs.pathname)) return;
    const key = abs.pathname;
    if (!found.includes(key)) found.push(key);
  };
  for (const m of text.matchAll(/\bsrc\s*=\s*"([^"]+)"/g)) add(m[1]);
  for (const m of text.matchAll(/\bsrc\s*=\s*'([^']+)'/g)) add(m[1]);
  const hasNext = found.find((p) => p.includes("/_next/static/"));
  const nextRoot = hasNext ? `${hasNext.split("/_next/")[0]}/_next/` : "/_next/";
  for (const m of text.matchAll(/["'(\s,]((?:\/[\w.-]+)*\/?static\/chunks\/[\w./%-]+\.js)/g)) {
    add(m[1].startsWith("/") ? m[1] : `${nextRoot}${m[1]}`);
  }
  return found;
}

/**
 * Judge one retired control against the live files.
 *   ctx.fetchImpl  a GET function (defaults to the global fetch); null means "no GET client"
 *   ctx.baseUrl    the site (defaults to https://fundhub.ai)
 *   ctx.retiredCache  optional Map shared by the controls of one run, so a page is read once
 * Returns { status: "na" | "pass" | "FAIL" | "skip", detail }. "pass" is for a control that is only half
 * retired (the other half is still live and is read here too); "na" is for a control that is gone.
 */
export async function retiredControlState(retired, ctx = {}) {
  const fetchImpl = Object.hasOwn(ctx, "fetchImpl") ? ctx.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { status: "skip", detail: `${retired.control}: not re-checked, this run has no GET client.` };
  }
  let base;
  try {
    base = new URL(ctx.baseUrl || "https://fundhub.ai").origin;
  } catch {
    return { status: "skip", detail: `${retired.control}: not re-checked, the site address is not usable.` };
  }
  const get = cachedReader(fetchImpl, ctx.retiredCache || new Map());
  const seen = await Promise.all(retired.pages.map((page) => judgePage(page, base, get)));
  const worst = seen.find((item) => item.status === "FAIL") || seen.find((item) => item.status === "skip");
  if (worst) return { status: worst.status, detail: `${retired.control}: ${worst.detail}` };
  if (retired.passes) {
    return {
      status: "pass",
      detail: `${retired.control}: ${retired.passes}. Read live from ${retired.pages.map((p) => p.path).join(", ")} (GET only); a browser practice test types the boxes and reads what is saved.`,
    };
  }
  return {
    status: "na",
    detail: `${retired.control}: ${retired.retired}. The live ${retired.pages.map((p) => p.path).join(", ")} still hold none of it, so there is nothing to judge.`,
  };
}
