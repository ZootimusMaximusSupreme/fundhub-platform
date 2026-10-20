// Extract, FROM THE CODE, who can actually reach what.
//
// CLAUDE.md §4: "Generate `-actual.md` from code, never from the spec or from
// memory. If you cannot trace a path in the code, mark it UNVERIFIED in the
// diagram. Do not draw what you assume."
//
// This file is the "from code" half, and it is deliberately literal. It reads
// four things and infers nothing else:
//
//   1. netlify/functions/api.mjs  — the ROUTES map. A handler absent from that
//      map is unreachable, so the map is the definition of "what exists".
//   2. src/http/read-api.mjs      — the ROLE_SETS values, so a journey says
//      "owner, admin" and not "FINANCE", which means nothing to a reader.
//   3. each api/*.mjs handler     — its own gate.
//   4. two shared wrappers        — partner-read-api.mjs and dashboard-auth.mjs,
//      whose gates are read from THEIR source, not hardcoded here.
//
// WHAT IT WILL NOT DO. When a handler's gate does not match a known shape, this
// returns kind "unverified" with the reason. It never guesses, never falls back
// to "probably staff", and never omits the route to keep the picture tidy. An
// unverified gate is a finding — possibly a real hole — and hiding it in a
// generator would be the most expensive kind of quiet.
//
// PARSED, NOT IMPORTED. Importing the adapter would execute every handler
// module's imports; a docs generator that fails because an unrelated handler has
// a broken import is a docs generator nobody runs. Text is enough here because
// the shapes are small and fixed, and anything unfamiliar is reported rather
// than assumed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(REPO, rel));

/* Strip // line comments and block comments before matching.
   Every file in this repo carries long comment headers that discuss the very
   gates being detected — api/read/tradelines.mjs's header quotes the BROKEN
   `{ roles: ROLE_SETS.STAFF }` call that shipped. Matching against prose would
   read that comment as the gate and report the opposite of the truth. */
// ORDER MATTERS HERE, and getting it wrong silently produced an empty routing
// table on the first run. netlify/functions/api.mjs has this line in its header:
//
//     // One function serves every /api/* path (config.path below).
//
// The `/*` inside `/api/*` opens a block comment as far as a regex is concerned.
// Stripping block comments FIRST therefore ate everything from the header down to
// the next `*/` — every import statement in the file — and the extractor reported
// 48 unverified routes with "handler file ? not found on disk" rather than
// failing. So: whole-line `//` comments go first, and only then block comments.
//
// The line filter is anchored to the start of the line on purpose. Stripping a
// `//` anywhere would truncate any line holding a URL.
export function code(src) {
  return src
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/* ---------------------------------------------------------------------------
   1. The routing table — key → handler file
   ------------------------------------------------------------------------ */

/** routes() → [{ key, file }] for every exact ROUTES entry. */
export function routes() {
  const src = code(read("netlify/functions/api.mjs"));

  // identifier → api/... path
  const imports = new Map();
  for (const m of src.matchAll(/import\s+(?:\{[^}]*\bas\s+(\w+)\s*\}|(\w+))\s+from\s+"\.\.\/\.\.\/(api\/[^"]+)"/g)) {
    imports.set(m[1] || m[2], m[3]);
  }

  const body = /export const ROUTES = \{([\s\S]*?)\n\};/.exec(src);
  if (!body) throw new Error("extract: could not find the ROUTES literal in netlify/functions/api.mjs");

  const out = [];
  for (const m of body[1].matchAll(/"([^"]+)"\s*:\s*(\w+)/g)) {
    out.push({ key: m[1], file: imports.get(m[2]) || null, identifier: m[2] });
  }
  return out;
}

/* Reached by a prefix branch in the adapter's handler() rather than an exact
   key. Named here because "absent from ROUTES" must not read as "unreachable"
   for these — the same list src/http/routes.test.mjs keeps, for the same reason. */
export const PREFIX_ROUTED = [
  { key: "webhooks/:provider", file: "api/webhooks/[provider].mjs" },
  { key: "documents/:id", file: "api/documents/[id].mjs" },
  { key: "inngest", file: "api/inngest.mjs" }
];

/* ---------------------------------------------------------------------------
   2. ROLE_SETS, resolved to actual role names
   ------------------------------------------------------------------------ */

/** roleSets() → { STAFF: ["owner", ...], ... } */
export function roleSets() {
  const src = code(read("src/http/read-api.mjs"));
  const block = /export const ROLE_SETS = \{([\s\S]*?)\n\};/.exec(src);
  if (!block) throw new Error("extract: could not find ROLE_SETS in src/http/read-api.mjs");

  const sets = {};
  for (const m of block[1].matchAll(/(\w+)\s*:\s*new Set\(\[([^\]]*)\]\)/g)) {
    sets[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  }
  return sets;
}

/* THERE IS NO IMPLICIT SUPER-ROLE ON THE READ PATH, and this matters enough to
   state. There are TWO different requireRole functions in this repo:

     src/http/read-api.mjs           requireRole(res, staff, roleSet)
       — plain set membership. No super-role.
     src/http/middleware/requireRole.mjs  requireRole(...allowed)
       — has SUPER_ROLES = ["owner"], so owner passes every gate.

   The endpoints in api/ use the FIRST one. Owner reaches everything only because
   "owner" is written into each ROLE_SETS value by hand. If someone removes it
   from one, the owner loses that route — there is no safety net. A journey that
   quietly added owner everywhere would hide that. */
export function superRoleApplies() {
  const src = code(read("src/http/read-api.mjs"));
  return /SUPER_ROLES/.test(src);
}

/* ---------------------------------------------------------------------------
   3. Wrapper gates — read from the wrapper's own source
   ------------------------------------------------------------------------ */

function principalsFromRequirePrincipal(src) {
  const clean = code(src);
  let m = /requirePrincipal\(\s*req\s*,\s*res\s*,\s*\[([^\]]*)\]/.exec(clean);
  if (!m) {
    // Dependency-injected handlers keep the production gate as the fallback:
    //   const auth = deps.requirePrincipal ?? requirePrincipal;
    //   await auth(req, res, ["staff"], ...)
    // Follow that alias instead of reporting the route as unverified. The
    // fallback name is required here, so an arbitrary injected function does
    // not get mistaken for an authentication gate.
    const alias = /const\s+(\w+)\s*=\s*deps\.requirePrincipal\s*(?:\?\?|\|\|)\s*requirePrincipal\s*;/.exec(clean);
    if (alias) {
      m = new RegExp(`${alias[1]}\\(\\s*req\\s*,\\s*res\\s*,\\s*\\[([^\\]]*)\\]`).exec(clean);
    }
  }
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** The gates of the shared wrappers, traced rather than assumed. */
export function wrapperGates() {
  const out = {};

  if (exists("src/http/partner-read-api.mjs")) {
    const kinds = principalsFromRequirePrincipal(read("src/http/partner-read-api.mjs"));
    out.partnerReadHandler = kinds
      ? { principals: kinds, note: "via src/http/partner-read-api.mjs" }
      : { unverified: "partner-read-api.mjs has no requirePrincipal call this parser recognises" };
  }

  if (exists("src/http/dashboard-auth.mjs")) {
    const src = code(read("src/http/dashboard-auth.mjs"));
    const secretFallback = /DASHBOARD_SECRET/.test(src);
    out.requireDashboardAccess = {
      principals: ["staff"],
      note: secretFallback
        ? "via src/http/dashboard-auth.mjs — staff session, OR a DASHBOARD_SECRET shared-secret fallback"
        : "via src/http/dashboard-auth.mjs",
      sharedSecretFallback: secretFallback
    };
  }

  return out;
}

/* ---------------------------------------------------------------------------
   4. One handler's gate
   ------------------------------------------------------------------------ */

/**
 * gateFor(file, { sets, wrappers }) → {
 *   kind, roles[]|null, principals[]|null, note, unverified?
 * }
 *
 * kind is one of:
 *   "role-set"       readHandler({ roles: ROLE_SETS.X }) or requireRole(..., ROLE_SETS.X)
 *   "explicit-roles" a hand-written Set of role names in the handler
 *   "principal"      requirePrincipal, gated by KIND rather than role
 *   "wrapper"        gate lives in a shared wrapper, traced above
 *   "open"           no session gate at all, by design
 *   "unverified"     the parser does not recognise the shape — a finding
 */
export function gateFor(file, ctx) {
  return narrowStaff(primaryGate(file, ctx), file, ctx);
}

function primaryGate(file, { sets, wrappers }) {
  if (!file || !exists(file)) {
    return { kind: "unverified", roles: null, principals: null, note: `handler file ${file || "?"} not found on disk` };
  }
  const src = code(read(file));

  // Shared wrappers first: the handler delegates and has no gate of its own.
  for (const [name, gate] of Object.entries(wrappers)) {
    if (new RegExp(`\\b${name}\\b`).test(src)) {
      if (gate.unverified) return { kind: "unverified", roles: null, principals: null, note: gate.unverified };
      return {
        kind: "wrapper", roles: null, principals: gate.principals,
        note: gate.note, sharedSecretFallback: !!gate.sharedSecretFallback
      };
    }
  }

  const resolveSet = (expr) => {
    const named = /^ROLE_SETS\.(\w+)$/.exec(expr);
    if (named) return sets[named[1]] ? { roles: sets[named[1]], label: `ROLE_SETS.${named[1]}` } : null;
    // A hand-written const in the same file: const X_ROLES = new Set([...]).
    const local = new RegExp(`const\\s+${expr}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]\\)`).exec(src);
    if (local) return { roles: [...local[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]), label: expr };
    /* A LOCAL NAME FOR A SHARED SET: const CARD_ROLES = ROLE_SETS.FINANCE.
       The eight api/finance/* handlers all gate this way — they alias the shared
       set to a name that says what the endpoint is, then gate on the alias. Both
       halves were already resolvable on their own and the alias between them was
       not, so every one of those endpoints extracted as "unverified" and the
       journey drew a gate it could not see. Resolved by following the alias to
       the set it names, so the diagram reports the roles that actually apply
       rather than an honest shrug. */
    const alias = new RegExp(`const\\s+${expr}\\s*=\\s*(ROLE_SETS\\.\\w+)\\s*;`).exec(src);
    if (alias) {
      const target = resolveSet(alias[1]);
      if (target) return { roles: target.roles, label: `${expr} (${target.label})` };
    }
    /* A GATE THAT CHANGES WITH THE METHOD:
         const gate = method === "GET" ? ROLE_SETS.STAFF : ROLE_SETS.FINANCE
       api/banking/accounts.mjs reads with one set and writes with a narrower one
       from a single handler. Reported as the UNION, because the question a
       journey answers is "who can reach this route at all" and the answer is
       everyone in either arm — reporting only the write set would draw the
       endpoint as closed to the roles that can in fact read it. The label names
       both sets so the narrower arm is not lost to a reader. */
    const byMethod = new RegExp(
      `const\\s+${expr}\\s*=\\s*[^;]*?\\?\\s*(ROLE_SETS\\.\\w+)\\s*:\\s*(ROLE_SETS\\.\\w+)\\s*;`
    ).exec(src);
    if (byMethod) {
      const a = resolveSet(byMethod[1]);
      const b = resolveSet(byMethod[2]);
      if (a && b) {
        return {
          roles: [...new Set([...a.roles, ...b.roles])],
          label: `${expr} — ${a.label} or ${b.label}, by method`
        };
      }
    }
    return null;
  };

  // readHandler({ roles: X, principals: new Set([...]) })
  //
  // Scanned over the WHOLE FILE rather than by bracket-matching the call. The
  // call appears both as a one-liner (api/hiring/application.mjs) and spread over
  // many lines with nested braces in the `fetch` arrow (api/read/products.mjs),
  // and any regex that tries to find the call's closing brace gets one of those
  // two wrong. There is exactly one readHandler call per handler file, so a
  // file-wide scan for its keys is unambiguous and survives both shapes.
  if (/readHandler\(\{/.test(src)) {
    const rolesExpr = /roles:\s*([\w.]+)/.exec(src);
    const principals = /principals:\s*new Set\(\[([^\]]*)\]\)/.exec(src);
    const resolved = rolesExpr ? resolveSet(rolesExpr[1]) : null;
    if (!resolved) {
      return { kind: "unverified", roles: null, principals: null,
        note: `readHandler with an unresolvable roles value: ${rolesExpr ? rolesExpr[1] : "none given"}` };
    }
    /* readHandler calls requirePrincipal(req, res, ["staff", ...principals]) —
       src/http/read-api.mjs:194. So the effective kinds ALWAYS include staff,
       and reading only the declared list would wrongly show an endpoint as
       closed to employees. Reconstructed here rather than assumed. */
    const declared = principals ? [...principals[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
    return {
      kind: "role-set",
      roles: resolved.roles,
      principals: declared ? ["staff", ...declared] : null,
      note: `readHandler, roles ${resolved.label}` +
            (declared ? `, also open to ${declared.join(", ")} by principal kind` : "")
    };
  }

  /* A SIGNED PUBLIC DOOR MAY SHARE ITS HANDLER WITH A STAFF-ONLY ACTION.
     Read this before the ordinary staff gates below. Otherwise adding a
     requireAuth branch for one action makes the extractor hide the signed
     public door for every other method. api/soft-pull-approve.mjs is the
     concrete case: GET and the consent POST use an expiring signed link, while
     stamp_incorporated is a separate staff action in the same file. */
  const signedToken = /verify\w*(Token|Url|Request)\s*\(/.test(src) && /\bsig\b/.test(src) && /\bexp\b/.test(src);
  if (signedToken) {
    const staffBranch = /require(Auth|Role|Principal)/.test(src);
    return {
      kind: "verified-other", roles: null, principals: null, verifiedBy: "signed link",
      note: "no sign-in needed, and NOT open — the link carries a signature and an expiry, " +
            "and the check fails closed when either is missing" +
            (staffBranch
              ? ". A SECOND DOOR on the same path is staff-only, behind the ordinary session gate"
              : "")
    };
  }

  /* THE OTHER requireRole. src/http/middleware/requireRole.mjs exports a CURRIED
     form — requireRole("a","b")(req,res) — and unlike read-api.mjs's version it
     has SUPER_ROLES, so an owner passes it without being named. api/inquiry.mjs
     is the one endpoint using it. Reporting its allowed set without the implicit
     owner would understate who can reach it, which is the kind of error a journey
     exists to prevent. */
  const curried = /requireRole\(\s*((?:"[^"]+"\s*,?\s*)+)\)\s*\(\s*req\s*,\s*res/.exec(src);
  if (curried) {
    const named = [...curried[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const supers = middlewareSuperRoles();
    const all = [...new Set([...named, ...supers])];
    return {
      kind: "role-set", roles: all, principals: ["staff"],
      note: `requireRole(${named.join(", ")}) from src/http/middleware/requireRole.mjs` +
            (supers.length ? ` — plus ${supers.join(", ")} via SUPER_ROLES` : "")
    };
  }

  // requirePrincipal is the entry gate when both it and requireRole are present.
  // requireRole then only limits the staff kind. Reading requireRole first would
  // hide partner/affiliate access on Brand Studio and partner pages.
  const kinds = principalsFromRequirePrincipal(src);
  if (kinds) {
    const localSet = /const\s+(\w*ROLES)\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(src);
    if (localSet) {
      return {
        kind: "explicit-roles",
        roles: [...localSet[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]),
        principals: kinds,
        note: `requirePrincipal(${kinds.join(", ")}), staff further limited by ${localSet[1]}`
      };
    }
    return { kind: "principal", roles: null, principals: kinds, note: `requirePrincipal(${kinds.join(", ")})` };
  }

  // requireRole(res, staff, X) — the SECOND call, after requireAuth.
  const rr = /requireRole\(\s*res\s*,\s*staff\s*,\s*([\w.]+)\s*\)/.exec(src);
  if (rr) {
    const resolved = resolveSet(rr[1]);
    if (!resolved) {
      return { kind: "unverified", roles: null, principals: null, note: `requireRole with an unresolvable set: ${rr[1]}` };
    }
    return { kind: "role-set", roles: resolved.roles, principals: null, note: `requireAuth + requireRole, ${resolved.label}` };
  }

  // requireAuth with no role gate: any signed-in employee, any role.
  if (/requireAuth\(\s*req\s*,\s*res/.test(src)) {
    return { kind: "role-set", roles: sets.STAFF ? ["any signed-in employee"] : null, principals: ["staff"],
      note: "requireAuth only — ANY signed-in employee of ANY role", anyStaff: true };
  }

  /* NOT EVERY GATE IS A SESSION. Three routes here have no requireAuth and are
     nonetheless not open to the world, and reporting them as "anyone" would be a
     false claim in the dangerous direction — somebody reads the journey, sees the
     webhook endpoint listed as reachable by anyone, and either panics or, worse,
     believes it and builds on it.
     Each mechanism is detected from what the handler actually imports or calls. */
  if (/verifyDocumentUrl|signed-url/.test(src)) {
    return { kind: "verified-other", roles: null, principals: null, verifiedBy: "signed link",
      note: "no sign-in needed, and NOT open — the link itself is signed and expires, checked in constant time (src/documents/signed-url.mjs)" };
  }

  /* THE OTHER SIGNED LINK. A handler that calls a verify…Token() helper and
     reads both a signature and an expiry is gated the same way as the document
     links above — the link IS the credential — but it does not import
     src/documents/signed-url.mjs, so the branch above never saw it.
     api/soft-pull-approve.mjs is the one this was written for: the client
     approves a soft pull from an emailed link, with no account anywhere.

     Reported as unverified until now, which was the wrong answer in the
     dangerous direction: "we could not tell" reads to someone skimming the
     journey as "nobody has checked this", when in fact the link is signed and
     expires and fails closed on a missing field.

     Both halves are named, because this endpoint has two doors and a journey
     that mentions one is a journey that misleads. */
  /* Same shape, other names: api/contracts/sign.mjs calls verifyContractUrl()
     and api/public/unsubscribe.mjs calls verifyUnsubscribeRequest(), both over
     a sig and an exp, both failing closed. Matching only "…Token(" drew both
     as open to anyone, which understated the gate (hole 24, 2026-09-18). */
  /* The word "signature" must be in the CODE. "rawBody" alone is not a
     signature check: four public forms (api/public/education-enroll,
     funnel-checkout, optimize, survey-submit) read req.rawBody only to parse
     JSON, and import from src/messaging/providers/ or src/adapters/, so an
     `rawBody|signature` test drew them as "NOT open — provider signature"
     when nothing checks one. That is a false claim in the harmful direction
     (hole 24, 2026-09-18). */
  if (/signature/i.test(src) && /adapter|provider/i.test(src)) {
    return { kind: "verified-other", roles: null, principals: null, verifiedBy: "provider signature",
      note: "no sign-in — the sender is checked by verifying the provider's signature over the raw bytes, in the adapter" };
  }
  if (/inngest/i.test(file)) {
    return { kind: "verified-other", roles: null, principals: null, verifiedBy: "Inngest request signing",
      note: "no sign-in — served by Inngest's own handler, which verifies its request signing" };
  }

  /* The auth endpoints themselves. These are open BY DESIGN and each is open in
     its own specific way, so they are named rather than lumped together — "open"
     with no explanation on a login route reads like an oversight. */
  if (/\battachStaff\b/.test(src)) {
    return { kind: "open", roles: null, principals: null,
      note: "auth is OPTIONAL here — this endpoint reports whether a session exists, so it must answer either way" };
  }
  if (/\bbearerToken\b/.test(src)) {
    return { kind: "open", roles: null, principals: null,
      note: "no gate — it acts on whatever token is presented, which is what makes signing out possible with a bad session" };
  }

  // No session gate referenced at all.
  if (!/require(Auth|Role|Principal|DashboardAccess)/.test(src)) {
    return { kind: "open", roles: null, principals: null, note: "no session gate in this handler" };
  }

  return { kind: "unverified", roles: null, principals: null, note: "a gate is referenced but its shape was not recognised" };
}

/* A SECOND ROLE CHECK, AFTER THE ENTRY GATE (hole 24, 2026-09-18).
   Some handlers let the staff kind in at the entry gate and then refuse most
   roles with a 403 a few lines later. Reading only the entry gate drew those
   routes as open to every employee — for example the Specialist was shown
   reaching /api/social/oauth and five /api/partner-marketing/* routes, all of
   which answer a Specialist 403. Three literal shapes are read here. A check
   tied to one action or one method (contracts, messages-outbound,
   message-templates) is NOT one of them and does not narrow the route:

     1. `if (!NAME.has(<the caller's role>))` — the whole condition, nothing
        else — where NAME is a `new Set([...])` written in the same file.
        api/call-outcomes.mjs (CLOSER_ROLES), api/social/oauth.mjs (STAFF_OK).
     2. `if (x !== true && !hasRole(x, [...]))` — the dashboard shared-secret
        idiom. hasRole passes SUPER_ROLES, so those are added. dashboard/seed.
     3. canAccessPartnerMarketing(...) — the roles it admits are read from its
        own source in src/brand/meter.mjs, not written here.
     4. `if (<role> !== "closer" && !allowsRole(ROLE_SETS.FINANCE, <role>))` —
        an && chain of two or more terms, each either `<role> !== "x"` or
        `!allowsRole(ROLE_SETS.X, <role>)`. The caller is refused only when
        every term holds, so the roles let through are the UNION of the named
        roles and sets. api/read/my-numbers.mjs ("My numbers is for closers.",
        hole 24 round 2). A lone `!allowsRole(...)` is NOT read: in that same
        file it guards only the ?staff_id= branch, and in api/finance/alerts.mjs
        only one action. Any term not in those forms skips the whole check.
        Three more term forms are read the same way (hole 24, fix run 2 —
        api/repair/exceptions.mjs was drawn open to every employee):
          `!NAME.has(<role>)`, NAME a `new Set([...])` in the same file; a
            `...SUPER_ROLES` spread inside it adds the middleware's super roles.
          `!["a", "b"].includes(<role>)` — the listed roles.
          `!SUPER_ROLES.includes(<role>)` — the middleware's super roles. Its
            `.has(...)` / `.has?.(...)` lets NOBODY through: SUPER_ROLES is an
            array, so `.has?.()` is undefined and the term is always true.

   The result is the INTERSECTION with whatever the entry gate already allowed,
   so this can only ever remove roles, never add one. */
function narrowStaff(gate, file, { sets } = {}) {
  if (!["role-set", "explicit-roles", "principal", "wrapper"].includes(gate.kind)) return gate;
  if (gate.principals && !gate.principals.includes("staff")) return gate;
  const src = code(read(file));
  const limits = [];

  /* A principal-kind gate followed by the ordinary read-api role gate:
       requirePrincipal(req, res, ["staff", "client"])
       ...
       requireRole(res, staff, ROLE_SETS.FINANCE_OS)
     The client branch stays open, while only the named staff roles pass. The
     money/* handlers deliberately use this shape so clients can manage their
     own file without opening the same tools to every employee. */
  const roleGate = /requireRole\(\s*res\s*,\s*staff\s*,\s*ROLE_SETS\.(\w+)\s*\)/.exec(src);
  if (roleGate && sets?.[roleGate[1]]) {
    limits.push({ roles: sets[roleGate[1]], by: `requireRole(ROLE_SETS.${roleGate[1]})` });
  }

  for (const cond of ifConditions(src)) {
    const m = /^!\s*(\w+)\.has\(([\s\S]*)\)$/.exec(cond);
    if (!m || !balanced(m[2]) || !/\.role\b|\brole\b/.test(m[2])) continue;
    const set = new RegExp(`const\\s+${m[1]}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]\\)`).exec(src);
    if (set) limits.push({ roles: [...set[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]), by: `${m[1]}.has(role)` });
  }

  const secretIdiom = /(\w+)\s*!==\s*true\s*&&\s*!hasRole\(\s*\1\s*,\s*\[([^\]]*)\]\s*\)/.exec(src);
  if (secretIdiom) {
    const named = [...secretIdiom[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    limits.push({ roles: [...new Set([...named, ...middlewareSuperRoles()])], by: "hasRole" });
  }

  if (/\bcanAccessPartnerMarketing\s*\(/.test(src)) {
    const roles = partnerMarketingRoles();
    if (roles) limits.push({ roles, by: "canAccessPartnerMarketing (src/brand/meter.mjs)" });
  }

  for (const cond of ifConditions(src)) {
    const terms = topLevelAnd(cond);
    if (terms.length < 2) continue;
    const allowed = terms.map((t) => {
      const lit = /^(?:String\(\s*)?[\w.]*\brole\s*\)?(?:\.toLowerCase\(\))?\s*!==\s*"([^"]+)"$/.exec(t);
      if (lit) return [lit[1]];
      const inSet = /^!\s*allowsRole\(\s*ROLE_SETS\.(\w+)\s*,\s*[\w.]*\brole\s*\)$/.exec(t);
      if (inSet) return sets && sets[inSet[1]] ? sets[inSet[1]] : null;
      const quoted = (s) => [...s.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      const supers = /^!\s*SUPER_ROLES\.(has|includes)(?:\?\.)?\(\s*[\w.]*\brole\s*\)$/.exec(t);
      if (supers) return supers[1] === "includes" ? middlewareSuperRoles() : [];
      const localHas = /^!\s*(\w+)\.has(?:\?\.)?\(\s*[\w.]*\brole\s*\)$/.exec(t);
      if (localHas) {
        const set = new RegExp(`const\\s+${localHas[1]}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]\\)`).exec(src);
        if (!set) return null;
        return [...quoted(set[1]), ...(/\.\.\.SUPER_ROLES\b/.test(set[1]) ? middlewareSuperRoles() : [])];
      }
      const listed = /^!\s*\[([^\]]*)\]\.includes\(\s*[\w.]*\brole\s*\)$/.exec(t);
      return listed ? quoted(listed[1]) : null;
    });
    if (allowed.every(Boolean)) {
      limits.push({ roles: [...new Set(allowed.flat())], by: `if (${terms.join(" && ")})` });
    }
  }

  if (!limits.length) return gate;
  let roles = gate.anyStaff ? null : gate.roles;
  for (const l of limits) roles = roles ? roles.filter((r) => l.roles.includes(r)) : [...l.roles];
  if (gate.roles && roles.length === gate.roles.length) return gate;
  const { anyStaff, ...rest } = gate;
  return { ...rest, roles, note: `${gate.note}; staff then limited to ${roles.join(", ")} by ${limits.map((l) => l.by).join(" and ")}` };
}

/* Every `if (…)` condition in the source, with its parentheses balanced. */
function ifConditions(src) {
  const out = [];
  for (const m of src.matchAll(/\bif\s*\(/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < src.length && depth; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    if (!depth) out.push(src.slice(start, i - 1).trim());
  }
  return out;
}

/* A condition split on its top-level `&&` — not on one inside a call's parentheses. */
function topLevelAnd(cond) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cond.length; i++) {
    if (cond[i] === "(") depth++;
    else if (cond[i] === ")") depth--;
    else if (!depth && cond.startsWith("&&", i)) {
      out.push(cond.slice(start, i).trim());
      start = i + 2;
      i++;
    }
  }
  out.push(cond.slice(start).trim());
  return out;
}

/* True when every "(" in s closes before s ends and no ")" closes early — so a
   `.has(` whose argument is s spans the WHOLE condition, with no `&& …` after. */
function balanced(s) {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

/** The staff roles canAccessPartnerMarketing admits, read from its source. */
function partnerMarketingRoles() {
  const rel = "src/brand/meter.mjs";
  if (!exists(rel)) return null;
  const body = /export function canAccessPartnerMarketing\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(code(read(rel)));
  if (!body) return null;
  const roles = [...body[1].matchAll(/role\s*===\s*"([^"]+)"/g)].map((x) => x[1]);
  return roles.length ? roles : null;
}

/* SUPER_ROLES from the middleware, read rather than assumed. Empty if the export
   ever goes away, which would silently narrow every curried gate — so the note
   above says "plus X" only when there really is an X. */
export function middlewareSuperRoles() {
  const rel = "src/http/middleware/requireRole.mjs";
  if (!exists(rel)) return [];
  const m = /export const SUPER_ROLES = \[([^\]]*)\]/.exec(code(read(rel)));
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
}

/* ---------------------------------------------------------------------------
   5. Which HTTP methods a handler answers
   ------------------------------------------------------------------------ */

export function methodsFor(file) {
  if (!file || !exists(file)) return [];
  const src = code(read(file));
  const found = new Set();
  for (const m of src.matchAll(/req\.method\s*===?\s*"(\w+)"/g)) found.add(m[1]);
  for (const m of src.matchAll(/setHeader\(\s*"allow"\s*,\s*"([^"]+)"/gi)) {
    for (const v of m[1].split(",")) found.add(v.trim());
  }
  if (/readHandler\(\{/.test(src) || /partnerReadHandler\(\{/.test(src)) found.add("GET");
  return [...found].filter(Boolean).sort();
}

/* ---------------------------------------------------------------------------
   6. The journeys themselves
   ------------------------------------------------------------------------ */

/* THE EIGHT TRACKED JOURNEYS, from CLAUDE.md §4, each tied to the thing in the
   code it actually describes — with the evidence for that tie, because two of
   these mappings are not obvious from the name and one of them does not exist.

   `subject` is either a staff.role value or a principal kind. `evidence` is
   where that mapping is established IN THE CODE, so a reader can check it
   rather than trust it. */
export const JOURNEYS = [
  { name: "client", type: "principal", subject: "client",
    evidence: "src/auth/account-session.mjs — PRINCIPAL_KINDS includes 'client'" },

  { name: "role-owner", type: "role", subject: "owner",
    evidence: "db/schema/001_init.sql — staff.role comment lists 'owner'" },

  { name: "role-sales-manager", type: "role", subject: "sales_manager",
    evidence: "src/http/read-api.mjs — ROLE_SETS.STAFF and ROLE_SETS.FINANCE both include " +
              "'sales_manager'; the catalog row, the task-routing CHECK and the demo login " +
              "come from db/migrations/112_sales_manager_role.sql. Built 2026-08-01 on the " +
              "owner's instruction in Ticket 8, which supersedes the 2026-07-31 decision to " +
              "defer it that this entry used to carry." },

  { name: "role-closer", type: "role", subject: "closer",
    evidence: "src/http/read-api.mjs — ROLE_SETS.STAFF includes 'closer'" },

  { name: "role-funding-advisor", type: "role", subject: "funding_advisor",
    evidence: "src/http/read-api.mjs — ROLE_SETS.STAFF includes 'funding_advisor'" },

  { name: "role-inquiry-remover", type: "role", subject: "inquiry_specialist",
    evidence: "the screen is the Inquiry Remover (src/http/inquiry-remover-view.mjs); " +
              "the role key behind it is 'inquiry_specialist' (src/http/read-api.mjs ROLE_SETS.STAFF, " +
              "and api/pii.mjs IDENTITY_ROLES). The journey is named for the product, the role for the column." },

  { name: "affiliate", type: "principal", subject: "affiliate",
    evidence: "src/auth/account-session.mjs — PRINCIPAL_KINDS includes 'affiliate'" },

  { name: "white-label", type: "principal", subject: "partner",
    evidence: "db/migrations/036_partner_role.sql — \"External white-label partner\"; " +
              "db/migrations/044_accounts.sql — \"partner — white-label operator, sees their own book only\"" }
];

/** Can this journey's subject reach this route? */
export function reaches(journey, gate) {
  if (gate.kind === "open") return { reachable: true, why: "no session gate" };
  if (gate.kind === "verified-other") {
    return { reachable: true, why: `no session gate — verified by ${gate.verifiedBy}` };
  }
  if (gate.kind === "unverified") return { reachable: null, why: "gate not verified" };

  if (journey.type === "role") {
    if (gate.anyStaff) return { reachable: true, why: "any signed-in employee" };
    if (gate.principals && !gate.principals.includes("staff")) {
      return { reachable: false, why: "employees are not an accepted principal kind here" };
    }
    if (!gate.roles) {
      return gate.principals && gate.principals.includes("staff")
        ? { reachable: true, why: "accepted as the staff kind, no role limit" }
        : { reachable: false, why: "no role admitted" };
    }
    return gate.roles.includes(journey.subject)
      ? { reachable: true, why: "role is in the allowed set" }
      : { reachable: false, why: "role is not in the allowed set" };
  }

  // A non-staff principal is admitted by KIND; roles do not apply to it.
  const kinds = gate.principals || [];
  return kinds.includes(journey.subject)
    ? { reachable: true, why: "principal kind is accepted" }
    : { reachable: false, why: "principal kind is not accepted" };
}

/** extractAll() → everything render.mjs needs, and nothing it has to re-derive. */
export function extractAll() {
  const sets = roleSets();
  const wrappers = wrapperGates();

  const all = [...routes().map((r) => ({ ...r, routing: "exact" })),
               ...PREFIX_ROUTED.map((r) => ({ ...r, routing: "prefix" }))];

  const endpoints = all.map((r) => ({
    ...r,
    gate: gateFor(r.file, { sets, wrappers }),
    methods: methodsFor(r.file)
  })).sort((a, b) => (a.key < b.key ? -1 : 1));

  return {
    endpoints,
    roleSets: sets,
    superRoleOnReadPath: superRoleApplies(),
    journeys: JOURNEYS,
    counts: {
      total: endpoints.length,
      unverified: endpoints.filter((e) => e.gate.kind === "unverified").length,
      open: endpoints.filter((e) => e.gate.kind === "open").length,
      verifiedOther: endpoints.filter((e) => e.gate.kind === "verified-other").length
    }
  };
}

export default { extractAll, routes, roleSets, gateFor, methodsFor, reaches, JOURNEYS, REPO };
