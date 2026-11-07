// Migration 578 and the three texts it seeds. Read as text — no database. What
// this pins: the template the client reads and the sentence the planner stored
// are the SAME sentence, and none of the three shows an amount, a bank or card
// name, or account digits on a locked phone.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { renderTemplate } from "../../lib/render-template.mjs";
import { isDraftTemplateRow } from "../../messaging/draft-guard.mjs";
import { KINDS } from "./common.mjs";
import { BUNDLE_KINDS, BUNDLE_TEMPLATES, lockScreenSafe } from "./bundle-common.mjs";
import { planCardOver10 } from "./card-over-10.mjs";
import { planBusinessCredit } from "./business-credit.mjs";
import { planWeeklyMoney, weeklySummary } from "./weekly-money.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "..", "..", "..", "db", "migrations");
const FILE = "578_finance_alerts_bundle.sql";
const SQL = readFileSync(join(MIGRATIONS, FILE), "utf8");
const CODE = SQL.replace(/--.*$/gm, "");
const STOP = " Reply STOP to opt out.";

function seeded() {
  const out = {};
  for (const m of SQL.matchAll(/\('(SMS-[A-Z0-9-]+)',\s*\$c\$([\s\S]*?)\$c\$\)/g)) out[m[1]] = m[2];
  return out;
}
const templates = seeded();

describe("migration 578 — the file", () => {
  test("it is number 578 and nothing else owns 578", () => {
    assert.deepEqual(readdirSync(MIGRATIONS).filter((f) => f.startsWith("578_")), [FILE]);
  });

  test("no table, column or row is dropped or rewritten; the only swap is the kind check", () => {
    assert.doesNotMatch(CODE, /\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
    assert.doesNotMatch(CODE, /\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
    assert.doesNotMatch(CODE, /\bUPDATE\s+\w+\s+SET\b/i);
    const drops = [...CODE.matchAll(/DROP CONSTRAINT IF EXISTS (\w+)/g)].map((m) => m[1]);
    assert.deepEqual(drops, ["file_protection_alerts_kind_check"]);
  });

  test("the new kind check lists the four older kinds and the three new ones — all seven", () => {
    const m = CODE.match(/ADD CONSTRAINT file_protection_alerts_kind_check\s+CHECK \(kind IN \(([^)]*)\)\)/);
    assert.ok(m, "the kind check is re-added");
    const listed = [...m[1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]);
    assert.deepEqual(listed, [...KINDS, ...BUNDLE_KINDS]);
  });

  test("one switch per new kind, on by default", () => {
    for (const k of BUNDLE_KINDS) {
      assert.match(CODE, new RegExp(`ADD COLUMN IF NOT EXISTS ${k}\\s+boolean NOT NULL DEFAULT true`), k);
    }
  });

  test("three texts, one per kind, approved and not drafts, and a company's own copy is kept", () => {
    assert.deepEqual(Object.keys(templates).sort(), Object.values(BUNDLE_TEMPLATES).sort());
    for (const [key, body] of Object.entries(templates)) {
      assert.equal(isDraftTemplateRow({ body, subject: null }), false, key);
      assert.ok(body.endsWith(STOP), `${key} ends with the opt-out line`);
    }
    assert.match(CODE, /ON CONFLICT \(org_id, template_key\) DO NOTHING/);
  });
});

describe("the words a locked phone shows", () => {
  test("no template holds a dollar sign, an amount or a card mask, and the company is spelled Fundhub", () => {
    for (const [key, body] of Object.entries(templates)) {
      assert.ok(lockScreenSafe(body), key);
      assert.match(body, /^Fundhub /, key);
      assert.doesNotMatch(body, /FundHub|FUNDHUB|Fund Hub/, key);
      assert.doesNotMatch(body, /round two|round 2|next round/i, key);
    }
  });

  test("every merge tag is one the job fills in", () => {
    const tags = Object.fromEntries(Object.entries(templates).map(([k, b]) => [k, [...b.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]).sort()]));
    assert.deepEqual(tags, {
      "SMS-FILE-PROTECT-CARD-OVER-10": ["alert.when"],
      "SMS-FILE-PROTECT-BUSINESS-CREDIT": ["alert.change"],
      "SMS-FINANCE-WEEKLY-MONEY": ["alert.summary"]
    });
  });
});

describe("the template renders to the planner's own sentence", () => {
  function check(plan, label) {
    assert.equal(plan.alert, true, `${label}: a plan was made`);
    assert.equal(renderTemplate(templates[plan.templateKey], { alert: plan.tags }), `${plan.body}${STOP}`, label);
    assert.ok(lockScreenSafe(plan.body), label);
  }

  test("card over 10%: ahead of the close and on the day", () => {
    const card = { account_id: "a", name: "Sample", mask: "4404", balance_cents: 240000, limit_cents: 800000 };
    check(planCardOver10(card, { statement_close_day: 16 }, { today: "2026-11-06", funded: true }), "ahead");
    check(planCardOver10(card, { statement_close_day: 6 }, { today: "2026-11-06", funded: true, payBeforeCloseOn: false }), "today");
  });

  test("business credit: up, down and changed", () => {
    const rep = (s, f) => ({ name: "Sample Co", report: { scoreInformation: { commercialScore: { score: s }, fsrScore: { score: f } } } });
    const pulls = (a, b) => [
      { id: "new", created_at: "2026-11-05T00:00:00Z", result: { businessReports: [rep(...a)] } },
      { id: "old", created_at: "2026-10-05T00:00:00Z", result: { businessReports: [rep(...b)] } }
    ];
    const biz = { id: "b", name: "Sample Co" };
    for (const [a, b] of [[[50, 50], [40, 40]], [[30, 30], [40, 40]], [[50, 30], [40, 40]]]) {
      check(planBusinessCredit(biz, pulls(a, b), { now: "2026-11-06T00:00:00Z" }), `${a}`);
    }
  });

  test("weekly money", () => {
    const summary = weeklySummary({
      moneyIn: { personal: { known: true, count: 2 }, business: { known: true, count: 0 } },
      cards: { personal: { known: 2, over: 1 } },
      seasoning: { opened: 1, newest: { days_open: 9 } },
      openSteps: 2
    });
    check(planWeeklyMoney({ clientId: "c", week: { monday: "2026-11-09", from: "2026-11-02", to: "2026-11-08" }, summary }), "weekly");
  });
});
