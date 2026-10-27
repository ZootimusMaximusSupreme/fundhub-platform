import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { setterEsc, setterDate, setterDialTarget, setterMissing, setterSorted } from "./setter-dashboard-view.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(here, "../../public/app/setter-dashboard.html"), "utf8");
const source = fs.readFileSync(path.join(here, "setter-dashboard-view.mjs"), "utf8");
const shell = fs.readFileSync(path.resolve(here, "../../public/app/shell.js"), "utf8");
const writeApi = fs.readFileSync(path.resolve(here, "../../api/setter-dashboard.mjs"), "utf8");

test("the page's pure view rules match the tested source", () => {
  const browser = html.split("/* FH-SETTER-VIEW-BEGIN */\n")[1]?.split("\n  /* FH-SETTER-VIEW-END */")[0];
  const module = source.slice(source.indexOf("function setterEsc"), source.indexOf("\nexport { setterEsc"));
  assert.equal(browser, module);
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1] || ""));
});

test("dial target is one minute in texting hours and 6 a.m. after hours", () => {
  assert.equal(setterDialTarget({ booked_at: "2026-10-26T20:00:00.000Z" }), "2026-10-26T20:01:00.000Z");
  assert.equal(setterDialTarget({ created_at: "2026-10-27T05:30:00.000Z" }), "2026-10-27T13:00:00.000Z");
  assert.equal(setterDialTarget({ created_at: "2026-10-27T12:30:00.000Z" }), "2026-10-27T13:00:00.000Z");
  assert.match(setterDate("2026-10-27T13:00:00.000Z"), /6:00 AM/);
});

test("completion calls out missing fields for booked and opt-in leads", () => {
  const base = {
    dialed_at: "2026-10-26T20:00:00.000Z", call_attempts: 1, disposition: "reached",
    time_confirmed: true, frame_warmed: true, problem: "Needs working capital.", goal: "Open a second store.",
    computer_ready: true, app_on_phone: false
  };
  assert.deepEqual(setterMissing({ lead_type: "booked", booked_at: "2026-10-27T20:00:00Z", booking_time: "2026-10-28T20:00:00Z" }, base), []);
  assert.deepEqual(setterMissing({ lead_type: "opt_in" }, base), ["booked call time", "triage problem", "triage goal", "personal or business"]);
  assert.ok(setterMissing({ lead_type: "booked", booked_at: "2026-10-27T20:00:00Z" }, { ...base, disposition: "no_answer" }).includes("second dial"));
  assert.ok(setterMissing({ lead_type: "booked", booked_at: "2026-10-27T20:00:00Z" }, { ...base, disposition: "reschedule" }).includes("reached call result"));
});

test("newest lead sorts first and escaped values stay text", () => {
  const rows = setterSorted([{ client_id: "old", created_at: "2026-10-24T00:00:00Z" }, { client_id: "new", booked_at: "2026-10-26T00:00:00Z" }]);
  assert.equal(rows[0].client_id, "new");
  assert.equal(setterEsc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test("screen uses live queue and write API with all four visible states", () => {
  assert.match(html, /\/api\/read\/setter-dashboard/);
  assert.match(html, /\/api\/setter-dashboard/);
  assert.match(html, /setter-skeleton/);
  assert.match(html, /Queue is clear/);
  assert.match(html, /Could not load the call queue/);
  assert.match(html, /paintDetail\(\)/);
  assert.match(html, /Send intro video/);
  assert.match(html, /introVideoAvailable = result\.body\.intro_video_available === true/);
  assert.match(html, /h\.video_sent_at \|\| !introVideoAvailable \? ' disabled'/);
  assert.match(html, /Intro video waiting to film/);
  assert.match(html, /Send lead-only SMS/);
  assert.match(html, /Send lead \+ closer SMS/);
  assert.match(html, /setter-number-book-rate/);
  assert.match(html, /paintNumbers\(result\.body\.numbers\)/);
  assert.match(writeApi, /"log_dial"/);
  assert.doesNotMatch(html, /style="/);
});

test("setter nav is role scoped with setter home", () => {
  assert.match(shell, /var SETTER_DESK_ONLY = \["setter-dashboard\.html"\]/);
  assert.match(shell, /SETTER_DESK_ONLY\.indexOf\(s\) === -1/);
  assert.match(shell, /if \(role === "setter"\) return staffTabs\(\)\.concat\(SETTER_DESK_ONLY\)/);
  assert.match(shell, /setter: "setter-dashboard\.html"/);
});
