#!/usr/bin/env node
/**
 * Load the 13 book-a-call scripts into ad_scripts and open one shoot.
 *
 * SOURCE. Spoken words are copied from the repo files. This script does not
 * rewrite them.
 *   marketing/ads/scripts/book-a-call-final-2026-10-03.md  (sections 1–11)
 *   marketing/ads/reference/vsl-scripts-latest.md          (/watch VSL, thank-you)
 *
 * NUMBERS. The next free ad ids above the highest in ad_scripts, ad_videos,
 * ads.fundhub_ad_number, and marketing/ads/registry.json. Low numbers already
 * in the registry (16, 26, and the rest) are never reused. Ads 84–91 are
 * never updated.
 *
 * SOURCE COLUMN. The shoot and the live teleprompter only roll scripts the
 * screens can see. scripts-store.mjs VISIBLE_SQL hides source 'import', so a
 * row tagged import never reaches GET /api/marketing/shoot. These rows use
 * source 'chris' (Chris wrote the words). They have no batch, so draft expiry
 * does not touch them.
 *
 * SAFE TO RE-RUN. A title that already has a live script is skipped. The
 * shoot is created, or the open shoot is updated, only when that shoot is
 * empty or already holds these titles.
 *
 *   node --env-file=.env scripts/ad-scripts-load-book-a-call.mjs          # dry-run
 *   node --env-file=.env scripts/ad-scripts-load-book-a-call.mjs --apply
 */
import { readFileSync } from "node:fs";
import { asStaff } from "../src/partners/rls.mjs";
import { db, close } from "../src/db.mjs";
import { readOpenShoot, writeShoot } from "../src/marketing/shoot-store.mjs";

const BOOK = new URL("../marketing/ads/scripts/book-a-call-final-2026-10-03.md", import.meta.url);
const VSL = new URL("../marketing/ads/reference/vsl-scripts-latest.md", import.meta.url);
const REGISTRY = new URL("../marketing/ads/registry.json", import.meta.url);
const APPLY = process.argv.includes("--apply");
const SOURCE = "chris";
const OFFER_KEY = "funding_dfy";

const TITLES = [
  "Script 4 — Tool analogy, the hammer on the flat tire",
  "Ad 19 — Over and over (broad, film first)",
  "Ad 14 — It's a skill",
  "Ad 15 — High earners",
  "Ad 17 — Paying for speed",
  "Ad 16 — The hidden tax",
  "Script 1 — Notes green screen, seven steps (double loop)",
  "Script 2 — Notes green screen",
  "Ad 9 — The bank",
  "Scale without your own cash",
  "The penthouse (Chris wants it again, 2026-10-07, even though it was filmed 2026-10-04)",
  "/watch VSL (book-a-call)",
  "/watch thank-you video"
];

const BULLET_INDEXES = new Set([6, 7]);

function sectionBlock(md, headingLineRe) {
  const re = new RegExp(headingLineRe, "m");
  const m = re.exec(md);
  if (!m) throw new Error(`missing section: ${headingLineRe}`);
  const rest = md.slice(m.index + m[0].length).replace(/^\r?\n/, "");
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

function paragraphs(block) {
  const lines = block.replace(/\r\n/g, "\n").split("\n").filter((line) => {
    const t = line.trim();
    if (/^Shoot:/i.test(t)) return false;
    if (/^Marks:/i.test(t)) return false;
    if (t.startsWith("|")) return false;
    return true;
  });
  return lines.join("\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

function cuesFromTalkingPoints(block) {
  const at = block.indexOf("Talking points");
  if (at === -1) throw new Error("notes script has no talking points");
  const cues = [];
  for (const line of block.slice(at).replace(/\r\n/g, "\n").split("\n")) {
    const m = line.match(/^\s*-\s+(\S.*?)\s*$/);
    if (m) cues.push(m[1]);
  }
  if (!cues.length) throw new Error("notes script has no cue lines");
  return cues;
}

function plainScript(title, block, scriptType) {
  const paras = paragraphs(block);
  if (!paras.length) throw new Error(`no spoken words: ${title}`);
  return {
    title,
    hook: paras[0],
    body: paras.join("\n\n"),
    style: null,
    parts: null,
    scriptType
  };
}

function bulletScript(title, block) {
  const cues = cuesFromTalkingPoints(block);
  return {
    title,
    hook: cues[0],
    body: cues.join("\n\n"),
    style: "bullets",
    parts: cues.map((text) => ({ kind: "cue", text })),
    scriptType: null
  };
}

function loadScripts() {
  const book = readFileSync(BOOK, "utf8").replace(/\r\n/g, "\n");
  const vsl = readFileSync(VSL, "utf8").replace(/\r\n/g, "\n");
  const out = [];
  for (let n = 1; n <= 11; n++) {
    const title = TITLES[n - 1];
    const block = sectionBlock(book, `^## ${n}\\. .+$`);
    out.push(BULLET_INDEXES.has(n - 1) ? bulletScript(title, block) : plainScript(title, block, null));
  }
  out.push(plainScript(TITLES[11], sectionBlock(vsl, "^## /watch VSL \\(book-a-call\\).+$"), "vsl"));
  out.push(plainScript(TITLES[12], sectionBlock(vsl, "^## /watch thank-you video.+$"), "vsl"));
  return out;
}

function registryIds() {
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

function assertPlan(scripts) {
  if (scripts.length !== 13) throw new Error(`expected 13 scripts, found ${scripts.length}`);
  const titles = scripts.map((s) => s.title);
  if (titles.join("\n") !== TITLES.join("\n")) {
    throw new Error("titles are not the 13 film-order names");
  }
  for (const s of scripts) {
    if (/Shoot:|Marks:/.test(s.body)) throw new Error(`film note left in body: ${s.title}`);
    if (s.body.includes("|---")) throw new Error(`table left in body: ${s.title}`);
    if (!s.hook || s.hook !== s.body.split(/\n\s*\n/)[0]) throw new Error(`hook is not the first paragraph: ${s.title}`);
  }
  const bullets = scripts.filter((s) => s.style === "bullets");
  if (bullets.length !== 2) throw new Error("expected exactly two bullet scripts");
  for (const s of bullets) {
    if (!s.parts.every((p) => p.kind === "cue" && p.text.trim())) throw new Error(`bad cues: ${s.title}`);
    if (s.parts.map((p) => p.text).join("\n\n") !== s.body) throw new Error(`cues do not match body: ${s.title}`);
  }
  for (const s of scripts) {
    if (s.style === "bullets") continue;
    if (s.style != null || s.parts != null) throw new Error(`plain script has parts: ${s.title}`);
  }
  if (!scripts[0].body.startsWith("Where your file is right now determines the tool you need")) {
    throw new Error("script 1 does not open on the tool line");
  }
  if (scripts[6].body.includes("Pull your report and make sure everything")) {
    throw new Error("script 7 still has the notes-app text");
  }
  if (scripts[7].body.includes("Pull all 3 bureaus")) {
    throw new Error("script 8 still has the notes-app text");
  }
  if (!scripts[9].body.startsWith("Putting MORE money into your business")) {
    throw new Error("scale script lost its opening");
  }
  if (!scripts[10].body.startsWith("The guys up there figured out one thing")) {
    throw new Error("penthouse script lost its opening");
  }
  if (scripts[11].scriptType !== "vsl" || scripts[12].scriptType !== "vsl") {
    throw new Error("the two /watch scripts must use script_type vsl");
  }
  if (scripts.slice(0, 11).some((s) => s.scriptType != null)) {
    throw new Error("only the two /watch scripts get a script_type");
  }
  if (scripts[11].body.includes("Your credit file could be worth a hundred thousand")) {
    throw new Error("SLO VSL text leaked into the book-a-call VSL");
  }
}

const scripts = loadScripts();
assertPlan(scripts);

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

  const reg = registryIds();
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
  const dbTop = Math.max(Number(tops.scripts), Number(tops.videos), Number(tops.ads));
  const top = Math.max(dbTop, reg.max);
  const used = new Set(reg.ids);
  const usedRows = (await tx.query(
    `SELECT ad_id FROM ad_scripts WHERE org_id = $1 AND ad_id IS NOT NULL
     UNION
     SELECT ad_id FROM ad_videos WHERE org_id = $1 AND ad_id IS NOT NULL
     UNION
     SELECT fundhub_ad_number FROM ads
      WHERE org_id = $1 AND fundhub_ad_number ~ '^[0-9]{1,9}$'`,
    [owner.org_id]
  )).rows;
  for (const row of usedRows) used.add(String(row.ad_id));

  const existingRows = (await tx.query(
    `SELECT id, root_script_id, ad_id, title
       FROM ad_scripts
      WHERE org_id = $1 AND archived_at IS NULL AND title = ANY($2::text[])`,
    [owner.org_id, TITLES]
  )).rows;
  const existing = new Map(existingRows.map((r) => [r.title, r]));

  let next = top + 1;
  const plan = [];
  for (const s of scripts) {
    const have = existing.get(s.title);
    if (have) {
      plan.push({ ...s, adId: String(have.ad_id), root: String(have.root_script_id), keep: true });
      continue;
    }
    while (used.has(String(next))) next += 1;
    const adId = String(next);
    if (Number(adId) <= top) throw new Error(`refusing to reuse ad ${adId}`);
    if (reg.ids.has(adId)) throw new Error(`refusing registry id ${adId}`);
    if (Number(adId) >= 84 && Number(adId) <= 91) throw new Error(`refusing ads 84–91 (${adId})`);
    used.add(adId);
    next += 1;
    plan.push({ ...s, adId, root: null, keep: false });
  }

  console.log(`highest ad number: scripts ${tops.scripts}, videos ${tops.videos}, ads ${tops.ads}, registry ${reg.max} → next starts at ${top + 1}`);
  for (const row of plan) {
    const kind = row.style === "bullets" ? "bullets" : "plain";
    const words = row.body.split(/\s+/).filter((w) => w && w !== "↑").length;
    console.log(`  ${row.keep ? "keep " : "load "} ${row.adId}  ${row.title}  ${kind}  ${words} words  type=${row.scriptType || "-"}`);
  }

  const open = await readOpenShoot(tx, { orgId: owner.org_id });
  if (!open) {
    console.log("open shoot: none");
  } else {
    const onIt = (await tx.query(
      `SELECT ad_id, title FROM ad_scripts
        WHERE org_id = $1 AND archived_at IS NULL AND root_script_id = ANY($2::uuid[])`,
      [owner.org_id, open.root_script_ids || []]
    )).rows;
    console.log(`open shoot: ${open.id} status=${open.status} scripts=${onIt.length}`);
    const allowed = new Set(TITLES);
    const foreign = onIt.filter((r) => !allowed.has(r.title) || (Number(r.ad_id) >= 84 && Number(r.ad_id) <= 91));
    if (foreign.length) {
      throw new Error(`open shoot already holds other scripts (${foreign.map((r) => r.ad_id).join(", ")}). Nothing was written.`);
    }
  }

  if (!APPLY) return;

  const roots = [];
  for (const row of plan) {
    if (row.keep) {
      roots.push(row.root);
      console.log(`  kept   ${row.adId}  ${row.title}`);
      continue;
    }
    const inserted = (await tx.query(
      `INSERT INTO ad_scripts (
         org_id, partner_id, title, body, hook_text, ad_id,
         script_type, status, source, offer_key, style, parts
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, 'locked', $8, $9, $10, $11::jsonb
       )
       RETURNING id, root_script_id, ad_id, title`,
      [
        owner.org_id, owner.id, row.title, row.body, row.hook, row.adId,
        row.scriptType, SOURCE, OFFER_KEY, row.style,
        row.parts ? JSON.stringify(row.parts) : null
      ]
    )).rows[0];
    const root = String(inserted.root_script_id || inserted.id);
    roots.push(root);
    console.log(`  loaded ${inserted.ad_id}  ${inserted.title}`);
  }

  if (roots.length !== 13) throw new Error(`shoot list has ${roots.length} scripts, not 13`);
  const move = open
    ? { kind: "update", id: open.id, ids: roots }
    : { kind: "create", ids: roots };
  const written = await writeShoot(tx, { orgId: owner.org_id, move });
  const got = written.shoot.scripts.map((s) => `${s.ad_id} ${s.title}`);
  if (got.length !== 13) throw new Error(`shoot returned ${got.length} scripts, not 13`);
  console.log("shoot order:");
  got.forEach((line, i) => console.log(`  ${i + 1}. ${line}`));
}, { db });

console.log(APPLY ? "\nDone." : "\nDry run. Re-run with --apply.");
await close();
