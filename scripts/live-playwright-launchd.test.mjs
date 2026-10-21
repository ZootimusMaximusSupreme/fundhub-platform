// The nightly desk-sweep job file (ops/launchd/ai.fundhub.live-playwright-sweep.plist).
//
// WHY A TEST FOR A TEXT FILE. The pulse row `live-playwright:desks` goes red when the newest sweep is
// older than LIVE_PLAYWRIGHT_MAX_AGE_MS (26 h). The row sat red for 13 days (316 h on 2026-10-20)
// because nothing ran the sweep on a schedule. This file is that schedule. If someone edits it to run
// weekly, or points it at the wrong script, the row goes red again and this test says so first.
//
// NOTHING IS INSTALLED OR RUN HERE. The test only reads the file.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LIVE_PLAYWRIGHT_MAX_AGE_MS } from "../src/pulse/live-playwright-check.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const PLIST = path.join(REPO, "ops/launchd/ai.fundhub.live-playwright-sweep.plist");
const XML = fs.readFileSync(PLIST, "utf8");
const DAY_MS = 24 * 60 * 60 * 1000;

/** The value after <key>NAME</key>: a string, an integer, a boolean, or the raw <array>/<dict> block. */
function valueOf(xml, name) {
  const body = xml.replace(/<!--[\s\S]*?-->/g, ""); // the comment block holds install commands, not keys
  const m = body.match(new RegExp(`<key>${name}</key>\\s*(?:<string>([\\s\\S]*?)</string>|<integer>(\\d+)</integer>|<(true|false)/>|(<array>[\\s\\S]*?</array>)|(<dict>[\\s\\S]*?</dict>))`));
  if (!m) return undefined;
  if (m[1] !== undefined) return m[1];
  if (m[2] !== undefined) return Number(m[2]);
  if (m[3] !== undefined) return m[3] === "true";
  return m[4] || m[5];
}

const programArgs = (xml) =>
  [...String(valueOf(xml, "ProgramArguments") || "").matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);

/** Everything wrong with a job file, in plain words. An empty list means the file does its one job. */
function plistProblems(xml) {
  const problems = [];
  const [nodeBin = "", script = ""] = programArgs(xml);
  if (valueOf(xml, "Label") !== "ai.fundhub.live-playwright-sweep") problems.push("wrong Label");
  if (!/\/node$/.test(nodeBin) || !path.isAbsolute(nodeBin)) problems.push("first argument is not an absolute node binary");
  if (path.basename(script) !== "live-playwright-sweep.mjs") problems.push("does not run scripts/live-playwright-sweep.mjs");
  if (!path.isAbsolute(script)) problems.push("script path is not absolute");
  const cwd = String(valueOf(xml, "WorkingDirectory") || "");
  if (!cwd.startsWith("/") || !script.startsWith(`${cwd}/`)) problems.push("script is not under the working directory that holds .env");

  const when = String(valueOf(xml, "StartCalendarInterval") || "");
  const hour = Number(when.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/)?.[1]);
  const minute = Number(when.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/)?.[1]);
  if (!when) problems.push("no StartCalendarInterval, so it never runs on its own");
  else {
    if (!Number.isInteger(hour) || hour > 23 || !Number.isInteger(minute) || minute > 59) problems.push("Hour and Minute must both be set");
    if (/<key>(Weekday|Day|Month)<\/key>/.test(when)) problems.push("not daily: a Weekday, Day or Month key makes the newest sweep older than the pulse limit");
    if (Number.isInteger(hour) && hour >= 5) problems.push("runs after 05:00, too close to the 06:00 morning pulse");
  }

  const env = String(valueOf(xml, "EnvironmentVariables") || "");
  const pathVar = env.match(/<key>PATH<\/key>\s*<string>([^<]*)<\/string>/)?.[1] || "";
  if (!pathVar.split(":").includes(path.dirname(nodeBin))) problems.push("the sweep shells out to npm, but node's folder is not on PATH");
  if (/PASSWORD|TOKEN|SECRET|API_KEY|DATABASE_URL/i.test(xml.replace(/<!--[\s\S]*?-->/g, ""))) problems.push("a secret name or value is written in the file");
  if (valueOf(xml, "RunAtLoad") !== false) problems.push("RunAtLoad must be false");
  return problems;
}

test("the job file runs the real desk sweep, daily, with nothing secret in it", () => {
  assert.deepEqual(plistProblems(XML), []);
  assert.ok(fs.existsSync(path.join(REPO, "scripts/live-playwright-sweep.mjs")), "the sweep script it runs is gone");
  assert.ok(DAY_MS < LIVE_PLAYWRIGHT_MAX_AGE_MS, "a daily run must be fresher than the pulse's red line");
});

test("a weekly schedule is caught", () => {
  const weekly = XML.replace("<key>Hour</key>", "<key>Weekday</key>\n    <integer>1</integer>\n    <key>Hour</key>");
  assert.ok(plistProblems(weekly).some((p) => /not daily/.test(p)), plistProblems(weekly).join("; "));
});

test("a missing schedule, the wrong script, a late hour and a written secret are each caught", () => {
  const noSchedule = XML.replace(/<key>StartCalendarInterval<\/key>[\s\S]*?<\/dict>/, "");
  assert.ok(plistProblems(noSchedule).some((p) => /never runs on its own/.test(p)));

  const wrongScript = XML.replace(/live-playwright-sweep\.mjs<\/string>\s*<\/array>/, "something-else.mjs</string>\n  </array>");
  assert.ok(plistProblems(wrongScript).some((p) => /does not run scripts\/live-playwright-sweep\.mjs/.test(p)));

  const late = XML.replace("<integer>3</integer>", "<integer>9</integer>");
  assert.ok(plistProblems(late).some((p) => /after 05:00/.test(p)));

  const leaky = XML.replace("<key>HOME</key>", "<key>STAFF_E2E_PASSWORD</key>\n    <string>x</string>\n    <key>HOME</key>");
  assert.ok(plistProblems(leaky).some((p) => /secret/.test(p)));
});
