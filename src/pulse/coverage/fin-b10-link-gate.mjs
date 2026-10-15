// Finish-853 batch 10: the live check for display rows whose control is a link that the app's own link gate
// can hide. It is used by the display lane (gap-catalog-display.mjs) for contracts with mode "link-gate".
//
// THE RESULT BEING JUDGED. A link on a screen is useless if public/app/shell.js hides it from the people it
// is for. shell.js decides every in-page link by the list of screens each role may open (its `ALL` list and
// the small role lists stacked on it). The live check reads the DEPLOYED /app/shell.js with one GET, lifts
// those lists out, works out which staff roles may open each screen the control points at, and goes red when
// a role that must see the link cannot. It goes green by itself the day the list is fixed.
//
// WHY THE DEPLOYED FILE. The gate that matters is the one people load. A read of the checkout would say
// nothing about what is live.
//
// HONEST STATUS. A GET that fails, a non-200 answer, or a shell whose lists are no longer plain arrays is
// "skip" with the reason. Never PASS, and never a made-up FAIL.
//
// READ ONLY. One GET, no cookies, no body, no write, no send. This file reads no repo file at run time and
// imports nothing, so the live bundle carries it as it is.

/** The staff roles the app has, with the list builder shell.js `allowedFor()` uses for each. */
export const STAFF_ROLE_MODE = Object.freeze({
  owner: "*",
  admin: "admin",
  sales_manager: "sales_manager",
  closer: "closer",
  funding_advisor: "funding_advisor",
  csm: "csm",
  setter: "staff",
  inquiry_specialist: "staff",
});

/** The shell.js lists this check lifts out of the source. Every one must be a plain list of file names. */
export const SHELL_LIST_NAMES = Object.freeze([
  "ALL", "PRINCIPAL_ONLY", "OWNER_ADMIN_ONLY", "CLOSER_DESK_ONLY", "SALES_FLOOR_ONLY", "PORTAL_ONLY",
  "HIRING_ONLY", "FINANCE_ONLY", "ADVISOR_ONLY", "CONSENT_DESK_ONLY", "STAFF_MONEY", "ADMIN_BLOCKED",
]);

/**
 * The strings of `var <name> = [ ... ];` in a script, or null when the list is not a plain list of quoted
 * names. Comments inside the list are skipped (they hold prose with quotes, brackets and file names).
 */
export function plainList(source, name) {
  const head = new RegExp(`\\bvar\\s+${name}\\s*=\\s*\\[`).exec(source);
  if (!head) return null;
  const out = [];
  let i = head.index + head[0].length;
  while (i < source.length) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) return null;
      i = end + 2;
    } else if (c === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      if (end < 0) return null;
      i = end + 1;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let text = "";
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\\") { text += source[j + 1] ?? ""; j += 2; } else { text += source[j]; j += 1; }
        if (text.length > 120) return null;
      }
      if (j >= source.length) return null;
      out.push(text);
      i = j + 1;
    } else if (c === "]") {
      return out;
    } else if (c === "," || /\s/.test(c)) {
      i += 1;
    } else {
      return null;
    }
  }
  return null;
}

/** Every list the role model needs, or null when any one is missing or no longer a plain list. */
export function parseShellLists(source) {
  const text = String(source || "");
  const lists = {};
  for (const name of SHELL_LIST_NAMES) {
    const items = plainList(text, name);
    if (!items || (name === "ALL" && items.length < 10)) return null;
    lists[name] = items;
  }
  return Object.freeze(lists);
}

/** The screens a staff role may open: the same arithmetic as shell.js staffTabs() and allowedFor(). */
export function screensFor(lists, role) {
  const mode = STAFF_ROLE_MODE[role];
  if (!mode) throw new Error(`unknown staff role: ${role}`);
  const off = new Set([
    ...lists.PRINCIPAL_ONLY, ...lists.OWNER_ADMIN_ONLY, ...lists.CLOSER_DESK_ONLY, ...lists.SALES_FLOOR_ONLY,
    ...lists.PORTAL_ONLY, ...lists.HIRING_ONLY, ...lists.FINANCE_ONLY, ...lists.ADVISOR_ONLY, ...lists.CONSENT_DESK_ONLY,
  ]);
  const staff = () => lists.ALL.filter((screen) => !off.has(screen));
  if (mode === "*") return [...lists.ALL, ...lists.STAFF_MONEY];
  if (mode === "admin") return [...lists.ALL.filter((s) => !lists.ADMIN_BLOCKED.includes(s)), ...lists.STAFF_MONEY];
  if (mode === "closer") return [...staff(), ...lists.CLOSER_DESK_ONLY, ...lists.CONSENT_DESK_ONLY, ...lists.STAFF_MONEY];
  if (mode === "funding_advisor") return [...staff(), ...lists.ADVISOR_ONLY, ...lists.CONSENT_DESK_ONLY];
  if (mode === "sales_manager") return [...staff(), ...lists.SALES_FLOOR_ONLY, ...lists.FINANCE_ONLY, ...lists.STAFF_MONEY];
  if (mode === "csm") return [...staff(), ...lists.CONSENT_DESK_ONLY];
  return staff();
}

/** The staff roles that may open a screen, in the order of STAFF_ROLE_MODE. */
export function rolesThatCanOpen(lists, screen) {
  return Object.keys(STAFF_ROLE_MODE).filter((role) => screensFor(lists, role).includes(screen));
}

/**
 * One GET of the deployed shell. Resolves { lists, url } or { error }. GET only, redirects not followed.
 * ctx.fetchImpl and ctx.baseUrl are the same two knobs the retired-page check in the display lane uses.
 */
export async function linkGateState(ctx = {}) {
  const fetchImpl = Object.hasOwn(ctx, "fetchImpl") ? ctx.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== "function") return { error: "this run has no GET client" };
  try {
    const url = `${new URL(ctx.baseUrl || "https://fundhub.ai").origin}/app/shell.js`;
    const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (response.status !== 200) return { error: `the deployed shell answered ${response.status}` };
    const lists = parseShellLists(await response.text());
    if (!lists) return { error: "the deployed shell does not declare its screen lists as plain lists the check can read" };
    return { lists, url };
  } catch (error) {
    return { error: `the deployed shell could not be read by GET: ${String(error?.message || error).replace(/\s+/g, " ").slice(0, 120)}` };
  }
}

function result(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

/**
 * Judge one contract { control, requirement, links: [{ file, roles }] } against the gate state.
 * PASS only when every named screen may be opened by every named role. FAIL names each one that may not.
 */
export function judgeLinkGate(entry, gate) {
  const id = entry.id;
  const control = entry.control;
  const links = entry.contract?.links;
  if (!Array.isArray(links) || !links.length) {
    return result(id, "skip", `${control}: the contract names no screen to judge.`);
  }
  if (!gate || gate.error || !gate.lists) {
    const why = gate?.error || "the deployed shell was not read";
    return result(id, "skip", `${control} was not read: ${why}.`);
  }
  const broken = [];
  for (const { file, roles } of links) {
    const open = rolesThatCanOpen(gate.lists, file);
    const missing = roles.filter((role) => !open.includes(role));
    if (!missing.length) continue;
    broken.push(open.length === 0
      ? `${file} is hidden from every staff role (${missing.join(", ")} cannot press it)`
      : `${file} is hidden from ${missing.join(", ")} (it opens for ${open.join(", ")})`);
  }
  const names = links.map((link) => link.file).join(", ");
  if (!broken.length) {
    return result(id, "PASS", `${control}: every link (${names}) may be opened by ${[...new Set(links.flatMap((l) => l.roles))].join(" and ")} on the deployed link gate. ${entry.contract.requirement}`);
  }
  return result(
    id,
    "FAIL",
    `${control}: the deployed link gate hides the link, so no person can press it: ${broken.join("; ")}. Required: ${entry.contract.requirement}`,
    "Add the screen to the right role list in public/app/shell.js (the link on the page is fine, the gate hides it). Do not auto-fix. Chris fixes reds.",
  );
}
