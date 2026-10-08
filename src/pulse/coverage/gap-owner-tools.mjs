// Owner tools the other morning lanes do not own. Read only. Report only.
// Galaxy, Ops Admin, teleprompter, Brand Studio, Content, Creative Factory,
// and the journeys editor.
//
// Break: the desk URL answers 404, or the main read API answers 500.
// GET only. Do not change brand assets. Do not start a teleprompter session.
// Do not edit a page.
//
// Tripwire is existing Recon (AG-07). This file does not start a second watchdog.
//
// Slice 30 only asks whether ops-admin.html is already on the morning list.
// Slice 31 only asks the same for creative-factory.html. Neither opens the
// page or the read. Partner Galaxy stays on the partner lane.

export const DEFAULT_BASE_URL = "https://fundhub.ai";

/** One desk and the one GET that desk uses to load. No write path is listed. */
export const OWNER_TOOLS = Object.freeze([
  {
    id: "owner-tools:galaxy",
    name: "Galaxy",
    desk: "/app/galaxy.html",
    read: "/api/read/company-activity"
  },
  {
    id: "owner-tools:ops-admin",
    name: "Ops Admin",
    desk: "/app/ops-admin.html",
    read: "/api/read/ops-pulse"
  },
  {
    id: "owner-tools:teleprompter",
    name: "Teleprompter",
    desk: "/app/teleprompter.html",
    read: "/api/marketing/shoot"
  },
  {
    id: "owner-tools:brand-studio",
    name: "Brand Studio",
    desk: "/app/brand-studio.html",
    read: "/api/org-brand"
  },
  {
    id: "owner-tools:content-admin",
    name: "Content",
    desk: "/app/content-admin.html",
    read: "/api/content/tiles"
  },
  {
    id: "owner-tools:creative-factory",
    name: "Creative Factory",
    desk: "/app/creative-factory.html",
    read: "/api/creative/jobs"
  },
  {
    id: "owner-tools:journeys",
    name: "Journeys editor",
    desk: "/app/journeys.html",
    read: "/api/journeys"
  }
]);

export const CHECK_IDS = Object.freeze(OWNER_TOOLS.map((tool) => tool.id));

const TRIPWIRE =
  "Recon (AG-07) is the one tripwire. Do not add another watcher. " +
  "Do not change brand assets. Do not start a teleprompter session. Do not edit a page.";

const SAFE =
  "Did not change brand assets. Did not start a teleprompter session. Did not edit a page.";

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function origin(ctx) {
  return String((ctx && ctx.baseUrl) || DEFAULT_BASE_URL).replace(/\/+$/, "");
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

async function readGet(fetchImpl, url, accept) {
  const res = await fetchImpl(url, {
    method: "GET",
    credentials: "omit",
    headers: { accept }
  });
  return { status: Number(res && res.status) };
}

/** A read door is up when it answers, including a clean refusal. A 500 is down. */
export function readStatusUp(status) {
  const code = Number(status);
  return (
    (code >= 200 && code < 300) ||
    code === 400 ||
    code === 401 ||
    code === 403 ||
    code === 405
  );
}

async function checkTool(ctx, tool) {
  if (typeof ctx.fetchImpl !== "function") {
    return check(
      tool.id,
      "skip",
      `no fetch in this run — ${tool.name} was not opened. ${SAFE}`
    );
  }
  const base = origin(ctx);
  try {
    const desk = await readGet(ctx.fetchImpl, `${base}${tool.desk}`, "text/html");
    const api = await readGet(ctx.fetchImpl, `${base}${tool.read}`, "application/json");
    const bits = [];
    if (desk.status === 404) {
      bits.push(`${tool.name} desk ${tool.desk} answered 404`);
    } else if (desk.status < 200 || desk.status >= 300) {
      bits.push(`${tool.name} desk ${tool.desk} answered ${desk.status}`);
    }
    if (!readStatusUp(api.status)) {
      bits.push(`${tool.name} read ${tool.read} answered ${api.status}`);
    }
    if (bits.length) {
      return check(
        tool.id,
        "FAIL",
        `${bits.join(". ")}. ${SAFE}`,
        fix(`Restore ${tool.name} so the desk loads and ${tool.read} does not answer 500.`)
      );
    }
    return check(
      tool.id,
      "PASS",
      `${tool.name} desk loaded and ${tool.read} answered ${api.status}. ${SAFE}`
    );
  } catch (err) {
    return check(
      tool.id,
      "FAIL",
      `${tool.name} unreachable: ${clip(err)}. ${SAFE}`,
      fix(`Restore ${tool.name}.`)
    );
  }
}

/** Seven gap rows. Shape is { id, status, detail, suggestedFix }. Status is PASS, FAIL, or skip. */
export async function gapChecks(ctx = {}) {
  return Promise.all(OWNER_TOOLS.map((tool) => checkTool(ctx, tool)));
}
