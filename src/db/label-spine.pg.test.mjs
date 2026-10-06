// Proves db/migrations/377_marketing_label_spine.sql actually did what its
// header says: angles and hooks are FIELDS, and they carry down the chain
// script -> creative -> ad.
//
// Lives under src/db/, not under db/ or api/, because npm test's glob is
// "src/**" and "scripts/**" only (CLAUDE.md §12) — a test placed anywhere else
// silently never runs.
//
// Skips cleanly with no DATABASE_URL, exactly like its neighbours: with the
// variable unset the whole describe block is skipped rather than failing, and
// a skipped .pg.test.mjs is NOT green (CLAUDE.md §12).
//
// WHO EACH QUERY RUNS AS, STATED EXACTLY.
//
// ad_scripts, ad_labels, creative_assets and ads all carry FORCEd row-level
// security. A bare db.query against one of them is anonymous to those policies —
// it silently touches ZERO rows rather than erroring, which makes a test look
// green while proving nothing. So every query against those four goes through
// asStaff() or asPartner().
//
// The bare db.query calls below are against things that carry no policy at all:
// information_schema and pg_catalog (the shape tests), the partners table
// (042_partners.sql installs no RLS on it, so the fixtures and the house-partner
// check read it directly), and two ALTER TABLE statements in cleanup() that need
// table ownership and could not run through a scoped session anyway.
//
// STAFF PASSES EVERY LOCK IN THIS DATABASE BY DESIGN (045:100-105). So a file
// written only in asStaff() would still go fully green if 377 had installed a
// broken policy, left the ad_labels read policy out, or never reached its GRANT
// block — and the screen would show an empty list with no error anywhere. The
// three tests in section 8 are the ones that actually prove the locks: they run
// as a PARTNER, through the unprivileged pool, which is the only session the
// policies really apply to (src/testing/rls-pool.mjs).

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { asStaff, asPartner as _asPartner } from "../partners/rls.mjs";
import { rlsPool, rlsIsReal, closeRlsPool } from "../testing/rls-pool.mjs";

/* SET UP as the owner, ASSERT as the unprivileged role. A superuser bypasses
   every policy, so a partner-isolation assertion is only meaningful through
   APP_DATABASE_URL. Same split invariants.pg.test.mjs:18-22 uses. */
const asPartner = (partnerId, fn) => _asPartner(partnerId, fn, { pool: rlsPool });

const HAS_DB = !!process.env.DATABASE_URL;
const SLUG = "labelspine-pg-test";

describe("377 marketing label spine", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org;
  let partnerA;      // owns everything the chain test builds
  let partnerB;      // owns nothing — proves the cross-partner guard bites
  let connId, campaignId, adSetId;

  before(async () => {
    org = await resolveDefaultOrg(db);
    await cleanup();

    partnerA = await makePartner("a");
    partnerB = await makePartner("b");

    await asStaff(async (tx) => {
      connId = (await tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, connection_state,
            platform_verification_state, encrypted_access_token)
         VALUES ($1,$2,'meta',$3,'active','approved','v1:x:y:z') RETURNING id`,
        [org, partnerA, `acct-${SLUG}-a`]
      )).rows[0].id;

      // offer_type 'funding' is one of the three seeded into
      // ad_platform_category_map by 052_config_defaults.sql, so the guard
      // trigger at 046:348-354 lets this insert through.
      campaignId = (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type,
                                budget_cents, approval_state)
         VALUES ($1,$2,$3,'Label spine campaign','funding',10000,'draft') RETURNING id`,
        [org, partnerA, connId]
      )).rows[0].id;

      adSetId = (await tx.query(
        `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name,
                              budget_cents, approval_state)
         VALUES ($1,$2,$3,$4,'Label spine ad set',10000,'draft') RETURNING id`,
        [org, partnerA, connId, campaignId]
      )).rows[0].id;
    });
  });

  after(async () => { await cleanup(); await closeRlsPool(); await close(); });

  // ── fixtures ────────────────────────────────────────────────────────────

  async function makePartner(tag) {
    return (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,$2,$3,'active',now()) RETURNING id`,
      [org, `Label spine ${tag}`, `${SLUG}-${tag}`]
    )).rows[0].id;
  }

  const insertScript = (tx, partnerId, fields = {}) => tx.query(
    `INSERT INTO ad_scripts
       (org_id, partner_id, parent_script_id, version, title, body, hook_text,
        script_type, lane, angle_key, hook_key, offer_key)
     VALUES ($1,$2,$3,COALESCE($4,1),$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [org, partnerId,
     fields.parent_script_id ?? null,
     fields.version ?? null,
     fields.title ?? null,
     fields.body ?? "HOOK: they said no.\nBODY: here is why.\nCTA: book a call.",
     fields.hook_text ?? null,
     fields.script_type ?? null,
     fields.lane ?? null,
     fields.angle_key ?? null,
     fields.hook_key ?? null,
     fields.offer_key ?? null]
  );

  const insertCreative = (tx, partnerId, scriptId) => tx.query(
    `INSERT INTO creative_assets (org_id, partner_id, kind, format, ai_generated, script_id)
     VALUES ($1,$2,'video','9x16',true,$3) RETURNING *`,
    [org, partnerId, scriptId]
  );

  const insertAd = (tx, name, assetId, { fundhubNumber = null, externalId = null } = {}) => tx.query(
    `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id,
                      name, approval_state, asset_id, fundhub_ad_number, external_id)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9) RETURNING *`,
    [org, partnerA, connId, campaignId, adSetId, name, assetId, fundhubNumber, externalId]
  );

  async function cleanup() {
    const ids = (await db.query(
      `SELECT id FROM partners WHERE slug LIKE $1`, [`${SLUG}%`]
    )).rows.map((r) => r.id);

    // creative_assets refuses a direct DELETE (fundhub_no_delete, 045:236-240).
    // Same escape hatch src/http/creative-endpoints.pg.test.mjs:336-348 uses.
    if (ids.length) {
      await db.query(`ALTER TABLE creative_assets DISABLE TRIGGER trg_creative_assets_no_delete`);
      try {
        await asStaff(async (tx) => {
          for (const t of ["ad_metrics_daily", "ads", "ad_sets", "campaigns"]) {
            await tx.query(`DELETE FROM ${t} WHERE partner_id = ANY($1)`, [ids]);
          }
          await tx.query(`DELETE FROM creative_assets WHERE partner_id = ANY($1)`, [ids]);
          // Children before parents: parent_script_id is ON DELETE RESTRICT.
          await tx.query(
            `DELETE FROM ad_scripts WHERE partner_id = ANY($1) AND parent_script_id IS NOT NULL`,
            [ids]
          );
          await tx.query(`DELETE FROM ad_scripts WHERE partner_id = ANY($1)`, [ids]);
          await tx.query(`DELETE FROM ad_platform_connections WHERE partner_id = ANY($1)`, [ids]);
        });
      } finally {
        await db.query(`ALTER TABLE creative_assets ENABLE TRIGGER trg_creative_assets_no_delete`);
      }
      await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [ids]);
    }

    // Dictionary rows this file writes, tagged so the seeded ones survive.
    await asStaff((tx) => tx.query(
      `DELETE FROM ad_labels WHERE org_id = $1 AND key LIKE 'labelspine_%'`, [org]
    ));
  }

  const columnsOf = async (table) => (await db.query(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  )).rows;

  // ── 1. the shapes exist ─────────────────────────────────────────────────

  test("ad_scripts exists with every column the design named", async () => {
    const cols = await columnsOf("ad_scripts");
    assert.ok(cols.length, "ad_scripts does not exist — did 377 run?");
    const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));

    for (const c of ["id", "org_id", "partner_id", "parent_script_id", "version",
                     "title", "body", "hook_text", "script_type", "lane",
                     "angle_key", "hook_key", "offer_key", "archived_at",
                     "created_at", "updated_at"]) {
      assert.ok(byName[c], `ad_scripts is missing ${c}`);
    }

    assert.equal(byName.org_id.is_nullable, "NO");
    assert.equal(byName.partner_id.is_nullable, "NO", "partner_id must be NOT NULL — a row nobody owns matches no policy");
    assert.equal(byName.body.is_nullable, "NO");

    // Every label is optional. An unclassified script is a normal script.
    for (const c of ["script_type", "lane", "angle_key", "hook_key", "offer_key",
                     "hook_text", "title", "parent_script_id"]) {
      assert.equal(byName[c].is_nullable, "YES", `${c} must be nullable — NULL means nobody has said yet`);
    }

    // The fifth label is script_type, NOT format. creative_assets.format
    // already exists and means the aspect ratio (045:170).
    assert.equal(byName.format, undefined, "ad_scripts must not have a column called format");
    assert.equal(byName.lane.data_type, "USER-DEFINED", "lane must reuse the ad_lane enum from 286");
  });

  test("ad_labels exists, and creative_assets/ads got their new columns", async () => {
    const labels = Object.fromEntries((await columnsOf("ad_labels")).map((c) => [c.column_name, c]));
    for (const c of ["id", "org_id", "kind", "key", "name", "description",
                     "source_ref", "sort_order", "retired_at", "created_at", "updated_at"]) {
      assert.ok(labels[c], `ad_labels is missing ${c}`);
    }
    assert.equal(labels.kind.is_nullable, "NO");
    assert.equal(labels.key.is_nullable, "NO");
    assert.equal(labels.name.is_nullable, "YES", "a key with no name still groups perfectly");

    const creative = Object.fromEntries((await columnsOf("creative_assets")).map((c) => [c.column_name, c]));
    assert.ok(creative.script_id, "creative_assets.script_id is missing");
    assert.equal(creative.script_id.is_nullable, "YES", "existing assets have no script and NULL means unknown");

    const ads = Object.fromEntries((await columnsOf("ads")).map((c) => [c.column_name, c]));
    assert.ok(ads.fundhub_ad_number, "ads.fundhub_ad_number is missing");
    assert.ok(ads.external_id, "ads.external_id disappeared");
    assert.equal(ads.fundhub_ad_number.data_type, "text",
      "ours is text so it joins client_ad_attribution.ad_id with no cast");
  });

  test("v_ad_label_spine exists and runs as the caller, not as its owner", async () => {
    const v = (await db.query(
      `SELECT c.reloptions
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'v_ad_label_spine'`
    )).rows[0];
    assert.ok(v, "v_ad_label_spine does not exist");
    assert.ok(
      (v.reloptions || []).includes("security_invoker=true"),
      "v_ad_label_spine is missing security_invoker=true — without it a partner reads every other partner's rows"
    );
  });

  test("the FundHub house partner exists and is NOT active", async () => {
    const row = (await db.query(
      `SELECT status, activated_at, is_demo, agreement_signed_at
         FROM partners WHERE org_id = $1 AND slug = 'fundhub-house'`, [org]
    )).rows[0];
    assert.ok(row, "no house partner row — Chris's own ads have nothing to hang off");
    assert.equal(row.status, "invited",
      "the house partner must stay at 'invited': 'active' stamps activated_at and starts the monthly production-floor grader on a partner that can never pass it");
    assert.equal(row.activated_at, null);
    assert.equal(row.is_demo, false, "is_demo true would let a demo wipe destroy it");
    assert.equal(row.agreement_signed_at, null, "it is a filing cabinet, not a business relationship");
  });

  test("the seeded angle dictionary is readable", async () => {
    const rows = (await asStaff((tx) => tx.query(
      `SELECT key, name FROM ad_labels WHERE org_id = $1 AND kind = 'angle' ORDER BY sort_order`,
      [org]
    ))).rows;
    const keys = rows.map((r) => r.key);
    for (const k of ["denial_angle", "broker_burn_angle", "competitor_angle", "blind_application"]) {
      assert.ok(keys.includes(k), `the running angle ${k} is not in the dictionary`);
    }
  });

  // ── 2. a script writes and reads back ───────────────────────────────────

  test("a script can be written and read back exactly as written", async () => {
    const written = await asStaff(async (tx) => {
      const ins = await insertScript(tx, partnerA, {
        title: "Denial Angle",
        body: "HOOK: they told you no.\nBODY: nobody told you why.\nCTA: find out.",
        hook_text: "They told you no and nobody told you why.",
        script_type: "cold",
        lane: "funding600",
        angle_key: "denial_angle",
        hook_key: "denial_open",
        offer_key: "credit_optimization"
      });
      return ins.rows[0];
    });

    const back = (await asStaff((tx) => tx.query(
      `SELECT * FROM ad_scripts WHERE id = $1`, [written.id]
    ))).rows[0];

    assert.ok(back, "the script did not read back");
    assert.equal(back.title, "Denial Angle");
    assert.equal(back.hook_text, "They told you no and nobody told you why.");
    assert.equal(back.script_type, "cold");
    assert.equal(back.lane, "funding600");
    assert.equal(back.angle_key, "denial_angle");
    assert.equal(back.hook_key, "denial_open");
    assert.equal(back.offer_key, "credit_optimization");
    assert.equal(back.version, 1);
    assert.equal(back.parent_script_id, null, "an original script has no parent");
    assert.equal(back.archived_at, null, "a new script is not archived");
    assert.match(back.body, /nobody told you why/);
  });

  test("a rewrite is a new row that points back at its parent — nothing is overwritten", async () => {
    const { parent, child } = await asStaff(async (tx) => {
      const p = (await insertScript(tx, partnerA, {
        title: "Broker Burn v1", angle_key: "broker_burn_angle", hook_key: "broker_open"
      })).rows[0];
      // Since 413 a script has one live version: the old one is archived in the
      // same transaction, before the rewrite goes in (spec 2026-10-04 §4 trap 9).
      await tx.query(`UPDATE ad_scripts SET archived_at = now() WHERE id = $1`, [p.id]);
      const c = (await insertScript(tx, partnerA, {
        title: "Broker Burn v2", version: 2, parent_script_id: p.id,
        angle_key: "broker_burn_angle", hook_key: "broker_open"
      })).rows[0];
      return { parent: p, child: c };
    });

    const pair = (await asStaff((tx) => tx.query(
      `SELECT c.title AS child_title, p.title AS parent_title, c.version
         FROM ad_scripts c JOIN ad_scripts p ON p.id = c.parent_script_id
        WHERE c.id = $1`, [child.id]
    ))).rows[0];

    assert.equal(pair.parent_title, "Broker Burn v1", "the parent was overwritten or lost");
    assert.equal(pair.child_title, "Broker Burn v2");
    assert.equal(pair.version, 2);

    // The parent must not be removable while the rewrite explains itself by it.
    await assert.rejects(
      () => asStaff((tx) => tx.query(`DELETE FROM ad_scripts WHERE id = $1`, [parent.id])),
      /violates foreign key constraint/i,
      "a parent script vanished out from under its rewrite"
    );
  });

  test("a blank script is refused, and a bad label shape is refused", async () => {
    await assert.rejects(
      () => asStaff((tx) => insertScript(tx, partnerA, { body: "   " })),
      /ad_scripts_body_ck/,
      "a script with no words was accepted"
    );
    await assert.rejects(
      () => asStaff((tx) => insertScript(tx, partnerA, { angle_key: "Denial Angle" })),
      /ad_scripts_angle_ck/,
      "a free-text angle with spaces and capitals was accepted"
    );
  });

  // ── 3 & 4. the chain, and the many-to-one shape ─────────────────────────

  test("one script, two creatives, three ads — the links hold at every step", async () => {
    const built = await asStaff(async (tx) => {
      const script = (await insertScript(tx, partnerA, {
        title: "Chain script",
        hook_text: "Three seconds that stop the scroll.",
        script_type: "cold",
        lane: "premium",
        angle_key: "competitor_angle",
        hook_key: "chain_hook"
      })).rows[0];

      const c1 = (await insertCreative(tx, partnerA, script.id)).rows[0];
      const c2 = (await insertCreative(tx, partnerA, script.id)).rows[0];

      // Two ads on the first creative, one on the second. Many ads per
      // creative, many creatives per script.
      const a1 = (await insertAd(tx, "Chain ad 1", c1.id, { fundhubNumber: "801" })).rows[0];
      const a2 = (await insertAd(tx, "Chain ad 2", c1.id, { fundhubNumber: "802" })).rows[0];
      const a3 = (await insertAd(tx, "Chain ad 3", c2.id, { fundhubNumber: "803" })).rows[0];

      return { script, c1, c2, ads: [a1, a2, a3] };
    });

    assert.equal(built.c1.script_id, built.script.id, "creative 1 is not linked to the script");
    assert.equal(built.c2.script_id, built.script.id, "creative 2 is not linked to the script");

    const counts = (await asStaff((tx) => tx.query(
      `SELECT count(DISTINCT ca.id)::int AS creatives, count(DISTINCT a.id)::int AS ads
         FROM ad_scripts s
         JOIN creative_assets ca ON ca.script_id = s.id
         JOIN ads a ON a.asset_id = ca.id
        WHERE s.id = $1`, [built.script.id]
    ))).rows[0];

    assert.equal(counts.creatives, 2, "one script should hold two creatives");
    assert.equal(counts.ads, 3, "one script should reach three ads through its two creatives");

    // The whole chain in one row, through the view.
    const spine = (await asStaff((tx) => tx.query(
      `SELECT ad_name, fundhub_ad_number, script_title, angle_key, hook_key, lane, hook_text
         FROM v_ad_label_spine
        WHERE script_id = $1 ORDER BY fundhub_ad_number`, [built.script.id]
    ))).rows;

    assert.equal(spine.length, 3, "the spine view lost an ad");
    for (const row of spine) {
      assert.equal(row.angle_key, "competitor_angle", "the angle did not carry down to the ad");
      assert.equal(row.hook_key, "chain_hook", "the hook did not carry down to the ad");
      assert.equal(row.lane, "premium");
      assert.equal(row.script_title, "Chain script");
      assert.equal(row.hook_text, "Three seconds that stop the scroll.");
    }
    assert.deepEqual(spine.map((r) => r.fundhub_ad_number), ["801", "802", "803"]);
  });

  test("a creative cannot be pointed at another partner's script", async () => {
    const strangerScript = await asStaff(async (tx) =>
      (await insertScript(tx, partnerB, { title: "Not yours" })).rows[0]);

    await assert.rejects(
      () => asStaff((tx) => insertCreative(tx, partnerA, strangerScript.id)),
      /script crosses partners/,
      "a creative was stitched onto another partner's script"
    );
  });

  // ── 5. our number and Meta's id are separate things ─────────────────────

  test("our ad number and Meta's ad id are stored separately and cannot be confused", async () => {
    // A real Meta ad id is far longer than nine digits.
    const META_ID = "23851234567890123";

    const ad = await asStaff(async (tx) => {
      const creative = (await insertCreative(tx, partnerA, null)).rows[0];
      return (await insertAd(tx, "Two numbers", creative.id, {
        fundhubNumber: "42", externalId: META_ID
      })).rows[0];
    });

    assert.equal(ad.fundhub_ad_number, "42", "our number did not survive");
    assert.equal(ad.external_id, META_ID, "Meta's id did not survive");
    assert.notEqual(ad.fundhub_ad_number, ad.external_id);

    const view = (await asStaff((tx) => tx.query(
      `SELECT fundhub_ad_number, meta_ad_id FROM v_ad_label_spine WHERE ad_row_id = $1`,
      [ad.id]
    ))).rows[0];
    assert.equal(view.fundhub_ad_number, "42");
    assert.equal(view.meta_ad_id, META_ID);

    // fundhub_ad_id() caps at nine digits, so a Meta id fed through it returns
    // NULL rather than matching one of our ads by accident.
    const derived = (await db.query(
      `SELECT fundhub_ad_id($1) AS from_meta, fundhub_ad_id('42-ringlights') AS from_utm`,
      [META_ID]
    )).rows[0];
    assert.equal(derived.from_meta, null, "a Meta ad id resolved to one of our ad numbers");
    assert.equal(derived.from_utm, "42", "utm_content with a slug did not resolve to our number");

    // And the column itself refuses a Meta-length value.
    await assert.rejects(
      () => asStaff(async (tx) => {
        const c = (await insertCreative(tx, partnerA, null)).rows[0];
        await insertAd(tx, "Wrong column", c.id, { fundhubNumber: META_ID });
      }),
      /ads_fundhub_ad_number_ck/,
      "a Meta ad id was accepted into our own ad-number column"
    );

    // Since 416 two ads MAY carry the same number. 377 made it unique
    // (ads_fundhub_number_uq); the owner-approved spec §10.4 replaced that with a
    // plain index so one ad number can run in several ad sets and a v2 keeps its
    // number. The second insert is rolled back so the fixtures below are
    // unchanged.
    const ROLL_BACK = new Error("roll back the duplicate-number probe");
    let shared = null;
    await assert.rejects(
      () => asStaff(async (tx) => {
        const c = (await insertCreative(tx, partnerA, null)).rows[0];
        const second = (await insertAd(tx, "Same number, second ad", c.id, { fundhubNumber: "42" })).rows[0];
        shared = (await tx.query(
          `SELECT count(*)::int AS n FROM ads WHERE id = ANY($1) AND fundhub_ad_number = '42'`,
          [[ad.id, second.id]]
        )).rows[0].n;
        throw ROLL_BACK;
      }),
      (err) => err === ROLL_BACK,
      "a second ad with the same number was refused — 416's plain index is not in place"
    );
    assert.equal(shared, 2, "both ads should carry number 42");
  });

  // ── 6. the query Chris actually wants ───────────────────────────────────

  test("a label can be set and rows GROUP BY it — this is the whole point", async () => {
    await asStaff(async (tx) => {
      await insertScript(tx, partnerA, { title: "G1", angle_key: "labelspine_alpha", hook_key: "labelspine_h1" });
      await insertScript(tx, partnerA, { title: "G2", angle_key: "labelspine_alpha", hook_key: "labelspine_h1" });
      await insertScript(tx, partnerA, { title: "G3", angle_key: "labelspine_beta",  hook_key: "labelspine_h2" });
    });

    const byAngle = (await asStaff((tx) => tx.query(
      `SELECT angle_key, count(*)::int AS n
         FROM ad_scripts
        WHERE org_id = $1 AND angle_key LIKE 'labelspine_%'
        GROUP BY angle_key
        ORDER BY angle_key`, [org]
    ))).rows;

    assert.deepEqual(byAngle, [
      { angle_key: "labelspine_alpha", n: 2 },
      { angle_key: "labelspine_beta",  n: 1 }
    ], "grouping scripts by angle did not work");

    // The real question, end to end: group ADS by the hook of the script they
    // came from. This is "which hook books calls cheapest" minus the money.
    const byHook = (await asStaff((tx) => tx.query(
      `SELECT hook_key, count(*)::int AS ads
         FROM v_ad_label_spine
        WHERE org_id = $1 AND hook_key IS NOT NULL
        GROUP BY hook_key
        ORDER BY ads DESC, hook_key`, [org]
    ))).rows;

    const chain = byHook.find((r) => r.hook_key === "chain_hook");
    assert.ok(chain, "grouping ads by the hook of their script returned nothing");
    assert.equal(chain.ads, 3, "the three ads built from one hook did not group together");
  });

  test("a brand new angle can be saved without anybody registering it first", async () => {
    // No foreign key to ad_labels, on purpose: naming is never a blocker.
    const row = await asStaff(async (tx) =>
      (await insertScript(tx, partnerA, {
        title: "Invented today", angle_key: "labelspine_never_seen_before"
      })).rows[0]);
    assert.equal(row.angle_key, "labelspine_never_seen_before");

    const dict = (await asStaff((tx) => tx.query(
      `SELECT 1 FROM ad_labels WHERE org_id = $1 AND kind = 'angle' AND key = $2`,
      [org, "labelspine_never_seen_before"]
    ))).rows;
    assert.equal(dict.length, 0, "the test only proves the point if the dictionary really is empty for this key");
  });

  // ── 7. NULL survives as NULL ────────────────────────────────────────────

  test("an unlabelled script stays unlabelled — no zeros, no empty strings", async () => {
    const bare = await asStaff(async (tx) =>
      (await insertScript(tx, partnerA, { title: null })).rows[0]);

    for (const c of ["title", "hook_text", "script_type", "lane",
                     "angle_key", "hook_key", "offer_key", "archived_at",
                     "parent_script_id"]) {
      assert.strictEqual(bare[c], null, `${c} came back as ${JSON.stringify(bare[c])} instead of NULL`);
    }
    assert.notStrictEqual(bare.script_type, "", "an unknown label became an empty string");
    assert.notStrictEqual(bare.version, null);
    assert.equal(bare.version, 1);
  });

  test("an ad with no creative still appears in the spine, with NULL labels", async () => {
    const ad = await asStaff(async (tx) =>
      (await insertAd(tx, "Naked ad", null)).rows[0]);

    const row = (await asStaff((tx) => tx.query(
      `SELECT * FROM v_ad_label_spine WHERE ad_row_id = $1`, [ad.id]
    ))).rows[0];

    assert.ok(row, "an ad with no creative fell out of the spine entirely");
    assert.equal(row.ad_name, "Naked ad");
    for (const c of ["asset_id", "asset_kind", "asset_aspect_ratio", "duration_sec",
                     "script_id", "script_version", "script_title", "script_type",
                     "lane", "angle_key", "hook_key", "offer_key", "hook_text",
                     "fundhub_ad_number", "script_archived_at", "asset_archived_at"]) {
      assert.strictEqual(row[c], null, `${c} was invented as ${JSON.stringify(row[c])} for an ad with no creative`);
    }
    assert.notStrictEqual(row.script_version, 0, "an unknown version became 0");
  });

  test("a creative with a script but no ad, and a creative with no script, both survive", async () => {
    const { withScript, without } = await asStaff(async (tx) => {
      const s = (await insertScript(tx, partnerA, { title: "Orphan script", angle_key: "labelspine_alpha" })).rows[0];
      return {
        withScript: (await insertCreative(tx, partnerA, s.id)).rows[0],
        without: (await insertCreative(tx, partnerA, null)).rows[0]
      };
    });

    assert.ok(withScript.script_id, "the linked creative lost its script");
    assert.strictEqual(without.script_id, null, "a creative made from no script got an invented script_id");
  });

  // ── 8. the locks, proved as a PARTNER and not as staff ──────────────────
  //
  // Everything above runs as staff, and staff passes every lock in this database
  // by design (045:100-105). These three are the only tests in the file that a
  // broken policy, a missing GRANT or a forgotten FORCE would actually fail.

  const NOT_REAL = rlsIsReal() ? "" :
    " — NOTE: APP_DATABASE_URL is not set, so this ran as the table owner and proves " +
    "less than it looks (src/testing/rls-pool.mjs)";

  test("a partner login can read its OWN scripts — the table is not simply denying everyone", async () => {
    const mine = await asStaff(async (tx) =>
      (await insertScript(tx, partnerA, {
        title: "Partner A can see this", angle_key: "labelspine_alpha"
      })).rows[0]);

    // Fails if 377 never reached its GRANT block (permission denied), if the
    // policy was installed with no USING clause, or if FORCE went on with no
    // policy at all — all three of which look like an empty screen with no
    // error message anywhere.
    const rows = await asPartner(partnerA, (tx) =>
      tx.query(`SELECT id, title, angle_key FROM ad_scripts WHERE id = $1`, [mine.id])
        .then((r) => r.rows));

    assert.equal(rows.length, 1,
      "a partner could not read a script it owns — the screen would show an empty list with no error");
    assert.equal(rows[0].title, "Partner A can see this");
    assert.equal(rows[0].angle_key, "labelspine_alpha");
  });

  test("a partner login reads ZERO of another partner's scripts", async () => {
    const theirs = await asStaff(async (tx) =>
      (await insertScript(tx, partnerA, { title: "Partner B must never see this" })).rows[0]);

    const byId = await asPartner(partnerB, (tx) =>
      tx.query(`SELECT id FROM ad_scripts WHERE id = $1`, [theirs.id]).then((r) => r.rows));
    assert.deepStrictEqual(byId, [], `partner B read partner A's script by id${NOT_REAL}`);

    const count = await asPartner(partnerB, (tx) =>
      tx.query(`SELECT count(*)::int AS n FROM ad_scripts WHERE partner_id = $1`, [partnerA])
        .then((r) => r.rows[0].n));
    assert.equal(count, 0, `partner B counted ${count} of partner A's scripts${NOT_REAL}`);
  });

  test("a partner login CAN read the label dictionary, and cannot write to it", async () => {
    // The dropdown of angle names is shown to partners, so a partner session
    // that reads zero labels is an empty dropdown with no error behind it.
    const keys = await asPartner(partnerA, (tx) =>
      tx.query(`SELECT key FROM ad_labels WHERE org_id = $1 AND kind = 'angle'`, [org])
        .then((r) => r.rows.map((x) => x.key)));

    for (const k of ["denial_angle", "broker_burn_angle", "competitor_angle", "blind_application"]) {
      assert.ok(keys.includes(k),
        `a partner session cannot see the angle ${k} — the angle dropdown would be empty`);
    }

    // Read-only for partners: the dictionary is house vocabulary. Either the
    // policy refuses the row or the role has no INSERT — both are correct, and
    // both must not be "it worked".
    await assert.rejects(
      () => asPartner(partnerA, (tx) => tx.query(
        `INSERT INTO ad_labels (org_id, kind, key, name)
         VALUES ($1,'angle','labelspine_partner_wrote_this','Nope')`, [org])),
      /row-level security|permission denied/i,
      "a partner wrote a row into the shared label dictionary"
    );
  });
});
