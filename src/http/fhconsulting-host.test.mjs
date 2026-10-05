// fhconsulting.online is an alias on the Fundhub site. The edge function is what
// keeps the funding homepage off that host. The consulting pages must describe
// marketing consulting, not the old operations courses.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("the consulting host fence is registered and only rewrites that domain", () => {
  const toml = read("netlify.toml");
  assert.match(toml, /function\s*=\s*"fhconsulting-host"/);
  const edge = read("netlify/edge-functions/fhconsulting-host.js");
  assert.match(edge, /fhconsulting\.online/);
  assert.match(edge, /www\.fhconsulting\.online/);
  assert.match(edge, /if \(!HOSTS\.has\(host\)\) return context\.next\(\)/);
  assert.match(edge, /\/consulting\//);
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
