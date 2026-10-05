#!/usr/bin/env node
/**
 * Ingest Alex Hormozi / ACQ Drive libraries into marketing/knowledge/hormozi/.
 *
 *   node scripts/hormozi-kb-ingest.mjs --pdfs
 *   node scripts/hormozi-kb-ingest.mjs --speech --visual --resume
 *   node scripts/hormozi-kb-ingest.mjs --load-brain --resume
 */
import pg from "pg";
import { loadEnv } from "./load-env.mjs";
import { resolveDefaultOrg } from "../src/auth/org.mjs";
import {
  runHormoziIngest,
  DEFAULT_KB_OUT,
  DEFAULT_WORK_DIR,
  INGEST_STOPPED_OPENAI_CREDITS
} from "../src/company-brain/hormozi-kb.mjs";

loadEnv();

function hasFlag(name) {
  return process.argv.includes(name);
}

function argNum(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  if (!hit) return fallback;
  const n = Number(hit.split("=")[1]);
  return Number.isFinite(n) ? n : fallback;
}

/** Default on: do not retry Whisper/vision after an empty OpenAI wallet. */
function stopOnNoCreditsFlag() {
  if (process.argv.includes("--no-stop-on-no-credits")) return false;
  const hit = process.argv.find((a) => a.startsWith("--stop-on-no-credits="));
  if (hit) {
    const v = hit.split("=")[1];
    return v !== "false" && v !== "0";
  }
  return true;
}

function logCreditsStop() {
  console.error("[hormozi-kb] OpenAI credits exhausted — ingest stopped.");
}

async function main() {
  const anyMode = hasFlag("--pdfs") || hasFlag("--speech") || hasFlag("--visual");
  const pdfs = hasFlag("--pdfs") || !anyMode;
  const speech = hasFlag("--speech") || (!anyMode && !hasFlag("--pdfs-only"));
  const visual = hasFlag("--visual") || (!anyMode && !hasFlag("--pdfs-only"));
  const resume = hasFlag("--resume");
  const loadBrain = hasFlag("--load-brain");
  const limit = argNum("--limit", Infinity);
  const videoSkip = argNum("--video-skip", 0);
  const stopOnNoCredits = stopOnNoCreditsFlag();

  let db = null;
  let orgId = null;
  if (loadBrain) {
    if (!process.env.DATABASE_URL) {
      console.error("[hormozi-kb] --load-brain requires DATABASE_URL");
      process.exit(1);
    }
    db = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost") ? undefined : { rejectUnauthorized: false }
    });
    await db.connect();
    orgId = await resolveDefaultOrg(db);
  }

  const started = Date.now();
  const result = await runHormoziIngest({
    env: process.env,
    outRoot: DEFAULT_KB_OUT,
    workDir: DEFAULT_WORK_DIR,
    resume,
    limit,
    videoSkip,
    pdfs,
    speech,
    visual,
    loadBrain,
    db,
    orgId,
    stopOnNoCredits,
    onProgress({ phase, meta, result: r }) {
      const tag = r?.ok ? "ok" : "fail";
      console.log(`[${phase}] ${tag} ${meta.name} (${meta.id})`);
    }
  });

  if (db) await db.end().catch(() => {});

  if (!result.ok) {
    if (result.reason === INGEST_STOPPED_OPENAI_CREDITS || result.creditsStopped) {
      logCreditsStop();
      process.exit(2);
    }
    console.error("[hormozi-kb] stopped:", result.reason || result);
    process.exit(1);
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log("\n[hormozi-kb] done in", `${elapsed}s`);
  console.log("inventory:", result.inventory);
  console.log("counts:", result.counts);
  console.log("index:", result.indexPath);
  console.log("state:", result.statePath);
  if (result.counts.errors.length) {
    console.log("errors:", result.counts.errors.slice(0, 10));
  }
}

main().catch((err) => {
  console.error("[hormozi-kb] fatal:", err?.message || err);
  process.exit(1);
});
