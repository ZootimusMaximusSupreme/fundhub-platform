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
//     The page only reads its sign-up config; it never posts.
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
const OPTIMIZE_CHECKOUT = [
  { name: "a Pay for Audit control", test: /pay for audit/i },
  { name: "the Consulting Services Assessment title", test: /Consulting Services Assessment/i },
  { name: "a POST", test: /method\s*:\s*["']POST["']/i },
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
    pages: [
      { path: "/optimize", mustHave: /id="opt"/, mustLack: OPTIMIZE_CHECKOUT },
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
        // The page is drawn by bundled scripts: read the page's own chunks too.
        follow: { prefix: "/climate/_next/static/chunks/app/", max: 4, mustLack: CLIMATE_GATE },
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
  if (!page.follow) return { status: "na" };

  const srcs = [...html.text.matchAll(/src="([^"]+)"/g)].map((m) => m[1])
    .filter((src) => src.startsWith(page.follow.prefix))
    .slice(0, page.follow.max);
  if (srcs.length === 0) {
    return { status: "FAIL", detail: `${page.path} names none of the page scripts under ${page.follow.prefix}, so the page's own code cannot be read.` };
  }
  for (const src of srcs) {
    const script = await get(new URL(src, base).href);
    if (!script.ok) return { status: "skip", detail: script.why };
    const hit = lacks(script.text, page.follow.mustLack);
    if (hit) return { status: "FAIL", detail: `${src} holds ${hit.name} again. The control is back and has no proof attached.` };
  }
  return { status: "na" };
}

/**
 * Judge one retired control against the live files.
 *   ctx.fetchImpl  a GET function (defaults to the global fetch); null means "no GET client"
 *   ctx.baseUrl    the site (defaults to https://fundhub.ai)
 *   ctx.retiredCache  optional Map shared by the controls of one run, so a page is read once
 * Returns { status: "na" | "FAIL" | "skip", detail }.
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
  return {
    status: "na",
    detail: `${retired.control}: ${retired.retired}. The live ${retired.pages.map((p) => p.path).join(", ")} still hold none of it, so there is nothing to judge.`,
  };
}
