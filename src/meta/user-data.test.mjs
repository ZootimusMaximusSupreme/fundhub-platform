// src/meta/user-data.test.mjs — what Meta gets about a person: hashes only.
//
// What this proves: email and phone are normalised the way the contract says
// (lowercased and trimmed; digits only, no leading zeros, with a leading 1 for
// a 10-digit US number) and then SHA-256 hashed; the raw value never appears in user_data;
// IP, fbc and fbp are shape-checked; the session contact lookup is bounded and
// never throws. And the CLAUDE.md §12 rule for this directory: nothing under
// src/meta/ calls fetch, and only track-send.mjs imports the sender.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  sha256, isHashed, normalizeEmail, normalizePhone, hashEmail, hashPhone,
  cleanFbc, cleanFbp, cleanIp, clientIpFrom, buildUserData, outboundFbp
} from "./user-data.mjs";

const hex = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const FBC = "fb.1.1727900000000.IwAR2abcDEF_ghi-jkl";
const FBP = "fb.1.1727900000000.1116446470";

describe("hashing", () => {
  test("sha256 is lowercase hex", () => {
    assert.equal(sha256("abc"), hex("abc"));
    assert.equal(isHashed(sha256("x")), true);
    assert.equal(isHashed("pat@gmail.com"), false);
    assert.equal(isHashed(sha256("x").toUpperCase()), false);
  });

  test("email: lowercased and trimmed before hashing", () => {
    assert.equal(normalizeEmail("  Pat@Gmail.COM "), "pat@gmail.com");
    assert.equal(hashEmail("  Pat@Gmail.COM "), hex("pat@gmail.com"));
    assert.equal(hashEmail("not an email"), null);
    assert.equal(hashEmail(""), null);
    assert.equal(hashEmail(null), null);
  });

  test("phone: digits only, a 10-digit US number gets its leading 1", () => {
    assert.equal(normalizePhone("(415) 555-0134"), "14155550134");
    assert.equal(normalizePhone("+1 415.555.0134"), "14155550134");
    assert.equal(normalizePhone("+14155550134"), "14155550134");
    assert.equal(normalizePhone("+44 20 7946 0958"), "442079460958");
    assert.equal(hashPhone("(415) 555-0134"), hex("14155550134"));
    assert.equal(hashPhone("+14155550134"), hex("14155550134"), "the stored +1 form and the typed form hash the same");
    assert.equal(hashPhone("123"), null);
    assert.equal(hashPhone(""), null);
  });

  test("phone: leading zeros are removed, as Meta's rule says (an 00 dialing prefix is not the number)", () => {
    assert.equal(normalizePhone("0044 20 7946 0958"), "442079460958");
    assert.equal(hashPhone("00 44 20 7946 0958"), hex("442079460958"), "same hash as the +44 form");
    assert.equal(hashPhone("0014155550134"), hex("14155550134"), "same hash as the +1 form");
    assert.equal(normalizePhone("000"), "", "all zeros is no phone");
  });
});

describe("user_data", () => {
  test("every key, hashed where it must be, raw nowhere", () => {
    const ud = buildUserData({
      email: "Pat@Gmail.com", phone: "+14155550134", ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 (iPhone)", fbc: FBC, fbp: FBP, sessionId: "sess-abcdef12"
    });
    assert.deepEqual(ud, {
      client_ip_address: "203.0.113.7",
      client_user_agent: "Mozilla/5.0 (iPhone)",
      fbp: FBP,
      em: [hex("pat@gmail.com")],
      ph: [hex("14155550134")]
    });
    const text = JSON.stringify(ud);
    for (const raw of ["pat@gmail.com", "Pat@Gmail.com", "4155550134", "sess-abcdef12"]) {
      assert.ok(!text.includes(raw), `raw "${raw}" must not appear`);
    }
  });

  test("missing pieces are left out, not sent empty", () => {
    assert.deepEqual(buildUserData({}), {});
    assert.deepEqual(buildUserData({ email: "nope", phone: "12", ip: "not-an-ip", fbc: "junk", fbp: "" }), {});
  });

  test("fbc and fbp must have Meta's shape", () => {
    assert.equal(cleanFbc(FBC), FBC);
    assert.equal(cleanFbc(` ${FBC} `), FBC);
    for (const bad of ["fb.1.123.x", "IwAR2abc", "fb.1.1727900000000.has space", "fb.1.1727900000000.a@b.co", 5, null]) {
      assert.equal(cleanFbc(bad), null, String(bad));
    }
    const long = `fb.1.1727900000000.${"A".repeat(500)}`;
    assert.equal(cleanFbc(long), long, "an fbclid up to 500 characters, as the browser and pickAttribution accept");
    assert.equal(cleanFbc(`fb.1.1727900000000.${"A".repeat(501)}`), null);
    assert.equal(cleanFbp(FBP), FBP);
    assert.equal(cleanFbp("fb.1.1727900000000."), null);
    assert.equal(outboundFbp("fb.1.1727900000000.800"), null);
    assert.equal(outboundFbp("fb.1.1727900000000.credit_800_income_100000"), null);
    assert.equal(cleanFbp("fb.1.17279.1116446470"), null);
  });

  test("IP: x-nf-client-connection-ip, else the first x-forwarded-for hop, else the socket", () => {
    assert.equal(clientIpFrom({ headers: { "x-nf-client-connection-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" } }), "203.0.113.7");
    assert.equal(clientIpFrom({ headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.1" } }), "198.51.100.1");
    assert.equal(clientIpFrom({ headers: { "x-forwarded-for": "garbage" }, socket: { remoteAddress: "192.0.2.5" } }), "192.0.2.5");
    assert.equal(clientIpFrom({ headers: {} }), null);
    assert.equal(clientIpFrom(undefined), null);
    assert.equal(cleanIp("2001:db8::1"), "2001:db8::1");
    assert.equal(cleanIp("[2001:db8::1]:443"), "2001:db8::1");
    assert.equal(cleanIp("203.0.113.7:8080"), "203.0.113.7");
    assert.equal(cleanIp("999.1.1.1"), null);
  });
});

test("nothing under src/meta/ transmits — CLAUDE.md section 12", () => {
  // Outbound transmission is permitted in src/messaging/providers/ and nowhere
  // else. src/meta/ builds events; the one sender is
  // src/messaging/providers/meta-capi.mjs.
  const here = fileURLToPath(new URL(".", import.meta.url));
  const files = readdirSync(here).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"));
  assert.ok(files.length >= 4, `found ${files.join(", ")}`);
  for (const f of files) {
    const src = readFileSync(`${here}${f}`, "utf8");
    assert.ok(!/\bfetch\s*\(|\bfetchImpl\s*\(|globalThis\.fetch/.test(src), `${f} must not call fetch`);
    const imports = src.match(/^\s*import[^;]+from\s+["'][^"']+["']/gm) || [];
    for (const line of imports) {
      if (/providers\//.test(line)) {
        assert.equal(f, "track-send.mjs", `${f} must not import a provider: ${line.trim()}`);
        assert.match(line, /providers\/meta-capi\.mjs/);
      }
    }
  }
});
