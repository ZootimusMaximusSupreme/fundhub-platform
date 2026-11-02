/* Which {{merge tags}} a template body may use, and which of them the renderer
 * can actually fill in.
 *
 * WHY THIS EXISTS. A merge tag is a placeholder — {{contact.first_name}} — that
 * gets swapped for a real value just before a message goes out. If the tag names
 * something the renderer cannot find, src/lib/render-template.mjs substitutes an
 * empty string and warns to the log. Nobody reads that log, so the failure is
 * invisible: the client gets "Hey , quick update" and everything downstream
 * reports success. The template editor is the first place a person types these
 * by hand, so it is the first place that failure can be caught before it ships.
 *
 * THE THREE VERDICTS, AND WHY IT IS NOT JUST OK/NOT-OK.
 *
 *   resolvable    The renderer definitely fills this in. These come off the
 *                 `clients` table via clientContext() in src/workflows/messaging
 *                 .mjs, which is the ONLY context every send path supplies.
 *
 *   unverifiable  Might work, cannot be proven from here. Two cases, both real
 *                 in copy that is already live:
 *                   contact.<anything else> — clientContext spreads the
 *                     clients.custom_fields jsonb into `contact`, and that bag
 *                     holds the 252 ported CRM fields. Whether a given one is
 *                     populated is a per-client fact, not a schema fact.
 *                   custom_fields.* and CLIENT_PORTAL_URL — these are used by
 *                     seeded copy today and DO NOT RESOLVE: nothing supplies a
 *                     `custom_fields` root or that constant, so they render
 *                     blank right now. They are warned rather than blocked by
 *                     an explicit owner decision (2026-08-01): blocking them
 *                     would make templates that already exist impossible to
 *                     edit at all, which fixes nothing and breaks the screen.
 *
 *   unknown       Nothing supplies this under any name. Blocked — but see
 *                 classifyChange() for the one case where it is only warned.
 *
 * PRE-EXISTING UNKNOWNS ARE NOT THE EDITOR'S TO PUNISH. If a row already holds
 * {{user.name}}, refusing every save until someone deletes it means a staff
 * member cannot fix a typo in that template, ever. So the rule is directional:
 * an unknown tag the save INTRODUCES is refused, an unknown tag that was already
 * in the stored copy is reported and allowed through. The editor can never make
 * a template worse than it found it, which is the property that actually
 * matters.
 */

// Matches src/lib/render-template.mjs's TOKEN_RE exactly. If that pattern ever
// changes, this one has to change with it — a tag this file cannot see is a tag
// it cannot check, and the check would pass while the send rendered blank.
const TOKEN_RE = /\{\{\s*(\w+(?:\.\w+)*)\s*\}\}/g;

/* What clientContext() in src/workflows/messaging.mjs puts on `contact`, spread
   AFTER the custom_fields bag so these six always win. Anything here is filled
   from a typed column on `clients` and is as close to guaranteed as this gets. */
export const RESOLVABLE_TAGS = Object.freeze([
  "contact.first_name",
  "contact.last_name",
  "contact.name",
  "contact.full_name",
  "contact.email",
  "contact.phone",
  "portal_login_url",
  /* portal_url — the client portal itself, /app/client-portal.html?email=…,
     added 2026-08-29 with the owner's "just send it to the portal" call. It is
     a SECOND destination, not a rename: portal_login_url is the sign-in form and
     is still what db/seed/009 and db/migrations/253 use. Both are filled by
     clientContext() in src/workflows/messaging.mjs, so both are resolvable. */
  "portal_url"
]);

/* Roots that are known-used and known-unresolved. Warned, never blocked — the
   owner decision above. Kept as an explicit list rather than "anything we don't
   recognise" so that adding a third one is a deliberate edit somebody reviews. */
export const WARN_ONLY_TAGS = Object.freeze(["CLIENT_PORTAL_URL"]);
export const WARN_ONLY_PREFIXES = Object.freeze(["custom_fields."]);

/* Roots a specific send path supplies through sendTemplated's `context`, rather
 * than clientContext() supplying them for every send.
 *
 * These are NOT the same thing as WARN_ONLY_PREFIXES above, and merging them
 * would tell a person the wrong thing. A tag under custom_fields. resolves
 * NOWHERE — it sends blank today. A tag under one of these resolves reliably in
 * the one template it was written for, and blank in any other, so the warning a
 * person needs is "this only works here", not "this is broken".
 *
 * `only` names that template so the editor can say which one.
 *
 * Adding to this list is a deliberate edit, same discipline as WARN_ONLY_TAGS:
 * a root nobody supplies would render blank while claiming it does not. */
export const CONTEXT_PREFIXES = Object.freeze([
  Object.freeze({
    prefix: "magic_link.",
    only: "EMAIL-PORTAL-MAGIC-LINK / EMAIL-S04-01-CONFIRM",
    supplied_by: "src/auth/magic-link.mjs"
  }),
  Object.freeze({
    prefix: "portal_claim.",
    only: "SMS-S04-01-CONFIRM / EMAIL-S04-01-CONFIRM",
    supplied_by: "src/workflows/s-04b-booking-reminders.mjs"
  }),
  Object.freeze({
    prefix: "repair.",
    only: "EMAIL-REPAIR-*",
    supplied_by: "src/repair/notify.mjs"
  })
]);

const contextPrefixFor = (tag) =>
  CONTEXT_PREFIXES.find((c) => tag.startsWith(c.prefix) && tag.length > c.prefix.length) || null;

const RESOLVABLE = new Set(RESOLVABLE_TAGS);
const WARN_EXACT = new Set(WARN_ONLY_TAGS);

/** extractTags — every distinct merge tag in a piece of copy, in first-seen
    order. Null/undefined subject is normal (SMS has none) and yields []. */
export function extractTags(text) {
  const seen = new Set();
  if (text == null) return [];
  for (const m of String(text).matchAll(TOKEN_RE)) {
    if (!seen.has(m[1])) seen.add(m[1]);
  }
  return [...seen];
}

/** classifyTag — one tag's verdict. See the header for what each means. */
export function classifyTag(tag) {
  const t = String(tag || "").trim();
  if (!t) return "unknown";
  if (RESOLVABLE.has(t)) return "resolvable";
  if (WARN_EXACT.has(t)) return "unverifiable";
  if (WARN_ONLY_PREFIXES.some((p) => t.startsWith(p) && t.length > p.length)) return "unverifiable";
  // Supplied by one send path. Real where it belongs, blank anywhere else —
  // which is a warning, not a block: see CONTEXT_PREFIXES.
  if (contextPrefixFor(t)) return "unverifiable";
  // A dotted path under `contact` may be one of the 252 ported custom fields.
  // Bare `contact` is not — it resolves to the object itself, which the renderer
  // refuses to stringify (it would send "[object Object]"), so it is unknown.
  if (t.startsWith("contact.") && t.length > "contact.".length) return "unverifiable";
  return "unknown";
}

/** classifyCopy — every tag in a subject+body pair, grouped by verdict. */
export function classifyCopy({ subject = null, body = "" } = {}) {
  const tags = [...new Set([...extractTags(subject), ...extractTags(body)])];
  const out = { resolvable: [], unverifiable: [], unknown: [], all: tags };
  for (const t of tags) out[classifyTag(t)].push(t);
  return out;
}

/* classifyChange — the check a save actually runs.
   `next` is what the person typed; `previous` is what the row holds now.

   Returns { ok, blocking, warnings, tags }. `blocking` is the unknown tags this
   save would ADD; `warnings` is everything a person should see but that does not
   stop the save — unverifiable tags, plus unknown tags that were already there.

   Passing no `previous` (a brand-new template) makes every unknown tag blocking,
   which is right: there is no pre-existing copy to grandfather. */
export function classifyChange(next, previous = null) {
  const now = classifyCopy(next);
  const before = previous ? new Set(classifyCopy(previous).all) : new Set();

  const blocking = now.unknown.filter((t) => !before.has(t));
  const grandfathered = now.unknown.filter((t) => before.has(t));

  const warnings = [
    ...now.unverifiable.map((tag) => {
      const ctx = contextPrefixFor(tag);
      return {
        tag,
        reason: ctx
          ? `this tag is filled in only by the ${ctx.only} email — anywhere else it sends as blank`
          : WARN_EXACT.has(tag) || WARN_ONLY_PREFIXES.some((p) => tag.startsWith(p))
            ? "this tag does not resolve today — it will send as blank"
            : "this may be one of the imported CRM fields; it fills in only if that client has a value"
      };
    }),
    ...grandfathered.map((tag) => ({
      tag,
      reason: "this tag was already in the saved copy and does not resolve — it sends as blank"
    }))
  ];

  return {
    ok: blocking.length === 0,
    blocking,
    warnings,
    tags: now
  };
}

/* AVAILABLE_TAGS — what the editor lists as "tags you can use here", with the
   plain-language description a non-technical person needs. Order is the order
   the screen shows them in. */
export const AVAILABLE_TAGS = Object.freeze([
  { tag: "contact.first_name", label: "First name", example: "Marcus" },
  { tag: "contact.last_name", label: "Last name", example: "Webb" },
  { tag: "contact.name", label: "Full name", example: "Marcus Webb" },
  { tag: "contact.full_name", label: "Full name (same as above)", example: "Marcus Webb" },
  { tag: "contact.email", label: "Email address", example: "marcus@example.com" },
  { tag: "contact.phone", label: "Phone number", example: "+15551234567" },
  { tag: "portal_login_url", label: "Portal sign-in URL (email prefilled)", example: "https://fundhub.ai/portal-login.html?email=marcus%40example.com" },
  { tag: "portal_url", label: "Client portal (signed-out visitors are sent to sign in)", example: "https://fundhub.ai/app/client-portal.html?email=marcus%40example.com" }
]);

/* SAMPLE_CONTEXT — what Preview fills the tags with. Deliberately obvious fake
   data: a preview that looks like a real client is a preview somebody screenshots
   into a compliance file by mistake. */
export const SAMPLE_CONTEXT = Object.freeze({
  contact: Object.freeze({
    first_name: "Marcus",
    last_name: "Webb",
    name: "Marcus Webb",
    full_name: "Marcus Webb",
    email: "marcus@example.com",
    phone: "+15551234567"
  })
});
