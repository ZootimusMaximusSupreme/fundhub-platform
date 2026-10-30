// POST /api/repair/send — human mail of repair DIY / DFY letters via PostGrid.
// Body: { mail: true, client_id, letters: [{ bureau, pdf?, html?, letter_id? }], mail_from? }
// Never auto-mails. Same pipe as inquiry send (mailBureauLetter → sendLetter).

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { loadClientReturnAddress } from "../../src/inquiry-ops/call-scheduler.mjs";
import { sendRepairLetters, RepairSendError } from "../../src/repair/send.mjs";
import { mailBureauLetter } from "../../src/metro2/delivery/send.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { hasRepairAgreement, hasDisputeAuthorization } from "../../src/repair/dispute-auth.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const mailFn = deps.mailBureauLetter ?? mailBureauLetter;
  const auth = deps.requireAuth ?? requireAuth;
  const sendFn = deps.sendRepairLetters ?? sendRepairLetters;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  // Literal requireRole + ROLE_SETS.STAFF so journey extract can see the gate.
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const body = req.body || {};
  const wantMail = body.mail === true || body.channels?.mail === true;
  const clientId = body.client_id || body.clientId;
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id_required" });
  }

  try {
    const owned = await database.query(
      `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    );
    if (!owned.rows.length) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    // Staff access and client ownership are not authorization to mail disputes.
    // Match the letter writer\x27s current signed-paper gate before any provider work.
    if (wantMail) {
      const agreement = await (deps.hasRepairAgreement ?? hasRepairAgreement)(database, { orgId, clientId });
      const authorized = agreement || await (deps.hasDisputeAuthorization ?? hasDisputeAuthorization)(database, { orgId, clientId });
      if (!authorized) {
        return res.status(403).json({ ok: false, error: "repair_dispute_authorization_required" });
      }
    }

    const from = body.mail_from || body.mailFrom
      || await loadClientReturnAddress(database, { orgId, clientId });

    const letters = Array.isArray(body.letters) ? body.letters : [];
    const mailSender = wantMail
      ? async (letter) => {
          const sent = await mailFn({
            db: database,
            bureau: letter.target === "furnisher" ? null : letter.bureau,
            furnisherName: letter.furnisherName || letter.furnisher || null,
            to: letter.to || null,
            from,
            identity: body.identity || null,
            pdf: letter.pdf || letter.pdfBase64,
            html: letter.html,
            description: letter.description
              || (letter.target === "furnisher"
                ? `Repair furnisher letter ${letter.furnisherName || letter.bureau}`
                : `Repair letter ${letter.bureau}`),
            metadata: {
              orgId,
              clientId,
              staffId: staff.id,
              letterId: letter.letterId || letter.letter_id || null,
              target: letter.target || "bureau",
              stack: "repair"
            },
            env: deps.env,
            fetchImpl: deps.fetchImpl
          });
          if (!sent.ok) {
            // CARRY THE FACT, NOT JUST THE WORDS.
            //
            // This used to return `{ ok, outcome, error }` and nothing else, so
            // the provider's own answer to "did a request actually leave this
            // process?" was thrown away right here. src/repair/send.mjs then
            // had only the error STRING to decide on, and its string list is a
            // fallback, not knowledge: a refusal whose wording is not on the
            // list keeps the letter's claim and needs a human to release it,
            // and a wording that matches by coincidence releases a letter that
            // may already be in the post.
            //
            // src/messaging/providers/mail-letter.mjs states the fact as
            // `preTransmission` on every failure it returns. Pass it through
            // exactly as given, including undefined — `nothingWasTransmitted()`
            // only believes an actual boolean and falls back to the strings
            // otherwise. Never default it: inventing `true` here would hand
            // back the claim on a letter nobody can prove did not go out.
            return {
              ok: false,
              outcome: `mail_failed:${sent.error || "unknown"}`,
              error: sent.error,
              ...(typeof sent.preTransmission === "boolean"
                ? { preTransmission: sent.preTransmission }
                : {})
            };
          }
          // providerId may legitimately be null — PostGrid can answer 200 with
          // no id in the body. The letter is still in the post, so `ok: true`
          // is the whole of the fact and sendRepairLetters records the mailing
          // on that, not on the id.
          return { ok: true, providerId: sent.providerId ?? null, outcome: "sent" };
        }
      : null;

    const result = await sendFn(database, {
      orgId,
      clientId,
      staffId: staff.id,
      mail: wantMail,
      letters,
      from,
      identity: body.identity || null,
      mailSender,
      env: deps.env,
      fetchImpl: deps.fetchImpl
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof RepairSendError) {
      return res.status(err.status || 400).json({
        ok: false,
        error: err.code || "repair_send",
        message: err.message
      });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
