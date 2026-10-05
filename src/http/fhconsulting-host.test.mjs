// fhconsulting.online is an alias on the Fundhub site. The edge function is what
// keeps the funding homepage off that host. The consulting pages must describe
// marketing consulting, not the old operations courses.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../../netlify/edge-functions/fhconsulting-host.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function fakeContext() {
  const seen = [];
  return {
    seen,
    next(req) {
      seen.push(req ? new URL(req.url) : null);
      return Promise.resolve(new Response("ok", { status: 200 }));
    },
  };
}

async function hit(url, headers) {
  const context = fakeContext();
  const res = await handler(new Request(url, { headers }), context);
  return { res, seen: context.seen };
}

test("the consulting host fence is registered and only rewrites that domain", () => {
  const toml = read("netlify.toml");
  assert.match(toml, /function\s*=\s*"fhconsulting-host"/);
  const edge = read("netlify/edge-functions/fhconsulting-host.js");
  assert.match(edge, /fhconsulting\.online/);
  assert.match(edge, /www\.fhconsulting\.online/);
  assert.match(edge, /if \(!HOSTS\.has\(host\)\) return context\.next\(\)/);
  assert.match(edge, /\/consulting\//);
  assert.match(edge, /\/consulting\/terms\//);
  assert.match(edge, /\/consulting\/privacy\//);
  assert.match(edge, /\/consulting\/refund\//);
  assert.match(edge, /\/consulting\/site\.css/);
  assert.doesNotMatch(edge, /https:\/\/fhconsulting\.online\/consulting\//);
});

test("other hosts pass through, including fundhub.ai/consulting/", async () => {
  for (const url of [
    "https://fundhub.ai/",
    "https://fundhub.ai/consulting/",
    "https://fundhub.ai/consulting/terms/",
    "https://fundhub.ai/consulting/site.css",
  ]) {
    const { res, seen } = await hit(url);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers.get("location"), null, url);
    assert.equal(seen.length, 1, url);
    assert.equal(seen[0], null, url);
  }
});

test("www 301s to the apex and keeps the path", async () => {
  const { res, seen } = await hit("https://www.fhconsulting.online/terms/?x=1");
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "https://fhconsulting.online/terms/?x=1");
  assert.equal(seen.length, 0);
});

test("the clean consulting URLs rewrite to the files and stay 200", async () => {
  const cases = [
    ["https://fhconsulting.online/", "/consulting/"],
    ["https://fhconsulting.online/terms/", "/consulting/terms/"],
    ["https://fhconsulting.online/privacy/", "/consulting/privacy/"],
    ["https://fhconsulting.online/refund/", "/consulting/refund/"],
  ];
  for (const [url, pathname] of cases) {
    const { res, seen } = await hit(url);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers.get("location"), null, url);
    assert.equal(seen.length, 1, url);
    assert.equal(seen[0].hostname, "fhconsulting.online", url);
    assert.equal(seen[0].pathname, pathname, url);
    assert.equal(seen[0].search, "", url);
  }
});

test("slashless legal paths 301 to the slashed clean URL", async () => {
  for (const page of ["terms", "privacy", "refund"]) {
    const { res, seen } = await hit(`https://fhconsulting.online/${page}`);
    assert.equal(res.status, 301, page);
    assert.equal(res.headers.get("location"), `https://fhconsulting.online/${page}/`, page);
    assert.equal(seen.length, 0, page);
  }
});

test("old /consulting/ URLs 301 to the clean address", async () => {
  const cases = [
    ["https://fhconsulting.online/consulting", "https://fhconsulting.online/"],
    ["https://fhconsulting.online/consulting/", "https://fhconsulting.online/"],
    ["https://fhconsulting.online/consulting/index.html", "https://fhconsulting.online/"],
    ["https://fhconsulting.online/consulting/?utm=old", "https://fhconsulting.online/?utm=old"],
    ["https://fhconsulting.online/consulting/terms", "https://fhconsulting.online/terms/"],
    ["https://fhconsulting.online/consulting/terms/", "https://fhconsulting.online/terms/"],
    ["https://fhconsulting.online/consulting/terms/index.html", "https://fhconsulting.online/terms/"],
    ["https://fhconsulting.online/consulting/privacy/", "https://fhconsulting.online/privacy/"],
    ["https://fhconsulting.online/consulting/refund/", "https://fhconsulting.online/refund/"],
    ["https://fhconsulting.online/consulting/nope", "https://fhconsulting.online/"],
  ];
  for (const [url, location] of cases) {
    const { res, seen } = await hit(url);
    assert.equal(res.status, 301, url);
    assert.equal(res.headers.get("location"), location, url);
    assert.equal(seen.length, 0, url);
  }
});

test("css, the funnel script, and favicon are served, not sent home", async () => {
  for (const url of [
    "https://fhconsulting.online/consulting/site.css",
    "https://fhconsulting.online/funnel/rb2b.js",
    "https://fhconsulting.online/favicon.ico",
  ]) {
    const { res, seen } = await hit(url);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers.get("location"), null, url);
    assert.equal(seen.length, 1, url);
    assert.equal(seen[0], null, url);
  }
});

test("a rewrite that comes back through this function serves the file", async () => {
  const { res, seen } = await hit("https://fhconsulting.online/consulting/", {
    "x-fh-consulting-rewrite": "1",
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("location"), null);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], null);
});

test("other paths on the consulting host go to the clean home, not /consulting/", async () => {
  const { res, seen } = await hit("https://fhconsulting.online/app/");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://fhconsulting.online/");
  assert.equal(seen.length, 0);
});

test("robots.txt and sitemap.xml are served on the consulting host only", async () => {
  const { res: robots, seen: rSeen } = await hit("https://fhconsulting.online/robots.txt");
  assert.equal(robots.status, 200);
  const robotsBody = await robots.text();
  assert.match(robotsBody, /User-agent:\s*GPTBot/i);
  assert.match(robotsBody, /Allow:\s*\//);
  assert.match(robotsBody, /Sitemap:\s*https:\/\/fhconsulting\.online\/sitemap\.xml/);
  assert.equal(rSeen.length, 0);

  const { res: map, seen: mSeen } = await hit("https://fhconsulting.online/sitemap.xml");
  assert.equal(map.status, 200);
  const mapBody = await map.text();
  assert.match(mapBody, /<loc>https:\/\/fhconsulting\.online\/<\/loc>/);
  assert.doesNotMatch(mapBody, /\/terms\//);
  assert.equal(mSeen.length, 0);

  const { res: fundRobots, seen: fSeen } = await hit("https://fundhub.ai/robots.txt");
  assert.equal(fundRobots.status, 200);
  assert.equal(fSeen.length, 1);
  assert.equal(fSeen[0], null);
});

test("the consulting home is indexable and legal pages stay noindex", () => {
  const home = read("public/consulting/index.html");
  assert.doesNotMatch(home, /<meta name="robots" content="noindex"/);
  for (const page of ["terms", "privacy", "refund"]) {
    const html = read(`public/consulting/${page}/index.html`);
    assert.match(html, /<meta name="robots" content="noindex">/, page);
  }
});

test("the consulting home sells marketing consulting and posts no course prices", () => {
  const html = read("public/consulting/index.html");
  assert.match(html, /Marketing consulting for agencies/);
  assert.match(html, /AI tools/);
  assert.match(html, /Offer tools/);
  assert.match(html, /Marketing systems/);
  assert.doesNotMatch(html, /Operations Foundations/);
  assert.doesNotMatch(html, /\$5,000/);
  assert.doesNotMatch(html, /\$10,000/);
});
