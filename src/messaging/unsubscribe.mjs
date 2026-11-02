// One-click unsubscribe links for outbound email.
//
// SAME SHAPE AS EVERY OTHER CONSUMER-FACING LINK IN THIS REPO, deliberately:
// src/documents/signed-url.mjs was copied to src/consent/approve-token.mjs and
// again to src/contracts/signed-link.mjs, and this is the fourth. The person
// clicking is not signed in and never will be, so the HMAC and its expiry ARE
// the credential.
//
//   /unsubscribe.html?org=<uuid>&client=<uuid>&channel=email&exp=<unix>&sig=<hex>
//
// WHY THIS EXISTS AT ALL (T5-14, T5-15). Measured against production on
// 2026-08-18: 173 email templates contain the word "Unsubscribe" and ZERO of
// them contain any URL whatsoever, and /unsubscribe and /api/unsubscribe both
// answered 404. Every marketing email told the reader they could unsubscribe
// and not one of them gave them a way to do it.
//
// INHERITED FROM THE PATTERN, ALL DELIBERATE:
//
//   - FAIL CLOSED with no secret. No secret, no links.
//   - Constant-time signature comparison.
//   - A bad signature, an expired link and a tampered id are ALL the same
//     answer. Distinguishing them turns the endpoint into an oracle for which
//     client ids exist.
//
// WHAT IS DIFFERENT, AND WHY:
//
//   SCHEME "unsub-v1". Domain separation. The scheme is the first field of the
//   signed string, so a document link, a soft-pull consent link and a contract
//   link can never verify as an unsubscribe link even when the same secret
//   signs them all — and, far more importantly, an unsubscribe link can never
//   be replayed as a consent link. Those two mean opposite things.
//
//   THE CHANNEL IS SIGNED. It is a field in the canonical string rather than a
//   constant, so a link minted for email cannot be edited in the address bar
//   into one that silences the client's texts as well. Today only email mints
//   these; the field is what stops the URL being widened by hand.
//
//   TTL IS A YEAR, NOT THIRTY DAYS. CAN-SPAM sets the floor at 30 days after
//   the message was sent. A contract link is 30 days because somebody either
//   signs it or they do not; an unsubscribe link sits in an archived mailbox
//   and has to still work the day they finally get annoyed enough to press it.
//   A dead unsubscribe link is the defect this file exists to fix, so the
//   expiry is set well past the obligation rather than at it.

import { createHmac, timingSafeEqual } from "node:crypto";

export const UNSUBSCRIBE_TTL_SECONDS = 60 * 60 * 24 * 365;      // 1 year
export const UNSUBSCRIBE_MAX_TTL_SECONDS = 60 * 60 * 24 * 400;  // hard cap
export const UNSUBSCRIBE_PATH = "/unsubscribe.html";
const SCHEME = "unsub-v1";

/* The source string written to opt_outs.source when somebody uses the link.
   Distinct from 'provider_unsubscribe' (the mail provider told us) and from
   'inbound_keyword' (they replied STOP), because an operator reading that
   column needs to know which of the three actually happened. */
export const UNSUBSCRIBE_LINK_SOURCE = "unsubscribe_link";

/**
 * The signing secret. Fail closed: no secret, no links.
 *
 * UNSUBSCRIBE_TOKEN_SECRET first, DOCUMENT_URL_SECRET as a fallback — the same
 * arrangement src/contracts/signed-link.mjs uses for CONTRACT_URL_SECRET, and
 * for the same reason: it is one fewer thing an operator has to set for the
 * feature to work at all, and it leaks nothing because SCHEME above
 * domain-separates the signature spaces. A dedicated UNSUBSCRIBE_TOKEN_SECRET
 * is the recommended posture and is what production is set to use.
 */
export function unsubscribeSecret(env = process.env) {
  const secret = env.UNSUBSCRIBE_TOKEN_SECRET || env.DOCUMENT_URL_SECRET;
  if (!secret || String(secret).length < 32) {
    throw new Error(
      "UNSUBSCRIBE_TOKEN_SECRET is missing or too short (need >= 32 chars) — refusing " +
      "to sign unsubscribe links. Generate one with: openssl rand -hex 32");
  }
  return secret;
}

/* Canonical string. Field order is fixed and "|" cannot appear in a uuid, in a
   channel name or in a decimal timestamp, so no two distinct payloads can
   produce the same input to the HMAC. */
const canonical = ({ orgId, clientId, channel, expiresAt }) =>
  [SCHEME, orgId, clientId, channel, expiresAt].join("|");

export function signature({ orgId, clientId, channel, expiresAt, secret }) {
  return createHmac("sha256", secret)
    .update(canonical({ orgId, clientId, channel, expiresAt }))
    .digest("hex");
}

/**
 * signUnsubscribeUrl — mint the link that goes in the footer.
 *
 * `now` is injectable so tests pin the clock without sleeping.
 * Returns { url, path, expiresAt, expiresAtIso }.
 *
 * The page lives at the SITE ROOT, not under public/app/. Everything under
 * public/app/ loads shell.js, which demands a session and bounces anybody
 * without one — and a person unsubscribing has no session and must never be
 * made to create one to get out of a mailing list.
 */
export function signUnsubscribeUrl({
  orgId,
  clientId,
  channel = "email",
  ttlSeconds = UNSUBSCRIBE_TTL_SECONDS,
  secret = undefined,
  baseUrl = null,
  env = process.env,
  now = Date.now
} = {}) {
  if (!orgId || !clientId) throw new Error("signUnsubscribeUrl requires orgId and clientId");
  if (!channel) throw new Error("signUnsubscribeUrl requires a channel");

  const ttl = Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error("ttlSeconds must be a positive number");
  if (ttl > UNSUBSCRIBE_MAX_TTL_SECONDS) {
    throw new Error(`ttlSeconds ${ttl} exceeds the ${UNSUBSCRIBE_MAX_TTL_SECONDS}s maximum`);
  }

  const key = secret ?? unsubscribeSecret(env);
  const expiresAt = Math.floor(now() / 1000) + Math.floor(ttl);
  const sig = signature({ orgId, clientId, channel, expiresAt, secret: key });

  const params = new URLSearchParams();
  params.set("org", String(orgId));
  params.set("client", String(clientId));
  params.set("channel", String(channel));
  params.set("exp", String(expiresAt));
  params.set("sig", sig);

  const path = `${UNSUBSCRIBE_PATH}?${params.toString()}`;
  return {
    url: baseUrl ? `${String(baseUrl).replace(/\/+$/, "")}${path}` : path,
    path,
    expiresAt,
    expiresAtIso: new Date(expiresAt * 1000).toISOString()
  };
}

/**
 * verifyUnsubscribeToken — the payload, or null. Never throws: a malformed
 * link is an invalid link, not a 500.
 */
export function verifyUnsubscribeToken({
  orgId, clientId, channel, exp, sig, secret = undefined, env = process.env, now = Date.now
} = {}) {
  if (!orgId || !clientId || !channel || !exp || !sig) return null;
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt)) return null;

  let key;
  try { key = secret ?? unsubscribeSecret(env); } catch { return null; }

  /* Signature BEFORE expiry, so the failure reason cannot be used to probe
     which half of a forged link was wrong. */
  const expected = signature({ orgId, clientId, channel, expiresAt, secret: key });
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(sig), "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (Math.floor(now() / 1000) > expiresAt) return null;

  return {
    orgId: String(orgId),
    clientId: String(clientId),
    channel: String(channel),
    expiresAt
  };
}

/** Parse + verify straight from a request URL or a query object. */
export function verifyUnsubscribeRequest(source, { secret = undefined, env = process.env, now = Date.now } = {}) {
  let q = source;
  if (typeof source === "string") {
    try {
      q = Object.fromEntries(new URL(source, "http://internal.invalid").searchParams);
    } catch {
      return null;
    }
  }
  if (!q || typeof q !== "object") return null;
  return verifyUnsubscribeToken({
    orgId: q.org, clientId: q.client, channel: q.channel, exp: q.exp, sig: q.sig, secret, env, now
  });
}


/* ── The footer ───────────────────────────────────────────────────────────
   Built here rather than in a provider. The provider contract
   (src/messaging/providers/mailgun.mjs:12-15) is that a provider "never
   mutates the message. No truncation, no appended footer", and three tests
   hold it to that. So the visible brand block is appended upstream, at
   dispatch, and the provider still sends exactly what it is handed.

   ONE HTML FOOTER for every outbound email: a tight personal signature card
   (handwritten Chris first, name, title, phone, tagline) plus a quiet
   Unsubscribe control — not a raw URL under the copy, not a marketing dump.

   Plain-text bodies are wrapped into a simple HTML shell so Resend sends
   html (it sniffs <!DOCTYPE>/<html>/<table>) and the button can render. */
const HTML_SNIFF = /<!DOCTYPE\s+html|<html[\s>]|<table[\s>]/i;
const FOOTER_MARK = "<!-- fundhub-email-footer -->";

/** Brand line shown under every outbound email footer. */
export const EMAIL_TAGLINE = "Fundhub.ai · Funding Intelligence for Entrepreneurs";
export const EMAIL_SIGNER_NAME = "Chris";
export const EMAIL_SIGNER_TITLE = "Funding Executive · Fundhub.ai";
/** Compact text wordmark casing (Fundhub.ai brand law — never FundHub). */
export const EMAIL_WORDMARK = "fundhub.ai";
/** Hosted Fundhub wordmark (footer). */
export const EMAIL_LOGO_PATH = "/assets/email/fundhub-logo.png";
/** Handwritten Chris signature (script PNG, #111827 on white). The old josh-signature files stay on the server only because emails already sent load them by address. */
export const EMAIL_SIGNATURE_PATH = "/assets/email/chris-signature.png";
/*
  Brand body face from public/app/fundhub-brand.css --sans.
  Inter is a Google font (same stack the app loads). Linked in the shell <head>
  so clients that honor webfonts get Inter; others fall back to system-ui.
*/
export const EMAIL_SANS = "'Inter',system-ui,-apple-system,sans-serif";

/** Display the rep number as (561) 304-8368; fall back to FUNDHUB_REP_NUMBER. */
export function formatRepPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return String(raw || "").trim();
}

export function emailLogoUrl(env = process.env) {
  const base = String(env.APP_BASE_URL || env.URL || "https://fundhub.ai").replace(/\/+$/, "");
  return `${base}${EMAIL_LOGO_PATH}`;
}

export function emailSignatureUrl(env = process.env) {
  const base = String(env.APP_BASE_URL || env.URL || "https://fundhub.ai").replace(/\/+$/, "");
  return `${base}${EMAIL_SIGNATURE_PATH}`;
}

export function emailRepPhone(env = process.env) {
  return formatRepPhone(env.FUNDHUB_REP_NUMBER || env.TWILIO_SEND_FROM || "+15613048368");
}

export function emailRepTelHref(env = process.env) {
  const digits = String(env.FUNDHUB_REP_NUMBER || env.TWILIO_SEND_FROM || "+15613048368").replace(/\D/g, "");
  const e164 = digits.length === 10 ? `+1${digits}` : digits.startsWith("1") ? `+${digits}` : `+${digits}`;
  return `tel:${e164}`;
}

/* THE SIGNATURE IMAGES NEED A WHITE GROUND UNDER THEM — F18, 2026-09-03.
   ═══════════════════════════════════════════════════════════════════════════
   The wordmark and the handwritten "Chris" are PNGs with a solid white
   background. They looked clean in the e-book email and showed as two white
   rectangles in the soft-pull email, which reads like an image problem and is
   not one: BOTH emails carry this one footer, and neither template contains a
   signature block of its own. The difference is where the footer lands.

     plain-text body   ensureHtmlEmailBody() wraps the copy in the shell below
                       and drops the footer into the card, whose background is
                       already #ffffff. White artwork on white — no edge.
     HTML body         the template brings its own document. The footer is
                       injected before its </body>, i.e. AFTER that template's
                       own centred card and directly onto the page background,
                       which is #F4F4F5 in every seeded template. White artwork
                       on grey — two visible rectangles.

   Measured on the real rows sent during the 2026-09-03 walk: the e-book body
   is 305 characters of plain text, the soft-pull body is 2816 characters of
   HTML opening `<!DOCTYPE html>` with `background-color:#F4F4F5` on <body>.

   So the standalone form below gives the footer a white card of its own,
   centred at the same 600px the seeded templates use. It carries its own
   ground rather than borrowing the template's, which is what makes it correct
   on ANY page background — including a mail client's dark mode, where a
   grey-vs-white mismatch gets worse, not better. */
function footerCard(inner) {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="border-collapse:collapse">` +
    `<tr><td align="center" style="padding:0 12px 24px 12px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" ` +
    `style="width:600px;max-width:100%;background-color:#ffffff;border-collapse:collapse">` +
    `<tr><td style="padding:0 28px 20px 28px">${inner}</td></tr>` +
    `</table></td></tr></table>`
  );
}

/**
 * Premium personal-signature footer (HTML). Handwritten Chris first, then
 * name / title / phone / tagline as one tight block, plus a quiet outlined
 * Unsubscribe control (still a real link).
 *
 * `standalone` — true when this footer will be appended AFTER a template's own
 * container rather than inside the shell's white card. See footerCard above.
 */
export function unsubscribeFooter(url, { html = false, standalone = false, env = process.env } = {}) {
  const safe = String(url || "");
  if (!safe) return "";
  const phone = emailRepPhone(env);
  const tel = emailRepTelHref(env);
  const signature = emailSignatureUrl(env);
  const logo = emailLogoUrl(env);

  if (!html) {
    return (
      `\n\n---\n` +
      `${EMAIL_SIGNER_NAME}\n${EMAIL_SIGNER_TITLE}\n` +
      `${phone}\n` +
      `${EMAIL_TAGLINE}\n` +
      `Don't want these emails? Unsubscribe: ${safe}`
    );
  }

  const href = escapeHtml(safe);
  const sigSrc = escapeHtml(signature);
  const logoSrc = escapeHtml(logo);
  const phoneLabel = escapeHtml(phone);
  const telHref = escapeHtml(tel);

  const inner =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ` +
    `style="margin:20px 0 0;border-collapse:collapse;border-top:1px solid #e5e7eb">` +
    `<tr><td style="padding:16px 0 0 0;text-align:left">` +

    /* Existing hosted wordmark — same file already on fundhub.ai. */
    `<img src="${logoSrc}" width="120" height="35" alt="fundhub.ai" ` +
    `style="display:block;margin:0 0 12px;width:120px;height:auto;border:0;outline:none" />` +

    /* Handwritten signature — PNG so mail apps show it (many skip SVG). */
    `<img src="${sigSrc}" width="150" height="75" alt="" ` +
    `style="display:block;margin:0 0 2px;width:150px;height:auto;border:0;outline:none" />` +

    `<p style="margin:0;font:400 14px/1.3 ${EMAIL_SANS};color:#111827">` +
    `${escapeHtml(EMAIL_SIGNER_NAME)}` +
    `</p>` +
    `<p style="margin:1px 0 0;font:400 12px/1.35 ${EMAIL_SANS};color:#6b7280">` +
    `${escapeHtml(EMAIL_SIGNER_TITLE)}` +
    `</p>` +

    `<p style="margin:8px 0 0;font:400 13px/1.35 ${EMAIL_SANS};color:#374151">` +
    `<a href="${telHref}" style="color:#374151;text-decoration:none">${phoneLabel}</a>` +
    `</p>` +

    /* One quiet tagline line (linked) — no second redundant fundhub.ai link. */
    `<p style="margin:6px 0 0;font:400 11px/1.45 ${EMAIL_SANS};color:#9ca3af">` +
    `<a href="https://fundhub.ai" target="_blank" rel="noopener noreferrer" ` +
    `style="color:#9ca3af;text-decoration:none">${escapeHtml(EMAIL_TAGLINE)}</a>` +
    `</p>` +

    /* Outlined pill — clearly clickable, not a giant black brick. */
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
    `style="margin:12px 0 0;border-collapse:collapse">` +
    `<tr><td style="border:1px solid #d1d5db;border-radius:999px;background:#ffffff">` +
    `<a href="${href}" target="_blank" rel="noopener noreferrer" ` +
    `style="display:inline-block;padding:5px 12px;font:400 11px/1.2 ${EMAIL_SANS};` +
    `color:#6b7280;text-decoration:none;border-radius:999px">` +
    `Unsubscribe` +
    `</a>` +
    `</td></tr></table>` +

    `</td></tr></table>`;

  /* The mark stays first in whatever is returned — withUnsubscribeFooter reads
     it to know a footer is already present and must not add a second one. */
  return `${FOOTER_MARK}\n${standalone ? footerCard(inner) : inner}\n`;
}

/** Wrap plain copy in a clean one-column email shell (optional footer slot). */
export function ensureHtmlEmailBody(body, footerHtml = "") {
  const text = String(body ?? "");
  if (HTML_SNIFF.test(text)) {
    if (footerHtml) {
      if (/<\/body>/i.test(text)) return text.replace(/<\/body>/i, `${footerHtml}</body>`);
      return text + footerHtml;
    }
    return text;
  }
  const escaped = escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>\n");
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
    /* Inter = brand --sans; Google-hosted so email clients that allow webfonts match the app. */
    `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet" />` +
    `</head><body style="margin:0;padding:0;background:#f4f4f5;font-family:${EMAIL_SANS}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;border-collapse:collapse">` +
    `<tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" ` +
    `style="width:560px;max-width:100%;background:#ffffff;border-collapse:collapse;` +
    `border:1px solid #e5e7eb;border-radius:10px">` +
    `<tr><td style="padding:28px 28px 8px 28px;font:400 15px/1.55 ${EMAIL_SANS};color:#111827">` +
    `${escaped}` +
    `</td></tr>` +
    `<tr><td style="padding:0 28px 28px 28px">${footerHtml}</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

/* ── The {{unsubscribe}} merge tag (N11, 2026-09-18) ──────────────────────
   22 live email templates (EMAIL-NOBOOK-01..03, EMAIL-S00-WELCOME, the
   no-show, offer, document, billing and funding-paused emails) end with a
   line that holds {{unsubscribe}}. Nothing supplied that tag, so the renderer
   logged "unknown token: {{unsubscribe}}" and left a blank line where the link
   should be. The footer above still went out, but the template's own line
   was empty in the stored copy and in the email.

   This is the value that tag renders to: the same signed link the footer
   uses, minted for this client. An HTML template gets a real
   <a>Unsubscribe</a>; plain copy gets "Unsubscribe: <url>", because
   ensureHtmlEmailBody escapes plain copy later and a tag would show as text.
   `body` is the template body, read only to tell the two apart.

   Throws exactly when signUnsubscribeUrl does (no secret) — the caller
   decides what a missing link means. */
export const UNSUBSCRIBE_TAG_RE = /\{\{\s*unsubscribe\s*\}\}/;

export function unsubscribeTagValue({ orgId, clientId, body = "", env = process.env, now = Date.now } = {}) {
  const baseUrl = String(env.APP_BASE_URL || env.URL || "https://fundhub.ai").replace(/\/+$/, "");
  const { url } = signUnsubscribeUrl({ orgId, clientId, channel: "email", baseUrl, env, now });
  if (HTML_SNIFF.test(String(body ?? ""))) {
    return (
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" ` +
      `style="color:#18181B;text-decoration:underline">Unsubscribe</a>`
    );
  }
  return `Unsubscribe: ${url}`;
}

/** Append the professional footer. Always ships HTML so the button can render. */
export function withUnsubscribeFooter(body, url, env = process.env) {
  const text = String(body ?? "");
  if (!url) return text;
  if (text.includes(String(url))) return text;
  if (text.includes(FOOTER_MARK)) return text;
  /* Same test ensureHtmlEmailBody uses to decide whether it wraps, asked one
     step earlier so the footer knows which ground it is going to land on. A
     template that brings its own HTML gets the standalone card (F18); plain
     copy gets the bare block, because the shell below already puts it inside a
     white card and a card inside a card would double the padding. */
  const footer = unsubscribeFooter(url, {
    html: true, standalone: HTML_SNIFF.test(text), env
  });
  return ensureHtmlEmailBody(text, footer);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
