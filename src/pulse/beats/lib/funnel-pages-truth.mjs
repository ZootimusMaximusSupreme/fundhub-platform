// The two /roadmap money checks a buyer feels at the till, read only: the card box script, and the
// old /order page's price against the till. GET and HEAD only.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). These checks, the memoized page reader and the page helpers
// used to live in src/pulse/coverage/gap-funnels.mjs. They moved here unchanged so the morning lane
// (which imports them back for all its funnel checks) and the hourly beat roadmap-pages run the same
// reads and the same verdicts. A beat may import only from src/pulse/beats/lib, so the truth lives here.
//
//   funnel:card-box-script-loads     /roadmap still names its card box script (the SDK_SRC the widget
//                                    loads, near byte 195,000 of a 268 KB page), and that script answers
//                                    200 as JavaScript, big enough to be the card box code, defining the
//                                    name the page calls
//   funnel:order-price-matches-till  the old /order checkout, while it is a working checkout, charges
//                                    the price the till (/api/public/slo-checkout) charges
//
// makeGetter(web): `web(url, init)` answers like fetch (status, url, headers, text()). The morning lane
// hands in its fetch; the hourly beat a GET through ctx.http (lib/web-reader.mjs). Never posts a lead,
// never mints a product, never opens ClickFunnels admin.

export function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

/** One web call may wait this long. Netlify cuts the whole step at 26 seconds. */
export const TIMEOUT_MS = 8000;
/** Keep the live host from stalling when every funnel check starts at once. */
export const MAX_IN_FLIGHT_READS = 8;

/** Reads one response header by name, whatever shape the response carries. Null when absent. */
export function headerReader(res) {
  const h = res && res.headers;
  return (name) => {
    if (!h) return null;
    try {
      if (typeof h.get === "function") {
        const v = h.get(name);
        return v == null ? null : String(v);
      }
      const key = Object.keys(h).find((k) => k.toLowerCase() === String(name).toLowerCase());
      return key ? String(h[key]) : null;
    } catch {
      return null;
    }
  };
}

/**
 * One memoized call per address for the whole run, so a door read twice is fetched
 * once. get(url, accept, origin) reads a page. An origin makes the call the way the
 * browser makes it from that site. get.head(url) asks for the headers only.
 */
export function makeGetter(web) {
  const seen = new Map();
  let inFlight = 0;
  const waiting = [];

  async function withReadSlot(run) {
    if (inFlight >= MAX_IN_FLIGHT_READS) {
      await new Promise((resolve) => waiting.push(resolve));
    }
    inFlight += 1;
    try {
      return await run();
    } finally {
      inFlight -= 1;
      const next = waiting.shift();
      if (next) next();
    }
  }

  function request(method, url, accept, origin) {
    const key = `${method}|${url}|${accept || ""}|${origin || ""}`;
    if (!seen.has(key)) {
      seen.set(key, withReadSlot(async () => {
        const headers = { accept: accept || (method === "HEAD" ? "*/*" : "text/html") };
        if (origin) headers.origin = origin;
        const init = { method, redirect: "follow", headers };
        if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
          init.signal = AbortSignal.timeout(TIMEOUT_MS);
        }
        const res = await web(url, init);
        const text = method !== "HEAD" && typeof res.text === "function" ? await res.text() : "";
        // url is where the call ended after any redirect; "" when the fetch does not say.
        return { status: Number(res.status), text: String(text || ""), header: headerReader(res), url: String((res && res.url) || "") };
      }));
    }
    return seen.get(key);
  }
  const get = (url, accept, origin) => request("GET", url, accept, origin);
  get.head = (url) => request("HEAD", url);
  return get;
}

export function clip(text, n = 420) {
  const s = String(text);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function skip(id, detail) {
  return check(id, "skip", clip(detail), null);
}

export function fail(id, detail, fix) {
  return check(id, "FAIL", clip(detail), fix);
}

export const is2xx = (status) => status >= 200 && status < 300;
export const errText = (err) => String((err && err.message) || err).slice(0, 120);

export function stripComments(html) {
  return String(html ?? "").replace(/<!--[\s\S]*?-->/g, "");
}

/** The value of one attribute inside one tag, or null. */
export function attrOf(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? "") : null;
}

export function absUrl(raw, base) {
  try {
    return new URL(String(raw).replace(/&amp;/g, "&").trim(), base).href;
  } catch {
    return null;
  }
}

export function pathOf(href) {
  try {
    return new URL(href).pathname;
  } catch {
    return "";
  }
}

export function siteOf(href) {
  try {
    return new URL(href).origin;
  } catch {
    return "";
  }
}

export function fileName(href) {
  return pathOf(href).split("/").filter(Boolean).pop() || String(href);
}

/** Every <script src> the page loads (comments left out), as full addresses. */
export function scriptSrcs(html, base) {
  const out = new Set();
  for (const m of stripComments(html).matchAll(/<script\b[^>]*>/gi)) {
    const src = attrOf(m[0], "src");
    const url = src ? absUrl(src, base) : null;
    if (url) out.add(url);
  }
  return [...out];
}

/** Every video file and poster picture the page names, as { url, kind }. */
export function videoFiles(html, base) {
  const out = new Map();
  const add = (raw, kind) => {
    const url = raw ? absUrl(raw, base) : null;
    if (url && !out.has(url)) out.set(url, kind);
  };
  for (const m of stripComments(html).matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi)) {
    const open = ` ${m[1]}`;
    add(attrOf(open, "src"), "video");
    add(attrOf(open, "poster"), "poster");
    for (const s of m[2].matchAll(/<source\b[^>]*>/gi)) add(attrOf(s[0], "src"), "video");
  }
  return [...out].map(([url, kind]) => ({ url, kind }));
}

/** The card box script the widget loads (its SDK_SRC), or null when the page no longer names one. */
export function cardBoxScriptUrl(html, base) {
  const m = /\bSDK_SRC\s*=\s*(?:"([^"]+)"|'([^']+)')/.exec(stripComments(html));
  if (m) return absUrl(m[1] ?? m[2], base);
  return scriptSrcs(html, base).find((u) => /fanbasis/i.test(u)) || null;
}

/** The product price the ClickFunnels checkout page carries, in cents, or null. */
export function orderPriceCents(html) {
  const m = /(?:"|&quot;)price_cents(?:"|&quot;)\s*:\s*(\d+)/.exec(String(html ?? ""));
  return m ? Number(m[1]) : null;
}

/** The price the till reports, in cents, or null when the answer is not usable. */
export function tillPriceCents(body) {
  let cfg;
  try {
    cfg = JSON.parse(body);
  } catch {
    return null;
  }
  if (!cfg || typeof cfg !== "object") return null;
  if (Number.isInteger(cfg.priceCents) && cfg.priceCents > 0) return cfg.priceCents;
  const m = /^\$([\d,]+)(?:\.(\d{2}))?$/.exec(String(cfg.priceDisplay || "").trim());
  return m ? Number(m[1].replace(/,/g, "")) * 100 + Number(m[2] || 0) : null;
}

export function dollars(cents) {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** A page that must answer 2xx. { page } when it does, { why } in plain words when it does not. */
export async function readPage(get, url, accept, origin) {
  try {
    const page = await get(url, accept, origin);
    if (!is2xx(page.status)) return { why: `${url} answered ${page.status}` };
    return { page };
  } catch (err) {
    return { why: `${url} unreachable: ${errText(err)}` };
  }
}

/** Why a script answer is not usable JavaScript, in plain words. Null when it is. */
export function scriptProblem(js) {
  if (!is2xx(js.status)) return `answered ${js.status}`;
  const type = (js.header("content-type") || "").split(";")[0].trim();
  if (type) {
    if (!/javascript|ecmascript/i.test(type)) return `came back as ${type}, not JavaScript`;
  } else if (/^\s*</.test(js.text)) {
    return "came back as a web page, not JavaScript";
  }
  if (!js.text.trim()) return "came back empty";
  return null;
}

// ---- 1. the card box script ------------------------------------------------

/** The card box code is about 21 KB. Anything under this is an error page or a stub. */
export const MIN_CARD_BOX_BYTES = 2000;

export const CARD_BOX_FIX =
  "The widget on /roadmap draws the card boxes with this card company script and never sends a buyer away, " +
  "so no script means no sale. Open https://apply.fundhub.ai/roadmap, press Continue, and see if the boxes draw on step 2. " +
  "Check the card company's status page. Do not run a test order from this check.";

export async function checkCardBox(get, origins) {
  const id = "funnel:card-box-script-loads";
  const pageUrl = `${origins.funnel}/roadmap`;
  const read = await readPage(get, pageUrl);
  if (read.why) {
    return skip(id, `${read.why}, so the card box script was not looked for (funnel:roadmap-checkout reports the page itself)`);
  }
  const src = cardBoxScriptUrl(read.page.text, pageUrl);
  if (!src) {
    return fail(
      id,
      `${pageUrl} no longer names a card box script (the SDK_SRC the widget loads). The widget changed, so this check needs a new look`,
      CARD_BOX_FIX
    );
  }
  let js;
  try {
    js = await get(src, "text/javascript,*/*");
  } catch (err) {
    return fail(id, `the card box script ${src} is unreachable: ${errText(err)}`, CARD_BOX_FIX);
  }
  const problem = scriptProblem(js);
  if (problem) return fail(id, `the card box script ${src} ${problem}`, CARD_BOX_FIX);
  if (js.text.length < MIN_CARD_BOX_BYTES) {
    return fail(id, `the card box script ${src} is only ${js.text.length} bytes, too small to be the card box code`, CARD_BOX_FIX);
  }
  // The widget calls window.PaymentCheckout.create(...). A script that no longer defines it draws nothing.
  if (/\bPaymentCheckout\b/.test(read.page.text) && !/\bPaymentCheckout\b/.test(js.text)) {
    return fail(id, `the card box script ${src} no longer defines PaymentCheckout, the name the page calls`, CARD_BOX_FIX);
  }
  return check(id, "PASS", `the card box script ${src} answers 200 as JavaScript (${js.text.length} bytes) and the page still names it`);
}

// ---- 2b. the order page charges what the till charges ----------------------
//
// /order is the old native ClickFunnels checkout. The row asks one thing: can a
// buyer who lands there pay a price other than the till's? It goes red only while
// /order is a working checkout at another price. Taking /order down clears it.

export const ORDER_PRICE_FIX =
  "The old order page and the till (what /roadmap charges) show different prices for the same product. " +
  "A buyer who lands on /order pays the other price, and a ClickFunnels order does not open the portal. " +
  "Decide which price is right, then make /order match the till, or take /order down (a 404, a 410, or a redirect off /order clears this row). " +
  "Do not edit it from this check.";

/** Where an answer ended after redirects, with the path trimmed of slashes; null when the fetch did not say. */
export function endedAtPath(page) {
  if (!page.url) return null;
  return pathOf(page.url).replace(/\/+$/, "") || "/";
}

export async function checkOrderPrice(get, origins) {
  const id = "funnel:order-price-matches-till";
  const orderUrl = `${origins.funnel}/order`;
  const tillUrl = `${origins.app}/api/public/slo-checkout`;
  let page;
  try {
    page = await get(orderUrl);
  } catch (err) {
    return skip(id, `${orderUrl} unreachable: ${errText(err)}, so its price was not read`);
  }
  // Taken down on purpose is a clear answer, not a failed read: a buyer cannot pay a wrong price at a page that is gone.
  if (page.status === 404 || page.status === 410) {
    return check(id, "PASS", `${orderUrl} answers ${page.status}: the old order page is down, so it cannot charge a price other than the till's`);
  }
  if (!is2xx(page.status)) {
    return skip(id, `${orderUrl} answered ${page.status}, so its price was not read`);
  }
  const endedAt = endedAtPath(page);
  if (endedAt !== null && endedAt !== "/order") {
    return check(id, "PASS", `${orderUrl} sends buyers on to ${page.url}: the old order page is retired, so it cannot charge a price other than the till's`);
  }
  const hasForm = /data-page-element=["']Checkout\/V2["']/.test(page.text) && /CheckoutSubmitButton/.test(page.text);
  if (!hasForm) {
    return skip(
      id,
      `${orderUrl} is up but is not a checkout any more (no checkout form), so there is no price to compare. If it was taken down on purpose, this row stays skipped until /order answers 404 or redirects`
    );
  }
  const orderCents = orderPriceCents(page.text);
  if (orderCents === null) {
    return skip(id, `${orderUrl} has a checkout form but shows no price, so there is nothing to compare`);
  }
  // Same call, same origin as the till read in funnel:roadmap-checkout, so it is fetched once.
  const till = await readPage(get, tillUrl, "application/json", origins.funnel);
  if (till.why) {
    return skip(id, `${till.why}, so the till price was not read (funnel:roadmap-checkout reports the till)`);
  }
  const tillCents = tillPriceCents(till.page.text);
  if (tillCents === null) {
    return skip(id, `${tillUrl} gave no usable price (funnel:roadmap-checkout reports the till)`);
  }
  if (orderCents !== tillCents) {
    return fail(
      id,
      `${orderUrl} charges ${dollars(orderCents)} but the till says ${dollars(tillCents)}, the price /roadmap charges`,
      ORDER_PRICE_FIX
    );
  }
  return check(id, "PASS", `${orderUrl} and the till both say ${dollars(tillCents)}`);
}
