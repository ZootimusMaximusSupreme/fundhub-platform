// GET/POST /api/contracts/sign?id=<uuid>&exp=<unix>&sig=<hex>
//
// The one endpoint a client ever touches. It is what public/contract.html talks
// to, and it is the only route in this repository besides api/documents/[id].mjs
// that serves somebody with no session at all.
//
//   GET   → { ok, contract }  the words, and whether they can still be signed.
//           Records the view: first one stamps viewed_at, every one bumps
//           view_count.
//   POST  → { ok, contract }  the signature: typed name + ticked box + the time
//           + the IP. Refused if the words have changed since they were sent.
//
// ─────────────────────────────────────────────────────────────────────────────
// AUTH IS THE SIGNATURE, NOT A SESSION — copied from api/documents/[id].mjs,
// which the brief named as the pattern to follow, and for the identical reason:
// a link in an email has to work for a person who is not signed in and never
// will be, so the HMAC and its expiry ARE the credential.
//
// Consequences, all deliberate and all inherited from that file:
//
//   - FAIL CLOSED with no signing secret. No secret, no links, no signing —
//     never an unauthenticated open door. That case answers 503 not_configured,
//     because it is OUR misconfiguration and not the caller's.
//   - Constant-time signature comparison, done inside signed-link.mjs.
//   - A bad signature, an expired link, an unknown id and a draft contract are
//     ALL 404 with the same body. Distinguishing them turns this endpoint into
//     an oracle for which contract ids exist.
//   - No org_id is read from anywhere. The anonymous caller has no org, and
//     asking them to name one is an invitation to guess.
//
// WHAT IT NEVER RETURNS: sent_by, created_by, org_id, the document ids, or the
// merge values. src/contracts/sign.mjs shapes the response to the fields the
// page actually renders; the rest is internal and goes nowhere near a client.
//
// SIGNING IS A POST AND VIEWING IS A GET, and the split is not cosmetic. A GET
// is prefetched by link scanners, retried by browsers, cached and logged with
// its query string. Recording a view that way is harmless and useful. Recording
// a SIGNATURE that way would let a corporate mail scanner sign somebody's
// funding agreement for them. Same reasoning api/consent/capture.mjs and
// api/pii.mjs both record for their own writes.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "../../src/db.mjs";
import { isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { verifyContractUrl } from "../../src/contracts/signed-link.mjs";
import { viewForSigning, sign, documentBytes, loadForClient } from "../../src/contracts/sign.mjs";
import { declineSigner, resolveSigner } from "../../src/contracts/signers.mjs";
import { notifyContractDecline } from "../../src/contracts/notify.mjs";
import { ContractError } from "../../src/contracts/errors.mjs";
import { withTransaction } from "../../src/db/with-transaction.mjs";

const GONE = (res) => res.status(404).json({ ok: false, error: "not_found" });

/* The client's IP, as the record of where a signature came from.
   netlify/functions/api.mjs already resolves x-nf-client-connection-ip and the
   first x-forwarded-for hop onto req.socket.remoteAddress; the header fallbacks
   are here so the handler is not wrong when it runs under a different adapter
   (scripts/dev-server.mjs, or a test calling it directly). */
function clientIp(req) {
  const h = req.headers || {};
  const raw =
    req.socket?.remoteAddress ||
    h["x-nf-client-connection-ip"] ||
    String(h["x-forwarded-for"] || "").split(",")[0].trim() ||
    null;
  const ip = raw ? String(raw).trim() : "";
  return ip ? ip.slice(0, 100) : null;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  /* The link's parameters ride the query string on BOTH methods. A signed link
     is a URL; putting half of it in a POST body would mean the page had to hold
     the signature somewhere and re-send it, and a page that can be induced to
     re-send a credential is a worse shape than one that never handles it. */
  const q = req.query || {};
  const contractId = q.id;
  // `s` names WHICH SIGNER this link belongs to. Its own signature space (see
  // src/contracts/signed-link.mjs), so a contract-wide link can never be
  // replayed as a particular person's, or the reverse.
  const signerId = q.s || null;

  // Shape checks first: a malformed id must not reach Postgres as a 22P02.
  if (!isUuid(contractId)) return GONE(res);
  if (signerId && !isUuid(signerId)) return GONE(res);

  const verdict = verifyContractUrl({
    contractId, signerId, expiresAt: q.exp, sig: q.sig
  });
  if (!verdict.valid) {
    if (verdict.reason === "no_secret") {
      return res.status(503).json({
        ok: false, error: "not_configured",
        message: "This link cannot be checked right now. Please contact the person who sent it."
      });
    }
    if (verdict.reason === "expired") {
      /* THE ONE FAILURE THAT IS TOLD APART FROM THE REST, and it is a
         deliberate exception to the oracle rule above. An expired link is the
         commonest thing that goes wrong here and it is entirely benign: the
         holder had a valid link, time passed. Telling them "this link has
         expired, ask for a new one" is the difference between a two-minute fix
         and a lost client. It leaks that a contract exists — which the person
         holding a validly-signed link already knew, because they were sent it.
         A forged or wrong signature still gets the undifferentiated 404. */
      return res.status(410).json({
        ok: false, error: "link_expired",
        message: "This link has expired. Please ask for a new one — nothing has been lost."
      });
    }
    return GONE(res);
  }

  try {
    if (req.method === "GET") {
      /* ?file=1 — the document itself, base64 inside JSON.
         Same transport as the staff side and for the same reason: one shape
         that works identically under both (req,res) shims. The signing page
         hands the bytes straight to pdf.js.

         It goes through the SAME signature check as everything else above, so a
         forged link cannot fetch the file either — which matters more here than
         anywhere, because the file is the contract. */
      if (String(q.file || "") === "1") {
        const contract = await loadForClient(db, contractId);
        if (!contract || contract.status === "draft" || contract.status === "void") return GONE(res);
        // Only somebody who is really a signer on this contract may pull the file.
        if (signerId) {
          const { signer } = await resolveSigner(db, { contractId, signerId });
          if (!signer) return GONE(res);
        }
        const out = await documentBytes(db, contract);
        if (!out) return res.status(404).json({ ok: false, error: "no_file" });
        res.setHeader("cache-control", "private, no-store");
        res.setHeader("x-content-type-options", "nosniff");
        return res.status(200).json({
          ok: true, filename: out.filename, signed: out.signed,
          pdf_base64: out.bytes.toString("base64")
        });
      }

      const out = await viewForSigning(db, { contractId, signerId });
      res.setHeader("cache-control", "private, no-store");
      res.setHeader("x-content-type-options", "nosniff");
      return res.status(200).json({ ok: true, contract: out.contract });
    }

    const body = req.body || {};

    /* Declining is a real answer and it is recorded, not swallowed. A signer
       who will not sign has to be able to say so without the contract sitting
       in "waiting" forever while somebody chases them. */
    if (String(body.action || "") === "decline") {
      const { signer } = await resolveSigner(db, { contractId, signerId });
      if (!signer) return GONE(res);
      await withTransaction(db, async (tx) => {
        const declined = await declineSigner(tx, { signerId: signer.id, reason: body.reason });
        await notifyContractDecline(tx, { signer: declined, reason: declined.decline_reason });
      });
      return res.status(200).json({
        ok: true, declined: true,
        message: "Recorded. The person who sent this has been told you did not sign it."
      });
    }

    const out = await sign(db, {
      contractId,
      signerId,
      signerName: body.signer_name,
      agreed: body.agreed === true,
      fieldValues: body.field_values && typeof body.field_values === "object" ? body.field_values : {},
      ip: clientIp(req),
      userAgent: (req.headers || {})["user-agent"] || null
    });
    res.setHeader("cache-control", "private, no-store");
    return res.status(200).json({
      ok: true, contract: out.contract, complete: out.complete === true,
      message: out.complete
        ? "Signed. A copy is saved with the time you signed it."
        : "Signed. We will let you know when everybody else has signed too."
    });
  } catch (err) {
    if (err instanceof ContractError) {
      // A contract that does not exist, or is still a draft, is a 404 with the
      // same body as a forged link — see the oracle note in the header.
      if (err.status === 404) return GONE(res);
      return res.status(err.status).json({
        ok: false, error: err.code, message: err.message
      });
    }
    if (err && CLIENT_DATA_ERRORS.has(err.code)) return GONE(res);
    return res.status(500).json({
      ok: false, error: "sign_failed",
      message: "Something went wrong while signing. Try again in a moment.",
      detail: safeError(err)
    });
  }
}

export const __test = { clientIp };
