// The settings and funnel checks, the answer shapes, and the 7-day window.
// Pure: no database, no network. The SQL runs for real in
// src/http/marketing-settings.pg.test.mjs and marketing-funnels.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateSettingsPatch, validateFunnelInput, settingsView, funnelView, parseUpdatedAt,
  sevenDayWindow, SETTINGS_KEYS, SETTINGS_PATCH_KEYS, FUNNEL_KEYS, FORMATS, AD_LANES,
  RESEARCH_SETTINGS_KEYS
} from "./settings-store.mjs";
import { InvalidError } from "./http.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = fs.readFileSync(path.resolve(HERE, "../../db/migrations/410_marketing_settings_funnels.sql"), "utf8");

const invalid = (fn, field) =>
  assert.throws(fn, (e) => e instanceof InvalidError && e.field === field, `expected 400 on ${field}`);

describe("validateSettingsPatch", () => {
  test("every patchable setting takes a good value", () => {
    const good = {
      enabled: true, batch_weekday: 0, batch_time: "06:30", timezone: "America/Phoenix",
      scripts_per_day: 4, days_per_batch: 7, size_rule: "per_funnel",
      format_style: { standard: "words", vsl: "bullets" }, draft_expiry_days: 21,
      winner_rule: { min_spend_cents: 5000 }, ad_number_floor: 91, next_overrides: null,
      max_batch_cost_usd: 50, max_month_cost_usd: 400, submagic_template: "Hormozi 1",
      max_research_cost_usd: 2.5, research_shares_month_cap: false,
      caption_position_y: 0, magic_zooms: true, clean_audio: false,
      caption_dictionary: ["Fundhub", " UnderwriteIQ "], animation_mode: "overlay",
      flip_horizontal: true, settle_minutes: 15, quiet_start: "22:00", quiet_end: "06:00"
    };
    assert.deepEqual(Object.keys(good).sort(), [...SETTINGS_PATCH_KEYS].sort(), "the test covers every key");
    const out = validateSettingsPatch(good);
    assert.deepEqual(out.caption_dictionary, ["Fundhub", "UnderwriteIQ"]);
    assert.equal(out.size_rule, "per_funnel");
    assert.equal(validateSettingsPatch({ winner_rule: null }).winner_rule, null);
  });

  test("bad values are 400 with the field", () => {
    invalid(() => validateSettingsPatch({ batch_weekday: 7 }), "patch.batch_weekday");
    invalid(() => validateSettingsPatch({ batch_weekday: -1 }), "patch.batch_weekday");
    invalid(() => validateSettingsPatch({ batch_weekday: "1" }), "patch.batch_weekday");
    invalid(() => validateSettingsPatch({ batch_time: "7:00" }), "patch.batch_time");
    invalid(() => validateSettingsPatch({ quiet_start: "24:00" }), "patch.quiet_start");
    invalid(() => validateSettingsPatch({ quiet_end: "07:00:00" }), "patch.quiet_end");
    invalid(() => validateSettingsPatch({ timezone: "Mars/Olympus" }), "patch.timezone");
    invalid(() => validateSettingsPatch({ scripts_per_day: 0 }), "patch.scripts_per_day");
    invalid(() => validateSettingsPatch({ scripts_per_day: 2.5 }), "patch.scripts_per_day");
    invalid(() => validateSettingsPatch({ max_month_cost_usd: -1 }), "patch.max_month_cost_usd");
    invalid(() => validateSettingsPatch({ ad_number_floor: 3e9 }), "patch.ad_number_floor");
    invalid(() => validateSettingsPatch({ size_rule: "each" }), "patch.size_rule");
    invalid(() => validateSettingsPatch({ animation_mode: "both" }), "patch.animation_mode");
    invalid(() => validateSettingsPatch({ format_style: { standard: "prose" } }), "patch.format_style.standard");
    invalid(() => validateSettingsPatch({ format_style: { podcast: "words" } }), "patch.format_style.podcast");
    invalid(() => validateSettingsPatch({ format_style: ["words"] }), "patch.format_style");
    invalid(() => validateSettingsPatch({ winner_rule: "spend most" }), "patch.winner_rule");
    invalid(() => validateSettingsPatch({ next_overrides: [] }), "patch.next_overrides");
    invalid(() => validateSettingsPatch({ enabled: "yes" }), "patch.enabled");
    invalid(() => validateSettingsPatch({ submagic_template: "  " }), "patch.submagic_template");
    invalid(() => validateSettingsPatch({ caption_position_y: -5 }), "patch.caption_position_y");
    invalid(() => validateSettingsPatch({ caption_dictionary: "Fundhub" }), "patch.caption_dictionary");
    invalid(() => validateSettingsPatch({ caption_dictionary: ["ok", ""] }), "patch.caption_dictionary.1");
  });

  test("unknown keys, server-set keys and empty patches are refused, not ignored", () => {
    invalid(() => validateSettingsPatch({ colour: "red" }), "patch.colour");
    invalid(() => validateSettingsPatch({ updated_at: "2026-10-05T00:00:00Z" }), "patch.updated_at");
    invalid(() => validateSettingsPatch({ org_id: "x" }), "patch.org_id");
    invalid(() => validateSettingsPatch({ updated_by: "x" }), "patch.updated_by");
    invalid(() => validateSettingsPatch({ toString: 1 }), "patch.toString");
    invalid(() => validateSettingsPatch({}), "patch");
    invalid(() => validateSettingsPatch(null), "patch");
    invalid(() => validateSettingsPatch([1]), "patch");
  });

  test("updated_at must be a time", () => {
    assert.equal(parseUpdatedAt("2026-10-05T14:00:00.123Z"), Date.parse("2026-10-05T14:00:00.123Z"));
    invalid(() => parseUpdatedAt(undefined), "updated_at");
    invalid(() => parseUpdatedAt("soon"), "updated_at");
    invalid(() => parseUpdatedAt(123), "updated_at");
  });
});

describe("settingsView", () => {
  test("answers exactly the fixed shape, times as HH:MM, updated_at as ISO", () => {
    const row = {
      org_id: "o", enabled: false, batch_weekday: 1, batch_time: "07:00:00", timezone: "America/Phoenix",
      scripts_per_day: 3, days_per_batch: 7, size_rule: "total",
      format_style: { standard: "bullets" }, draft_expiry_days: 14, winner_rule: null,
      ad_number_floor: 91, next_overrides: null, max_batch_cost_usd: 40, max_month_cost_usd: 300,
      submagic_template: "Hormozi 2", caption_position_y: null, magic_zooms: false, clean_audio: true,
      caption_dictionary: [], animation_mode: "fullframe", flip_horizontal: false, settle_minutes: 10,
      quiet_start: "21:00:00", quiet_end: "07:00:00", updated_at: new Date("2026-10-05T14:00:00.123Z"),
      updated_by: null, extra_column_from_a_later_migration: 1
    };
    const v = settingsView(row);
    assert.deepEqual(Object.keys(v), [...SETTINGS_KEYS, ...RESEARCH_SETTINGS_KEYS]);
    // A row read before migration 429: the stop amount is unknown (null), research shares the cap.
    assert.equal(v.max_research_cost_usd, null);
    assert.equal(v.research_shares_month_cap, true);
    assert.equal(v.batch_time, "07:00");
    assert.equal(v.quiet_start, "21:00");
    assert.equal(v.updated_at, "2026-10-05T14:00:00.123Z");
  });

  test("the fixed shape is the spec's column list, and the migration holds every column", () => {
    assert.equal(SETTINGS_KEYS.length, 27);
    for (const k of SETTINGS_KEYS) assert.match(MIGRATION, new RegExp(`\\n  ${k}\\s`), `410 has marketing_settings.${k}`);
  });
});

describe("the spec's defaults are in the migration (§6 Step 3, §17)", () => {
  const settings = MIGRATION.slice(MIGRATION.indexOf("CREATE TABLE IF NOT EXISTS public.marketing_settings"),
    MIGRATION.indexOf("-- ── marketing_funnels"));
  for (const [col, def] of [
    ["enabled", "false"], ["batch_weekday", "1"], ["batch_time", "'07:00'"],
    ["timezone", "'America/Phoenix'"], ["scripts_per_day", "3"], ["days_per_batch", "7"],
    ["size_rule", "'total'"], ["draft_expiry_days", "14"], ["ad_number_floor", "91"],
    ["max_batch_cost_usd", "40"], ["max_month_cost_usd", "300"], ["submagic_template", "'Hormozi 2'"],
    ["magic_zooms", "false"], ["clean_audio", "true"], ["caption_dictionary", "'{}'"],
    ["animation_mode", "'fullframe'"], ["flip_horizontal", "false"], ["settle_minutes", "10"],
    ["quiet_start", "'21:00'"], ["quiet_end", "'07:00'"]
  ]) {
    test(`${col} defaults to ${def}`, () => {
      const line = settings.split("\n").find((l) => new RegExp(`^  ${col}\\s`).test(l));
      assert.ok(line, `no ${col} line`);
      assert.match(line, new RegExp(`DEFAULT ${def.replace(/[{}]/g, "\\$&")}(,|\\s|$)`), line);
    });
  }
  test("format_style's default is the spec's six formats", () => {
    const m = /'(\{"standard":[^']+\})'::jsonb/.exec(settings);
    assert.ok(m);
    assert.deepEqual(JSON.parse(m[1]), {
      standard: "bullets", sorting: "words", long: "words", notes: "bullets", greenscreen: "bullets", vsl: "bullets"
    });
    assert.deepEqual(Object.keys(JSON.parse(m[1])), [...FORMATS]);
  });
  test("winner_rule, next_overrides and caption_position_y start blank", () => {
    for (const col of ["winner_rule", "next_overrides", "caption_position_y"]) {
      const line = settings.split("\n").find((l) => new RegExp(`^  ${col}\\s`).test(l));
      assert.doesNotMatch(line, /DEFAULT|NOT NULL/, col);
    }
  });
});

describe("validateFunnelInput", () => {
  test("a full new funnel passes, ids de-duplicated", () => {
    const { key, values, updatedAt } = validateFunnelInput({
      key: "book_call", name: "Book a call", landing_url: "https://apply.fundhub.ai/watch",
      offer_key: "funding_dfy", lane: "sorting", book_call: true, format_mix: { standard: 2, sorting: 1 },
      cta_type: "LEARN_MORE", meta_campaign_ids: ["120200000000000001", "120200000000000001"],
      default_ad_set_external_id: "120200000000000009", weight: 1.5, active: true
    });
    assert.equal(key, "book_call");
    assert.equal(updatedAt, null);
    assert.deepEqual(values.meta_campaign_ids, ["120200000000000001"]);
    assert.equal(values.weight, 1.5);
  });

  test("a change carries its updated_at back out", () => {
    const r = validateFunnelInput({ key: "roadmap_147", active: false, updated_at: "2026-10-05T14:00:00.000Z" });
    assert.equal(r.updatedAt, "2026-10-05T14:00:00.000Z");
    assert.deepEqual(r.values, { active: false });
    assert.deepEqual(validateFunnelInput({ key: "x", offer_key: null, default_ad_set_external_id: null }).values,
      { offer_key: null, default_ad_set_external_id: null });
  });

  test("bad values are 400 with the field", () => {
    invalid(() => validateFunnelInput({}), "funnel.key");
    invalid(() => validateFunnelInput({ key: "Book Call" }), "funnel.key");
    invalid(() => validateFunnelInput({ key: "_x" }), "funnel.key");
    invalid(() => validateFunnelInput({ key: "a".repeat(64) }), "funnel.key");
    invalid(() => validateFunnelInput({ key: "k", lane: "tiktok" }), "funnel.lane");
    invalid(() => validateFunnelInput({ key: "k", offer_key: "mystery" }), "funnel.offer_key");
    invalid(() => validateFunnelInput({ key: "k", landing_url: "http://apply.fundhub.ai/watch" }), "funnel.landing_url");
    invalid(() => validateFunnelInput({ key: "k", landing_url: "apply.fundhub.ai" }), "funnel.landing_url");
    invalid(() => validateFunnelInput({ key: "k", format_mix: { standard: -1 } }), "funnel.format_mix.standard");
    invalid(() => validateFunnelInput({ key: "k", format_mix: { podcast: 1 } }), "funnel.format_mix.podcast");
    invalid(() => validateFunnelInput({ key: "k", format_mix: { standard: 0 } }), "funnel.format_mix");
    invalid(() => validateFunnelInput({ key: "k", cta_type: "learn more" }), "funnel.cta_type");
    invalid(() => validateFunnelInput({ key: "k", meta_campaign_ids: [120200000000000001] }), "funnel.meta_campaign_ids");
    invalid(() => validateFunnelInput({ key: "k", meta_campaign_ids: "1202" }), "funnel.meta_campaign_ids");
    invalid(() => validateFunnelInput({ key: "k", default_ad_set_external_id: "abc" }), "funnel.default_ad_set_external_id");
    invalid(() => validateFunnelInput({ key: "k", weight: -1 }), "funnel.weight");
    invalid(() => validateFunnelInput({ key: "k", book_call: 1 }), "funnel.book_call");
    invalid(() => validateFunnelInput({ key: "k", name: "" }), "funnel.name");
    invalid(() => validateFunnelInput({ key: "k", updated_at: "soon" }), "funnel.updated_at");
    invalid(() => validateFunnelInput({ key: "k", id: "x" }), "funnel.id");
    invalid(() => validateFunnelInput({ key: "k", colour: "red" }), "funnel.colour");
    invalid(() => validateFunnelInput(null), "funnel");
  });

  test("every ad_lane the database knows is accepted, 'slo' included", () => {
    for (const lane of AD_LANES) assert.equal(validateFunnelInput({ key: "k", lane }).values.lane, lane);
  });
});

describe("funnelView", () => {
  test("answers exactly the fixed shape; weight is a number", () => {
    const v = funnelView({
      id: "i", org_id: "o", key: "book_call", name: "Book a call", landing_url: "https://apply.fundhub.ai/watch",
      offer_key: "funding_dfy", lane: "sorting", book_call: true, format_mix: { standard: 2, sorting: 1 },
      cta_type: "LEARN_MORE", meta_campaign_ids: [], default_ad_set_external_id: null, weight: "1",
      active: true, created_at: new Date("2026-10-05T00:00:00Z"), updated_at: new Date("2026-10-05T00:00:00.5Z")
    });
    assert.deepEqual(Object.keys(v), [...FUNNEL_KEYS]);
    assert.equal(v.weight, 1);
    assert.equal(v.updated_at, "2026-10-05T00:00:00.500Z");
    assert.equal("org_id" in v, false);
  });
});

describe("sevenDayWindow", () => {
  test("seven Arizona days, today included", () => {
    // 2026-10-06 03:00 UTC is still the 5th in Arizona (UTC-7).
    assert.deepEqual(sevenDayWindow(new Date("2026-10-06T03:00:00Z")), { from: "2026-09-29", to: "2026-10-05" });
    assert.deepEqual(sevenDayWindow(new Date("2026-10-06T08:00:00Z")), { from: "2026-09-30", to: "2026-10-06" });
  });
});

describe("seed 297 (read as text; it runs for real in marketing-funnels.pg.test.mjs)", () => {
  const seed = fs.readFileSync(path.resolve(HERE, "../../db/seed/297_marketing_funnels.sql"), "utf8");
  const sql = seed.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  test("the two spec funnels, once each, never overwriting", () => {
    assert.match(sql, /\('book_call',\s*'[^']+',\s*'https:\/\/apply\.fundhub\.ai\/watch',\s*'funding_dfy',\s*'sorting',\s*true,\s*'\{"standard":2,"sorting":1\}'\)/);
    assert.match(sql, /\('roadmap_147',\s*'[^']+',\s*'https:\/\/apply\.fundhub\.ai\/roadmap',\s*'slo_roadmap',\s*'uwiq',\s*false,\s*'\{"standard":1\}'\)/);
    assert.match(sql, /ON CONFLICT \(org_id, key\) DO NOTHING/);
    assert.doesNotMatch(sql, /\bUPDATE\b|\bDELETE\b/i);
  });

  test("it never turns the machine on and never guesses a Meta campaign", () => {
    assert.doesNotMatch(sql, /marketing_settings/);
    assert.doesNotMatch(sql, /\benabled\b/);
    assert.doesNotMatch(sql, /meta_campaign_ids/);
  });
});
