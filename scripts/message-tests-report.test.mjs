// scripts/message-tests-report.mjs prints the message-tests report and must stay read only.
// No database: the printing is a pure function, and the read-only promise is checked in the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatReport } from "./message-tests-report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, "message-tests-report.mjs"), "utf8");

const sample = [
  {
    name: "nobook-proof", label: "Never-booked chase, message 2: real proof or not", goal: "booking.created", window_days: 7,
    min_per_arm: 30, started_at: "2026-11-10T16:00:00.000Z", earlier_people: 3,
    arms: { A: { people: 41, reached: 8, waiting: 5 }, B: { people: 40, reached: 12, waiting: 4 } },
    verdict: { winner: null, p: 0.27, text: "B is ahead: 12 of 40 booked (30%) vs 8 of 41 (20%). Not enough people yet to call it." }
  },
  {
    name: "resume-proof", label: "Come-back chase, message 2: real proof or not", goal: "survey.completed", window_days: 7,
    min_per_arm: 30, started_at: null, earlier_people: 0,
    arms: { A: { people: 0, reached: 0, waiting: 0 }, B: { people: 0, reached: 0, waiting: 0 } },
    verdict: { winner: null, p: null, text: "Version B has not gone out yet, so there is nothing to compare." }
  }
];

test("it prints each test with both sides, the start, and the verdict in plain words", () => {
  const out = formatReport(sample, { orgId: "org-1", now: new Date("2026-11-20T12:00:00Z") });
  assert.match(out, /^MESSAGE TESTS — read only\. Company org-1\. 2026-11-20T12:00:00\.000Z/);
  assert.match(out, /Never-booked chase, message 2: real proof or not {2}\[nobook-proof\]/);
  assert.match(out, /goal: booking\.created within 7 days of the first message/);
  assert.match(out, /started: 2026-11-10T16:00:00\.000Z {3}before it, not compared: 3/);
  assert.match(out, /needs: 30 people on each side, and a gap that passes the 95% check, before a winner is named/);
  assert.match(out, /A: 8 of 41 \(20%\), 5 still inside their days/);
  assert.match(out, /B: 12 of 40 \(30%\), 4 still inside their days/);
  assert.match(out, /verdict: B is ahead: 12 of 40 booked \(30%\) vs 8 of 41 \(20%\)\. Not enough people yet to call it\./);
  assert.match(out, /started: not yet \(no version B message has gone out\)/);
  assert.match(out, /A: 0 of 0 \(-\)/);
  assert.match(out, /verdict: Version B has not gone out yet/);
  assert.match(out, /Nothing was written\. Nothing was sent\. No version was switched\.$/);
});

test("a winner is named in the verdict line, once", () => {
  const out = formatReport([{ ...sample[0], verdict: { winner: "B", p: 0.01, text: "B wins: 25 of 40 booked (63%) vs 10 of 40 (25%). That gap is big enough to trust." } }],
    { orgId: "o", now: new Date("2026-11-20T12:00:00Z") });
  assert.match(out, /verdict: B wins: 25 of 40 booked \(63%\) vs 10 of 40 \(25%\)\. That gap is big enough to trust\./);
  assert.equal(out.match(/B wins/g).length, 1);
});

test("the script reads inside BEGIN READ ONLY ... COMMIT and never uses SET or a write", () => {
  const code = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(code, /BEGIN READ ONLY/);
  assert.match(code, /COMMIT/);
  assert.ok(code.indexOf("BEGIN READ ONLY") < code.indexOf("experimentReport(conn"), "the read runs after the read-only transaction opens");
  assert.ok(!/\bSET\b/.test(code), "no bare SET");
  assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/.test(code.replace(/"[^"]*"/g, "")), "no write statement");
  assert.ok(!/\bsendTemplated\b|\bfetch\(/.test(code), "nothing is sent");
});
