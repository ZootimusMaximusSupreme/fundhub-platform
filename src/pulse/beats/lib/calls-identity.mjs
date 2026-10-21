// Who is a real customer on a booked call: four small pure tests, copied from app code.
//
// A lib file may import only sibling lib files, so the join-link check (lib/calls-truth.mjs) cannot
// load the app modules these come from. Each function below is a copy, word for word except for the
// one noted change, and beat-call-bookings.test.mjs fails the day a copy gives a different answer
// from its source on a grid of addresses and payloads:
//
//   classifyVisitor        src/slo/visitor.mjs
//   emailLooksLikeProveSim src/messaging/gate.mjs
//   testEmailTag, isTestEmail  src/demo/test-identity.mjs (the env default is {} here, not process.env:
//                          a beat may not read process.env; the caller hands its env in)
//   isInterviewBooking     src/insights/meet.mjs
//
// No I/O. No imports.

const BOT_UA = /HeadlessChrome|Playwright|Puppeteer|PhantomJS|Headless|bot|crawler|spider|Bytespider|GPTBot/i;
const TEST_LOCAL = /(^|[.+_-])(e2e|sim|test)([.+_-]|$)/;

export function classifyVisitor({ email, userAgent, webdriver } = {}) {
  if (webdriver === true || webdriver === "true" || webdriver === 1) {
    return { actor: "agent", reason: "automated_browser" };
  }
  if (BOT_UA.test(String(userAgent || ""))) {
    return { actor: "agent", reason: "bot_browser" };
  }
  const mail = String(email || "").trim().toLowerCase();
  const at = mail.lastIndexOf("@");
  if (at > 0) {
    const local = mail.slice(0, at);
    const domain = mail.slice(at + 1);
    if (domain === "fundhub.ai") return { actor: "agent", reason: "company_email" };
    if (domain === "example.com" || domain === "example.net" || domain === "example.org") {
      return { actor: "agent", reason: "test_email" };
    }
    if (TEST_LOCAL.test(local)) return { actor: "agent", reason: "test_email" };
  }
  return { actor: "person", reason: "browser" };
}

export function emailLooksLikeProveSim(email) {
  const local = String(email || "").split("@")[0].toLowerCase();
  if (!local) return false;
  return local.startsWith("e2e+")
    || local.includes("+sim-")
    || local.includes("+colin-qa");
}

/** The tag, without its leading `+`. Empty string switches the mechanism off. */
export function testEmailTag(env = {}) {
  const raw = env.TEST_EMAIL_TAG;
  return raw === undefined ? "fhtest" : String(raw).trim().toLowerCase();
}

export function isTestEmail(email, { env = {} } = {}) {
  const tag = testEmailTag(env);
  if (!tag) return false;                       // explicitly disabled
  if (typeof email !== "string") return false;

  const at = email.lastIndexOf("@");
  if (at <= 0) return false;                    // no local part, or no domain
  const local = email.slice(0, at).toLowerCase();

  // Every `+`-delimited segment after the first. `a+b+c` -> ["b", "c"].
  const segments = local.split("+").slice(1);
  return segments.some((s) => s.startsWith(tag));
}

export function isInterviewBooking(payload = {}) {
  const blob = [
    payload.eventTypeSlug,
    payload.eventTypeTitle,
    payload.eventType,
    payload.title
  ].filter(Boolean).join(" ");
  return /interview|post-fund|insight/i.test(blob);
}
