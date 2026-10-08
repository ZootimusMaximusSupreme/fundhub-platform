// Credit soft-pull approve door. Report only. Never auto-fix.
// One GET of the approve screen. One GET of its read route, with no link token.
// That GET does not pull credit and does not send bureau mail.
// Recon (AG-07) is the one tripwire. Do not invent a second watchdog.
// Do not edit the approve page from this check.

export const DEFAULT_BASE_URL = "https://fundhub.ai";
export const APPROVE_PAGE_PATH = "/app/soft-pull-approve.html";
export const APPROVE_READ_PATH = "/api/soft-pull-approve";

/** The screen calls this path. A 200 page that lacks it is not the approve screen. */
export const PAGE_MARKER = "/api/soft-pull-approve";

/** What GET /api/soft-pull-approve returns when the link is real. */
export const READ_KIND = "soft_pull_consent";

export const CHECK_IDS = Object.freeze([
  "soft-pull:approve-page",
  "soft-pull:approve-read"
]);

const TRIPWIRE =
  "Recon (AG-07) is the one tripwire. Do not invent a second watchdog. " +
  "Do not pull credit. Do not send bureau mail. Do not edit the approve page. Do not auto-fix.";

const PAGE_FIX =
  `Put the soft-pull approve screen back at ${APPROVE_PAGE_PATH}. ${TRIPWIRE}`;

const READ_FIX =
  `Fix GET ${APPROVE_READ_PATH} so the approve screen can read it. Do not POST. ${TRIPWIRE}`;

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(s, n = 160) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

function originOf(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function httpStatus(res) {
  const n = Number(res && res.status);
  return Number.isInteger(n) ? n : null;
}

async function bodyText(res) {
  if (res && typeof res.text === "function") return String((await res.text()) ?? "");
  if (res && typeof res.json === "function") {
    const value = await res.json();
    return JSON.stringify(value);
  }
  return "";
}

function parseJson(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** Unsigned refusal, or the disclosure read. Never a credit pull. */
export function approveReadShape(status, body) {
  if (!body || typeof body !== "object") return false;
  if (status === 200) {
    return body.ok === true
      && body.kind === READ_KIND
      && body.disclosure != null
      && typeof body.disclosure === "object"
      && body.pricing != null
      && typeof body.pricing === "object";
  }
  if (status === 400 || status === 401) {
    return body.ok === false && typeof body.error === "string" && body.error.length > 0;
  }
  return false;
}

async function readGet(fetchImpl, url, accept) {
  const res = await fetchImpl(url, {
    method: "GET",
    credentials: "omit",
    headers: { accept }
  });
  const text = await bodyText(res);
  return { status: httpStatus(res), text };
}

export async function checkApprovePage({ fetchImpl, baseUrl = DEFAULT_BASE_URL } = {}) {
  const id = "soft-pull:approve-page";
  if (typeof fetchImpl !== "function") {
    return check(id, "skip", "no fetch in this run — approve screen not opened");
  }
  const url = `${originOf(baseUrl)}${APPROVE_PAGE_PATH}`;
  try {
    const { status, text } = await readGet(fetchImpl, url, "text/html");
    if (status === 404 || (status != null && status >= 500)) {
      const extra = text ? `: ${clip(text, 120)}` : "";
      return check(id, "FAIL", `soft-pull approve screen answered ${status}${extra}`, PAGE_FIX);
    }
    if (status === 200 && text.includes(PAGE_MARKER)) {
      return check(id, "PASS", "soft-pull approve screen loaded");
    }
    const why = status === 200 ? "without its read route" : `answered ${status == null ? "nothing" : status}`;
    return check(id, "FAIL", `soft-pull approve screen ${why}`, PAGE_FIX);
  } catch (err) {
    return check(id, "FAIL", `soft-pull approve screen unreachable: ${clip(err && err.message)}`, PAGE_FIX);
  }
}

export async function checkApproveRead({ fetchImpl, baseUrl = DEFAULT_BASE_URL } = {}) {
  const id = "soft-pull:approve-read";
  if (typeof fetchImpl !== "function") {
    return check(id, "skip", "no fetch in this run — approve read API not opened");
  }
  const url = `${originOf(baseUrl)}${APPROVE_READ_PATH}`;
  try {
    const { status, text } = await readGet(fetchImpl, url, "application/json");
    if (status === 404 || (status != null && status >= 500)) {
      const extra = text ? `: ${clip(text, 120)}` : "";
      return check(id, "FAIL", `soft-pull read API answered ${status}${extra}`, READ_FIX);
    }
    const body = parseJson(text);
    if (approveReadShape(status, body)) {
      const shape = status === 200 ? "approval read shape" : "unsigned link shape";
      return check(id, "PASS", `soft-pull read API answered ${status} with the ${shape}`);
    }
    return check(
      id,
      "FAIL",
      `soft-pull read API answered ${status == null ? "nothing" : status} but the body was not the approval read shape`,
      READ_FIX
    );
  } catch (err) {
    return check(id, "FAIL", `soft-pull read API unreachable: ${clip(err && err.message)}`, READ_FIX);
  }
}

/**
 * Soft-pull approve door. One tripwire, two readings.
 * @param {{ fetchImpl?: Function, baseUrl?: string }} [ctx]
 * @returns {Promise<Array<{ id: string, status: string, detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  const fetchImpl = ctx.fetchImpl;
  const baseUrl = ctx.baseUrl;
  return [
    await checkApprovePage({ fetchImpl, baseUrl }),
    await checkApproveRead({ fetchImpl, baseUrl })
  ];
}
