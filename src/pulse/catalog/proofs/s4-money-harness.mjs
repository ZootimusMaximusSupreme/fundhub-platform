// Helpers for the FinanceOS money screens: the standalone page (money-banks.html)
// and the same section inside the one-page frame (financeos.html#banks). Both
// call GET and POST on /api/money/<resource>; the test answers both.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OWNER, bodyOf, json } from "./s4-screen-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** One of the sample answers the money screens are already tested against. */
export function sampleAnswer(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "src/http/fixtures", name), "utf8"));
}

export const STAFF = { ok: true, staff: { ...OWNER.staff, role: "funding_advisor" } };
export const CLIENT = { ok: true, staff: { ...OWNER.staff, role: "client" } };
export const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";

/**
 * A fake /api/money/<resource> (or a full path such as /api/blueprint/declines). GET answers `read()`; POST records the body and
 * answers `write(body)` (default: ok). Both are logged in order on `log`.
 */
export function moneyResource(resource, { read, readStatus = 200, write = () => ({ status: 200, body: { ok: true } }) }) {
  const log = { reads: [], posts: [] };
  const handler = async (route, { url, method }) => {
    if (method === "POST") {
      const body = bodyOf(route);
      log.posts.push(body);
      const out = write(body);
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    }
    log.reads.push(new URL(url).search);
    return json(route, typeof read === "function" ? read() : read, readStatus);
  };
  const path = resource.startsWith("/") ? resource : `/api/money/${resource}`;
  return { log, handlers: { [path]: handler } };
}

/** Where a money section opens: the standalone page, or its tab in the frame. */
export function entryUrl(entry, { file, tab, clientId }) {
  const query = clientId ? `?client_id=${clientId}` : "";
  return entry === "frame" ? `/app/financeos.html${query}#${tab}` : `/app/${file}${query}`;
}

export async function waitFor(done, ms = 4000) {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25));
  if (!done()) throw new Error("timed out waiting for the page");
}
