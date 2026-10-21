#!/usr/bin/env node
/**
 * Load the 5 green-lit scripts (2026-10-15) into the teleprompter.
 *
 * SOURCE. Spoken words are copied from the repo files. Nothing is reworded.
 *   marketing/vsl/direct-book-vsl-2026-10-15.md        everything after "---"
 *   marketing/vsl/direct-book-thank-you-2026-10-15.md  everything after "---"
 *   marketing/ads/scripts/2026-10-14.md                sections 1, 2 and 3
 *
 * WHAT IT DOES
 *   Ad 103 (VSL) and Ad 104 (thank-you): a new version through editScript()
 *     in src/marketing/scripts-store.mjs, the same path as
 *     POST /api/marketing/scripts/edit. The old version is archived, the ad
 *     number and locked status stay, and the repo mirror file is queued.
 *   Direct Book Ad 13, Ad 14 and Capital Blueprint Ad 3: new ad_scripts rows,
 *     status 'locked', source 'chris'. Numbers are the next free ones above
 *     the highest in ad_scripts, ad_videos, ads and marketing/ads/registry.json.
 *   The open shoot: through writeShoot(). Film order is VSL, thank-you, Ad 13,
 *     Ad 14, Blueprint Ad 3, then every other script already on it, in the
 *     order it had. Nothing is removed from the shoot.
 *
 * SAFE TO RE-RUN. A script whose live words already match is skipped. A title
 * that already has a live script is kept.
 *
 *   node --env-file=.env scripts/ad-scripts-load-direct-book-2026-10-21.mjs          # dry-run
 *   node --env-file=.env scripts/ad-scripts-load-direct-book-2026-10-21.mjs --apply
 */
import { readFileSync } from "node:fs";
import { asStaff } from "../src/partners/rls.mjs";
import { db, close } from "../src/db.mjs";
import { readOpenShoot, writeShoot } from "../src/marketing/shoot-store.mjs";
import { editScript } from "../src/marketing/scripts-store.mjs";

const VSL_FILE = new URL("../marketing/vsl/direct-book-vsl-2026-10-15.md", import.meta.url);
const THANKS_FILE = new URL("../marketing/vsl/direct-book-thank-you-2026-10-15.md", import.meta.url);
const ADS_FILE = new URL("../marketing/ads/scripts/2026-10-14.md", import.meta.url);
const REGISTRY = new URL("../marketing/ads/registry.json", import.meta.url);
const APPLY = process.argv.includes("--apply");
const SOURCE = "chris";

const EDITS = [
  { adId: "103", file: VSL_FILE, name: "VSL" },
  { adId: "104", file: THANKS_FILE, name: "thank-you" }
];

const NEW = [
  { section: 1, title: "Direct Book Ad 13 — 700 and up, hundreds of clients", offer: "funding_dfy" },
  { section: 2, title: "Direct Book Ad 14 — 780 and up, 13 optimization points", offer: "funding_dfy" },
  { section: 3, title: "Capital Blueprint Ad 3 — 600 and up, the shortest path", offer: "capital_blueprint" }
];

const read = (url) => readFileSync(url, "utf8").replace(/\r\n/g, "\n");

/** Everything after the first line that is only "---". */
function afterRule(md) {
  const m = /^---[ \t]*$/m.exec(md);
  if (!m) throw new Error("no --- line in the file");
  const body = md.slice(m.index + m[0].length).trim();
  if (!body) throw new Error("nothing after the --- line");
  return body;
}

/** The text of "## n. ..." up to the next "## ". */
function section(md, n) {
  const m = new RegExp(`^## ${n}\\. .+$`, "m").exec(md);
  if (!m) throw new Error(`missing section ${n}`);
  const rest = md.slice(m.index + m[0].length).replace(/^\n/, "");
  const next = rest.search(/\n## /);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/**
 * The spoken paragraphs of an ad section. A paragraph is dropped when it is a
 * status line (**GREEN-LIT...**), a Shoot: line or a version note (v4 (...)).
 */
function spoken(block) {
  const paras = block.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const kept = paras.filter((p) => !/^\*\*/.test(p) && !/^Shoot:/i.test(p) && !/^v\d+ \(/.test(p));
  if (!kept.length) throw new Error("no spoken words");
  return kept.join("\n\n");
}

function loadAll() {
  const out = { edits: [], fresh: [] };
  for (const e of EDITS) out.edits.push({ ...e, body: afterRule(read(e.file)) });
  const ads = read(ADS_FILE);
  for (const n of NEW) {
    const block = section(ads, n.section);
    const body = spoken(block);
    out.fresh.push({ ...n, body, hook: body.split(/\n\s*\n/)[0], block });
  }
  return out;
}

/** Hard checks. The spoken words must be the tail of the source text, character for character. */
function assertPlan({ edits, fresh }) {
  for (const e of edits) {
    if (!read(e.file).trimEnd().endsWith(e.body)) throw new Error(`${e.name}: body is not the tail of the source`);
    if (/Status:|Shoot:|Marks:/.test(e.body)) throw new Error(`${e.name}: a note is in the body`);
  }
  if (!edits[0].body.startsWith("The condition of your credit decides whether you walk away with $20,000")) {
    throw new Error("VSL does not open on the right line");
  }
  for (const s of fresh) {
    if (!s.block.endsWith(s.body)) throw new Error(`${s.title}: body is not the tail of its section`);
    if (/GREEN-LIT|Shoot:|^v\d+ \(/m.test(s.body)) throw new Error(`${s.title}: a note is in the body`);
  }
  const [a13, a14, bp3] = fresh;
  if (!a13.body.startsWith("If you have a 700 or higher credit score")) throw new Error("Ad 13 opening is wrong");
  if (!a13.body.endsWith("you pay us nothing.")) throw new Error("Ad 13 ending is wrong");
  if (!a14.body.startsWith("If you have a 780 or higher credit score")) throw new Error("Ad 14 opening is wrong");
  if (!a14.body.endsWith("you don't pay.")) throw new Error("Ad 14 ending is wrong");
  if (!bp3.body.startsWith("If you have a 600 or higher credit score")) throw new Error("Blueprint Ad 3 opening is wrong");
  if (!bp3.body.endsWith("based on where you're at right now.")) throw new Error("Blueprint Ad 3 ending is wrong");
}

function registryMax() {
  const doc = JSON.parse(readFileSync(REGISTRY, "utf8"));
  const ids = new Set();
  let max = 0;
  for (const ad of doc.ads || []) {
    const id = String(ad.id ?? "");
    if (!/^[0-9]{1,9}$/.test(id)) continue;
    ids.add(id);
    max = Math.max(max, Number(id));
  }
  return { ids, max };
}

const plan = loadAll();
assertPlan(plan);
const words = (s) => s.split(/\s+/).filter((w) => w && w !== "↑").length;

await asStaff(async (tx) => {
  const owner = (await tx.query(
    `SELECT id, org_id FROM partners WHERE slug = 'fundhub-house' ORDER BY created_at ASC LIMIT 1`
  )).rows[0];
  if (!owner) throw new Error("no house partner (slug fundhub-house). Nothing was written.");

  if (APPLY) {
    await tx.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('fundhub.next_ad_number:' || $1::text, 0))`,
      [owner.org_id]
    );
  }

  // ── Ads 103 and 104: a new version each ──
  const editPlan = [];
  for (const e of plan.edits) {
    const live = (await tx.query(
      `SELECT id, root_script_id, version, status, ad_id, title, body
         FROM ad_scripts
        WHERE org_id = $1 AND ad_id = $2 AND archived_at IS NULL`,
      [owner.org_id, e.adId]
    )).rows;
    if (live.length !== 1) throw new Error(`ad ${e.adId}: expected 1 live script, found ${live.length}`);
    const row = live[0];
    if (row.status !== "locked") throw new Error(`ad ${e.adId} is ${row.status}, not locked`);
    const same = row.body === e.body;
    editPlan.push({ ...e, row, same });
    console.log(`  ${same ? "same " : "edit "} ${e.adId}  ${row.title}  v${row.version} → v${Number(row.version) + 1}  ${words(row.body)} → ${words(e.body)} words`);
  }

  // ── Three new scripts: numbers ──
  const reg = registryMax();
  const tops = (await tx.query(
    `SELECT
       COALESCE((SELECT max(ad_id::bigint) FROM ad_scripts
                  WHERE org_id = $1 AND ad_id ~ '^[0-9]{1,9}$'), 0) AS scripts,
       COALESCE((SELECT max(ad_id::bigint) FROM ad_videos
                  WHERE org_id = $1 AND ad_id ~ '^[0-9]{1,9}$'), 0) AS videos,
       COALESCE((SELECT max(fundhub_ad_number::bigint) FROM ads
                  WHERE org_id = $1 AND fundhub_ad_number ~ '^[0-9]{1,9}$'), 0) AS ads`,
    [owner.org_id]
  )).rows[0];
  const top = Math.max(Number(tops.scripts), Number(tops.videos), Number(tops.ads), reg.max);
  const used = new Set(reg.ids);
  for (const r of (await tx.query(
    `SELECT ad_id FROM ad_scripts WHERE org_id = $1 AND ad_id IS NOT NULL
     UNION SELECT ad_id FROM ad_videos WHERE org_id = $1 AND ad_id IS NOT NULL
     UNION SELECT fundhub_ad_number FROM ads WHERE org_id = $1 AND fundhub_ad_number ~ '^[0-9]{1,9}$'`,
    [owner.org_id]
  )).rows) used.add(String(r.ad_id));

  const existing = new Map((await tx.query(
    `SELECT root_script_id, ad_id, title FROM ad_scripts
      WHERE org_id = $1 AND archived_at IS NULL AND title = ANY($2::text[])`,
    [owner.org_id, NEW.map((n) => n.title)]
  )).rows.map((r) => [r.title, r]));

  let next = top + 1;
  const freshPlan = [];
  for (const s of plan.fresh) {
    const have = existing.get(s.title);
    if (have) {
      freshPlan.push({ ...s, adId: String(have.ad_id), root: String(have.root_script_id), keep: true });
      continue;
    }
    while (used.has(String(next))) next += 1;
    const adId = String(next);
    if (Number(adId) <= top) throw new Error(`refusing to reuse ad ${adId}`);
    used.add(adId);
    next += 1;
    freshPlan.push({ ...s, adId, root: null, keep: false });
  }
  console.log(`highest ad number: scripts ${tops.scripts}, videos ${tops.videos}, ads ${tops.ads}, registry ${reg.max} → next starts at ${top + 1}`);
  for (const s of freshPlan) {
    console.log(`  ${s.keep ? "keep " : "load "} ${s.adId}  ${s.title}  offer=${s.offer}  ${words(s.body)} words`);
  }

  const open = await readOpenShoot(tx, { orgId: owner.org_id });
  if (!open) throw new Error("no open shoot to add to. Nothing was written.");
  console.log(`open shoot: ${open.id} status=${open.status} scripts=${(open.root_script_ids || []).length}`);

  if (!APPLY) return;

  // ── Write ──
  const warnings = [];
  const roots = {};
  for (const e of editPlan) {
    roots[e.adId] = String(e.row.root_script_id);
    if (e.same) { console.log(`  kept   ${e.adId}  words already match`); continue; }
    const res = await editScript(tx, {
      orgId: owner.org_id,
      id: e.row.id,
      version: Number(e.row.version),
      body: e.body,
      parts: null,
      metaCopy: null,
      staffId: null,
      requestId: `load-direct-book-2026-10-21:${e.adId}`
    });
    warnings.push(...res.warnings.map((w) => `ad ${e.adId}: ${w.rule}: ${w.message}`));
    console.log(`  edited ${e.adId}  now v${res.script.version}  status=${res.script.status}`);
  }

  const freshRoots = [];
  for (const s of freshPlan) {
    if (s.keep) { freshRoots.push(s.root); console.log(`  kept   ${s.adId}  ${s.title}`); continue; }
    const row = (await tx.query(
      `INSERT INTO ad_scripts (
         org_id, partner_id, title, body, hook_text, ad_id,
         script_type, status, source, offer_key, style, parts
       ) VALUES ($1, $2, $3, $4, $5, $6, NULL, 'locked', $7, $8, NULL, NULL)
       RETURNING id, root_script_id, ad_id, title`,
      [owner.org_id, owner.id, s.title, s.body, s.hook, s.adId, SOURCE, s.offer]
    )).rows[0];
    freshRoots.push(String(row.root_script_id || row.id));
    console.log(`  loaded ${row.ad_id}  ${row.title}`);
  }

  // ── The shoot: VSL, thank-you, 13, 14, Blueprint 3, then the rest as they were ──
  const onShoot = (open.root_script_ids || []).map(String);
  const front = [roots["103"], roots["104"], ...freshRoots];
  const rest = (await tx.query(
    `SELECT root_script_id FROM ad_scripts
      WHERE org_id = $1 AND archived_at IS NULL AND root_script_id = ANY($2::uuid[])
        AND root_script_id <> ALL($3::uuid[])
      ORDER BY film_order NULLS LAST, ad_id::bigint`,
    [owner.org_id, onShoot, front]
  )).rows.map((r) => String(r.root_script_id));
  const ids = [...front, ...rest];
  if (new Set(ids).size !== ids.length) throw new Error("a script is in the film order twice");
  for (const id of onShoot) if (!ids.includes(id)) throw new Error(`would drop ${id} from the shoot`);
  if (ids.length !== onShoot.length + freshRoots.length) {
    throw new Error(`film order has ${ids.length} scripts, expected ${onShoot.length + freshRoots.length}`);
  }
  const written = await writeShoot(tx, { orgId: owner.org_id, move: { kind: "update", id: open.id, ids } });
  console.log("shoot order:");
  written.shoot.scripts.forEach((s, i) => console.log(`  ${i + 1}. ${s.ad_id} v${s.version} ${s.title}`));
  if (warnings.length) console.log("checker notes (saved anyway):\n  " + warnings.join("\n  "));
}, { db });

console.log(APPLY ? "\nDone." : "\nDry run. Re-run with --apply.");
await close();
