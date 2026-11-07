#!/usr/bin/env node
// Build the credit-union "who can join" file that src/finance/local-banks.mjs reads.
//
//   node scripts/build-ncua-membership-data.mjs            writes src/finance/ncua-membership-data.json
//   node scripts/build-ncua-membership-data.mjs --check    downloads and checks, writes nothing
//
// SOURCE. The NCUA's own quarterly Call Report data file, the SAME file the
// credit-union branch directory was built from (src/blueprint/local-credit-
// union-data.json names its URL and SHA-256; this script refuses a file whose
// SHA-256 differs, so the two always describe the same quarter). Inside it,
// FOICU.txt carries TOM_CODE, "the credit union field of membership"
// (FOICUDES.txt). The codes, as Callahan & Associates lists them
// (https://callahan-associates-inc.helpscoutdocs.com/article/292-understanding-tom-codes,
// read 2026-11-07): 00 community, 66 community rural district, 77 community
// next to a metro area, 01-24 one group only (faith, fraternal, school,
// military, government or one employer), 34-54 and 98 several groups, 99 a
// state charter (the NCUA records no type).
//
// The zip is read with the system `unzip` (macOS and the Linux runners have it).
// Nothing about any client is involved.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIRECTORY = fileURLToPath(new URL("../src/blueprint/local-credit-union-data.json", import.meta.url));
const OUT = fileURLToPath(new URL("../src/finance/ncua-membership-data.json", import.meta.url));
/* A sanity floor, not a rule: FOICU listed 4,299 credit unions for 2026-06-30. */
const MIN_ROWS = 3000;

/** One CSV line → fields. Quotes may wrap a field; "" inside quotes is a quote. */
export function csvFields(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** FOICU.txt text → { charter: "TOM" } for every row with a charter and a two-digit code. */
export function membershipCodes(foicu) {
  const lines = String(foicu || "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return {};
  const head = csvFields(lines[0]).map((h) => h.trim().toUpperCase());
  const at = { cu: head.indexOf("CU_NUMBER"), tom: head.indexOf("TOM_CODE") };
  if (at.cu < 0 || at.tom < 0) throw new Error("FOICU.txt has no CU_NUMBER or TOM_CODE column");
  const codes = {};
  for (const line of lines.slice(1)) {
    const f = csvFields(line);
    const cu = String(f[at.cu] || "").trim();
    const tom = String(f[at.tom] || "").trim();
    if (/^\d+$/.test(cu) && /^\d{2}$/.test(tom)) codes[cu] = tom;
  }
  return codes;
}

async function main() {
  const check = process.argv.includes("--check");
  const directory = JSON.parse(readFileSync(DIRECTORY, "utf8"));
  const src = directory.source || {};
  if (!src.url || !src.sha256) throw new Error("The credit-union directory names no source URL or SHA-256");
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`NCUA answered ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  const sha = createHash("sha256").update(zip).digest("hex");
  if (sha !== src.sha256) throw new Error(`The NCUA file changed (SHA-256 ${sha}, the directory has ${src.sha256}). Nothing written.`);
  const dir = mkdtempSync(join(tmpdir(), "ncua-"));
  let text;
  try {
    const file = join(dir, "call-report.zip");
    writeFileSync(file, zip);
    text = execFileSync("unzip", ["-p", file, "FOICU.txt"], { maxBuffer: 64 * 1024 * 1024 }).toString("latin1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const codes = membershipCodes(text);
  const n = Object.keys(codes).length;
  if (n < MIN_ROWS) throw new Error(`Only ${n} credit unions had a membership code. Nothing written.`);
  const data = {
    version: 1,
    source: {
      name: "NCUA Call Report FOICU: type of membership (TOM_CODE)",
      asOf: src.asOf || null,
      url: src.url,
      sha256: src.sha256,
      codesFrom: "https://callahan-associates-inc.helpscoutdocs.com/article/292-understanding-tom-codes"
    },
    codes
  };
  console.log(`NCUA ${data.source.asOf}: ${n} credit unions with a membership code.`);
  if (check) return;
  writeFileSync(OUT, JSON.stringify(data) + "\n");
  console.log(`Wrote ${OUT}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
}
