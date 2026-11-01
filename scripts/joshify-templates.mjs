#!/usr/bin/env node
/**
 * Rewrite message template copy:
 * - Chris personification (not "the company")
 * - Brand tagline on emails
 * - Strip bare "Unsubscribe" lines (real button comes from dispatch footer)
 *
 * Updates source markdown, fixtures, templates-seed, and optionally live DB JSON dump.
 */
import fs from "fs";
import path from "path";

const TAGLINE = "FundHub.ai • Funding Intelligence for Entrepreneurs";
const SIGN_OFF = "– Chris\nFundHub.ai\n\n" + TAGLINE;

function joshifyProse(text, { channel }) {
  let s = String(text);
  // Company-as-speaker → Chris
  s = s.replace(/\bit'?s Fund[Hh]ub\b/g, "it's Chris from Fundhub");
  s = s.replace(/\bFund[Hh]ub here\b/g, "Chris from Fundhub here");
  s = s.replace(/\bFund[Hh]ub —\b/g, "Chris at Fundhub —");
  s = s.replace(/\bFund[Hh]ub -\b/g, "Chris at Fundhub -");
  s = s.replace(/\bfrom Fund[Hh]ub\b/g, "from Chris at Fundhub");
  s = s.replace(/\bQuick note from Chris at Fundhub from Chris at Fundhub\b/g, "Quick note from Chris at Fundhub");
  s = s.replace(/\blast nudge from Fund[Hh]ub\b/gi, "last nudge from Chris at Fundhub");
  s = s.replace(/\bLast try from Fund[Hh]ub\b/gi, "Last try from Chris at Fundhub");
  s = s.replace(/\bOur team is\b/g, "I'm");
  s = s.replace(/\bour team is\b/g, "I'm");
  s = s.replace(/\bWe'll confirm\b/g, "I'll confirm");
  s = s.replace(/\bwe('ll| will) text you\b/gi, "I'll text you");
  s = s.replace(/\bLooking forward to it\b/g, "Looking forward to connecting");
  // Signature lines
  s = s.replace(/—\s*Fund[Hh]ub\s*$/gm, "— Chris");
  s = s.replace(/–\s*Fund[Hh]ub\s*$/gm, "– Chris");
  s = s.replace(/-\s*Fund[Hh]ub\s*$/gm, "- Chris");
  s = s.replace(/—\s*The Fund[Hh]ub Team\s*$/gim, "— Chris");
  s = s.replace(/FundHub Document Team/g, "Chris at Fundhub");
  // Avoid double Chris
  s = s.replace(/Chris from Chris at Fundhub/g, "Chris from Fundhub");
  s = s.replace(/from Chris at Chris at Fundhub/g, "from Chris at Fundhub");
  s = s.replace(/it's Chris from Chris from Fundhub/g, "it's Chris from Fundhub");
  if (channel === "sms") {
    // Ensure SMS that still open as company get Chris
    if (!/Chris/i.test(s) && /Hey \{\{/i.test(s)) {
      s = s.replace(/^(Hey \{\{[^}]+\}\})\s*[,—-]\s*/i, "$1 — Chris from Fundhub here. ");
      if (!/Chris/i.test(s)) {
        s = s.replace(/^(Hey \{\{[^}]+\}\})/i, "$1 — it's Chris from Fundhub.");
      }
    }
  }
  return s;
}

function normalizeEmailFooter(body) {
  let s = String(body).replace(/\r\n/g, "\n");
  // Drop bare Unsubscribe lines (word alone or with spaces)
  s = s.replace(/\n+[ \t]*Unsubscribe[ \t]*\n*$/i, "\n");
  s = s.replace(/\n+[ \t]*Unsubscribe[ \t]*\n+/gi, "\n\n");
  // Remove existing tagline / brand footer variants so we re-attach one clean block
  s = s.replace(/\n+[^\n]*Funding Intelligence for Entrepreneurs[^\n]*\n*/gi, "\n");
  s = s.replace(/\n+[^\n]*Helping Entrepreneurs Access Capital[^\n]*\n*/gi, "\n");
  s = s.replace(/\n+FundHub\.ai\s*•\s*[^\n]+\n*/g, "\n");
  s = s.replace(/\n+fundhub\.ai\s*•\s*[^\n]+\n*/gi, "\n");
  // Remove trailing FundHub.ai / sender blocks we'll replace
  s = s.replace(/\n+–\s*\{\{sender_name\}\}\s*\n+FundHub\.ai\s*$/i, "\n");
  s = s.replace(/\n+\{\{sender_name\}\}\s*\n+FundHub\.ai\s*$/i, "\n");
  s = s.replace(/\n+–\s*Chris\s*\n+FundHub\.ai\s*$/i, "\n");
  s = s.replace(/\n+FundHub\.ai\s*$/i, "\n");
  s = s.replace(/\n+View this email in your browser\s*$/i, "\n");
  s = s.trimEnd() + "\n\n" + SIGN_OFF + "\n";
  // Collapse excess blank lines
  s = s.replace(/\n{4,}/g, "\n\n\n");
  return s;
}

function transformBody(body, channel) {
  let s = joshifyProse(body, { channel });
  if (channel === "email") s = normalizeEmailFooter(s);
  else {
    // SMS: light sign if still no Chris and not a pure link notice
    if (!/Chris/i.test(s) && !/payment link/i.test(s)) {
      s = joshifyProse(s, { channel });
      if (!/Chris/i.test(s)) {
        s = s.replace(/\s*Reply STOP to opt out\.?\s*$/i, "");
        s = s.trimEnd() + "\n— Chris at Fundhub. Reply STOP to opt out.";
      }
    }
  }
  return s;
}

function transformMarkdownSource(filePath, channelHint) {
  if (!fs.existsSync(filePath)) return { filePath, changed: 0 };
  const raw = fs.readFileSync(filePath, "utf8");
  const parts = raw.split(/(?=^## )/m);
  let changed = 0;
  const out = parts.map((part, idx) => {
    if (idx === 0 && !part.startsWith("## ")) return part;
    const channel =
      channelHint ||
      (/SMS-/i.test(part.slice(0, 80)) || filePath.includes("SMS-") ? "sms" : "email");
    // Body is usually after blank line / Subject / Body markers — transform whole part carefully
    // Prefer transforming fenced or free body after headers
    const m = part.match(/^(## [^\n]+\n)([\s\S]*)$/);
    if (!m) return part;
    const head = m[1];
    let rest = m[2];
    // If structure has Subject: keep subject, transform body region
    if (/Subject:/i.test(rest)) {
      const sm = rest.match(/^(.*?Subject:\s*[^\n]*\n)([\s\S]*)$/i);
      if (sm) {
        const before = sm[1];
        let body = sm[2];
        // strip leading Body: label if present
        body = body.replace(/^Body:\s*/i, "");
        const next = transformBody(body.trimEnd(), channel);
        if (next !== body.trimEnd()) changed += 1;
        return head + before + next + (next.endsWith("\n") ? "" : "\n");
      }
    }
    const next = transformBody(rest.trimEnd(), channel);
    if (next !== rest.trimEnd()) changed += 1;
    return head + next + (next.endsWith("\n") ? "" : "\n");
  });
  const joined = out.join("");
  if (joined !== raw) fs.writeFileSync(filePath, joined);
  return { filePath, changed };
}

function transformTemplatesJson(jsonPath) {
  const templates = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  let changed = 0;
  for (const t of templates) {
    const next = transformBody(t.body, t.channel);
    if (next !== t.body) {
      t.body = next;
      changed += 1;
    }
  }
  fs.writeFileSync(jsonPath, JSON.stringify(templates, null, 2));
  return { jsonPath, changed, total: templates.length };
}

function transformSqlBodies(filePath) {
  if (!fs.existsSync(filePath)) return { filePath, changed: 0 };
  let raw = fs.readFileSync(filePath, "utf8");
  let changed = 0;
  // Replace dollar-quoted or single-quoted long bodies that look like messages — conservative:
  // only rewrite known seed files' body sections via regex on common patterns
  const next = raw
    .replace(/\bit'?s Fund[Hh]ub\b/g, () => {
      changed += 1;
      return "it's Chris from Fundhub";
    })
    .replace(/\bFund[Hh]ub here\b/g, "Chris from Fundhub here")
    .replace(/\bfrom Fund[Hh]ub\b/g, "from Chris at Fundhub")
    .replace(/—\s*Fund[Hh]ub/g, "— Chris")
    .replace(/Quick note from Chris at Fundhub from Chris at Fundhub/g, "Quick note from Chris at Fundhub");
  // Fix double-counting: only write if different
  if (next !== raw) {
    fs.writeFileSync(filePath, next);
  }
  return { filePath, changed: next !== raw ? 1 : 0 };
}

function transformTemplatesSeed(filePath) {
  if (!fs.existsSync(filePath)) return { filePath, changed: 0 };
  let raw = fs.readFileSync(filePath, "utf8");
  const before = raw;
  raw = raw
    .replace(/\bit'?s Fund[Hh]ub\b/g, "it's Chris from Fundhub")
    .replace(/\bFund[Hh]ub here\b/g, "Chris from Fundhub here")
    .replace(/\bfrom Fund[Hh]ub\b/g, "from Chris at Fundhub")
    .replace(/—\s*Fund[Hh]ub/g, "— Chris")
    .replace(/Last try from Fund[Hh]ub/gi, "Last try from Chris at Fundhub")
    .replace(/Chris from Chris at Fundhub/g, "Chris from Fundhub")
    .replace(/from Chris at Chris at Fundhub/g, "from Chris at Fundhub");
  if (raw !== before) fs.writeFileSync(filePath, raw);
  return { filePath, changed: raw !== before ? 1 : 0 };
}

const root = process.cwd();
const results = [];

results.push(
  transformMarkdownSource(
    path.join(root, "fundhub-docs/sources/EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md"),
    "email"
  )
);
results.push(
  transformMarkdownSource(
    path.join(root, "fundhub-docs/sources/SMS-TEMPLATES-CURRENT.md"),
    "sms"
  )
);
results.push(
  transformMarkdownSource(
    path.join(root, "src/messaging/seed/fixtures/EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md"),
    "email"
  )
);
results.push(
  transformMarkdownSource(
    path.join(root, "src/messaging/seed/fixtures/SMS-TEMPLATES-CURRENT.md"),
    "sms"
  )
);
results.push(transformTemplatesSeed(path.join(root, "src/workflows/templates-seed.mjs")));

for (const f of [
  "db/seed/006_message_templates_source_doc.sql",
  "db/seed/007_portal_magic_link_template.sql",
  "db/seed/008_contract_messages.sql",
  "db/seed/009_u02_funding_delivery_template.sql",
  "db/seed/010_bs_sms_precall.sql",
  "db/seed/011_followup_sms_pack.sql",
  "db/seed/007_payment_link_template.sql",
  "db/migrations/253_repair_email_templates.sql"
]) {
  results.push(transformSqlBodies(path.join(root, f)));
}

const dumpJson = path.join(
  root,
  "ops/workflows/messaging-review-2026-08-21-evidence/_templates.json"
);
if (fs.existsSync(dumpJson)) results.push(transformTemplatesJson(dumpJson));

console.log(JSON.stringify(results, null, 2));
