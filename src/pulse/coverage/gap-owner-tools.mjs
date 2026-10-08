// Owner tools the other morning lanes do not own. Read only. Report only.
// Galaxy, Ops Admin, teleprompter, Brand Studio, Content, Creative Factory,
// and the journeys editor.
//
// Break: the tool cannot read what it shows. GET only. Do not change brand
// assets. Do not start a teleprompter session. Do not edit a page.
//
// Tripwire is existing Recon (AG-07). This file does not start a second watchdog.
//
// Claude review 2026-10-08: this file used to GET each desk and each read door
// and call a 2xx, 400, 401, 403 or 405 "up". The registry already does exactly
// that for all 14 URLs (reg:galaxy ... reg:journeys), so every row here was a
// copy, and a 401 only proves the sign-in is in front of the tool, not that the
// tool can read its data. Each row now reads the data behind its tool, the way
// the tool reads it, under the pulse's staff scope. Slice 30 only asks whether
// ops-admin.html is on the morning list, and slice 31 only asks the same for
// creative-factory.html. Partner Galaxy stays on the partner lane.

export const DEFAULT_BASE_URL = "https://fundhub.ai";

/** Teleprompter read. Open to a GET on purpose (api/marketing/shoot.mjs), so the body can be read. */
export const SHOOT_PATH = "/api/marketing/shoot";

/** One tool per row. `reads` is what the row proves the tool can read. */
export const OWNER_TOOLS = Object.freeze([
  { id: "owner-tools:galaxy", name: "Galaxy", reads: "the people and agents on the board" },
  { id: "owner-tools:ops-admin", name: "Ops Admin", reads: "today's company pulse" },
  { id: "owner-tools:teleprompter", name: "Teleprompter", reads: "the open shoot and its scripts" },
  { id: "owner-tools:brand-studio", name: "Brand Studio", reads: "the company brand row" },
  { id: "owner-tools:content-admin", name: "Content", reads: "the tiles, videos and products" },
  { id: "owner-tools:creative-factory", name: "Creative Factory", reads: "the generation jobs list" },
  { id: "owner-tools:journeys", name: "Journeys editor", reads: "the saved journeys" }
]);

export const CHECK_IDS = Object.freeze(OWNER_TOOLS.map((tool) => tool.id));

/** Same select the Brand Studio read runs (api/org-brand.mjs readEffective), columns narrowed. */
export const BRAND_SQL = `
  SELECT org_id::text AS org_id, ink, paper
    FROM v_org_brand_effective
   WHERE org_id = $1::uuid`;

/** Same selects the Content screen loads (api/content/tiles.mjs loadBundle). */
export const TILES_SQL = `
  SELECT code, name, description, active, sort_order
    FROM entitlement_catalog
   WHERE org_id = $1::uuid
   ORDER BY sort_order, code`;
export const VIDEOS_SQL = `
  SELECT id, title, duration_label, mime_type, byte_size, uploaded_by, created_at
    FROM content_videos
   WHERE org_id = $1::uuid
   ORDER BY created_at DESC
   LIMIT 50`;
export const TIER_MAP_SQL = `
  SELECT tier_code, video_id FROM content_tier_map WHERE org_id = $1::uuid`;
export const PRODUCTS_SQL = `
  SELECT code, name, description
    FROM products
   WHERE org_id = $1::uuid AND active = true
   ORDER BY sort_order, code`;

/** Same select the Journeys editor loads (api/journeys.mjs GET). */
export const JOURNEYS_SQL = `
  SELECT key, name, start_when, end_when, description, nodes, updated_at
    FROM journeys
   WHERE org_id = $1::uuid`;

const TRIPWIRE =
  "Recon (AG-07) is the one tripwire. Do not add another watcher. " +
  "Do not change brand assets. Do not start a teleprompter session. Do not edit a page.";

const SAFE =
  "Did not change brand assets. Did not start a teleprompter session. Did not edit a page.";

const HEX = /^#[0-9a-fA-F]{6}$/;

const toolById = new Map(OWNER_TOOLS.map((tool) => [tool.id, tool]));

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail: `${detail} ${SAFE}`, suggestedFix };
}

function origin(ctx) {
  return String((ctx && ctx.baseUrl) || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function fetcher(ctx) {
  const f = ctx && (ctx.fetchImpl || ctx.fetch);
  return typeof f === "function" ? f : null;
}

function clip(err) {
  return String((err && err.message) || err || "error")
    .replace(/postgres(ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function fix(line) {
  return `${line} ${TRIPWIRE}`;
}

function hasDb(ctx) {
  return Boolean(ctx.db && typeof ctx.db.query === "function" && ctx.orgId);
}

/** Run a read as staff when the pulse gave a staff scope, else on the plain db. */
function withScope(ctx, fn) {
  if (typeof ctx.scope === "function") return ctx.scope(fn);
  return fn(ctx.db);
}

const noDb = (id) => {
  const tool = toolById.get(id);
  return check(id, "skip", `no database in this run — ${tool.name} was not read.`);
};

const broke = (id, why) => {
  const tool = toolById.get(id);
  return check(
    id,
    "FAIL",
    `${tool.name} cannot read ${tool.reads}: ${why}.`,
    fix(`Restore the read behind ${tool.name}.`)
  );
};

/* The code each tool's own read runs. Loaded when a row runs, so one that will
   not load fails its own row and no other. `ctx.probes` swaps them in tests. */
const loaders = {
  companyActivity: async () => (await import("../../galaxy/company-activity.mjs")).companyActivity,
  computePulse: async () => (await import("../../ops/pulse.mjs")).computePulse,
  creativeJobRows: async () => (await import("../../../api/creative/jobs.mjs")).fetchRows
};

async function probe(ctx, name) {
  const injected = ctx.probes && ctx.probes[name];
  return typeof injected === "function" ? injected : loaders[name]();
}

async function checkGalaxy(ctx) {
  const id = "owner-tools:galaxy";
  if (!hasDb(ctx)) return noDb(id);
  try {
    const companyActivity = await probe(ctx, "companyActivity");
    const data = await withScope(ctx, (tx) => companyActivity(tx, { orgId: ctx.orgId }));
    const nodes = Array.isArray(data && data.nodes) ? data.nodes.length : 0;
    if (!nodes) return broke(id, "it came back with nobody on the board");
    return check(id, "PASS", `Galaxy read ran: ${nodes} people and agents on the board.`);
  } catch (err) {
    return broke(id, clip(err));
  }
}

async function checkOpsAdmin(ctx) {
  const id = "owner-tools:ops-admin";
  if (!hasDb(ctx)) return noDb(id);
  try {
    const computePulse = await probe(ctx, "computePulse");
    const pulse = await withScope(ctx, (tx) => computePulse(tx, { orgId: ctx.orgId, period: "today" }));
    if (!pulse || typeof pulse !== "object" || !pulse.kpis || typeof pulse.kpis !== "object") {
      return broke(id, "the pulse came back with no numbers");
    }
    return check(id, "PASS", "Ops Admin read ran: today's company pulse came back with numbers.");
  } catch (err) {
    return broke(id, clip(err));
  }
}

async function checkTeleprompter(ctx) {
  const id = "owner-tools:teleprompter";
  const fetchImpl = fetcher(ctx);
  if (!fetchImpl) return check(id, "skip", "no fetch in this run — Teleprompter was not read.");
  try {
    const res = await fetchImpl(`${origin(ctx)}${SHOOT_PATH}`, {
      method: "GET",
      headers: { accept: "application/json" }
    });
    const status = Number(res && res.status);
    if (status !== 200) return broke(id, `${SHOOT_PATH} answered ${status}`);
    let body = null;
    try {
      body = JSON.parse(typeof res.text === "function" ? await res.text() : "");
    } catch {
      body = null;
    }
    if (!body || !Array.isArray(body.plan_candidates) || !Array.isArray(body.past_shoots) || typeof body.as_of !== "string") {
      return broke(id, `${SHOOT_PATH} answered 200 but not with a shoot`);
    }
    const scripts = body.shoot && Array.isArray(body.shoot.scripts) ? body.shoot.scripts : [];
    const blank = scripts.filter((s) => !String((s && s.teleprompter_text) || "").trim()).length;
    if (blank) {
      return broke(id, `${blank} of ${scripts.length} scripts in the open shoot have no teleprompter text, so the prompter would roll a blank page`);
    }
    return check(
      id,
      "PASS",
      body.shoot
        ? `Teleprompter read ran: the open shoot has ${scripts.length} scripts, each with text to roll.`
        : "Teleprompter read ran: no shoot is open."
    );
  } catch (err) {
    return broke(id, clip(err));
  }
}

async function checkBrandStudio(ctx) {
  const id = "owner-tools:brand-studio";
  if (!hasDb(ctx)) return noDb(id);
  try {
    const { rows } = await withScope(ctx, (tx) => tx.query(BRAND_SQL, [ctx.orgId]));
    const brand = rows && rows[0];
    if (!brand) return broke(id, "the company has no brand row, so /api/org-brand answers 404 and nothing is painted");
    if (!HEX.test(String(brand.ink || "")) || !HEX.test(String(brand.paper || ""))) {
      return broke(id, "the brand row has no usable ink and paper colors");
    }
    return check(id, "PASS", "Brand Studio read ran: the company brand row is there with ink and paper.");
  } catch (err) {
    return broke(id, clip(err));
  }
}

async function checkContentAdmin(ctx) {
  const id = "owner-tools:content-admin";
  if (!hasDb(ctx)) return noDb(id);
  try {
    const out = await withScope(ctx, async (tx) => {
      const tiles = await tx.query(TILES_SQL, [ctx.orgId]);
      let videos = { rows: [] };
      try {
        videos = await tx.query(VIDEOS_SQL, [ctx.orgId]);
        await tx.query(TIER_MAP_SQL, [ctx.orgId]);
      } catch (err) {
        // The screen forgives exactly one thing here: the video tables not being there yet.
        if (!(err && err.code === "42P01")) throw err;
      }
      const products = await tx.query(PRODUCTS_SQL, [ctx.orgId]);
      return { tiles: tiles.rows.length, videos: videos.rows.length, products: products.rows.length };
    });
    if (!out.tiles) return broke(id, "the company has no tiles, so the Content screen has nothing to edit");
    return check(
      id,
      "PASS",
      `Content read ran: ${out.tiles} tiles, ${out.videos} videos, ${out.products} products.`
    );
  } catch (err) {
    return broke(id, clip(err));
  }
}

async function checkCreativeFactory(ctx) {
  const id = "owner-tools:creative-factory";
  if (!hasDb(ctx)) return noDb(id);
  try {
    const fetchRows = await probe(ctx, "creativeJobRows");
    const rows = await withScope(ctx, (tx) => fetchRows(tx, { limit: 1, offset: 0, query: {} }));
    if (!Array.isArray(rows)) return broke(id, "the jobs list did not come back as a list");
    return check(id, "PASS", "Creative Factory read ran: the generation jobs list came back.");
  } catch (err) {
    return broke(id, clip(err));
  }
}

async function checkJourneys(ctx) {
  const id = "owner-tools:journeys";
  if (!hasDb(ctx)) return noDb(id);
  try {
    const { rows } = await withScope(ctx, (tx) => tx.query(JOURNEYS_SQL, [ctx.orgId]));
    const bad = (rows || []).filter((row) => !Array.isArray(row.nodes));
    if (bad.length) {
      return broke(id, `${bad.length} saved journey${bad.length === 1 ? " has" : "s have"} steps that are not a list, so the editor cannot draw ${bad.length === 1 ? "it" : "them"}`);
    }
    return check(id, "PASS", `Journeys read ran: ${(rows || []).length} saved journeys, each with a step list.`);
  } catch (err) {
    return broke(id, clip(err));
  }
}

/** Seven gap rows. Shape is { id, status, detail, suggestedFix }. Status is PASS, FAIL, or skip. */
export async function gapChecks(ctx = {}) {
  // One after another: each database row opens its own staff transaction.
  return [
    await checkGalaxy(ctx),
    await checkOpsAdmin(ctx),
    await checkTeleprompter(ctx),
    await checkBrandStudio(ctx),
    await checkContentAdmin(ctx),
    await checkCreativeFactory(ctx),
    await checkJourneys(ctx)
  ];
}
