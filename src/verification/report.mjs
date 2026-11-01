// Markdown report writer for docs/END-TO-END-VERIFICATION.md
// Security section FIRST. P0 violations at the very top.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STATUS } from "./assert.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "docs/END-TO-END-VERIFICATION.md");

function esc(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function verdictLine(role, journey, usable) {
  if (usable === true) return `PASS — ${role} / ${journey}`;
  if (usable === false) return `FAIL — ${role} / ${journey}`;
  return `UNVERIFIED — ${role} / ${journey}`;
}

export function writeReport({ collector, meta = {}, journeyNotes = [], credentials = [], verdicts = [] }) {
  const { tallies, p0, total } = collector.summary();
  const items = collector.items;
  const p0Fails = items.filter((i) => i.p0 && i.status !== STATUS.PASS);
  const silents = items.filter((i) => i.status === STATUS.SILENT);
  const fails = items.filter((i) => i.status === STATUS.FAIL);
  const unverified = items.filter((i) => i.status === STATUS.UNVERIFIED);
  const security = items.filter((i) => i.section === "SECURITY" || i.section.startsWith("SECURITY"));

  const lines = [];
  lines.push("# End-to-End Verification Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Run id: ${collector.runId}`);
  lines.push(`Node: ${process.version}`);
  lines.push(`DATABASE_URL: ${meta.dbHost || "(set, host redacted)"}`);
  lines.push(`Stance: skeptical operator / business architect. Prefer SILENTLY-DID-NOTHING and UNVERIFIED over a false pass.`);
  lines.push("");
  lines.push("## Operator headline");
  lines.push("");
  if (p0Fails.length) {
    const leak = p0Fails.find((i) => /another ORG|cross-org|isolation/i.test(i.title || i.id || ""));
    lines.push(
      `**Do not put a real client on this platform today.** ${p0Fails.length} P0 isolation finding(s).` +
      (leak
        ? ` At least one confirmed cross-company data access attempt failed the isolation check.`
        : ` Review the P0 list below before treating this as a ship gate.`)
    );
  } else if ((tallies.FAIL || 0) + (tallies["SILENTLY-DID-NOTHING"] || 0) > 0) {
    lines.push(
      `**Not ready for real money.** No confirmed P0 isolation leak in this run, but ` +
      `${tallies.FAIL || 0} FAIL and ${tallies["SILENTLY-DID-NOTHING"] || 0} silent no-ops remain.`
    );
  } else {
    lines.push("No FAIL/SILENT/P0 in this local synthetic run. UNVERIFIED rows and live provider paths remain unproven.");
  }
  lines.push("");
  lines.push(
    "Re-run: `DATABASE_URL=... npm run verify:e2e` " +
    "(Playwright UI + data-layer). Data only: `node src/verification/run-all.mjs`."
  );
  lines.push("");
  lines.push("## Tallies");
  lines.push("");
  lines.push(`| Status | Count |`);
  lines.push(`|---|---:|`);
  for (const k of [STATUS.PASS, STATUS.FAIL, STATUS.SILENT, STATUS.UNVERIFIED, STATUS.SKIP]) {
    lines.push(`| ${k} | ${tallies[k] || 0} |`);
  }
  lines.push(`| **Total** | **${total}** |`);
  lines.push(`| P0 non-passes | ${p0} |`);
  lines.push("");

  // ─── SECURITY FIRST ───────────────────────────────────────────────
  lines.push("## 1. SECURITY (read this first)");
  lines.push("");
  if (p0Fails.length) {
    lines.push("### P0 — successful or unresolved isolation failures");
    lines.push("");
    lines.push("Any successful violation here is a business-ending and regulatory event.");
    lines.push("");
    for (const i of p0Fails) {
      lines.push(`- **P0 ${i.status}** — ${esc(i.claim)}`);
      if (i.detail) lines.push(`  - ${esc(i.detail)}`);
      if (i.file) lines.push(`  - at \`${i.file}${i.line ? ":" + i.line : ""}\``);
    }
    lines.push("");
  } else {
    lines.push("No P0 isolation failures recorded in this run. That is not a claim that none exist — only that the attempts below did not succeed.");
    lines.push("");
  }

  lines.push("### Isolation attempts");
  lines.push("");
  lines.push("| Status | Role | Claim | Detail | File |");
  lines.push("|---|---|---|---|---|");
  for (const i of security) {
    lines.push(`| ${i.status} | ${esc(i.role)} | ${esc(i.claim)} | ${esc(i.detail)} | ${esc(i.file)}${i.line ? ":" + i.line : ""} |`);
  }
  if (!security.length) {
    lines.push("| UNVERIFIED | — | No security section assertions were recorded | — | — |");
  }
  lines.push("");

  // ─── Silent no-ops (the whole point) ──────────────────────────────
  lines.push("## 2. SILENTLY-DID-NOTHING (hunt results)");
  lines.push("");
  lines.push("Code ran. No error. Nothing useful persisted — or the write was empty/zero.");
  lines.push("These are more dangerous than hard failures because nothing alerts.");
  lines.push("");
  if (!silents.length) {
    lines.push("_None recorded in this run._");
    lines.push("");
  } else {
    for (const i of silents) {
      lines.push(`- **${esc(i.journey || i.section)}** — ${esc(i.claim)}`);
      if (i.detail) lines.push(`  - ${esc(i.detail)}`);
      if (i.file) lines.push(`  - \`${i.file}${i.line ? ":" + i.line : ""}\``);
      if (i.expected) lines.push(`  - expected: \`${esc(JSON.stringify(i.expected))}\``);
      if (i.actual) lines.push(`  - actual: \`${esc(JSON.stringify(i.actual))}\``);
    }
    lines.push("");
  }

  // ─── Journey step accounts ────────────────────────────────────────
  lines.push("## 3. Journey accounts (persisted values)");
  lines.push("");
  for (const note of journeyNotes) {
    lines.push(`### ${note.title}`);
    lines.push("");
    if (note.usableToday === true) lines.push(`**Local synthetic journey: PASS**`);
    else if (note.usableToday === false) lines.push(`**Local synthetic journey: FAIL**`);
    else lines.push(`**Local synthetic journey: PARTIAL / UNVERIFIED**`);
    lines.push("");
    lines.push(note.body || "");
    lines.push("");
    if (note.steps?.length) {
      lines.push("| Step | Status | Persisted |");
      lines.push("|---|---|---|");
      for (const s of note.steps) {
        lines.push(`| ${esc(s.step)} | ${s.status} | ${esc(s.persisted)} |`);
      }
      lines.push("");
    }
  }

  // ─── Full assertion table ─────────────────────────────────────────
  lines.push("## 4. Full assertion table");
  lines.push("");
  lines.push("| Status | Section | Journey | Role | Claim | File:line |");
  lines.push("|---|---|---|---|---|---|");
  for (const i of items) {
    lines.push(
      `| ${i.status} | ${esc(i.section)} | ${esc(i.journey)} | ${esc(i.role)} | ${esc(i.claim)} | ${esc(i.file)}${i.line ? ":" + i.line : ""} |`
    );
  }
  lines.push("");

  // ─── Breaks with file/line ────────────────────────────────────────
  lines.push("## 5. Breaks (FAIL + SILENT) with file and line");
  lines.push("");
  const breaks = [...fails, ...silents];
  if (!breaks.length) {
    lines.push("_None recorded._");
    lines.push("");
  } else {
    for (const i of breaks) {
      lines.push(`- **${i.status}** ${esc(i.claim)} — \`${i.file || "?"}${i.line ? ":" + i.line : ""}\``);
      if (i.detail) lines.push(`  - ${esc(i.detail)}`);
    }
    lines.push("");
  }

  // ─── Credentials needed ───────────────────────────────────────────
  lines.push("## 6. Unverifiable without a real external credential");
  lines.push("");
  lines.push("| Check | Credential that unlocks it |");
  lines.push("|---|---|");
  const credRows = credentials.length ? credentials : [
    { check: "Real ClickFunnels webhook field paths", credential: "Live CF webhook sample + CLICKFUNNELS_WEBHOOK_SECRET" },
    { check: "Real Commas payment.succeeded payload", credential: "COMMAS_WEBHOOK_SECRET + live event sample" },
    { check: "Twilio inbound SMS + status callbacks", credential: "TWILIO_AUTH_TOKEN + real MessageSid" },
    { check: "Mailgun inbound bank-email parse", credential: "MAILGUN_WEBHOOK_SIGNING_KEY + real MIME" },
    { check: "Bland AI voice call outcome", credential: "BLAND_WEBHOOK_SECRET + live call" },
    { check: "Lendflow application decision webhooks", credential: "LENDFLOW_WEBHOOK_SECRET" },
    { check: "Company Brain live embedding retrieve", credential: "OPENAI_API_KEY (or COMPANY_BRAIN_OPENAI_API_KEY)" },
    { check: "Agent live model replies (non-shadow)", credential: "ANTHROPIC_API_KEY" },
    { check: "Oxylabs residential proxy geo-verify", credential: "OXYLABS credentials" },
    { check: "Actual outbound SMS/email delivery", credential: "Twilio/Mailgun send credentials + outbound_enabled=true" },
    { check: "Inngest-scheduled workflow timing", credential: "INNGEST_EVENT_KEY (owner-gated)" },
    { check: "CRS live soft-pull", credential: "CRS / Array vendor credentials" }
  ];
  for (const c of credRows) {
    lines.push(`| ${esc(c.check)} | ${esc(c.credential)} |`);
  }
  lines.push("");

  // ─── Verdicts ─────────────────────────────────────────────────────
  lines.push("## 7. Local synthetic journey verdicts");
  lines.push("");
  for (const v of verdicts) {
    lines.push(`- ${verdictLine(v.role, v.journey, v.usableToday)}${v.why ? ` — ${esc(v.why)}` : ""}`);
  }
  if (!verdicts.length) {
    lines.push("_No role/journey verdicts recorded._");
  }
  lines.push("");

  lines.push("## 8. Operator notes");
  lines.push("");
  lines.push(meta.operatorNotes || [
    "This harness drives real handlers against a real Postgres. Adapters run with mock secrets; nothing transmits.",
    "A PASS means the write path was exercised and the persisted value matched. Looking-correct code without a write is SILENT or UNVERIFIED.",
    "Money amounts are checked by independent hand-calculation constants in src/verification/fixtures.mjs (MONEY), not by re-calling commission helpers under test.",
    "",
    "### Decisions this pass (2026-08-04)",
    "- Closeout fee = 10% of CONFIRMED APPROVALS — the sum of applications.approved_amount",
    "  on Approved rows that carry a recorded amount. Owner-set 2026-08-30, superseding the",
    "  2026-08-04 funded-amount basis (docs/finance/CLOSEOUT-FEE-BASIS.md). Nothing confirmed means no",
    "  invoice and a named reason, never a $0 one.",
    "- Static HTML direct-URL is not a P0 leak: Netlify serves files; API ROLE_SET probes prove isolation.",
    "- Company Brain tier gate verified via access.mjs + SQL filter; live retrieve needs OPENAI_API_KEY.",
    "- DIY EMAIL-DS02 still [DRAFT]: hard guard correctly refuses send (not silent no-op).",
    "- Harness fabricated-figure check matches $12,450 only — not ordinary price copy.",
    "- Bus replay skips payload amounts ≥ $1bn so adversarial poison events cannot kill the job."
  ].join("\n\n"));
  lines.push("");

  if (unverified.length) {
    lines.push("## 9. UNVERIFIED inventory");
    lines.push("");
    for (const i of unverified) {
      lines.push(`- ${esc(i.claim)}${i.detail ? ` — ${esc(i.detail)}` : ""}`);
    }
    lines.push("");
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");
  return OUT;
}

export { OUT as REPORT_PATH };
