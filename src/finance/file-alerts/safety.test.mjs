// The promises these alerts make about what they cannot do — checked against the
// source itself, so a later edit cannot quietly break one.
//
//   * NOTHING SENDS WITHOUT THE TEMPLATED PATH. CLAUDE.md §12: outbound transmission
//     lives in src/messaging/providers/ and nowhere else. These files only ever call
//     sendTemplated, which writes a `messages` row at status='queued'; the dispatcher
//     is what sends, behind the dry-run fence, quiet hours and the opt-out read.
//   * NOTHING MOVES MONEY.
//   * The company is spelled Fundhub, and the next round is "the next funding sequence".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

const alertFiles = readdirSync(HERE)
  .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
  .map((f) => join("src", "finance", "file-alerts", f));
const ALL = [...alertFiles, join("api", "money", "alerts.mjs"), join("src", "workflows", "blueprint-finance-os-alerts.mjs")];
const code = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("what the alert code can and cannot do", () => {
  test("the files are found (so the checks below are not vacuous)", () => {
    assert.ok(alertFiles.length >= 9, alertFiles.join(", "));
    for (const f of ["run.mjs", "store.mjs", "snapshot.mjs", "read.mjs", "common.mjs"]) {
      assert.ok(alertFiles.some((a) => a.endsWith(f)), f);
    }
  });

  test("no file here makes a network call, or imports a provider or the dispatcher", () => {
    for (const f of ALL) {
      const src = code(f);
      assert.doesNotMatch(src, /\bfetch\s*\(/, `${f} calls fetch`);
      assert.doesNotMatch(src, /\bXMLHttpRequest\b|\bWebSocket\b|node:https?|node:net|node:tls/, `${f} opens a connection`);
      assert.doesNotMatch(src, /messaging\/providers|messaging\/dispatch|bland-voice|twilio|sendgrid|mailgun/i, `${f} reaches for a provider`);
      assert.doesNotMatch(src, /from\s+["'][^"']*adapters\//, `${f} imports an adapter`);
    }
  });

  test("the only send is sendTemplated, handed in through one named seam", () => {
    const run = code(join("src", "finance", "file-alerts", "run.mjs"));
    assert.match(run, /import\s*\{\s*sendTemplated as defaultSend\s*\}\s*from\s*"\.\.\/\.\.\/workflows\/messaging\.mjs"/);
    assert.match(run, /deps\.send \|\| defaultSend/);
    assert.equal((run.match(/\bsend\(/g) || []).length, 1, "exactly one call site that sends");
    for (const f of alertFiles.filter((a) => !a.endsWith("run.mjs"))) {
      assert.doesNotMatch(code(f), /sendTemplated|workflows\/messaging/, `${f} must not send`);
    }
  });

  test("a CSM task is opened only through createTask", () => {
    const run = code(join("src", "finance", "file-alerts", "run.mjs"));
    assert.match(run, /from\s*"\.\.\/\.\.\/lib\/create-task\.mjs"/);
    for (const f of ALL) assert.doesNotMatch(code(f), /INSERT INTO tasks/i, `${f} writes tasks by hand`);
  });

  test("nothing here moves money", () => {
    for (const f of ALL) {
      assert.doesNotMatch(code(f), /proposeTransfer|money-transfer-seam|transfer\/(create|authorize)|charge\(|refund\(|payouts?\//i, f);
    }
  });

  test("the store writes only its own tables, plus the promo and close-day columns of a statement cycle", () => {
    const store = code(join("src", "finance", "file-alerts", "store.mjs"));
    // `DO UPDATE SET` inside an upsert is not a second table.
    const written = [...store.matchAll(/(?:INSERT INTO|(?<!DO\s)UPDATE)\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase());
    assert.deepEqual([...new Set(written)].sort(), ["account_statement_cycles", "file_protection_alerts", "file_protection_settings"]);
    assert.doesNotMatch(store, /\bDELETE\b/i, "nothing is ever deleted");
    assert.doesNotMatch(store, /saveStatementCycle/, "a one-field write must not replace the whole cycle row");
  });

  test("the snapshot reader writes nothing at all", () => {
    assert.doesNotMatch(code(join("src", "finance", "file-alerts", "snapshot.mjs")), /\b(INSERT|UPDATE|DELETE)\b/i);
    assert.doesNotMatch(code(join("src", "finance", "file-alerts", "read.mjs")), /\b(INSERT|UPDATE|DELETE)\b/i);
  });
});

describe("what the alerts say", () => {
  test("the company is spelled Fundhub — everywhere, comments included", () => {
    for (const f of [...ALL, join("db", "migrations", "471_file_protection_alerts.sql"), join("docs", "finance", "file-protection-alerts.md")]) {
      let src;
      try { src = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
      assert.doesNotMatch(src, /FundHub|FUNDHUB|Fund Hub/, f);
    }
  });

  test("a client is never told 'round two' — the next round is 'the next funding sequence' (owner-set 2026-10-06)", () => {
    // Client-facing words only: the template bodies and the planners' sentences are
    // asserted in migration.test.mjs. This guards the code strings that build them.
    for (const f of alertFiles.filter((a) => /(payment-timing|promo|cash-reserve|new-credit)\.mjs$/.test(a))) {
      const strings = [...code(f).matchAll(/`([^`]*)`|"([^"]*)"/g)].map((m) => m[1] ?? m[2]).join("\n");
      assert.doesNotMatch(strings, /round two|round 2|second round|next round/i, f);
    }
  });
});
