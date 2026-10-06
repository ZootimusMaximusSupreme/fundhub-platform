// Resend email provider — replaces Mailgun as the outbound email path.
//
// OWNER LAW (2026-08-14): Email = Resend. Mailgun stays in the tree for
// inbound webhook signing only; do not route new outbound email through it.
//
// Same contract as mailgun.mjs: no DB, no compliance re-check, never throw,
// body sent exactly as approved. Env only — never hardcode the key.
//
//   RESEND_API_KEY   API key (re_…)
//   RESEND_FROM      From header, e.g. "Fundhub <noreply@fundhub.ai>"
//                    Owner law: brand is Fundhub — never FundHub in From.
//                    Free-tier onboarding may use onboarding@resend.dev until
//                    the real domain is verified (SPF/DKIM).
//   RESEND_BASE_URL  optional; defaults to https://api.resend.com

import { readFile } from "node:fs/promises";
import { postJson, classify, success, failure, rejection, redact } from "./http.mjs";
import { resolveMessageAsset } from "../assets.mjs";

/** Must equal the `provider` value in message_channel_routing. */
export const PROVIDER = "resend";

export const CHANNELS = new Set(["email"]);

export const ADDRESS_FIELD = "email";

/** True once migration 164 seeds email → resend. */
export const ENABLED = true;

export const TRANSMITS = true;

const DEFAULT_BASE_URL = "https://api.resend.com";

/* ADDRESSES RESEND WILL NEVER TAKE.

   example.com, example.net, example.org and every name under .test, .example,
   .invalid and .localhost are reserved for examples and testing (RFC 2606,
   RFC 6761). No mailbox can exist there, and Resend refuses them on sight:
   HTTP 422 validation_error, "use our testing email address instead of domains
   like `example.com`". Measured 2026-10-01: 6 welcome and 5 finish-application
   emails from live test walks of the apply form got exactly that answer and
   were recorded as failed mail, which read as the welcome email being broken.

   Pure — no network, no database. The dispatcher asks before it sends, so a
   test address is held for what it is instead of handed over and logged as a
   failed delivery. Returns a plain reason naming the domain (never the whole
   address), or null when the address is fine to try. */
const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org"]);
const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost"]);

export function refusedAddress(to) {
  const addr = String(to || "").trim().toLowerCase();
  const at = addr.lastIndexOf("@");
  if (at < 0) return null;
  const domain = addr.slice(at + 1).replace(/\.+$/, "");
  if (!domain) return null;
  const labels = domain.split(".");
  if (RESERVED_TLDS.has(labels[labels.length - 1]) || RESERVED_DOMAINS.has(labels.slice(-2).join("."))) {
    return `test address: ${domain} is reserved for testing and can never receive mail, so it was not sent`;
  }
  return null;
}

function asBase64(content, encoding) {
  if (Buffer.isBuffer(content)) return content.toString("base64");
  const raw = String(content ?? "");
  if (encoding === "utf8") return Buffer.from(raw, "utf8").toString("base64");
  return raw.replace(/\s+/g, "");
}

/** Named assets, or inline { filename, content } bytes for generated files. */
async function loadAttachments(list) {
  if (list == null || list === "") return { files: [], error: null };
  if (typeof list === "string") {
    try { list = JSON.parse(list); } catch { return { files: [], error: null }; }
  }
  if (!Array.isArray(list) || list.length === 0) return { files: [], error: null };
  const files = [];
  for (const item of list) {
    if (item && item.content != null && item.filename) {
      files.push({
        filename: String(item.filename),
        content: asBase64(item.content, item.encoding),
        content_type: item.contentType || item.content_type || "application/pdf"
      });
      continue;
    }
    const key = item && (item.asset || item.key);
    const asset = resolveMessageAsset(key);
    if (!asset) {
      return { files: [], error: `unknown attachment asset: ${String(key || "")}` };
    }
    try {
      const bytes = await readFile(asset.absPath);
      files.push({
        filename: (item && item.filename) || asset.filename,
        content: bytes.toString("base64"),
        content_type: asset.contentType
      });
    } catch (err) {
      return {
        files: [],
        error: `could not read attachment ${asset.filename}: ${String(err && err.message || err)}`
      };
    }
  }
  return { files, error: null };
}

/** Rough plain-text fallback when the template body is HTML (multipart text part). */
function htmlToText(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/(div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function config(env) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM;
  const missing = [
    !apiKey && "RESEND_API_KEY",
    !from && "RESEND_FROM"
  ].filter(Boolean);
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    apiKey,
    from,
    /* NOT required, and deliberately not defaulted. Which domain receives our
       mail is a fact about DNS, not something this file can infer from the
       sending address — the two are different domains here, which is the whole
       of T5-05. Unset, no Reply-To is added and behaviour is unchanged. */
    replyToDomain: String(env.RESEND_REPLY_TO_DOMAIN || "").trim(),
    baseUrl: String(env.RESEND_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "")
  };
}

export async function send(message = {}, options = {}) {
  try {
    return await attempt(message, options);
  } catch (err) {
    return failure(`resend provider error: ${String((err && err.message) || err)}`);
  }
}

async function attempt(message, { fetchImpl, timeoutMs, signal, env = process.env } = {}) {
  const cfg = config(env);
  if (!cfg.ok) {
    return failure(`resend is not configured: ${cfg.missing.join(", ")} not set`);
  }

  const to = String(message.to || "").trim();
  if (!to) return rejection("no destination email address on the message");

  const body = String(message.body ?? "");
  if (!body) return rejection("message body is empty");

  const looksHtml = /<!DOCTYPE\s+html|<html[\s>]|<table[\s>]/i.test(body);
  const payload = {
    from: cfg.from,
    to: [to],
    subject: message.subject ? String(message.subject) : "(no subject)"
  };
  if (looksHtml) {
    payload.html = body;
    payload.text = htmlToText(body);
  } else {
    payload.text = body;
  }
  /* HEADERS ARE NOT THE MESSAGE. The contract this file inherits is that the
     BODY goes out exactly as approved — no truncation, no appended footer — and
     that still holds: nothing here touches payload.text or payload.html.
     Headers are envelope metadata the reader never sees as content.

     List-Unsubscribe / List-Unsubscribe-Post are RFC 8058. They are what puts
     an "Unsubscribe" control in Gmail's and Apple Mail's own chrome, beside the
     sender name, and Gmail and Yahoo both require them of bulk senders. The
     visible footer link is appended upstream in dispatch.mjs; these are the
     same door opened from the mail client instead of from the message.

     The angle brackets are required by the RFC, not decoration. */
  /* WHERE A REPLY GOES, AND WHY IT IS NOT THE FROM ADDRESS.

     Mail leaves from RESEND_FROM, which is on fundhub.ai — and fundhub.ai's MX
     records point at Cloudflare, not at us (checked 2026-08-18). Nothing reads
     that mailbox. Inbound mail is only received on the Mailgun domain, which
     has a catch-all route posting to /api/webhooks/mailgun. So a client who
     pressed Reply was writing to an address no part of this system reads, which
     is T5-05: outbound and inbound were on different domains.

     REPLY_TO_DOMAIN names the domain that actually receives. The local part is
     plus-tagged with the client id, the same convention F-10 uses for bank mail
     (`monitor+<id>@`), so the reply comes back naming exactly one client rather
     than being matched by guessing at the From address.

     Unset, nothing is added and behaviour is exactly what it was. This is a
     configuration fact — which domain receives mail — and the code refuses to
     assume one. */
  const replyDomain = String(cfg.replyToDomain || "").trim();
  if (replyDomain && message.clientId) {
    payload.reply_to = `reply+${message.clientId}@${replyDomain}`;
  }

  const headers = {};
  if (message.providerRef) headers["X-Fundhub-Ref"] = String(message.providerRef);
  if (message.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${String(message.unsubscribeUrl)}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  if (Object.keys(headers).length) payload.headers = headers;

  const attached = await loadAttachments(message.attachments);
  if (attached.error) return rejection(attached.error);
  if (attached.files.length) payload.attachments = attached.files;

  const res = await postJson(`${cfg.baseUrl}/emails`, {
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      Accept: "application/json"
    },
    body: JSON.stringify(payload),
    contentType: "application/json",
    timeoutMs,
    fetchImpl,
    signal,
    env,
    what: "resend email"
  });

  if (res.status === 0) return failure(res.error || "resend request failed");

  const verdict = classify(res.status);
  if (verdict.status === "rejected") {
    return rejection(res.error || `resend rejected the message (HTTP ${res.status})`);
  }
  if (verdict.status === "failed") {
    return failure(res.error || `resend returned HTTP ${res.status}`, { retryable: true });
  }

  const providerMessageId = res.body && typeof res.body.id === "string" ? res.body.id : null;
  if (!providerMessageId) {
    return failure(redact(`resend accepted the message but returned no id (HTTP ${res.status})`));
  }
  return success(providerMessageId);
}

export default send;
