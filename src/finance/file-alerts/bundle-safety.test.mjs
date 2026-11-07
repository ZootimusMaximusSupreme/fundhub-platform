// What the alerts bundle can and cannot do — checked against the source itself.
//   * Nothing in the bundle files sends; the one send is the weekly job's, through
//     sendTemplated (a queued messages row). The daily pass sends the other two
//     through run.mjs's own deliver().
//   * Nothing moves money, opens a task, or calls out.
//   * The store writes one thing: the switches.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const BUNDLE = ["bundle-common.mjs", "card-over-10.mjs", "pay-by.mjs", "intro-countdown.mjs", "business-credit.mjs",
  "weekly-money.mjs", "bundle-store.mjs", "bundle.mjs"].map((f) => join("src", "finance", "file-alerts", f));
const JOB = join("src", "workflows", "finance-os-weekly-money.mjs");
const SCREEN = [join("public", "app", "money-alerts-bundle.js"), join("public", "app", "money-alerts-bundle.css")];
const raw = (rel) => readFileSync(join(ROOT, rel), "utf8");
const code = (rel) => raw(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("what the bundle code can and cannot do", () => {
  test("no file makes a network call, or reaches a provider, the dispatcher or an adapter", () => {
    for (const f of [...BUNDLE, JOB]) {
      const src = code(f);
      assert.doesNotMatch(src, /\bfetch\s*\(/, `${f} calls fetch`);
      assert.doesNotMatch(src, /\bXMLHttpRequest\b|\bWebSocket\b|node:https?|node:net|node:tls/, `${f} opens a connection`);
      assert.doesNotMatch(src, /messaging\/providers|messaging\/dispatch|twilio|sendgrid|mailgun|push\/(native-)?send/i, `${f} reaches for a provider`);
      assert.doesNotMatch(src, /from\s+["'][^"']*adapters\//, `${f} imports an adapter`);
    }
  });

  test("the bundle files never send; the weekly job's one send is sendTemplated through one seam", () => {
    for (const f of BUNDLE) assert.doesNotMatch(code(f), /sendTemplated|workflows\/messaging/, `${f} must not send`);
    const job = code(JOB);
    assert.match(job, /import\s*\{\s*sendTemplated as defaultSend\s*\}\s*from\s*"\.\/messaging\.mjs"/);
    assert.match(job, /deps\.send \|\| defaultSend/);
    assert.equal((job.match(/\bsend\(/g) || []).length, 1, "exactly one call site that sends");
    assert.match(job, /channel: "sms"/);
  });

  test("nothing moves money or opens a task", () => {
    for (const f of [...BUNDLE, JOB]) {
      const src = code(f);
      assert.doesNotMatch(src, /proposeTransfer|money-transfer-seam|plaid-transfer|transfer\/(create|authorize)|charge\(|refund\(|payouts?\//i, f);
      assert.doesNotMatch(src, /createTask|INSERT INTO tasks/i, f);
    }
  });

  test("the store writes only the switches; every other bundle file writes nothing", () => {
    const store = code(join("src", "finance", "file-alerts", "bundle-store.mjs"));
    const written = [...store.matchAll(/(?:INSERT INTO|(?<!DO\s)UPDATE)\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase());
    assert.deepEqual([...new Set(written)], ["file_protection_settings"]);
    assert.doesNotMatch(store, /\bDELETE\b/i);
    for (const f of BUNDLE.filter((x) => !x.endsWith("bundle-store.mjs"))) {
      assert.doesNotMatch(code(f), /\b(INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b/i, f);
    }
  });

  test("the weekly job checks the 9-to-5 Arizona window before it queues anything", () => {
    const job = code(JOB);
    assert.match(job, /dripSendTime/);
    const windowAt = job.indexOf("inPlanWindow(nowDate)");
    const sendAt = job.indexOf("await send(");
    assert.ok(windowAt > 0 && sendAt > windowAt, "the window check comes before the send");
    assert.match(job, /TZ=America\/Phoenix 0 9 \* \* 1/);
  });
});

test("the company is spelled Fundhub — everywhere, comments included", () => {
  for (const f of [...BUNDLE, JOB, ...SCREEN, join("db", "migrations", "578_finance_alerts_bundle.sql")]) {
    assert.doesNotMatch(raw(f), /FundHub|FUNDHUB|Fund Hub/, f);
  }
});
