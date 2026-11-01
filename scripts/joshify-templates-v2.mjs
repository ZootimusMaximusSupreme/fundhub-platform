#!/usr/bin/env node
/**
 * Safe rewrite of EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md block format:
 *   ========
 *   ## KEY ...
 *   ========
 *   body...
 */
import fs from "fs";

const TAGLINE = "FundHub.ai • Funding Intelligence for Entrepreneurs";
const SIGN_OFF = "– Chris\nFundHub.ai\n\n" + TAGLINE;

function joshify(s) {
  return String(s)
    .replace(/\bit'?s Fund[Hh]ub\b/g, "it's Chris from Fundhub")
    .replace(/(?<!Chris from )\bFund[Hh]ub here\b/g, "Chris from Fundhub here")
    .replace(/\bFund[Hh]ub again\b/g, "Chris again")
    .replace(/\bFund[Hh]ub update\b/gi, "Update from Chris")
    .replace(/\bfrom Fund[Hh]ub\b/g, "from Chris at Fundhub")
    .replace(/\blast nudge from Fund[Hh]ub\b/gi, "last nudge from Chris at Fundhub")
    .replace(/\bOur team is\b/g, "I'm")
    .replace(/\bour team is\b/g, "I'm")
    .replace(/—\s*Fund[Hh]ub\b/g, "— Chris")
    .replace(/–\s*Fund[Hh]ub\b/g, "– Chris")
    .replace(/FundHub Document Team/g, "Chris at Fundhub")
    .replace(/Chris from Chris at Fundhub/g, "Chris from Fundhub")
    .replace(/from Chris at Chris at Fundhub/g, "from Chris at Fundhub")
    .replace(/Quick note from Chris at Fundhub from Chris at Fundhub/g, "Quick note from Chris at Fundhub")
    .replace(/it's Chris from Chris from Fundhub/g, "it's Chris from Fundhub");
}

function normalizeEmailBody(body) {
  let s = joshify(body).replace(/\r\n/g, "\n");
  s = s.replace(/\n+[ \t]*Unsubscribe[ \t]*\s*$/i, "\n");
  s = s.replace(/\n+[ \t]*Unsubscribe[ \t]*\n+/gi, "\n\n");
  s = s.replace(/\n+[^\n]*Funding Intelligence for Entrepreneurs[^\n]*\n*/gi, "\n");
  s = s.replace(/\n+[^\n]*Helping Entrepreneurs Access Capital[^\n]*\n*/gi, "\n");
  s = s.replace(/\n+[^\n]*Affiliate Program[^\n]*\n*/gi, "\n");
  s = s.replace(/\n+[^\n]*• Billing[^\n]*\n*/gi, "\n");
  s = s.replace(/\n+[^\n]*• Onboarding Support[^\n]*\n*/gi, "\n");
  s = s.replace(/\n+fundhub\.ai\s*•\s*[^\n]+\n*/gi, "\n");
  s = s.replace(/\n+FundHub\.ai\s*•\s*[^\n]+\n*/g, "\n");
  s = s.replace(/\n+–\s*\{\{sender_name\}\}\s*\n+FundHub\.ai\s*\n*/gi, "\n");
  s = s.replace(/\n+\{\{sender_name\}\}\s*\n+FundHub\.ai\s*\n*/gi, "\n");
  s = s.replace(/\n+–\s*Chris\s*\n+FundHub\.ai\s*\n*/gi, "\n");
  s = s.replace(/\n+FundHub\.ai\s*\n*$/i, "\n");
  s = s.trimEnd() + "\n\n" + SIGN_OFF + "\n";
  s = s.replace(/\n{4,}/g, "\n\n\n");
  return s;
}

function transformEmailSource(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const re =
    /(={10,}\n## [^\n]+\n={10,}\n)([\s\S]*?)(?=\n={10,}\n## |\n*$)/g;
  let changed = 0;
  const out = raw.replace(re, (full, header, body) => {
    const next = normalizeEmailBody(body);
    if (next !== body) changed += 1;
    return header + next;
  });
  fs.writeFileSync(filePath, out);
  return changed;
}

function transformSmsSource(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const parts = raw.split(/(?=^## )/m);
  let changed = 0;
  const out = parts
    .map((part, i) => {
      if (i === 0 && !part.startsWith("## ")) return part;
      const m = part.match(/^(## [^\n]+\n\n?)([\s\S]*)$/);
      if (!m) return part;
      let body = m[2].trimEnd();
      let next = joshify(body);
      if (!/Chris/i.test(next)) {
        next = next.replace(/\s*Reply STOP to opt out\.?\s*$/i, "");
        next = next.trimEnd() + "\n— Chris at Fundhub. Reply STOP to opt out.";
      } else if (!/Reply STOP/i.test(next) && /opt out/i.test(body)) {
        // keep stop line
      }
      // Ensure STOP line still present
      if (/Reply STOP/i.test(body) && !/Reply STOP/i.test(next)) {
        next = next.trimEnd() + " Reply STOP to opt out.";
      }
      if (next !== body) changed += 1;
      return m[1] + next + "\n";
    })
    .join("");
  fs.writeFileSync(filePath, out);
  return changed;
}

const emailFiles = [
  "fundhub-docs/sources/EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md",
  "src/messaging/seed/fixtures/EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md"
];
const smsFiles = [
  "fundhub-docs/sources/SMS-TEMPLATES-CURRENT.md",
  "src/messaging/seed/fixtures/SMS-TEMPLATES-CURRENT.md"
];

for (const f of emailFiles) {
  if (fs.existsSync(f)) console.log("email", f, transformEmailSource(f));
}
for (const f of smsFiles) {
  if (fs.existsSync(f)) console.log("sms", f, transformSmsSource(f));
}

// Refresh _templates.json bodies with the same helpers
const dumpPath =
  "ops/workflows/messaging-review-2026-08-21-evidence/_templates.json";
if (fs.existsSync(dumpPath)) {
  const templates = JSON.parse(fs.readFileSync(dumpPath, "utf8"));
  let n = 0;
  for (const t of templates) {
    const before = t.body;
    if (t.channel === "email") {
      t.body = normalizeEmailBody(t.body);
    } else {
      let s = joshify(t.body);
      if (!/Chris/i.test(s) && t.key !== "payment_link_notice") {
        s = s.replace(/\s*Reply STOP to opt out\.?\s*$/i, "");
        s = s.trimEnd() + "\n— Chris at Fundhub. Reply STOP to opt out.";
      }
      if (/Reply STOP/i.test(before) && !/Reply STOP/i.test(s)) {
        s = s.trimEnd() + " Reply STOP to opt out.";
      }
      t.body = s;
    }
    if (t.body !== before) n += 1;
  }
  fs.writeFileSync(dumpPath, JSON.stringify(templates, null, 2));
  console.log("json", n, "/", templates.length);
}
