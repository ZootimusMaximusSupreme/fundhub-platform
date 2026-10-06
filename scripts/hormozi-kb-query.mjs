#!/usr/bin/env node
/**
 * Query the local Hormozi vault by topic and/or keyword.
 *
 *   node scripts/hormozi-kb-query.mjs --list-topics
 *   node scripts/hormozi-kb-query.mjs --topic "Attraction Offers"
 *   node scripts/hormozi-kb-query.mjs --topic "ACQ Scale Advisory" --grep "CAC"
 */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_KB_OUT } from "../src/company-brain/hormozi-kb.mjs";

const outRoot = DEFAULT_KB_OUT;
const topicsPath = path.join(outRoot, "topics.json");

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  if (hit) return hit.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("-")) {
    return process.argv[i + 1];
  }
  return "";
}

function loadCatalog() {
  if (!fs.existsSync(topicsPath)) {
    console.error("[hormozi-kb-query] missing topics.json — run: node scripts/hormozi-kb-inventory.mjs --repair");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(topicsPath, "utf8"));
}

function topicMatches(topicRow, needle) {
  const n = String(needle || "").trim().toLowerCase();
  if (!n) return true;
  const full = topicRow.topic.toLowerCase();
  if (full.includes(n)) return true;
  return (topicRow.topicPath || []).some((p) => String(p).toLowerCase().includes(n));
}

function grepFile(absPath, needle) {
  const text = fs.readFileSync(absPath, "utf8").toLowerCase();
  const hits = [];
  const lines = text.split("\n");
  const n = needle.toLowerCase();
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(n)) hits.push(i + 1);
  }
  return hits.slice(0, 8);
}

const listTopics = process.argv.includes("--list-topics");
const topicNeedle = argValue("--topic");
const grepNeedle = argValue("--grep");

const catalog = loadCatalog();

if (listTopics) {
  for (const t of catalog.topics) {
    console.log(`${t.topic} (${t.files.length} files)`);
  }
  process.exit(0);
}

const rows = catalog.topics.filter((t) => topicMatches(t, topicNeedle));
if (!rows.length) {
  console.error("[hormozi-kb-query] no topics matched:", topicNeedle || "(empty)");
  process.exit(1);
}

for (const t of rows) {
  console.log(`\n## ${t.topic}\n`);
  for (const f of t.files) {
    const abs = path.join(outRoot, f.relativePath);
    if (!fs.existsSync(abs)) {
      console.log(`- [missing] ${f.title}`);
      continue;
    }
    if (grepNeedle) {
      const hitLines = grepFile(abs, grepNeedle);
      if (!hitLines.length) continue;
      console.log(`- ${f.title} (${f.kind}) — lines ${hitLines.join(", ")}`);
      console.log(`  ${f.relativePath}`);
    } else {
      console.log(`- ${f.title} (${f.kind})`);
      console.log(`  ${f.relativePath}`);
    }
  }
}
