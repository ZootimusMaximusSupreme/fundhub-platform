// bank-classify: the pure rules the apply-links beat uses. No network, no database, no clock of its own.
//
// Pulse v1, piece B1 (ops/workflows/pulse-layer-2026-10-09-v1.md; brief 07 section 3).
// Chris's failure: "the Apply button stopped working on one of the banks". The Apply button opens a bank's
// application_url (public/app/client-control-panel.html, window.FHProxyApply). This file decides, for ONE
// read of ONE bank address, whether the bank page is fine, behind a bot wall, dead, slow, or a bad address.
//
// THE FIVE CLASSES
//   OK       2xx and the page does not say "not found" and is not a bot-wall page.
//   WALL     403 / 429 / other 4xx, a bot-wall page (captcha, "Just a moment"), a 5xx with a wall marker.
//            A WALL is NEVER red. A bank that blocks a data-center address is not a bank that is down.
//   HARD     the bank did not answer at all (name not found, connection refused, bad certificate, or a
//            bare "no connection"), or it answered 5xx with no wall marker.
//   SLOW     no answer in time, a redirect loop, a hop the pulse will not follow (http://, a port), our own side
//            failing (EAI_AGAIN), anything we cannot prove. Never red.
//   BAD_URL  the address itself is the problem: 404 / 410, a page whose title says not found, an address with
//            a space in it, an http:// address, one that points at our own site.
//
// Only HARD and BAD_URL can ever make the beat red, and only for an address that WAS good before
// (it has a last_good_at) and fails again on a second read in the same run. That rule lives in the beat.
//
// WHAT WE CANNOT SEE (and say so): the pulse probe (src/messaging/providers/pulse-probe.mjs) hands back the
// text "fetch failed" for every failure to connect, whether the name did not resolve, the connection was
// refused or the certificate was bad. So a bare "fetch failed" is HARD with the words "no connection". If the
// probe ever adds the system error code to its error text, classifyRead reads it and gives a finer answer.
// It also returns the final HOST of a redirect chain but not the final path, so "redirected to the home page"
// cannot be seen.
//
// WHAT "OK" DOES AND DOES NOT PROVE. OK means the host answered with a page that is not a wall and whose TITLE does not
// say "not found". It does NOT prove the link id inside the address is still valid. Some issuer hosts answer 200 for ANY
// id: www.mycommunitycc.com returned 200 "Online Application" for an id that does not exist (checked 2026-10-09, one
// read), so a dead merchantId link on that host reads OK. That is about 181 of the 987 addresses. creditcardlearnmore.com
// does return a real 404 for a bad id. Only the page title is looked at for a soft 404, never the body.

export const BANK_CLASSES = Object.freeze(["OK", "WALL", "HARD", "SLOW", "BAD_URL"]);

/** Issuer tracking hosts: hundreds of Apply links share a few of these, so they get a bigger cap. */
export const TRACKING_DOMAINS = Object.freeze([
  "creditcardlearnmore.com",
  "mycommunitycc.com",
  "mycardapply.com",
  "thecardservicescenter.com"
]);

export const CAPS = Object.freeze({
  perRun: 40,
  perTrackingHost: 6,
  perOtherHost: 2,
  maxSuspects: 10,
  maxConfirms: 5,
  concurrency: 20
});

/* All times are from the start of the beat. The beat's own deadline is 12 s (the contract maximum) and the
   probe takes up to 8 s for one read, so "stop starting reads at 12 s" would be cut off by the deadline.
   Instead: no new read starts after stopStartMs; a read is given up on after readLimitMs; the second-read
   phase only starts before confirmStartMs. Worst case: 4.0 + 4.5 = 8.5 s for the first phase, and
   6.0 + 4.5 = 10.5 s for the second. Both end before the 12 s deadline. */
export const TIMING = Object.freeze({ readLimitMs: 4500, stopStartMs: 4000, confirmStartMs: 6000 });

const HOST_MAX = 255;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------------------ */
/* Small text helpers. Nothing here may put a query string in a message. */
/* ------------------------------------------------------------------ */

/** Plain ASCII, one line, web addresses removed (they can carry a bank's campaign codes), cut to `max`. */
export function cleanText(value, max = 120) {
  return String(value ?? "")
    .replace(/https?:\/\/\S+/gi, "[address]")
    .replace(/[^\x20-\x7e]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** The host of an address, lower case, or null. */
export function hostOf(address) {
  try { return new URL(String(address)).hostname.toLowerCase().replace(/\.+$/, "") || null; } catch { return null; }
}

/** The tracking domain a host belongs to ("www.mycardapply.com" -> "mycardapply.com"), or null. */
export function trackingDomain(host) {
  const h = String(host ?? "").toLowerCase();
  return TRACKING_DOMAINS.find((d) => h === d || h.endsWith(`.${d}`)) ?? null;
}

/** The key host caps are counted on: the tracking domain, or the full host name. */
export function capKey(host) {
  return trackingDomain(host) ?? String(host ?? "").toLowerCase();
}

/** How many reads one host may get in one run. */
export function capFor(host) {
  return trackingDomain(host) ? CAPS.perTrackingHost : CAPS.perOtherHost;
}

/** The text inside <title>, ASCII, at most 80 characters. "" when there is none. */
export function pageTitle(body) {
  const m = /<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(String(body ?? ""));
  if (!m) return "";
  return cleanText(m[1].replace(/&amp;/gi, "&").replace(/&#0?39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&nbsp;/gi, " "), 80);
}

/* ------------------------------------------------------------------ */
/* url-shape: is the stored address one the pulse can read at all?       */
/* ------------------------------------------------------------------ */

/**
 * Pure. { ok: true, url, host } or { ok: false, reason, host }. A bad shape is class BAD_URL and costs no network.
 * The reasons are written for a person ("has a space in it").
 */
export function checkShape(raw) {
  const text = typeof raw === "string" ? raw : "";
  const looseHost = /^[a-z]+:\/\/([^/?#\s:@]+)/i.exec(text.trim());
  const host0 = looseHost ? looseHost[1].toLowerCase().slice(0, HOST_MAX) : "unknown";
  const bad = (reason, host = host0) => ({ ok: false, reason, host });

  if (!text.trim()) return bad("is empty");
  if (/\s/.test(text)) return bad("has a space or blank in it");
  if (text.length > 2048) return bad("is too long");
  if (/^https?:\/\/(?:[^/?#@]*\.)?fundhub\.ai(?:[:/?#]|$)/i.test(text)) return bad("is our own site, not a bank");
  if (/^http:\/\//i.test(text)) return bad("starts with http, not https");
  if (!/^https:\/\//i.test(text)) return bad("does not start with https://");
  let u;
  try { u = new URL(text); } catch { return bad("is not a web address"); }
  const host = u.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host) return bad("has no host name");
  if (u.username || u.password) return bad("has a user name or password in it", host);
  if (u.port) return bad("has a port number in it", host);
  if (host.startsWith("[") || /^\d+(?:\.\d+){3}$/.test(host)) return bad("uses a number, not a name", host);
  if (host === "localhost" || /\.(?:localhost|local|internal|localdomain|lan|intranet|corp)$/.test(host) || host.endsWith(".home.arpa")) {
    return bad("is a private address", host);
  }
  if (!host.includes(".")) return bad("has a one-word host name", host);
  return { ok: true, url: text, host };
}

/* ------------------------------------------------------------------ */
/* classifyRead: one answer from the web -> one class                    */
/* ------------------------------------------------------------------ */

const WALL_TITLE = /just a moment|pardon our interruption|access denied|attention required|verify you are human|are you a robot|robot check|captcha|security check|checking your browser|request unsuccessful|request blocked/i;
/* Phrases a bot-wall page SAYS to a person, used on error answers (404, 5xx). They are searched in the VISIBLE text of
   the first 8 KB (script and style blocks and tags are removed first), never in the page's code. A real 404 or 500
   page often loads a captcha script (recaptcha/api.js) or shows "protected by reCAPTCHA"; that is not a wall, and the
   bare words "captcha", "access denied" and "cloudflare" are NOT markers (checker finding, 2026-10-09). A Cloudflare 52x
   page means the bank's own server is down, which is a real break. */
const WALL_PHRASE = /just a moment|attention required|pardon our interruption|checking your browser|verify you are (?:a )?human|confirm you are (?:a )?human|are you a robot|unusual traffic|request unsuccessful|incapsula incident|solve the captcha|complete the captcha|captcha challenge|press (?:&amp;|&) hold/i;
const SOFT_404_TITLE = /\b404\b|not found|page unavailable|no longer available|does not exist|doesn'?t exist|cannot be found|can'?t be found/i;

/** Pure. A 2xx answer is a wall only by its header or its TITLE. A good application page may mention a captcha
    or a CDN in its body, so the body is not scanned for a 2xx. */
export function looksLikeWallPage(res) {
  const h = (res && res.headers) || {};
  if (String(h["cf-mitigated"] ?? "").toLowerCase() === "challenge") return true;
  const body = String((res && (res.body || res.bodySnippet)) || "");
  return WALL_TITLE.test(pageTitle(body));
}

/** The words a person would read on a page: script and style blocks, comments and tags removed. */
export function visibleText(body) {
  return String(body ?? "")
    .slice(0, 8192)
    .replace(/<(script|style|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, " ")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/<[^>]*>?/g, " ")
    .replace(/\s+/g, " ");
}

/** Pure. For an error answer (404, 5xx): the title, the header, or an exact wall phrase in the visible text. */
export function looksLikeWall(res) {
  if (looksLikeWallPage(res)) return true;
  return WALL_PHRASE.test(visibleText((res && (res.body || res.bodySnippet)) || ""));
}

/**
 * Turn one probe answer (the shape ctx.http.get returns) into
 * { cls, status, why, title, finalHost }. Pure; never throws.
 * `why` is a short plain phrase with no web address in it.
 */
export function classifyRead(res) {
  const r = res && typeof res === "object" ? res : {};
  const status = Number.isInteger(r.status) ? r.status : Number(r.status) || 0;
  const finalHost = r.finalHost ? String(r.finalHost).toLowerCase().slice(0, HOST_MAX) : null;
  const err = cleanText(r.error, 200);
  const kind = String(r.class ?? "");
  const out = (cls, why, title = "") => ({ cls, status, why, title, finalHost });

  // The probe refuses a hop it will not follow: a redirect to http://, to a port, to an address by number.
  // A person's browser follows those, so this is "we could not follow it", never "the address is bad".
  // (Live calibration 2026-10-09: two real bank sites sent the pulse to a hop it refuses.)
  if (kind === "refused") return out("SLOW", err ? `the pulse will not follow it (${err.replace(/^refused:\s*/i, "")}); unproven` : "the pulse will not follow it; unproven");
  if (kind === "blocked") return out("SLOW", "web calls are on hold (dry-run fence)");
  if (kind === "timeout") return out("SLOW", err || "no answer in time");
  if (kind === "too_many_redirects") return out("SLOW", "too many redirects (unproven)");

  if (status === 0) {
    if (/ENOTFOUND|EAI_NODATA|EAI_NONAME|getaddrinfo ENOTFOUND/i.test(err)) return out("HARD", "the bank name does not resolve");
    if (/ECONNREFUSED/i.test(err)) return out("HARD", "the bank refused the connection");
    if (/CERT_|ERR_TLS|ERR_SSL|SSL_|certificate|self.signed|UNABLE_TO_VERIFY|ALTNAME|handshake/i.test(err)) return out("HARD", "the bank certificate is bad");
    if (/EAI_AGAIN|ETIMEDOUT|ECONNRESET|EPIPE|UND_ERR|socket hang up|timed out|aborted/i.test(err)) return out("SLOW", err || "no answer in time");
    return out("HARD", "no connection to the bank site");
  }

  const body = r.body || r.bodySnippet || "";
  const title = pageTitle(body);

  if (status >= 200 && status < 300) {
    if (looksLikeWallPage(r)) return out("WALL", "a bot-wall page answered", title);
    if (SOFT_404_TITLE.test(title)) return out("BAD_URL", "the page says not found", title);
    return out("OK", "the page opened", title);
  }
  if (status >= 300 && status < 400) return out("SLOW", "a redirect with nowhere to go (unproven)");
  if (status === 404 || status === 410) {
    if (looksLikeWall(r)) return out("WALL", "a bot-wall page answered", title);
    return out("BAD_URL", "page not found", title);
  }
  if (status === 408) return out("SLOW", "the bank gave up waiting");
  if (status >= 400 && status < 500) return out("WALL", "refused us (unproven, not a break)", title);
  if (status >= 500) {
    if (looksLikeWall(r)) return out("WALL", "a bot-wall page answered", title);
    return out("HARD", "the bank site has an error", title);
  }
  return out("SLOW", "an answer we do not know");
}

/** HARD and BAD_URL are the only classes that can make the beat red. */
export const isBroken = (cls) => cls === "HARD" || cls === "BAD_URL";

/** The sentence stored in pulse_bank_links.last_detail. No query string, ASCII, at most 300 characters. */
export function describeRead(c) {
  const parts = [c.cls, c.status ? String(c.status) : "", cleanText(c.why, 100)];
  let s = parts.filter(Boolean).join(" ");
  if (c.finalHost) s += ` at ${c.finalHost}`;
  if (c.title && c.cls !== "OK") s += ` "${cleanText(c.title, 50)}"`;
  return cleanText(s, 300);
}

/* ------------------------------------------------------------------ */
/* pickLinks: which 40 addresses to read this run                         */
/* ------------------------------------------------------------------ */

const ageOf = (row) => {
  const t = row && row.lastCheckedAt ? Date.parse(row.lastCheckedAt) : NaN;
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/** Was this address good once and is it broken now? Those are read again on every run. */
export const isSuspect = (row) => Boolean(row && row.lastGoodAt && isBroken(row.lastClass));

/**
 * Pure. Choose what to read.
 *   1. suspects first (was good, last read HARD or BAD_URL), at most CAPS.maxSuspects;
 *   2. then the rest, oldest last_checked_at first, never-checked first. Among never-checked addresses
 *      the first address of every host comes before the second of any host (so the first pass sweeps many
 *      different banks instead of one issuer), then by hash so the order is the same every time;
 *   3. at most CAPS.perTrackingHost reads per tracking domain and CAPS.perOtherHost per other host;
 *   4. at most CAPS.perRun in all.
 *
 * candidates: [{ urlHash, url, host, lenderIds }]  (shape already checked)
 * stateByHash: Map<urlHash, bankLinks row>
 * Returns { picks: [{ ...candidate, prev, suspect }], capped: number }
 */
export function pickLinks({ candidates, stateByHash, caps = CAPS }) {
  const byHost = new Map();
  for (const c of candidates) {
    if (!byHost.has(c.host)) byHost.set(c.host, []);
    byHost.get(c.host).push(c);
  }
  const rank = new Map();
  for (const list of byHost.values()) {
    list.sort((a, b) => (a.urlHash < b.urlHash ? -1 : a.urlHash > b.urlHash ? 1 : 0));
    list.forEach((c, i) => rank.set(c.urlHash, i));
  }
  const prevOf = (c) => (stateByHash && stateByHash.get(c.urlHash)) || null;
  const byAge = (a, b) => {
    const da = ageOf(prevOf(a));
    const db = ageOf(prevOf(b));
    if (da !== db) return da < db ? -1 : 1;
    if (rank.get(a.urlHash) !== rank.get(b.urlHash)) return rank.get(a.urlHash) - rank.get(b.urlHash);
    return a.urlHash < b.urlHash ? -1 : a.urlHash > b.urlHash ? 1 : 0;
  };

  const suspects = candidates.filter((c) => isSuspect(prevOf(c))).sort(byAge).slice(0, caps.maxSuspects);
  const suspectSet = new Set(suspects.map((c) => c.urlHash));
  const rest = candidates.filter((c) => !suspectSet.has(c.urlHash)).sort(byAge);

  const used = new Map();
  const picks = [];
  let capped = 0;
  const take = (c, suspect) => {
    if (picks.length >= caps.perRun) return;
    const key = capKey(c.host);
    const limit = trackingDomain(c.host) ? caps.perTrackingHost : caps.perOtherHost;
    if ((used.get(key) ?? 0) >= limit) { capped++; return; }
    used.set(key, (used.get(key) ?? 0) + 1);
    picks.push({ ...c, prev: prevOf(c), suspect });
  };
  for (const c of suspects) take(c, true);
  for (const c of rest) take(c, false);
  return { picks, capped };
}

/* ------------------------------------------------------------------ */
/* Rows to save, and the words for a break                                */
/* ------------------------------------------------------------------ */

/**
 * The pulse_bank_links row for one read (v1 delta 13 shape). `read` is { cls, status, why, title, finalHost }.
 * lastGoodAt moves to now on OK; otherwise the old value is sent back unchanged.
 */
export function buildRow({ cand, prev, read, nowIso }) {
  const lenderIds = (cand.lenderIds || []).filter((x) => ID_RE.test(String(x)));
  return {
    urlHash: cand.urlHash,
    host: cand.host,
    lenderId: lenderIds[0] ?? null,
    lenderIds,
    lastCheckedAt: nowIso,
    lastGoodAt: read.cls === "OK" ? nowIso : (prev && prev.lastGoodAt) || null,
    lastClass: read.cls,
    lastStatus: read.status || 0,
    lastDetail: describeRead(read),
    finalHost: read.finalHost || null
  };
}

/** A row for an address that failed the shape check (class BAD_URL, no network). */
export function buildShapeRow({ cand, prev, nowIso }) {
  const lenderIds = (cand.lenderIds || []).filter((x) => ID_RE.test(String(x)));
  return {
    urlHash: cand.urlHash,
    host: cand.host || "unknown",
    lenderId: lenderIds[0] ?? null,
    lenderIds,
    lastCheckedAt: nowIso,
    lastGoodAt: (prev && prev.lastGoodAt) || null,
    lastClass: "BAD_URL",
    lastStatus: 0,
    lastDetail: cleanText(`BAD_URL the stored address ${cand.reason}`, 300),
    finalHost: null
  };
}

/**
 * The break text. The bank host comes FIRST, then the class, then a short lender id (8 characters). The alert
 * layer cuts a detail to about 100 characters for the phone and turns any 24+ character id into "[long value]",
 * so the host and class must lead and the id must be short. The full lender ids are in evidence.confirmed and in
 * the pulse_bank_links row. NEVER the query string. items: [{ lenderId, rows, cls, status, host }]. At most `max` chars.
 */
export function breakDetail(items, max = 300) {
  const total = items.length;
  const tailFor = (n) => ` - ${n} bank Apply link${n === 1 ? "" : "s"} broke after it worked.`;
  const bits = [];
  let used = tailFor(total).length;
  for (const it of items) {
    const rows = it.rows > 1 ? `, ${it.rows} lender rows` : "";
    const short = String(it.lenderId || "").slice(0, 8) || "unknown";
    const bit = `${it.host} ${it.cls}${it.status ? ` ${it.status}` : " no answer"} (lender ${short}${rows})`;
    const left = total - bits.length - 1;
    const more = left > 0 ? `; and ${left} more` : "";
    if (bits.length > 0 && used + bit.length + 2 + more.length > max) break;
    bits.push(bit);
    used += bit.length + 2;
  }
  const more = total - bits.length;
  return cleanText(`${bits.join("; ")}${more > 0 ? `; and ${more} more` : ""}${tailFor(total)}`, max);
}

/* ------------------------------------------------------------------ */
/* Two tiny async helpers (no clock of their own, no I/O)                  */
/* ------------------------------------------------------------------ */

/**
 * Run `worker` over `items` with at most `concurrency` at once. Before each item starts it asks canStart();
 * once that says no, nothing new starts and the items left are not run. A worker that throws costs its own
 * item only. Returns an array the same length as `items`; an item that never ran is `undefined`.
 */
export async function runPool(items, worker, { concurrency = CAPS.concurrency, canStart = () => true } = {}) {
  const out = new Array(items.length);
  let next = 0;
  async function lane() {
    for (;;) {
      if (!canStart()) return;
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await worker(items[i], i); } catch (err) { out[i] = { error: cleanText((err && err.message) || err, 120) }; }
    }
  }
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: items.length ? lanes : 0 }, lane));
  return out;
}

/** Give up on `promise` after `ms`. The timeout answer has the probe's shape, class "timeout". */
export async function withinMs(promise, ms) {
  let timer;
  const gone = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, status: 0, ms, finalHost: null, body: "", bodySnippet: "", headers: {}, error: `no answer in ${Math.round(ms / 100) / 10} s`, class: "timeout" }), ms);
  });
  try { return await Promise.race([promise, gone]); } finally { clearTimeout(timer); }
}
