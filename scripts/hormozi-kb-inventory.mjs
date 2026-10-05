#!/usr/bin/env node
/**
 * Full Hormozi KB inventory: Drive video count vs markdown speech sections + state repair.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./load-env.mjs";
import { driveConfigFromEnv } from "../src/company-brain/config.mjs";
import { createDriveClientFromConfig } from "../src/company-brain/drive-client.mjs";
import {
  DEFAULT_KB_OUT,
  inventoryHormoziDrive,
  isVideoFile,
  readIngestState,
  writeIngestState,
  writeIndex,
  isPdfFile
} from "../src/company-brain/hormozi-kb.mjs";

loadEnv();

function speechFromMd(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, reason: "missing file" };
  const c = fs.readFileSync(filePath, "utf8");
  const idx = c.indexOf("## Speech transcript");
  if (idx < 0) return { ok: false, reason: "no section" };
  const after = c.slice(idx + "## Speech transcript".length).trim();
  const next = after.indexOf("\n## ");
  const body = (next >= 0 ? after.slice(0, next) : after).trim();
  if (!body || body === "(no transcript)" || body.length < 20) {
    return { ok: false, reason: "empty", len: body.length };
  }
  return { ok: true, len: body.length };
}

const repair = process.argv.includes("--repair");
const outRoot = DEFAULT_KB_OUT;
const state = readIngestState(outRoot);

const config = driveConfigFromEnv(process.env);
if (!config.ready) {
  console.error("[hormozi-kb-inventory] drive not configured:", config.missing?.join(", "));
  process.exit(1);
}
const client = createDriveClientFromConfig(config, {});
const inventory = await inventoryHormoziDrive(client);
const videos = inventory.filter(isVideoFile);
const pdfs = inventory.filter(isPdfFile);

let staleErr = 0;
let strippedSpeechText = 0;
if (repair) {
  for (const meta of videos) {
    if (!state.videos[meta.id]) state.videos[meta.id] = {};
    const rec = state.videos[meta.id];
    const sp = speechFromMd(rec.outPath);
    if (sp.ok && rec.speech === "error") {
      delete rec.speechError;
      rec.speech = "done";
      staleErr += 1;
    }
    if (sp.ok && rec.speech !== "done") rec.speech = "done";
    if (rec.speechText) {
      delete rec.speechText;
      strippedSpeechText += 1;
    }
    if (sp.ok && !rec.done) rec.done = "done";
  }
  writeIngestState(outRoot, state);

  const indexEntries = [];
  for (const meta of inventory) {
    let rel = null;
    let kind = "other";
    if (isPdfFile(meta) && state.pdfs[meta.id] === "done") {
      kind = "pdf";
      rel = path.relative(outRoot, state.pdfs[`${meta.id}_path`] || "");
    } else if (isVideoFile(meta) && state.videos[meta.id]?.outPath) {
      kind = "video";
      rel = path.relative(outRoot, state.videos[meta.id].outPath);
    }
    if (rel) {
      indexEntries.push({
        title: meta.name,
        topicPath: meta.topicPath,
        relativePath: rel.split(path.sep).join("/"),
        kind
      });
    }
  }
  writeIndex(outRoot, indexEntries);
}

const missing = [];
let withSpeech = 0;
let stateDone = 0;
let stateErr = 0;
for (const meta of videos) {
  const rec = state.videos[meta.id] || {};
  if (rec.speech === "done") stateDone += 1;
  if (rec.speech === "error") stateErr += 1;
  const sp = speechFromMd(rec.outPath);
  if (sp.ok) withSpeech += 1;
  else missing.push({ name: meta.name, id: meta.id, issue: sp.reason, outPath: rec.outPath });
}

console.log(JSON.stringify({
  drive: { pdfs: pdfs.length, videos: videos.length, total: inventory.length },
  speechMarkdownOk: withSpeech,
  stateSpeechDone: stateDone,
  stateSpeechError: stateErr,
  missingCount: missing.length,
  repair: repair ? { staleErr, strippedSpeechText } : null
}, null, 2));

if (missing.length) {
  console.error("\n[missing speech]");
  for (const m of missing) console.error(`- ${m.name} (${m.id}): ${m.issue}`);
  process.exit(missing.length > 0 ? 1 : 0);
}
