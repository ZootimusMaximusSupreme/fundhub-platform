// Migration 472 without a database: the three ask templates render with the words
// the chase hands them (no unknown tag survives), and the file declares what the
// repo's other guards expect of a new table — row-level security, a policy, grants
// that never include DELETE, and idempotent statements.
//
// The real-Postgres half (constraints, indexes, the writers) is
// document-vault.pg.test.mjs; CI runs that one.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { renderTemplate } from "../lib/render-template.mjs";
import { askContext, planChase, ASK_STEPS } from "./document-vault-chase.mjs";
import { buildVault } from "./document-vault.mjs";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..", "..");
const SQL = fs.readFileSync(path.join(ROOT, "db", "migrations", "472_document_vault.sql"), "utf8");
const NOW = new Date("2026-10-07T16:45:00Z");

/** { key: { channel, subject, body } } read out of the migration's VALUES list. */
function templatesIn(sql) {
  const out = {};
  const re = /\(\s*'((?:SMS|EMAIL)-VAULT-ASK-\d)'\s*,\s*'(sms|email)'\s*,\s*(NULL::text|'[^']*')\s*,\s*\$(c|html)\$([\s\S]*?)\$\4\$\s*\)/g;
  let m;
  while ((m = re.exec(sql))) {
    out[m[1]] = { channel: m[2], subject: m[3] === "NULL::text" ? null : m[3].slice(1, -1), body: m[5] };
  }
  return out;
}

const core = buildVault({
  env: {}, now: NOW,
  scopes: [{ kind: "business", id: "11111111-1111-4111-8111-111111111111", name: "Alpha & Sons LLC" }]
});
const ctx = (ask) => ({
  contact: { first_name: "Sam" },
  CLIENT_PORTAL_URL: "https://app.fundhub.ai/portal",
  unsubscribe: "https://fundhub.ai/u/abc",
  vault: askContext(core, ask)
});

describe("the three ask templates", () => {
  const found = templatesIn(SQL);

  test("the migration holds exactly the three keys the ladder uses, on the right channels", () => {
    assert.deepEqual(Object.keys(found).sort(), ["EMAIL-VAULT-ASK-2", "SMS-VAULT-ASK-1", "SMS-VAULT-ASK-3"]);
    for (const step of ASK_STEPS) {
      assert.equal(found[step.templateKey].channel, step.channel, step.templateKey);
    }
  });

  test("every tag in them is one the chase or the client record supplies — nothing renders blank", () => {
    const warnings = [];
    const real = console.warn;
    console.warn = (...a) => warnings.push(a.join(" "));
    try {
      for (const step of ASK_STEPS) {
        const ask = { ...planChase({ core, now: NOW, env: {} }).ask, ...step };
        const out = renderTemplate(found[step.templateKey].body, ctx(ask));
        assert.ok(!/\{\{/.test(out), `${step.templateKey} still holds a tag: ${out.slice(0, 200)}`);
      }
    } finally {
      console.warn = real;
    }
    assert.deepEqual(warnings, [], "an unknown or blank tag means the template and the chase disagree");
  });

  test("a text names the paper, the business, the portal, and how to stop", () => {
    const ask = { ...planChase({ core, now: NOW, env: {} }).ask, ...ASK_STEPS[0] };
    const sms = renderTemplate(found["SMS-VAULT-ASK-1"].body, ctx(ask));
    assert.match(sms, /^Hey Sam, Fundhub\./);
    assert.match(sms, /we still need a photo of your driver's license or passport\./);
    assert.match(sms, /After that, 7 more documents\./);
    assert.match(sms, /https:\/\/app\.fundhub\.ai\/portal Or reply to this text with a photo\. Reply STOP to opt out\.$/);
    const third = renderTemplate(found["SMS-VAULT-ASK-3"].body, ctx({ ...ask, ...ASK_STEPS[2] }));
    assert.match(third, /reply here and a person will help/);
    assert.match(third, /Reply STOP to opt out\.$/);
    assert.notEqual(sms, third, "three different words, never the same text three times");
  });

  test("'reply with a photo' is only said where it is true: the three personal papers", () => {
    const ask = planChase({ core, now: NOW, env: {} }).ask;
    assert.equal(ask.slot, "id_document:client");
    const personal = renderTemplate(found["SMS-VAULT-ASK-1"].body, ctx({ ...ask, ...ASK_STEPS[0] }));
    assert.match(personal, /reply to this text with a photo/);
    const businessCore = buildVault({
      env: {}, now: NOW,
      scopes: [{ kind: "business", id: "11111111-1111-4111-8111-111111111111", name: "Alpha LLC" }],
      waivers: ["id_document", "proof_of_address", "tax_returns_personal"].map((k) => ({ item_key: k, entity_id: null, note: "x" }))
    });
    const bizAsk = planChase({ core: businessCore, now: NOW, env: {} }).ask;
    assert.equal(bizAsk.slot, "bank_statements_business:11111111-1111-4111-8111-111111111111");
    const biz = renderTemplate(found["SMS-VAULT-ASK-1"].body, {
      contact: { first_name: "Sam" }, CLIENT_PORTAL_URL: "https://app.fundhub.ai/portal",
      vault: askContext(businessCore, { ...bizAsk, ...ASK_STEPS[0] })
    });
    assert.ok(!/reply to this text/.test(biz), biz);
    assert.match(biz, /https:\/\/app\.fundhub\.ai\/portal Reply STOP to opt out\.$/, "the portal, then straight to how to stop");
  });

  test("a text is short enough for a handful of segments, not an essay", () => {
    const ask = { ...planChase({ core, now: NOW, env: {} }).ask, ...ASK_STEPS[0] };
    for (const step of [ASK_STEPS[0], ASK_STEPS[2]]) {
      const out = renderTemplate(found[step.templateKey].body, ctx({ ...ask, ...step }));
      assert.ok(out.length < 420, `${step.templateKey} is ${out.length} characters`);
    }
  });

  test("the email lists every open paper, escapes a business name, and carries the unsubscribe link", () => {
    const ask = { ...planChase({ core, now: NOW, env: {} }).ask, ...ASK_STEPS[1] };
    const html = renderTemplate(found["EMAIL-VAULT-ASK-2"].body, ctx(ask));
    assert.equal((html.match(/<li>/g) || []).length, 8);
    assert.ok(html.includes("Alpha &amp; Sons LLC"));
    assert.ok(!html.includes("Alpha & Sons"));
    assert.match(html, /https:\/\/fundhub\.ai\/u\/abc/);
    assert.equal(found["EMAIL-VAULT-ASK-2"].subject, "Documents still needed for your file");
    assert.match(html, /^<!DOCTYPE html>/);
  });

  test("no placeholder: a draft marker would be refused by sendTemplated", () => {
    for (const t of Object.values(found)) {
      assert.ok(!/\[DRAFT\]|TODO|lorem/i.test(t.body + (t.subject || "")));
    }
  });
});

describe("the migration file", () => {
  test("both tables switch row-level security on, force it, and declare a policy", () => {
    for (const table of ["document_vault_reviews", "document_vault_items"]) {
      assert.match(SQL, new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`), table);
      assert.match(SQL, new RegExp(`ALTER TABLE public\\.${table}\\s+FORCE ROW LEVEL SECURITY`), table);
      assert.match(SQL, new RegExp(`CREATE POLICY ${table}_app_all ON public\\.${table}`), table);
    }
  });

  test("the app role can read, add and change — and can never delete", () => {
    assert.match(SQL, /GRANT SELECT, INSERT, UPDATE ON public\.document_vault_reviews TO fundhub_app/);
    assert.match(SQL, /GRANT SELECT, INSERT, UPDATE ON public\.document_vault_items\s+TO fundhub_app/);
    assert.ok(!/GRANT[^;]*\bDELETE\b/i.test(SQL));
    assert.ok(!/\bDELETE\s+FROM\b/i.test(SQL), "nothing here deletes a row");
    assert.ok(!/DROP\s+(TABLE|COLUMN)/i.test(SQL));
  });

  test("it can be run twice: every create is IF NOT EXISTS or guarded", () => {
    for (const m of SQL.matchAll(/CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX)\s+(?!IF NOT EXISTS)/gi)) {
      assert.fail(`CREATE ${m[1]} without IF NOT EXISTS at offset ${m.index}`);
    }
    assert.match(SQL, /ADD COLUMN IF NOT EXISTS detail text/);
    assert.match(SQL, /ON CONFLICT \(org_id, template_key\) DO NOTHING/, "a company's edited template keeps its words");
  });

  test("a reject must carry a reason, a waiver must carry a reason, a custom line must carry a title, in the database", () => {
    assert.match(SQL, /document_vault_reviews_reject_reason_ck[\s\S]*status <> 'rejected'/);
    assert.match(SQL, /document_vault_items_waiver_reason_ck[\s\S]*kind <> 'waiver'/);
    assert.match(SQL, /document_vault_items_custom_title_ck[\s\S]*kind <> 'custom'/);
    assert.match(SQL, /document_vault_reviews_one_per_document\s+ON public\.document_vault_reviews \(document_id\)/);
  });

  test("it never touches money_agent_log's CHECK lists, which other units rebuild from migration 464's words", () => {
    assert.ok(!/money_agent_log/i.test(SQL.replace(/--[^\n]*/g, "")), "no statement may touch money_agent_log");
    assert.ok(!/money_agent_tasks/i.test(SQL.replace(/--[^\n]*/g, "")), "the ask uses 464's table as it is");
  });
});
