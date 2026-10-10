// Tests for the apply-links rules (src/pulse/beats/lib/bank-classify.mjs). Pure: no network, no database.
//
// The statuses and titles in CALIBRATION are the real answers from the 40-host calibration in
// ops/workflows/pulse-layer-2026-10-09-brief/07-first-beats.md section 3.1 (one GET per host from a laptop,
// 2026-10-09), plus the shapes the pulse probe returns for a failed connection (the text is always "fetch failed").
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BANK_CLASSES, CAPS, TIMING, TRACKING_DOMAINS, cleanText, hostOf, trackingDomain, capKey, capFor, pageTitle, checkShape,
  classifyRead, looksLikeWall, visibleText, isBroken, describeRead, isSuspect, pickLinks, buildRow, buildShapeRow, breakDetail, runPool, withinMs
} from "./bank-classify.mjs";

const html = (title, extra = "") => `<!doctype html><html><head><title>${title}</title></head><body>${extra}</body></html>`;
const page = (status, title, over = {}) => ({ ok: status >= 200 && status < 300, status, finalHost: "www.bank.example.com", body: html(title), headers: {}, error: null, class: "ok", ...over });
const down = (error, klass = "network") => ({ ok: false, status: 0, finalHost: "www.bank.example.com", body: "", headers: {}, error, class: klass });

/* ---------------- classifyRead: table driven ---------------- */

const CALIBRATION = [
  // [what it was, the probe answer, expected class]
  ["200, real page (30 of 40)", page(200, "Business Credit Card Application | Example Bank"), "OK"],
  ["200 after one redirect (the probe returns the last answer)", page(200, "Apply Now", { redirects: 1 }), "OK"],
  ["200 but a bot wall: baycoastbank.myapexcard.com", page(200, "Pardon Our Interruption"), "WALL"],
  ["200 but a soft 404: www.bankatpeoples.com", page(200, "404 - File Not Found"), "BAD_URL"],
  ["403 Cloudflare challenge: www.flagstar.com", page(403, "Just a moment...", { class: "http_4xx" }), "WALL"],
  ["403 Cloudflare challenge: www.carterbank.com", page(403, "Just a moment...", { class: "http_4xx" }), "WALL"],
  ["403 with a normal title: www.alliantcreditunion.org", page(403, "Alliant Credit Union", { class: "http_4xx" }), "WALL"],
  ["403 plain Forbidden: www.traditions.bank", page(403, "403 Forbidden", { class: "http_4xx" }), "WALL"],
  ["403 plain Forbidden: www.veritycu.com", page(403, "403 Forbidden", { class: "http_4xx" }), "WALL"],
  ["404, real: www.westernalliancebancorporation.com", page(404, "Page Not Found", { class: "http_4xx" }), "BAD_URL"],
  ["TLS name mismatch: www.citywidebanks.com (the probe says only: fetch failed)", down("fetch failed"), "HARD"],
  ["timeout at 8 s: www.penfed.org", down("timed out after 8000ms", "timeout"), "SLOW"]
];

const OTHER = [
  ["429 too many requests", page(429, "Too Many Requests", { class: "http_4xx" }), "WALL"],
  ["401", page(401, "Sign in", { class: "http_4xx" }), "WALL"],
  ["400 from a firewall", page(400, "Bad Request", { class: "http_4xx" }), "WALL"],
  ["406 from a firewall", page(406, "Not Acceptable", { class: "http_4xx" }), "WALL"],
  ["410 gone", page(410, "Gone", { class: "http_4xx" }), "BAD_URL"],
  ["404 under a bot-wall title is a WALL, not a dead link", page(404, "Attention Required! | Cloudflare", { class: "http_4xx" }), "WALL"],
  ["404 with the cf-mitigated header is a WALL", page(404, "x", { headers: { "cf-mitigated": "challenge" }, class: "http_4xx" }), "WALL"],
  ["408 request timeout", page(408, "Request Timeout", { class: "http_4xx" }), "SLOW"],
  ["500", page(500, "Internal Server Error", { class: "http_5xx" }), "HARD"],
  ["502 from a Cloudflare error page: the bank server is down, a real break", page(502, "Bad gateway", { class: "http_5xx", body: html("Bad gateway", "cloudflare ray id 123") }), "HARD"],
  ["503 with a challenge page", page(503, "Just a moment...", { class: "http_5xx" }), "WALL"],
  ["503 with the cf-mitigated header", page(503, "x", { headers: { "cf-mitigated": "challenge" }, class: "http_5xx" }), "WALL"],
  ["503 with a captcha word in the body", page(503, "x", { class: "http_5xx", body: html("Service", "please solve the captcha") }), "WALL"],
  ["503 plain", page(503, "Service Unavailable", { class: "http_5xx" }), "HARD"],
  ["a 2xx whose BODY mentions captcha and cloudflare is a good page (title is normal)", page(200, "Apply for a business card", { body: html("Apply for a business card", "protected by captcha, cdnjs.cloudflare.com") }), "OK"],
  ["200 with 'robot' in the title", page(200, "Are you a robot?"), "WALL"],
  ["200 with 'Access Denied' title", page(200, "Access Denied"), "WALL"],
  ["200 with the cf-mitigated header", page(200, "ok", { headers: { "cf-mitigated": "challenge" } }), "WALL"],
  ["200, title 'Page not found'", page(200, "Page not found - Example Bank"), "BAD_URL"],
  ["200, title 'This page is no longer available'", page(200, "This page is no longer available"), "BAD_URL"],
  ["200, no title at all", { ...page(200, "x"), body: "<html><body>Apply</body></html>" }, "OK"],
  ["a redirect that has nowhere to go", page(302, "Moved", { class: "redirect" }), "SLOW"],
  ["too many redirects", down("more than 5 redirects", "too_many_redirects"), "SLOW"],
  ["DNS: name not found", down("getaddrinfo ENOTFOUND www.nosuchbank.example"), "HARD"],
  ["connection refused", down("connect ECONNREFUSED 10.0.0.1:443"), "HARD"],
  ["TLS: certificate expired", down("CERT_HAS_EXPIRED"), "HARD"],
  ["TLS: wrong name", down("ERR_TLS_CERT_ALTNAME_INVALID"), "HARD"],
  ["TLS: can not verify", down("UNABLE_TO_VERIFY_LEAF_SIGNATURE"), "HARD"],
  ["connection reset (a firewall, or us): unproven", down("read ECONNRESET"), "SLOW"],
  ["our own DNS failed (EAI_AGAIN)", down("getaddrinfo EAI_AGAIN www.x.example"), "SLOW"],
  ["a socket timeout code", down("UND_ERR_CONNECT_TIMEOUT"), "SLOW"],
  ["the probe will not follow a redirect hop (http://, a port): unproven, never a bad address", down("refused: only https is allowed (got http)", "refused"), "SLOW"],
  ["the dry-run fence is holding calls", down("the dry-run fence is holding web calls (ADAPTERS_DRY_RUN)", "blocked"), "SLOW"],
  ["our own read timeout", down("no answer in 4.5 s", "timeout"), "SLOW"],
  ["nothing at all", null, "HARD"],
  ["junk", "text", "HARD"],
  ["a status we do not know", { status: 299, class: "ok", ok: true, body: html("Fine") }, "OK"],
  ["a status of 199", { status: 199, class: "x", body: "" }, "SLOW"]
];

for (const [name, res, expected] of [...CALIBRATION, ...OTHER]) {
  test(`classifyRead: ${name} -> ${expected}`, () => {
    const c = classifyRead(res);
    assert.equal(c.cls, expected, JSON.stringify(c));
    assert.ok(BANK_CLASSES.includes(c.cls));
    assert.ok(typeof c.why === "string" && c.why.length > 0);
  });
}

test("classifyRead: the 40-host calibration reads as the brief says (about 3 broken, 7 walls, 1 unknown, 30 fine)", () => {
  const counts = { OK: 0, WALL: 0, HARD: 0, SLOW: 0, BAD_URL: 0 };
  // 30 real pages, 1 bot wall, 1 soft 404, 5 x 403, 1 x 404, 1 TLS, 1 timeout = 40
  const sample = [
    ...Array.from({ length: 30 }, () => page(200, "Apply")),
    page(200, "Pardon Our Interruption"), page(200, "404 - File Not Found"),
    page(403, "Just a moment..."), page(403, "Just a moment..."), page(403, "Alliant"), page(403, "403 Forbidden"), page(403, "403 Forbidden"),
    page(404, "Page Not Found"), down("fetch failed"), down("timed out after 8000ms", "timeout")
  ];
  assert.equal(sample.length, 40);
  for (const s of sample) counts[classifyRead(s).cls]++;
  assert.deepEqual(counts, { OK: 30, WALL: 6, HARD: 1, SLOW: 1, BAD_URL: 2 });
});

test("classifyRead: a WALL is never broken; only HARD and BAD_URL are", () => {
  assert.deepEqual(BANK_CLASSES.filter(isBroken), ["HARD", "BAD_URL"]);
});

test("classifyRead: carries the status and the final host, never throws on odd input", () => {
  const c = classifyRead(page(404, "Page Not Found", { finalHost: "WWW.Bank.Example.COM" }));
  assert.equal(c.status, 404);
  assert.equal(c.finalHost, "www.bank.example.com");
  for (const odd of [undefined, null, 0, "", [], {}, { status: "404" }, { status: NaN }, { status: 404, body: 12 }, { status: 200, body: null, headers: null }]) {
    assert.doesNotThrow(() => classifyRead(odd));
  }
  assert.equal(classifyRead({ status: "404" }).cls, "BAD_URL", "a status that came as text still reads");
});

test("looksLikeWall: title, header, or a wall word in the first 4 KB of an error page", () => {
  assert.equal(looksLikeWall(page(403, "Just a moment...")), true);
  assert.equal(looksLikeWall(page(403, "Fine", { headers: { "cf-mitigated": "challenge" } })), true);
  assert.equal(looksLikeWall(page(500, "x", { body: html("x", "Incapsula incident") })), true);
  assert.equal(looksLikeWall(page(500, "Server error")), false);
  assert.equal(looksLikeWall(null), false);
});

test("looksLikeWall: a real 404 or 500 that LOADS a captcha script or shows a reCAPTCHA badge is not a wall (checker finding)", () => {
  const script = '<script src="https://www.google.com/recaptcha/api.js"></script><div class="g-recaptcha" data-sitekey="x"></div>';
  const badge = "This site is protected by reCAPTCHA and the Google Privacy Policy and Terms of Service apply.";
  for (const status of [404, 410, 500, 503]) {
    assert.equal(looksLikeWall(page(status, "Page Not Found", { body: `<html><head><title>Page Not Found</title>${script}</head><body>${badge} Access denied to this folder is not what this page says; it says gone.</body></html>` })), false, String(status));
  }
  assert.equal(looksLikeWall(page(500, "x", { body: "<html><body><p>Cloudflare Ray ID: 1</p></body></html>" })), false, "the bare word cloudflare is not a wall");
  assert.equal(looksLikeWall(page(503, "x", { body: html("x", "<p>Please complete the CAPTCHA to continue</p>") })), true, "a visible wall phrase still is");
});

test("classifyRead: a real 404 that loads recaptcha reads BAD_URL; the same page as a 500 reads HARD (never hidden as WALL)", () => {
  const body = '<html><head><title>Page Not Found</title><script src="https://www.google.com/recaptcha/api.js"></script></head><body>Gone.</body></html>';
  assert.equal(classifyRead(page(404, "Page Not Found", { class: "http_4xx", body })).cls, "BAD_URL");
  assert.equal(classifyRead(page(500, "Server Error", { class: "http_5xx", body: body.replace("Page Not Found", "Server Error") })).cls, "HARD");
  // and a real wall page on a 404 is still a wall by its title
  assert.equal(classifyRead(page(404, "Just a moment...", { class: "http_4xx" })).cls, "WALL");
});

test("visibleText: scripts, styles, comments and tags are gone; an open script is cut off", () => {
  assert.equal(visibleText('<p>Hi <b>there</b></p><script>var captcha=1</script><style>.x{}</style><!-- captcha -->ok').trim(), "Hi there ok");
  assert.equal(visibleText("<p>a</p><script>captcha captcha captcha").trim(), "a");
  assert.equal(visibleText(null), "");
});

test("LIMIT: a 200 'Online Application' page reads OK even if the id inside the link is dead (mycommunitycc.com answers 200 for any id); only the title is read for a soft 404", () => {
  assert.equal(classifyRead(page(200, "Online Application")).cls, "OK");
  assert.equal(classifyRead(page(200, "First Bank | Home", { body: html("First Bank | Home", "<h1>Sorry, we could not find that page</h1>") })).cls, "OK");
});

/* ---------------- describeRead: the stored sentence ---------------- */

test("classifyRead: the refused hop is explained in words and carries no address", () => {
  const c = classifyRead(down("refused: only https is allowed (got http)", "refused"));
  assert.equal(c.cls, "SLOW");
  assert.match(c.why, /the pulse will not follow it \(only https is allowed \(got http\)\); unproven/);
  assert.equal(classifyRead(down("", "refused")).why, "the pulse will not follow it; unproven");
});

test("describeRead: class, status, plain reason, final host, a short title; never a web address", () => {
  const c = classifyRead(page(404, "Page Not Found", { finalHost: "www.bank.example.com" }));
  const d = describeRead(c);
  assert.match(d, /^BAD_URL 404 page not found at www\.bank\.example\.com "Page Not Found"$/);
  assert.equal(describeRead(classifyRead(page(200, "Apply"))), "OK 200 the page opened at www.bank.example.com", "an OK read shows no title");
  assert.match(describeRead(classifyRead(down("fetch failed"))), /^HARD no connection to the bank site at www\.bank\.example\.com$/);
  const leaky = describeRead(classifyRead(down("request to https://www.bank.example.com/apply?ecid=SECRET123 failed")));
  assert.ok(!/SECRET123|ecid|https?:/i.test(leaky), leaky);
  assert.ok(describeRead({ cls: "WALL", status: 403, why: "x".repeat(900), title: "t".repeat(900), finalHost: "h" }).length <= 300);
});

/* ---------------- text helpers ---------------- */

test("cleanText: removes web addresses and non-ASCII, collapses blanks, cuts to length", () => {
  assert.equal(cleanText("see https://x.example.com/a?b=c now"), "see [address] now");
  assert.equal(cleanText("café  \n  bar"), "caf bar");
  assert.equal(cleanText("abcdef", 3), "abc");
  assert.equal(cleanText(null), "");
  assert.equal(cleanText({ toString() { return "ok"; } }), "ok");
});

test("pageTitle: reads the title, decodes a few entities, ignores a missing one", () => {
  assert.equal(pageTitle("<title>Hello &amp; welcome</title>"), "Hello & welcome");
  assert.equal(pageTitle("<TITLE lang=en>\n  Apply\n</TITLE>"), "Apply");
  assert.equal(pageTitle("<p>none</p>"), "");
  assert.equal(pageTitle(null), "");
  assert.ok(pageTitle(`<title>${"a".repeat(400)}</title>`).length <= 80);
  assert.equal(pageTitle("<title>café</title>"), "caf");
});

test("hostOf, trackingDomain, capKey, capFor", () => {
  assert.equal(hostOf("https://WWW.Bank.example.com./a?b=1"), "www.bank.example.com");
  assert.equal(hostOf("nonsense"), null);
  assert.deepEqual([...TRACKING_DOMAINS].sort(), ["creditcardlearnmore.com", "mycardapply.com", "mycommunitycc.com", "thecardservicescenter.com"]);
  assert.equal(trackingDomain("www.mycommunitycc.com"), "mycommunitycc.com");
  assert.equal(trackingDomain("app.thecardservicescenter.com"), "thecardservicescenter.com");
  assert.equal(trackingDomain("creditcardlearnmore.com"), "creditcardlearnmore.com");
  assert.equal(trackingDomain("notmycardapply.com"), null, "a different domain that ends the same way is not the tracking host");
  assert.equal(capKey("www.mycardapply.com"), "mycardapply.com");
  assert.equal(capKey("www.otherbank.com"), "www.otherbank.com");
  assert.equal(capFor("www.mycardapply.com"), 6);
  assert.equal(capFor("www.otherbank.com"), 2);
  assert.deepEqual({ ...CAPS }, { perRun: 40, perTrackingHost: 6, perOtherHost: 2, maxSuspects: 10, maxConfirms: 5, concurrency: 20 });
});

test("TIMING: both phases end before the beat's own 12 s deadline", () => {
  assert.ok(TIMING.stopStartMs + TIMING.readLimitMs < 12000);
  assert.ok(TIMING.confirmStartMs + TIMING.readLimitMs < 12000);
});

/* ---------------- checkShape ---------------- */

const SHAPE = [
  ["a plain https address", "https://www.bank.example.com/apply", true],
  ["with a query (a tracking code)", "https://creditcardlearnmore.com/card?ecdma-lc=27795&ecid=abc", true],
  ["upper-case scheme", "HTTPS://WWW.BANK.EXAMPLE.COM/", true],
  ["the real bad row: a space inside the query", "https://creditcardlearnmore.com/card?ecdma-lc= 27795&ecid=abc", false, /space/],
  ["a trailing space", "https://www.bank.example.com/apply ", false, /space/],
  ["a tab", "https://www.bank.example.com/ap\tply", false, /space/],
  ["http, not https", "http://www.bank.example.com/apply", false, /http, not https/],
  ["no scheme", "www.bank.example.com/apply", false, /https:\/\//],
  ["ftp", "ftp://www.bank.example.com/apply", false, /https:\/\//],
  ["empty", "", false, /empty/],
  ["blank", "   ", false, /empty/],
  ["null", null, false, /empty/],
  ["a number", 12, false, /empty/],
  ["garbage after the scheme", "https://", false],
  ["a port", "https://www.bank.example.com:8443/apply", false, /port/],
  ["a user and password", "https://user:pw@www.bank.example.com/apply", false, /user name/],
  ["a literal IP", "https://203.0.113.9/apply", false, /number, not a name/],
  ["an IPv6 literal", "https://[2001:db8::1]/apply", false],
  ["localhost", "https://localhost/apply", false, /private/],
  ["a .internal name", "https://bank.internal/apply", false, /private/],
  ["a one-word host", "https://intranet/apply", false, /one-word/],
  ["too long", `https://www.bank.example.com/${"a".repeat(2100)}`, false, /too long/],
  ["our own site", "https://www.fundhub.ai/roadmap", false, /our own site/],
  ["our own site, bare", "https://fundhub.ai/x", false, /our own site/],
  ["a bank whose name only ends the same way", "https://www.notfundhub.ai.example.com/x", true]
];
for (const [name, raw, ok, reason] of SHAPE) {
  test(`checkShape: ${name}`, () => {
    const s = checkShape(raw);
    assert.equal(s.ok, ok, JSON.stringify(s));
    if (ok) {
      assert.ok(s.url && s.host);
    } else {
      assert.ok(typeof s.reason === "string" && s.reason.length > 0);
      assert.ok(typeof s.host === "string" && s.host.length > 0 && s.host.length <= 255);
      if (reason) assert.match(s.reason, reason);
    }
  });
}

test("checkShape: the host of a bad address is still named when it can be read", () => {
  assert.equal(checkShape("https://creditcardlearnmore.com/card?ecdma-lc= 27795").host, "creditcardlearnmore.com");
  assert.equal(checkShape("http://www.plain.example.com/a").host, "www.plain.example.com");
  assert.equal(checkShape(null).host, "unknown");
  assert.equal(checkShape("https://Bank.Example.com./a").host, "bank.example.com");
});

/* ---------------- pickLinks ---------------- */

const hashN = (n) => n.toString(16).padStart(64, "0");
const cand = (n, host, extra = {}) => ({ urlHash: hashN(n), url: `https://${host}/apply?ecid=SECRET${n}`, host, lenderIds: [`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`], ...extra });
const stateMap = (rows) => new Map(rows.map((r) => [r.urlHash, r]));
const checkedRow = (n, over = {}) => ({ urlHash: hashN(n), lastCheckedAt: "2026-10-09T10:00:00.000Z", lastGoodAt: "2026-10-09T10:00:00.000Z", lastClass: "OK", ...over });

test("pickLinks: the first pass takes one address from each of 40 different hosts", () => {
  // 4 tracking hosts with 100 addresses each, 100 other hosts with 3 each.
  const c = [];
  let n = 1;
  for (const d of TRACKING_DOMAINS) for (let i = 0; i < 100; i++) c.push(cand(n++, `www.${d}`));
  for (let h = 0; h < 100; h++) for (let i = 0; i < 3; i++) c.push(cand(n++, `www.bank${h}.example.com`));
  const { picks } = pickLinks({ candidates: c, stateByHash: new Map() });
  assert.equal(picks.length, 40);
  assert.equal(new Set(picks.map((p) => p.host)).size, 40, "forty different hosts, one address each");
  assert.ok(picks.every((p) => p.prev === null && p.suspect === false));
});

test("pickLinks: same input, same order", () => {
  const c = Array.from({ length: 80 }, (_, i) => cand(i + 1, `www.bank${i % 30}.example.com`));
  const a = pickLinks({ candidates: c, stateByHash: new Map() }).picks.map((p) => p.urlHash);
  const b = pickLinks({ candidates: [...c].reverse(), stateByHash: new Map() }).picks.map((p) => p.urlHash);
  assert.deepEqual(a, b);
});

test("pickLinks: at most 6 per tracking host and 2 per other host, 40 in all", () => {
  const c = [];
  let n = 1;
  for (const d of TRACKING_DOMAINS) for (let i = 0; i < 50; i++) c.push(cand(n++, i % 2 ? `www.${d}` : d)); // two names, one domain
  for (let i = 0; i < 20; i++) c.push(cand(n++, "www.onebigbank.example.com"));
  for (let h = 0; h < 5; h++) c.push(cand(n++, `www.other${h}.example.com`));
  const { picks, capped } = pickLinks({ candidates: c, stateByHash: new Map() });
  assert.equal(picks.length, 4 * 6 + 2 + 5, "24 on the tracking domains, 2 on the big bank, 1 on each of 5 small ones");
  assert.ok(capped > 0);
  const per = new Map();
  for (const p of picks) per.set(capKeyOf(p.host), (per.get(capKeyOf(p.host)) ?? 0) + 1);
  for (const [key, count] of per) {
    const limit = TRACKING_DOMAINS.includes(key) ? 6 : 2;
    assert.ok(count <= limit, `${key} got ${count} (limit ${limit})`);
  }
});
const capKeyOf = (host) => trackingDomain(host) ?? host;

test("pickLinks: oldest last_checked_at first, never-checked before any checked", () => {
  const c = Array.from({ length: 50 }, (_, i) => cand(i + 1, `www.bank${i}.example.com`));
  const state = [];
  // 1..30 checked at increasing times (1 is oldest); 31..50 never checked
  for (let i = 1; i <= 30; i++) state.push(checkedRow(i, { lastCheckedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }));
  const { picks } = pickLinks({ candidates: c, stateByHash: stateMap(state) });
  const got = picks.map((p) => p.urlHash);
  const never = [];
  for (let i = 31; i <= 50; i++) never.push(hashN(i));
  assert.deepEqual(new Set(got.slice(0, 20)), new Set(never), "the 20 never-checked come first");
  assert.deepEqual(got.slice(20), Array.from({ length: 20 }, (_, i) => hashN(i + 1)), "then the 20 oldest, oldest first");
});

test("pickLinks: a suspect (was good, now HARD or BAD_URL) goes first even if it was read a minute ago", () => {
  const c = Array.from({ length: 60 }, (_, i) => cand(i + 1, `www.bank${i}.example.com`));
  const state = c.map((x, i) => checkedRow(i + 1, { lastCheckedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }));
  state[59] = checkedRow(60, { lastCheckedAt: "2026-10-09T18:59:00.000Z", lastClass: "HARD" });
  assert.equal(isSuspect(state[59]), true);
  const { picks } = pickLinks({ candidates: c, stateByHash: stateMap(state) });
  assert.equal(picks[0].urlHash, hashN(60));
  assert.equal(picks[0].suspect, true);
  assert.equal(picks.length, 40);
});

test("pickLinks: never good is not a suspect; WALL is not a suspect; at most 10 suspects", () => {
  assert.equal(isSuspect({ lastGoodAt: null, lastClass: "HARD" }), false);
  assert.equal(isSuspect({ lastGoodAt: "2026-10-01T00:00:00Z", lastClass: "WALL" }), false);
  assert.equal(isSuspect({ lastGoodAt: "2026-10-01T00:00:00Z", lastClass: "SLOW" }), false);
  assert.equal(isSuspect({ lastGoodAt: "2026-10-01T00:00:00Z", lastClass: "BAD_URL" }), true);
  assert.equal(isSuspect(null), false);
  const c = Array.from({ length: 30 }, (_, i) => cand(i + 1, `www.bank${i}.example.com`));
  const state = c.map((x, i) => checkedRow(i + 1, { lastClass: "HARD" }));
  const { picks } = pickLinks({ candidates: c, stateByHash: stateMap(state) });
  assert.equal(picks.filter((p) => p.suspect).length, CAPS.maxSuspects);
});

test("pickLinks: suspects obey the host caps too", () => {
  const c = Array.from({ length: 20 }, (_, i) => cand(i + 1, "www.mycardapply.com"));
  const state = c.map((x, i) => checkedRow(i + 1, { lastClass: "BAD_URL" }));
  const { picks } = pickLinks({ candidates: c, stateByHash: stateMap(state) });
  assert.equal(picks.length, CAPS.perTrackingHost);
});

test("pickLinks: nothing to pick, and fewer than 40 addresses", () => {
  assert.deepEqual(pickLinks({ candidates: [], stateByHash: new Map() }), { picks: [], capped: 0 });
  assert.equal(pickLinks({ candidates: [cand(1, "www.a.example.com"), cand(2, "www.b.example.com")], stateByHash: new Map() }).picks.length, 2);
});

/* ---------------- rows and words ---------------- */

const NOW = "2026-10-09T19:07:00.000Z";

test("buildRow: an OK read is a good time; a failed read keeps the old good time", () => {
  const c = cand(7, "www.bank.example.com");
  const ok = buildRow({ cand: c, prev: null, read: classifyRead(page(200, "Apply")), nowIso: NOW });
  assert.equal(ok.lastGoodAt, NOW);
  assert.equal(ok.lastClass, "OK");
  assert.equal(ok.lastStatus, 200);
  assert.equal(ok.lenderId, c.lenderIds[0]);
  const prev = { lastGoodAt: "2026-10-08T10:00:00.000Z" };
  const bad = buildRow({ cand: c, prev, read: classifyRead(page(404, "Not Found")), nowIso: NOW });
  assert.equal(bad.lastGoodAt, "2026-10-08T10:00:00.000Z");
  assert.equal(bad.lastClass, "BAD_URL");
  const never = buildRow({ cand: c, prev: null, read: classifyRead(down("fetch failed")), nowIso: NOW });
  assert.equal(never.lastGoodAt, null);
  assert.equal(never.lastStatus, 0);
  assert.equal(never.lastHost, undefined);
});

test("buildRow: drops lender ids that are not ids; keeps no query string anywhere", () => {
  const c = cand(8, "www.bank.example.com", { lenderIds: ["not-an-id", "00000000-0000-4000-8000-000000000008"] });
  const row = buildRow({ cand: c, prev: null, read: classifyRead(page(200, "Apply")), nowIso: NOW });
  assert.deepEqual(row.lenderIds, ["00000000-0000-4000-8000-000000000008"]);
  assert.ok(!JSON.stringify(row).includes("SECRET"), "the address and its query string are not in the row");
  assert.ok(row.lastDetail.length <= 300);
});

test("buildShapeRow: BAD_URL with the reason in words and no address", () => {
  const row = buildShapeRow({ cand: { urlHash: hashN(9), host: "creditcardlearnmore.com", lenderIds: ["00000000-0000-4000-8000-000000000009"], reason: "has a space or blank in it" }, prev: null, nowIso: NOW });
  assert.equal(row.lastClass, "BAD_URL");
  assert.equal(row.lastGoodAt, null);
  assert.match(row.lastDetail, /has a space or blank in it/);
  assert.equal(row.host, "creditcardlearnmore.com");
});

test("breakDetail: host first, then class, then a short lender id; at most 300 characters; says how many more", () => {
  const one = breakDetail([{ lenderId: "00000000-0000-4000-8000-0000000000aa", rows: 1, cls: "BAD_URL", status: 404, host: "www.bank.example.com" }]);
  assert.equal(one, "www.bank.example.com BAD_URL 404 (lender 00000000) - 1 bank Apply link broke after it worked.");
  const many = breakDetail(Array.from({ length: 12 }, (_, i) => ({ lenderId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, rows: i === 0 ? 3 : 1, cls: i % 2 ? "HARD" : "BAD_URL", status: i % 2 ? 0 : 404, host: `www.some-long-bank-name-${i}.example.com` })));
  assert.ok(many.length <= 300, String(many.length));
  assert.match(many, /^www\.some-long-bank-name-0\.example\.com BAD_URL 404 \(lender 00000000, 3 lender rows\)/);
  assert.match(many, /and \d+ more - 12 bank Apply links broke after it worked\.$/);
  assert.match(many, /HARD no answer \(lender/);
  assert.ok(!/ecid|SECRET|https?:/.test(many));
});

test("breakDetail: the first 100 characters (what the phone gets) already name the first bank host and the class", () => {
  const d = breakDetail([
    { lenderId: "1a2b3c4d-0000-4000-8000-0000000000aa", rows: 1, cls: "BAD_URL", status: 404, host: "tri-county.org" },
    { lenderId: "9f8e7d6c-0000-4000-8000-0000000000bb", rows: 1, cls: "HARD", status: 0, host: "www.baystatebank.com" }
  ]);
  assert.match(d.slice(0, 100), /^tri-county\.org BAD_URL 404 \(lender 1a2b3c4d\); www\.baystatebank\.com HARD no answer/);
});

/* ---------------- runPool and withinMs ---------------- */

test("runPool: never more than `concurrency` at once; results line up with items", async () => {
  let running = 0;
  let peak = 0;
  const out = await runPool(Array.from({ length: 30 }, (_, i) => i), async (i) => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 3));
    running--;
    return i * 2;
  }, { concurrency: 7 });
  assert.equal(peak, 7);
  assert.deepEqual(out, Array.from({ length: 30 }, (_, i) => i * 2));
});

test("runPool: when canStart says no, nothing new starts and the rest stay undefined", async () => {
  let started = 0;
  const out = await runPool(Array.from({ length: 10 }, (_, i) => i), async (i) => { started++; await new Promise((r) => setTimeout(r, 5)); return i; }, {
    concurrency: 2, canStart: () => started < 4
  });
  assert.equal(started, 4);
  assert.deepEqual(Array.from(out, (x) => x !== undefined), [true, true, true, true, false, false, false, false, false, false]);
});

test("runPool: a worker that throws costs its own item only; empty list is fine", async () => {
  const out = await runPool([1, 2, 3], async (n) => { if (n === 2) throw new Error("boom"); return n; });
  assert.equal(out[0], 1);
  assert.match(out[1].error, /boom/);
  assert.equal(out[2], 3);
  assert.deepEqual(await runPool([], async () => 1), []);
});

test("withinMs: a fast promise wins; a slow one becomes a timeout answer in the probe's shape", async () => {
  assert.equal(await withinMs(Promise.resolve("fast"), 200), "fast");
  const slow = await withinMs(new Promise(() => {}), 20);
  assert.equal(slow.class, "timeout");
  assert.equal(slow.status, 0);
  assert.equal(classifyRead(slow).cls, "SLOW");
  await assert.rejects(() => withinMs(Promise.reject(new Error("x")), 200), /x/);
});
