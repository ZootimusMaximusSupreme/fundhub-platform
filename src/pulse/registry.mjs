// Live-path registry for the 7:00 a.m. pulse.
// Add a row in the same change as the feature. See .cursor/rules/pulse-registry.mdc.
// Completeness is enforced by registry.test.mjs (routes.test.mjs allow-list pattern).
// Audit only. GET pings. Never auto-fix. Never live CRS. Never charge a card.

export const ALLOWED_UNMONITORED = {
  "inngest": "Inngest serve() is not a GET uptime door. Liveness is the daily-pulse cron itself.",
  "webhooks/[provider]": "Signed webhook POST only. A GET ping is not uptime and can look like a replay.",
  "documents/[id]": "Per-document GET needs a real id and a signed-in caller. Not a desk ping.",
  "contracts/sign": "Signed contract link. GET without id/exp/sig answers 404 on purpose. That is not downtime.",
  /* SHELVED, NOT DOWN. The owner shelved the $27 Decline Autopsy on 2026-08-31
     and its three routes are commented out in netlify/functions/api.mjs on
     purpose. Pinging it anyway answered 404 in every pulse from 2026-09-18 to
     2026-10-05 and led Chris's morning text each day. TO UNSHELVE: restore the
     route lines there, then move this key back into API_KEYS below. */
  "public/decline-autopsy": "Shelved by the owner 2026-08-31 — its route is commented out in netlify/functions/api.mjs on purpose, so a GET answers 404 by design. That is a decision, not an outage. When the offer is unshelved and routed again, move this key back into API_KEYS so the sales-page door is watched.",
  "public/decline-autopsy-upload": "POST only — the paid autopsy_ref plus the merchant attestation are the credential. A GET answers 405 by design, and pinging it with a body would write somebody's declined-deal rows. The sales page at public/decline-autopsy becomes the monitored door for this offer once it is unshelved (shelved 2026-08-31, see its entry above).",
  "public/decline-autopsy-report": "Signed, expiring report link. A GET without org/ref/exp/sig answers 404 on purpose — and it answers that identically for a forged signature, so the endpoint cannot be used to find out which references exist. That refusal is correct behaviour, not downtime.",
  "public/vsl-watch": "POST only — it is the video player's own beacon, and the one door here a stranger can knock on. A GET answers 405 by design, which a ping would read as an outage, and pinging it with a body would file a viewing of the VSL that nobody watched: a made-up visitor, a made-up viewing, counted on every drop-off curve drawn from vsl_watch_sessions afterwards. There is no read sibling to watch in its place yet, because no screen reads this table — when one exists it becomes the monitored door for this surface.",
  "trials/provision": "POST only, owner/admin. A GET answers 405 by design, and pinging it with a body would create a partner row, an affiliate row and a login for a trial nobody bought. The eligibility gate and the live dashboard are the monitored doors for this offer.",
  "trials/convert": "POST only, owner/admin. A GET answers 405 by design, and pinging it with a body would stamp a partner agreement or pause a partner. Day 8 is a human decision, not an uptime probe.",
  "campaigns/meta-agency": "POST only. A GET answers 405 by design, and pinging it with a body would store a Meta Business id against a partner and fire a real agency-access request at Meta on their behalf. The monitored door for this surface is campaigns/connections, which reports whether the access actually landed.",
  "training-progress": "POST only, owner/admin. A GET answers 405 by design, and pinging it with a body would stamp a compliance certification against a partner nobody assessed. The monitored door for the training is read/partner-training, which is what a partner actually opens.",
  "push/unsubscribe": "POST or DELETE only — it is the control that switches a client's notifications off. A GET answers 405 by design, which a ping would read as an outage, and pinging it with a body would retire a real device. Its read sibling push/subscribe answers GET and is the monitored door for this pair.",
  "sidebar.fragment.html": "Shared chrome fragment mounted into other pages. Not a live desk.",
  "analytics/clickfunnels-connect": "POST only. A GET answers 405 by design, and pinging it with a body would try to save an org's ClickFunnels credential from whatever junk the pinger sent, and validates by calling the real ClickFunnels API before saving — a scheduled ping would burn a real API call against Chris's account every time it ran. The monitored door for this surface is read/funnel-pages, which reports the connection's real state.",
  "analytics/clickfunnels-sync": "POST only. A GET answers 405 by design, and pinging it with a body would trigger a real sync against ClickFunnels' API on a schedule nobody asked for, and updates last_synced_at/last_error whether or not anyone wanted a sync to run right then. The monitored door is read/funnel-pages.",
  "analytics/youtube-connect": "POST only, same reasoning as analytics/clickfunnels-connect — it exchanges a real OAuth refresh token with Google before saving, so a scheduled ping would spend a real Google API call. The monitored door is read/video-stats.",
  "analytics/youtube-sync": "POST only, same reasoning as analytics/clickfunnels-sync — it refreshes a real Google OAuth token and calls the YouTube Analytics API. The monitored door is read/video-stats.",
  "scripts/write": "POST only, staff. A GET answers 405 by design, which a ping would read as an outage, and pinging it with a body would file a junk ad script against the FundHub house partner and teach the label dictionary whatever words the pinger sent — every one of those rows then shows up in the ad spine as a real script nobody wrote. The monitored door for this surface is read/ad-spine, which reports the scripts and labels that actually landed.",
  "ops/weekly-brief": "POST only. A GET answers 405 by design, and pinging it with a body would generate a real brief every time — a real model call, a real write into Company Brain (brain_files/brain_chunks) — on whatever schedule the pulse runs, not the weekly cadence Chris actually wants. This is meant to be run when a person (or a job Chris explicitly schedules) asks for it, not pinged for uptime.",
  "public/slo-repair-checkout": "POST only. A GET answers 405 by design, and pinging it with a body would record a repair plan choice (and, off demo, mint a real Commas link) for a buyer. It also refuses anyone slo-status would not show the repair offer to. The monitored doors for this offer are public/slo-checkout and public/slo-status.",
  "public/slo-pull": "POST only. A GET answers 405 by design, and pinging it with a body would store identity (including SSN) against a paid SLO file and emit diagnostic.paid, which starts C-00. The monitored door for this offer is public/slo-checkout, which answers GET with the price.",
  "marketing/research/approve": "POST only, owner/admin. A GET answers 405 by design, and pinging it with a body would stamp Chris's approval on a research report nobody read. Its read sibling marketing/research answers GET and is the monitored door for the research card.",
  "marketing/research/tweak": "POST only, owner/admin. A GET answers 405 by design, and pinging it with a body would start a paid research run (model calls and web searches) that nobody asked for. The monitored door is marketing/research.",
  "marketing/research/brain": "POST only, owner/admin. A GET answers 405 by design, and pinging it with a body would write a report into Company Brain and pay for embedding it. The monitored door is marketing/research.",
  "marketing/flywheel/run": "POST only, owner/admin. A GET answers 405 by design, and pinging it with a body would start a paid flywheel run (model calls and web searches). Its job shows on marketing/research's sibling reads and on the health card (marketing/health), which is monitored.",
  "public/ad-video-approve": "The approval token in Chris's phone notification is the whole credential, so a GET without one answers 404 on purpose — and it answers that identically for a made-up token, an expired one and a spent one, so the door cannot be used to find out which tokens exist. A ping would read that correct refusal as an outage every single time. Pinging it with a body is worse: a POST is the decision, and it would approve or reject a filmed take that nobody watched. The monitored door for this surface is ad-videos, the staff queue, which answers GET and reports how many takes are waiting."
};

const API_KEYS = [
  "ad-videos",
  "adintel/board",
  "agent-call",
  "agents",
  "affiliates/refer",
  "ai-bureau-config",
  "applications",
  "auth/admin-reset",
  "auth/authorized-rep",
  "auth/authorized-rep-file",
  "auth/invite",
  "auth/login",
  "auth/logout",
  "auth/magic-link-verify",
  "auth/magic-link",
  "auth/reset",
  "auth/send-portal-link",
  "auth/session",
  "auth/staff-role",
  "auth/staff-update",
  "auth/suspend",
  "banking/accounts",
  "banking/revoke",
  "banking/sync-accounts",
  "bookings",
  "brand/review",
  "call-outcomes",
  /* An employee's own profile photo. GET is a real door — handleDownload
     serves it — so this is monitored rather than excused. Self-scoped: both
     halves act on req.staff.id and nothing else. */
  "staff/avatar",
  "campaigns/action-log",
  "campaigns/connections",
  "campaigns/detail",
  "campaigns/fatigue",
  /* Says which creative is running on an ad, and what our own ad number for it
     is (377). Monitored rather than excused, exactly like its sibling
     campaigns/write directly below: the pulse only ever sends GET, this handler
     answers a GET with 405, and isUp() counts 405 as up. So the ping proves the
     route is reachable and writes nothing. */
  "campaigns/link-asset",
  "campaigns/list",
  "campaigns/spend",
  "campaigns/sync",
  "campaigns/write",
  "chat/ask",
  "chat/messages",
  "chat/peers",
  "chat/portal-message",
  "client-notes",
  "climate/config",
  "climate/geocode",
  "climate",
  "closer-deck",
  "commission-rules",
  "commissions",
  "company-brain/reviews",
  "company-brain/sync",
  "company-brain/threads",
  "company-brain/upload",
  "consent/capture",
  "content/tiles",
  "content/upload",
  "content/welcome-video",
  "contracts",
  "creative/actions",
  "creative/approvals",
  "creative/brand-kits",
  "creative/generate",
  "creative/jobs",
  "creative/library",
  "creative/run",
  "customer-insights",
  "dashboard/client-archive",
  "dashboard/client",
  "dashboard/clients",
  "dashboard/kpis",
  "dashboard/pipeline-counts",
  "dashboard/pipeline",
  "dashboard/seed",
  "demo/mode",
  "demo/simulate",
  "documents-download",
  "documents-upload",
  "finance/alerts",
  "finance/bank-accounts",
  "finance/bills",
  "finance/cards",
  "finance/cashflow",
  "finance/crs-pull",
  "finance/entities",
  "finance/liabilities",
  "finance/model",
  "finance/paydown-simulator",
  "finance/soft-pull",
  "finance/subscriptions",
  "gifts/message-blaster",
  "health",
  "hiring/application",
  /* The public careers door. A plain GET answers 200 with the open roles and no
     session, so it is a real uptime probe — and the surface it proves is the one
     where being down is invisible to us and total to the person on it: if this
     fails, /careers.html shows "we could not load the roles" and nobody can
     apply for a job. Monitored on the GET; the POST is never pinged. */
  "hiring/apply",
  "hiring/bench",
  "hiring/candidates",
  "hiring/decide",
  "hiring/decisions",
  "hiring/funnel",
  "hiring/postings",
  "inquiries",
  "inquiry-cases",
  "inquiry",
  "journeys/ask",
  "journeys/run",
  "journeys",
  "lender-observations",
  "lenders",
  "marketing-flags",
  "marketing/offer/generate",
  "marketing/today",
  "message-templates",
  "messages-outbound",
  "messages",
  "ops/hire-closer",
  "org-brand",
  "partner-brand/verify-domain",
  "partner-brand",
  "partner-marketing/copy-history",
  "partner-marketing/enable",
  "partner-marketing/generate-copy",
  "partner-marketing/generate-logo",
  "partner-marketing/usage",
  "partner-pages",
  "partners/approve",
  /* The white-label add-on menu. A door that asks a partner for money and puts
     them on a monthly cycle, so an outage here is revenue not asked for. */
  "partner-addons",
  "payment-links",
  /* The self-serve paid round. A plain GET answers with the price list and
     whether this client may buy one, so it is a real uptime door: a client
     seeing "could not load" on a page with a price on it is an outage worth
     knowing about. The POST half is the one that mints a hosted checkout link,
     and a GET never touches it. */
  "paid-services",
  "pii",
  "pipeline-cards",
  "pipeline-clients",
  "privacy/erasure",
  "products",
  "proxy/end",
  "proxy/launch",
  "public/affiliate-click",
  /* The lending-climate lead magnet's match count, behind the /climate/ page. A
     plain GET answers 200 with how many active lenders the book holds, so it is
     a real uptime door: if this is down the page shows the map and can never
     give a visitor their number, which is the whole offer. */
  "public/climate-match",
  "public/education-enroll",
  /* The voluntary EEO self-ID form. GET never writes (the survey token is the
     credential, and a GET without one answers 400, which counts as up). */
  "public/eeo-survey",
  /* The self-serve till for the /partner/ funnel pages. A plain GET answers 200
     with every price those five pages render and whether checkout is actually
     configured, so it is a real uptime door: if this is down, three sales pages
     show an em dash where the price goes and their buy buttons stay disabled. */
  "public/funnel-checkout",
  "public/optimize",
  "public/partner-apply",
  "public/partner-page",
  /* The $297 SLO diagnostic till. A plain GET answers 200 with the price and
     whether Commas checkout is on, so it is a real uptime door: if this is
     down the sales page has no price and the pay button cannot mint a link. */
  "public/slo-checkout",
  /* Step 1 of /roadmap, saved before Pay. A plain GET answers 200 and writes
     nothing, so a ping cannot file a fake lead. */
  "public/slo-interest",
  /* RB2B visitor identity webhook. A plain GET answers 200 and writes nothing,
     so a ping cannot file a fake lead. POST is the write door and needs the
     shared secret in the query string. */
  "public/rb2b-webhook",
  /* The /roadmap widget's status read after the soft pull. A plain GET with no
     ref or client_id answers 400, which counts as up, and reads nothing. */
  "public/slo-status",
  "public/survey-submit",
  "public/unsubscribe",
  /* Web push for the client portal. Both answer a plain GET — push/key with the
     public VAPID key, push/subscribe with the caller's own device list — and both
     are client-only, so an unsigned ping answers 401, which counts as up. They are
     worth watching because a client whose portal cannot reach them is offered a
     button that silently does nothing. The write half, push/unsubscribe, is POST
     only — see ALLOWED_UNMONITORED. */
  "push/key",
  "push/subscribe",
  "read/ad-attribution",
  "read/ad-books",
  "read/ad-spine",
  "read/affiliates",
  /* One affiliate's own referrals, payouts, rates and payout gates. Separate
     from read/affiliates above, which answers staff with roster-wide counts.
     Monitored because an outage here empties both tables on the affiliate
     screen, whose empty state reads "No referrals on file" — an affiliate would
     read that as their referrals having vanished, not as a server being down. */
  "read/affiliate-portal",
  "read/agent-context",
  "read/agent-shadow-log",
  "read/agents",
  "read/ai-bureau-config",
  "read/bank-inbox",
  "read/banking-surface",
  "read/blueprint-combined-approval",
  "blueprint/staff-actions",
  "read/call-outcomes",
  /* The only read behind the client progress page. An outage here is a client
     who paid up to $10,000 seeing no scores, no checklist and no next step. */
  "read/client-progress",
  "read/closer-call",
  "read/closer-deck",
  "read/closer-now",
  "read/commissions",
  "read/company-activity",
  "read/company-brain-affiliate",
  "read/company-brain",
  "read/contracts",
  "read/conversations",
  /* The CSM's whole day. An outage here and the person who owns every
     post-sale conversation has no list of who to call and no idea who is
     behind on payments. */
  "read/csm-queue",
  "read/customer-insights",
  "read/deal-math",
  "read/documents",
  /* Bias-audit counts only (cells under 5 suppressed). Staff read; an unsigned
     ping answers 401, which counts as up. */
  "read/eeo-aggregate",
  "read/entitlements",
  "read/failed-events",
  "read/finance-ask",
  "read/finance-command",
  "read/finance-os",
  "read/finance-os-suggestions",
  "read/funding-rounds",
  "read/funnel-pages",
  "read/inbox",
  "read/inquiries",
  "read/inquiry-cases",
  "read/invoices",
  "read/lender-matches",
  "read/lender-observations",
  "read/lenders",
  "read/message-templates",
  "read/messages",
  "read/money-map",
  "read/my-numbers",
  "read/ops-pulse",
  "read/partners",
  "read/partner-home-tiles",
  "read/partner-production",
  /* The $10,000 curriculum a partner opens. An outage here is the training half
     of the entry fee missing, and it is the only read behind the gate record. */
  "read/partner-training",
  "read/portal-contracts",
  "read/portal-summary",
  "read/products",
  "read/proxy-sessions",
  "read/repair-cases",
  "read/sales-floor",
  "read/search",
  "read/slo-connections",
  "read/staff",
  "read/tradelines",
  "read/transactions",
  "read/underwrite",
  "read/unrecorded-calls",
  "read/video-stats",
  "read/workflows",
  "repair/enroll",
  "repair/exceptions",
  "repair/generate",
  "repair/inbound-mail",
  "repair/send",
  /* The Script picker's read on the Creative Factory screen. Staff read; an
     unsigned ping answers 401, which counts as up. */
  "scripts/list",
  "shifts",
  "slo-connections",
  "social/channels",
  "social/generate",
  "social/oauth",
  "social/posts",
  "social/publish",
  "social/schedule",
  "social/settings",
  "soft-pull-approve",
  "staff/monitoring-consent",
  "staff/telemetry",
  "tasks",
  /* The Live Trial's two public-facing doors. `trials/eligibility` is the gate
     that runs in front of the pay button — if it is down, nobody can buy the
     trial and nobody is told why. `trials/dashboard` is the screen a person
     paid $297 to watch for seven days; an outage there is the product missing.
     Its two write siblings are not pingable — see ALLOWED_UNMONITORED. */
  "trials/dashboard",
  "trials/eligibility",
  /* The checkbox a client ticks on their own checklist. POST only: a GET
     answers 405 before it reads anything, and isUp() counts 405 as up — the
     same reason campaigns/link-asset is monitored. The ping writes nothing. */
  "waypoint-tick",
  /* marketing machine. GET answers 401 to an unsigned ping (counts as up) and
     never writes; the POST half is never pinged. */
  "marketing/settings",
  "marketing/funnels",
  "marketing/health",
  /* U25 script actions. The two GETs answer 401 unsigned; the four POST-only
     routes answer 405 to a GET before reading anything (isUp counts 405 as up,
     as for waypoint-tick). No ping writes. */
  "marketing/scripts",
  "marketing/script",
  "marketing/scripts/approve",
  "marketing/scripts/edit",
  "marketing/scripts/reject",
  "marketing/scripts/order",
  /* U26: the GETs answer 401 to an unsigned ping; the POST-only routes answer
     405 to a GET before they read anything (isUp counts both as up). A ping
     never writes, queues or spends. */
  "marketing/ideas",
  "marketing/rules",
  "marketing/scripts/fix",
  "marketing/batches",
  "marketing/batches/write-now",
  "marketing/jobs/retry",
  /* The funnel builder (build unit X4). GET marketing/funnel answers 401 to an
     unsigned ping. The four POST siblings answer 405 to a GET before they read
     anything (isUp() counts 405 as up), so a ping writes nothing. */
  "marketing/funnel",
  "marketing/funnels/create",
  "marketing/funnels/rename",
  "marketing/funnels/build",
  "marketing/funnels/push-live",
  /* The Meta loader (U28). load is POST only: a GET answers 405 before it reads
     anything, which isUp() counts as up, and the ping queues nothing.
     load-status answers 401 to an unsigned GET. Neither ever calls Meta. */
  "marketing/meta/load",
  "marketing/meta/load-status",
  "marketing/ads",
  "marketing/ad",
  "marketing/angles",
  "marketing/funnels/stats",
  /* U23: GET answers 401 to an unsigned ping and never writes (the plan is a live
     preview); the POST half is never pinged. */
  "marketing/batches/next",
  /* Build the avatar (unit X1). The GETs answer 401 unsigned; the POSTs answer 405 to
     a GET ping (counted as up) and never write. */
  "marketing/costs",
  "marketing/flywheel",
  "marketing/flywheel/job",
  "marketing/flywheel/run",
  "marketing/flywheel/approve",
  "marketing/flywheel/tweak",
  "marketing/flywheel/campaign",
  /* Research it (unit X2): GET lists the runs, 401 to an unsigned ping; the POST
     that starts a paid run is never pinged. */
  "marketing/research",
  /* X3: the flywheel. The GET answers 401 to an unsigned ping; the POST-only
     routes answer 405 to a GET before they read anything. A ping never
     writes, queues or spends. */
  "marketing/flywheel/spend-read"
];

const DESK_FILES = [
  "affiliate.html",
  "agent-editor.html",
  "automations.html",
  "brand-studio.html",
  "calendar.html",
  "campaign-manager.html",
  "client-control-panel.html",
  "client-portal.html",
  "closer-call.html",
  "closer-dashboard.html",
  "company-brain.html",
  "consent-capture.html",
  "content-admin.html",
  "contracts.html",
  "creative-factory.html",
  "csm-queue.html",
  "documents.html",
  "finance-os.html",
  "galaxy.html",
  "hiring.html",
  "index.html",
  "inquiry-remover.html",
  "journeys.html",
  "lenders.html",
  "marketing-command-center.html",
  "messaging.html",
  "my-numbers.html",
  "ops-admin.html",
  "partner-galaxy.html",
  "partner-training.html",
  "payment-success.html",
  "pipeline.html",
  "present.html",
  "products-commissions.html",
  "sales-floor.html",
  "social-studio.html",
  "soft-pull-approve.html",
  "staff-teams.html"
];

/** Static HTML under public/ (not public/app desks). */
const PUBLIC_STATIC_FILES = ["climate/index.html"];

export const PULSE_REGISTRY = [
  ...API_KEYS.map((key) => ({
    id: key,
    kind: "api",
    path: key === "health" ? "/api/health?strict=1" : `/api/${key}`
  })),
  ...DESK_FILES.map((file) => ({
    id: file.replace(/\.html$/, ""),
    kind: "desk",
    path: `/app/${file}`
  })),
  ...PUBLIC_STATIC_FILES.map((file) => ({
    id: file.replace(/\.html$/, "").replace(/\//g, "-"),
    kind: "public_static",
    file,
    path: file === "climate/index.html" ? "/climate/" : `/${file}`
  }))
];

export function coverageKey(row) {
  if (!row || !row.path) return "";
  if (row.kind === "public_static") return row.file || "";
  if (row.kind === "desk") return row.path.replace(/^.*\//, "");
  return String(row.path).replace(/^\/api\//, "").replace(/\?.*$/, "");
}

export function missingFromRegistry({
  handlerKeys = [],
  deskFiles = [],
  registry = PULSE_REGISTRY,
  allow = ALLOWED_UNMONITORED
} = {}) {
  const covered = new Set([
    ...registry.map(coverageKey),
    ...Object.keys(allow)
  ]);
  const missing = [];
  for (const key of handlerKeys) {
    if (!covered.has(key)) missing.push(key);
  }
  for (const file of deskFiles) {
    if (!covered.has(file)) missing.push(file);
  }
  return missing.sort();
}

function checkRow(row, status, detail, suggestedFix = null) {
  return {
    id: `reg:${row.id}`,
    kind: "registry",
    path: row.path,
    status,
    detail,
    suggestedFix
  };
}

function isUp(row, httpStatus) {
  if (row.kind === "desk" || row.kind === "public_static") return httpStatus >= 200 && httpStatus < 300;
  return (
    (httpStatus >= 200 && httpStatus < 300) ||
    httpStatus === 400 ||
    httpStatus === 401 ||
    httpStatus === 403 ||
    httpStatus === 405
  );
}

async function pingRow(row, fetchImpl, baseUrl) {
  const url = `${baseUrl}${row.path}`;
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "text/html,application/json" },
      signal: AbortSignal.timeout(15000)
    });
    const status = res.status;
    if (isUp(row, status)) {
      return checkRow(row, "up", `${row.path} ${status}`);
    }
    return checkRow(
      row,
      "down",
      `${row.path} answered ${status}`,
      `Restore ${row.path}. Do not auto-fix from this pulse.`
    );
  } catch (err) {
    return checkRow(
      row,
      "down",
      `${row.path} unreachable: ${String((err && err.message) || err).slice(0, 160)}`,
      `Restore ${row.path}. Do not auto-fix from this pulse.`
    );
  }
}

async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker()));
  return out;
}

/** GET each registry URL. Writes up / down. Never POSTs. Never auto-fixes. */
export async function checkRegistry({
  fetchImpl,
  baseUrl,
  rows = PULSE_REGISTRY,
  concurrency = 8
} = {}) {
  const origin = String(baseUrl || "").replace(/\/+$/, "");
  return mapPool(rows, concurrency, (row) => pingRow(row, fetchImpl, origin));
}
