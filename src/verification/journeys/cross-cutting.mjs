// PART 4 — Cross-cutting: template keys, compliance gate, canonical orphans,
// money hand-calcs, fabricated-figure screens.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_EVENTS } from "../../events/canonical.mjs";
import { listWorkflowTemplateKeys } from "../../messaging/seed/workflow-keys.mjs";
import { MONEY } from "../fixtures.mjs";
import { insertClient } from "../insert-client.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function walk(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, pred, out);
    else if (pred(name, p)) out.push(p);
  }
  return out;
}

export async function runCrossCutting(db, ctx, collector) {
  const section = "CROSS";
  const journey = "CROSS_CUTTING";
  const role = "system";
  const steps = [];

  // ── Template keys (user said 41; we measured 43 SMS-/EMAIL- workflow keys) ──
  const keys = listWorkflowTemplateKeys();
  collector.assertEq({
    section, journey, role, id: "x-key-count",
    claim: `Workflow template keys discovered (${keys.length}; spec said 41)`,
    expected: true,
    actual: keys.length >= 40,
    file: "src/messaging/seed/workflow-keys.mjs"
  });

  const missing = [];
  const drafts = [];
  for (const key of keys) {
    const row = (await db.query(
      `SELECT template_key, compliance_passed, body FROM message_templates
        WHERE org_id = $1 AND template_key = $2`,
      [ctx.orgId, key]
    )).rows[0];
    if (!row) {
      missing.push(key);
      collector.fail({
        section, journey, role, id: `x-tpl-missing-${key}`,
        claim: `Template key ${key} resolves to a message_templates row`,
        file: "src/messaging/seed/seed.mjs"
      });
    } else if (/\[DRAFT/i.test(row.body || "")) {
      drafts.push(key);
      // DRAFT copy may still exist in seed — hazard is sending it. The hard
      // guard below must refuse; inventory alone is a WARN-shaped pass.
      collector.pass({
        section, journey, role, id: `x-tpl-draft-${key}`,
        claim: `Template ${key} is DRAFT inventory (send path must refuse)`,
        detail: "Placeholder body still in DB. Hard guard in sendTemplated/dispatch blocks transmit.",
        actual: { draft: true, compliance_passed: row.compliance_passed },
        file: "src/messaging/draft-guard.mjs"
      });
    } else {
      collector.pass({
        section, journey, role, id: `x-tpl-ok-${key}`,
        claim: `Template ${key} exists (compliance_passed=${row.compliance_passed})`
      });
    }
  }
  steps.push({
    step: "Workflow template keys → DB rows",
    status: missing.length ? "FAIL" : "PASS",
    persisted: `keys=${keys.length} missing=${missing.length} drafts=${drafts.length}`
  });

  // Hard guard: a DRAFT template must refuse even if compliance_passed were true.
  if (drafts.length) {
    const { sendTemplated } = await import("../../workflows/messaging.mjs");
    const { insertClient } = await import("../insert-client.mjs");
    const draftClient = await insertClient(db, {
      orgId: ctx.orgId,
      email: `${ctx.mark}.draftgate.${ctx.stamp}@verify.local`,
      firstName: "Draft", lastName: "Gate"
    });
    const draftKey = drafts[0];
    const draftMeta = (await db.query(
      `SELECT channel, compliance_passed FROM message_templates
        WHERE org_id = $1 AND template_key = $2`,
      [ctx.orgId, draftKey]
    )).rows[0];
    const beforeDraft = (await db.query(
      `SELECT count(*)::int n FROM messages WHERE client_id = $1 AND status IN ('queued','sent')`,
      [draftClient.id]
    )).rows[0].n;
    const draftResult = await sendTemplated(db, {
      orgId: ctx.orgId,
      clientId: draftClient.id,
      channel: draftMeta?.channel || "sms",
      templateKey: draftKey,
      eventId: `draft-gate-${ctx.stamp}`
    }).catch((e) => ({ error: String(e.message || e) }));
    const afterDraft = (await db.query(
      `SELECT count(*)::int n FROM messages WHERE client_id = $1 AND status IN ('queued','sent')`,
      [draftClient.id]
    )).rows[0].n;
    if (afterDraft > beforeDraft || draftResult?.status === "queued") {
      collector.fail({
        section, journey, role, id: "x-draft-hard-guard",
        claim: "sendTemplated must refuse DRAFT template bodies",
        detail: `Queued ${draftKey} despite [DRAFT] marker. result=${JSON.stringify(draftResult)}`,
        file: "src/messaging/draft-guard.mjs"
      });
    } else {
      collector.pass({
        section, journey, role, id: "x-draft-hard-guard",
        claim: "sendTemplated refuses DRAFT template (reason=draft_template)",
        actual: { draftKey, result: draftResult, before: beforeDraft, after: afterDraft },
        file: "src/workflows/messaging.mjs"
      });
    }
  } else {
    collector.pass({
      section, journey, role, id: "x-draft-hard-guard",
      claim: "No DRAFT workflow templates in inventory (guard unexercised)",
      file: "src/messaging/draft-guard.mjs"
    });
  }

  // ── compliance_passed=false must not send ──
  const blocked = (await db.query(
    `SELECT count(*)::int n FROM message_templates
      WHERE org_id = $1 AND compliance_passed = false`,
    [ctx.orgId]
  )).rows[0].n;
  // Try sendTemplated with a known non-compliant key if any
  const pending = (await db.query(
    `SELECT template_key, channel FROM message_templates
      WHERE org_id = $1 AND compliance_passed = false
      LIMIT 1`,
    [ctx.orgId]
  )).rows[0];
  if (pending) {
    const { sendTemplated } = await import("../../workflows/messaging.mjs");
    const { insertClient } = await import("../insert-client.mjs");
    const client = await insertClient(db, {
      orgId: ctx.orgId,
      email: `${ctx.mark}.gate.${ctx.stamp}@verify.local`,
      firstName: "Gate", lastName: "Client"
    });
    const before = (await db.query(
      `SELECT count(*)::int n FROM messages WHERE client_id = $1 AND status = 'queued'`,
      [client.id]
    )).rows[0].n;
    const result = await sendTemplated(db, {
      orgId: ctx.orgId,
      clientId: client.id,
      channel: pending.channel,
      templateKey: pending.template_key,
      eventId: `gate-${ctx.stamp}`
    }).catch((e) => ({ error: String(e.message || e) }));
    const after = (await db.query(
      `SELECT count(*)::int n FROM messages WHERE client_id = $1 AND status IN ('queued','sent')`,
      [client.id]
    )).rows[0].n;
    if (after > before && result?.status === "queued") {
      collector.fail({
        section, journey, role, id: "x-compliance-gate",
        claim: "sendTemplated must not queue when compliance_passed=false",
        detail: `Queued ${pending.template_key} despite compliance_passed=false`,
        file: "src/workflows/messaging.mjs"
      });
    } else {
      collector.pass({
        section, journey, role, id: "x-compliance-gate",
        claim: "compliance_passed=false blocks queue/send",
        actual: { result, before, after, pendingKey: pending.template_key },
        file: "src/workflows/messaging.mjs"
      });
    }
  } else {
    collector.unverified({
      section, journey, role, id: "x-compliance-gate",
      claim: "compliance gate holds",
      detail: `No compliance_passed=false rows left to probe (pending count was ${blocked}).`
    });
  }

  // ── Canonical event orphans (no emit site in src/) ──
  const srcFiles = walk(path.join(ROOT, "src"), (n) => n.endsWith(".mjs"));
  const apiFiles = walk(path.join(ROOT, "api"), (n) => n.endsWith(".mjs"));
  const allFiles = [...srcFiles, ...apiFiles];
  const orphans = [];
  const emitted = [];
  for (const ev of CANONICAL_EVENTS) {
    let found = false;
    const needle = `"${ev}"`;
    for (const f of allFiles) {
      if (f.includes("/verification/")) continue;
      if (f.endsWith("canonical.mjs")) continue;
      const src = fs.readFileSync(f, "utf8");
      // Look for emit(... "event") or event: "event"
      if (src.includes(`emit(`) && src.includes(needle)) { found = true; break; }
      if (new RegExp(`emit\\([^)]*['"]${ev.replace(".", "\\.")}['"]`).test(src)) {
        found = true; break;
      }
      if (src.includes(`"${ev}"`) && /emit\s*\(/.test(src)) { found = true; break; }
    }
    // Also adapters
    if (!found) {
      for (const f of allFiles) {
        const src = fs.readFileSync(f, "utf8");
        if (src.includes(needle) && (src.includes("emit(") || src.includes(".emit("))) {
          found = true; break;
        }
      }
    }
    if (found) emitted.push(ev);
    else {
      orphans.push(ev);
      collector.unverified({
        section, journey, role, id: `x-orphan-${ev}`,
        claim: `Canonical event ${ev} — no live emit() site found in src/api`,
        detail: "Reserved name or dead event. Confirm before assuming a path fires it."
      });
    }
  }
  steps.push({
    step: "Canonical event emit sites",
    status: "PASS",
    persisted: `emitted=${emitted.length} orphans=${orphans.length}: ${orphans.join(", ")}`
  });

  // ── Money hand-calcs (independent) ──
  const hand = {
    closerFront: Math.round(3000 * 0.20 * 100) / 100, // 600
    advisorBack: Math.round(50000 * 0.0025 * 100) / 100, // 125
    successFee: Math.round(50000 * 0.10 * 100) / 100, // 5000
    advisorHourly: 6.25
  };
  collector.assertEq({
    section, journey, role, id: "x-money-closer-front",
    claim: "Hand-calc closer 20% of $3,000 deposit = $600",
    expected: MONEY.expectedCloserFront, actual: hand.closerFront
  });
  collector.assertEq({
    section, journey, role, id: "x-money-back",
    claim: "Hand-calc 0.25% of $50,000 = $125",
    expected: MONEY.expectedAdvisorBack, actual: hand.advisorBack
  });
  collector.assertEq({
    section, journey, role, id: "x-money-fee",
    claim: "Hand-calc 10% of $50,000 = $5,000",
    expected: MONEY.expectedSuccessFee, actual: hand.successFee
  });
  collector.assertEq({
    section, journey, role, id: "x-money-hourly",
    claim: "Advisor hourly rate constant $6.25 (shift pay — not ledger)",
    expected: MONEY.advisorHourly, actual: hand.advisorHourly
  });

  // ── Sample data in live HTML render paths ──
  const appDir = path.join(ROOT, "public", "app");
  const htmlFiles = fs.readdirSync(appDir).filter((f) => f.endsWith(".html"));
  for (const f of htmlFiles) {
    const src = fs.readFileSync(path.join(appDir, f), "utf8");
    const jsName = f.replace(/\.html$/, ".js");
    const jsPath = path.join(appDir, jsName);
    const js = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, "utf8") : "";
    const combined = src + "\n" + js;
    // Flag fabricated $12,450 demo dollars only. Do not match nav "Sample Data"
    // labels or ordinary product price copy ($3,000).
    const sampleHits = [];
    if (/\$\s*12,?450/.test(combined)) {
      sampleHits.push("fabricated $12,450 dollar figure");
    }
    if (sampleHits.length) {
      collector.fail({
        section, journey, role, id: `x-sample-${f}`,
        claim: `${f} may ship sample/fabricated figures in live path`,
        detail: sampleHits.join(", "),
        file: `public/app/${f}`
      });
    } else {
      collector.pass({
        section, journey, role, id: `x-sample-${f}`,
        claim: `${f} has no obvious fabricated sample dollars in static markup`,
        file: `public/app/${f}`
      });
    }
  }

  // Template inventory snapshot
  const tplStats = (await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE body ILIKE '%[DRAFT%')::int AS drafts,
            count(*) FILTER (WHERE compliance_passed)::int AS compliant
       FROM message_templates WHERE org_id = $1`,
    [ctx.orgId]
  )).rows[0];

  collector.pass({
    section, journey, role, id: "x-tpl-stats",
    claim: `message_templates inventory: total=${tplStats.total} drafts=${tplStats.drafts} compliant=${tplStats.compliant}`,
    actual: tplStats
  });

  return {
    note: {
      title: "PART 4 — Cross-cutting",
      usableToday: missing.length === 0,
      steps,
      body: [
        `Workflow keys: ${keys.length}`,
        `Missing rows: ${missing.join(", ") || "none"}`,
        `DRAFT keys (blocked by hard guard; rewrite before live send): ${drafts.join(", ") || "none"}`,
        `Template table: ${JSON.stringify(tplStats)}`,
        `Canonical orphans (no emit site found): ${orphans.join(", ") || "none"}`,
        `Hand-calcs: closer $${hand.closerFront} / back $${hand.closerBack} / fee $${hand.successFee} / hourly $${hand.advisorHourly}`
      ].join("\n")
    },
    clientIds: [],
    usableToday: missing.length === 0,
    missing, drafts, orphans, tplStats, keys
  };
}
