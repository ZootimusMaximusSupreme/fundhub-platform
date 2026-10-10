// Texting hours: the window itself, and the guard that every path that texts Chris's number checks it.
// Owner law 2026-10-09 (.claude/rules/texting-hours.md): 6:00 a.m. to 10:00 p.m. Arizona time, 100%.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inTextWindow, nextWindowStart, phoenixClock, phoenixTimeWords, HELD,
  TEXT_TZ, WINDOW_START_HOUR, WINDOW_END_HOUR
} from "./quiet-hours.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const at = (iso) => new Date(iso);

/* ============================== the window ============================== */

describe("inTextWindow: 6:00:00 a.m. is in, 10:00:00 p.m. is out (Arizona time)", () => {
  test("the four edges", () => {
    // Arizona is UTC-7: 6:00 a.m. there is 13:00 UTC, 10:00 p.m. there is 05:00 UTC the next day.
    assert.equal(inTextWindow(at("2026-10-09T12:59:59Z")), false, "5:59:59 a.m. is out");
    assert.equal(inTextWindow(at("2026-10-09T13:00:00Z")), true, "6:00:00 a.m. is in");
    assert.equal(inTextWindow(at("2026-10-10T04:59:59Z")), true, "9:59:59 p.m. is in");
    assert.equal(inTextWindow(at("2026-10-10T05:00:00Z")), false, "10:00:00 p.m. is out");
  });

  test("the UTC day boundary: 9:59 p.m. Arizona is already tomorrow in UTC, and still in", () => {
    assert.equal(inTextWindow(at("2026-10-10T00:00:00Z")), true, "5:00 p.m. Arizona, midnight UTC");
    assert.equal(inTextWindow(at("2026-10-10T04:59:00Z")), true, "9:59 p.m. Arizona on the 9th");
    assert.equal(inTextWindow(at("2026-10-10T05:00:00Z")), false, "10:00 p.m. Arizona on the 9th = 05:00 UTC on the 10th");
    assert.equal(inTextWindow(at("2026-10-10T09:07:00Z")), false, "2:07 a.m. Arizona");
  });

  test("summer and winter are the same clock (Arizona has no daylight time)", () => {
    for (const day of ["2026-07-15", "2026-01-15", "2026-03-08", "2026-11-01"]) {
      assert.equal(inTextWindow(at(`${day}T12:59:59Z`)), false, `${day} 5:59:59 a.m.`);
      assert.equal(inTextWindow(at(`${day}T13:00:00Z`)), true, `${day} 6:00 a.m.`);
      assert.equal(inTextWindow(at(`${day}T19:00:00Z`)), true, `${day} noon`);
      const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      assert.equal(inTextWindow(at(`${next}T04:59:59Z`)), true, `${day} 9:59:59 p.m.`);
      assert.equal(inTextWindow(at(`${next}T05:00:00Z`)), false, `${day} 10:00 p.m.`);
    }
  });

  test("agrees with the America/Phoenix clock every 7 minutes for a whole summer day and a whole winter day", () => {
    const hourOf = (d) => Number(new Intl.DateTimeFormat("en-US", { timeZone: TEXT_TZ, hour: "numeric", hourCycle: "h23" }).format(d));
    for (const start of ["2026-07-15T00:00:00Z", "2026-01-15T00:00:00Z"]) {
      for (let m = 0; m < 24 * 60; m += 7) {
        const d = new Date(Date.parse(start) + m * 60000);
        const h = hourOf(d);
        assert.equal(phoenixClock(d).hour, h, d.toISOString());
        assert.equal(inTextWindow(d), h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR, d.toISOString());
      }
    }
  });

  test("takes a Date, ms or an ISO string; an unreadable value falls back to the real clock (never throws)", () => {
    assert.equal(inTextWindow(Date.parse("2026-10-10T09:07:00Z")), false);
    assert.equal(inTextWindow("2026-10-09T19:00:00Z"), true);
    assert.equal(typeof inTextWindow("not a date"), "boolean");
    assert.equal(typeof inTextWindow(), "boolean");
  });

  test("a machine set to another time zone gets the same answers (New York, Tokyo, UTC)", () => {
    const script = `import("${new URL("./quiet-hours.mjs", import.meta.url).href}").then((q) => {
      const isos = ["2026-10-09T12:59:59Z", "2026-10-09T13:00:00Z", "2026-10-10T04:59:59Z", "2026-10-10T05:00:00Z", "2026-10-10T09:07:00Z", "2026-07-15T19:00:00Z"];
      console.log(JSON.stringify({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone, a: isos.map((i) => q.inTextWindow(new Date(i))), n: q.nextWindowStart(new Date("2026-10-10T09:07:00Z")).toISOString() }));
    });`;
    for (const tz of ["America/New_York", "Asia/Tokyo", "UTC"]) {
      const out = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ: tz }, encoding: "utf8" }));
      assert.equal(out.tz === tz || (tz === "UTC" && /UTC|Etc\/UTC/.test(out.tz)), true, `the child really ran in ${tz} (got ${out.tz})`);
      assert.deepEqual(out.a, [false, true, true, false, false, true], tz);
      assert.equal(out.n, "2026-10-10T13:00:00.000Z", tz);
    }
  });
});

describe("nextWindowStart: when a held text may go", () => {
  test("inside the window it is now", () => {
    assert.equal(nextWindowStart(at("2026-10-09T19:00:00Z")).toISOString(), "2026-10-09T19:00:00.000Z");
    assert.equal(nextWindowStart(at("2026-10-09T13:00:00Z")).toISOString(), "2026-10-09T13:00:00.000Z");
  });
  test("before 6 a.m. it is 6:00 a.m. the same Arizona day", () => {
    assert.equal(nextWindowStart(at("2026-10-10T09:07:00Z")).toISOString(), "2026-10-10T13:00:00.000Z", "2:07 a.m.");
    assert.equal(nextWindowStart(at("2026-10-09T12:59:59Z")).toISOString(), "2026-10-09T13:00:00.000Z", "5:59:59 a.m.");
    assert.equal(nextWindowStart(at("2026-10-10T07:00:00Z")).toISOString(), "2026-10-10T13:00:00.000Z", "midnight Arizona");
  });
  test("from 10 p.m. on it is 6:00 a.m. the next Arizona day (across the UTC day line)", () => {
    assert.equal(nextWindowStart(at("2026-10-10T05:00:00Z")).toISOString(), "2026-10-10T13:00:00.000Z", "10:00 p.m. on the 9th");
    assert.equal(nextWindowStart(at("2026-10-10T06:59:59Z")).toISOString(), "2026-10-10T13:00:00.000Z", "11:59:59 p.m. on the 9th");
    assert.equal(nextWindowStart(at("2026-12-31T05:30:00Z")).toISOString(), "2026-12-31T13:00:00.000Z", "10:30 p.m. Dec 30");
    assert.equal(nextWindowStart(at("2027-01-01T06:00:00Z")).toISOString(), "2027-01-01T13:00:00.000Z", "11 p.m. New Year's Eve");
  });
  test("the answer is always inside the window", () => {
    for (let m = 0; m < 24 * 60; m += 11) {
      const d = new Date(Date.parse("2026-07-15T00:00:00Z") + m * 60000);
      const n = nextWindowStart(d);
      assert.equal(inTextWindow(n), true, d.toISOString());
      assert.ok(n.getTime() >= d.getTime() && n.getTime() - d.getTime() <= 8 * 3600 * 1000, d.toISOString());
    }
  });
});

test("phoenixTimeWords says the Arizona time in plain words", () => {
  assert.equal(phoenixTimeWords("2026-10-10T09:07:00Z"), "2:07 a.m.");
  assert.equal(phoenixTimeWords(at("2026-10-09T19:00:00Z")), "12:00 p.m.");
  assert.equal(phoenixTimeWords("2026-10-10T07:05:00Z"), "12:05 a.m.");
  assert.equal(phoenixTimeWords("2026-10-10T04:00:00Z"), "9:00 p.m.");
  assert.equal(phoenixTimeWords(null), "");
  assert.equal(phoenixTimeWords("nope"), "");
});

test("the held word is the one every sender answers with", () => {
  assert.equal(HELD, "held_quiet_hours");
});

/* ============================== the guard ============================== */

/*
 * THE GUARD. A file that hands a text or a buzz to a provider for Chris's own phone must call inTextWindow().
 *
 * "Hands it to a provider": the file imports a raw sender module (src/messaging/providers/twilio.mjs,
 * ntfy.mjs or twilio-whatsapp.mjs). A file that only calls a gated sender (textMorningBrief, textChris,
 * notify-fanout's send) is covered by the gate inside that sender, which is the point: a new caller cannot
 * forget it.
 *
 * "Chris's own phone": the code names his number (PULSE_SMS_TO, CHRIS_PULSE_SMS, AD_VIDEO_SMS_TO,
 * chrisPulseSmsTo, adVideoSmsTo), or writes a fixed phone number into the code (a customer's number always
 * comes from data), or imports ntfy (ntfy only ever buzzes Chris's phone).
 *
 * Comments are stripped first, so a gate that is only mentioned in a comment does not count.
 */
const SENDER_IMPORT = /(?:from\s+|import\s*\(\s*)["'][^"']*messaging\/providers\/(twilio|ntfy|twilio-whatsapp)\.mjs["']/g;
const CHRIS_NUMBER = /\b(PULSE_SMS_TO|CHRIS_PULSE_SMS|AD_VIDEO_SMS_TO|chrisPulseSmsTo|adVideoSmsTo)\b/;
const FIXED_NUMBER = /["'`]\+1\d{10}["'`]/;
const GATE_CALL = /\binTextWindow\s*\(/;

/** Files that match the pattern but send nothing to Chris themselves. Each needs a written reason. */
const ALLOW = Object.freeze({
  "src/workflows/ad-video-sweeper.mjs":
    "Imports the ntfy module but never calls its send(). Its only buzz is notify-fanout's send(), which holds outside the window."
});

function stripComments(code) {
  return String(code)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n");
}

/** [{ path, text }] -> [{ path, why }] for every file that texts Chris without the gate. */
function ungatedChrisSenders(files, allow = ALLOW) {
  const bad = [];
  for (const { path, text } of files) {
    const code = stripComments(text);
    const senders = [...code.matchAll(SENDER_IMPORT)].map((m) => m[1]);
    if (!senders.length) continue;
    const chris = CHRIS_NUMBER.test(code) || FIXED_NUMBER.test(code) || senders.includes("ntfy");
    if (!chris) continue;
    if (GATE_CALL.test(code)) continue;
    if (Object.prototype.hasOwnProperty.call(allow, path)) continue;
    bad.push({ path, why: `imports ${senders.join(", ")} and reaches Chris's phone, but never calls inTextWindow()` });
  }
  return bad;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(mjs|js|cjs)$/.test(name) && !/\.test\.(mjs|js|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe("the guard: every file that texts Chris's number checks the window", () => {
  const files = ["src", "api", "netlify"].flatMap((d) => walk(join(ROOT, d)))
    .map((full) => ({ path: relative(ROOT, full).split("\\").join("/"), text: readFileSync(full, "utf8") }));

  test("no file in src/, api/ or netlify/ texts Chris without inTextWindow()", () => {
    assert.ok(files.length > 100, `the scan found the code (${files.length} files)`);
    assert.deepEqual(ungatedChrisSenders(files), []);
  });

  test("the guard sees the senders it is meant to see (so a green result is not an empty scan)", () => {
    const seen = files.filter(({ text }) => {
      const code = stripComments(text);
      return [...code.matchAll(SENDER_IMPORT)].length && (CHRIS_NUMBER.test(code) || FIXED_NUMBER.test(code) || /providers\/ntfy\.mjs/.test(code));
    }).map((f) => f.path).sort();
    for (const p of [
      "src/pulse/notify.mjs", "src/pulse/alerts.mjs", "src/pulse/instant-watch.mjs", "src/ad-videos/notify-fanout.mjs",
      "src/staff/blake-lead-watch.mjs", "netlify/functions/teleprompter-live-text.mjs"
    ]) assert.ok(seen.includes(p), `${p} is one of Chris's senders the guard checks`);
  });

  test("every allow-list entry still exists and still has a reason", () => {
    for (const [p, why] of Object.entries(ALLOW)) {
      assert.ok(files.some((f) => f.path === p), `${p} is still in the repo`);
      assert.ok(String(why).length > 40, `${p} has a written reason`);
    }
  });

  test("a file that texts Chris with no check FAILS the guard (fixture)", () => {
    const fixture = {
      path: "src/fixture/texts-chris-at-night.mjs",
      text: [
        'import { send } from "../messaging/providers/twilio.mjs";',
        "// inTextWindow( is only in this comment, which does not count",
        "export async function nag(env) {",
        "  return send({ to: env.PULSE_SMS_TO, body: \"hi\", channel: \"sms\" }, { env });",
        "}"
      ].join("\n")
    };
    const bad = ungatedChrisSenders([fixture]);
    assert.equal(bad.length, 1);
    assert.equal(bad[0].path, fixture.path);
  });

  test("a fixed number, an ntfy buzz and a dynamic import are caught too (fixtures)", () => {
    const fixed = { path: "netlify/functions/x.mjs", text: 'import { send } from "../../src/messaging/providers/twilio.mjs";\nexport default () => send({ to: "+15555550100", body: "x" });' };
    const buzz = { path: "src/x/buzz.mjs", text: 'import { send } from "../messaging/providers/ntfy.mjs";\nexport const go = (n) => send({ notification: n });' };
    const lazy = { path: "src/x/lazy.mjs", text: 'export async function go(env) { const { send } = await import("../messaging/providers/twilio.mjs"); return send({ to: env.CHRIS_PULSE_SMS }); }' };
    assert.deepEqual(ungatedChrisSenders([fixed, buzz, lazy]).map((b) => b.path), [fixed.path, buzz.path, lazy.path]);
  });

  test("the same fixture WITH the check passes, and a customer sender (number from data) is not Chris's", () => {
    const gated = {
      path: "src/fixture/texts-chris-in-hours.mjs",
      text: [
        'import { send } from "../messaging/providers/twilio.mjs";',
        'import { inTextWindow } from "../pulse/quiet-hours.mjs";',
        "export async function nag(env, now) {",
        "  if (!inTextWindow(now)) return { status: \"held_quiet_hours\" };",
        "  return send({ to: env.PULSE_SMS_TO, body: \"hi\", channel: \"sms\" }, { env });",
        "}"
      ].join("\n")
    };
    const customer = { path: "src/fixture/customer.mjs", text: 'import { send } from "../messaging/providers/twilio.mjs";\nexport const go = (row) => send({ to: row.phone, body: row.body });' };
    assert.deepEqual(ungatedChrisSenders([gated, customer]), []);
  });
});
