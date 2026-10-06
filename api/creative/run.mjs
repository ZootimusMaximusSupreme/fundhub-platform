// POST /api/creative/run — claim and run queued generation jobs for a partner
// (or all partners with due work when staff omits partner_id and passes all=1).
// The Netlify creative-job-runner cron calls the same runDue path on a schedule.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { claim, run } from "../../src/creative/generate.mjs";
import { runDue } from "../../src/creative/runner.mjs";
import { safeError } from "../../src/http/health.mjs";
import { quickCopyVerdict } from "../../src/marketing/quick-copy.mjs";

/* plainReason — the failure a job recorded, in words the owner reads.

   generation_jobs.error holds the engineer's sentence, and the commonest one
   names a database table ("insert a creative_providers row"), which is exactly
   what must never reach a screen. Only a reason we can state plainly is
   translated; anything else points at the job list, which now runs the same
   sentence through its own ladder (creative-factory.html plainJobError). Nothing
   is invented and nothing is hidden. */
function plainReason(error) {
  const text = String(error || "");
  if (/no active provider configured/i.test(text)) {
    return "No ad-making service is switched on for this account, so there is nothing to make the work.";
  }
  if (/has no module/i.test(text)) {
    return "The ad-making service on file is one this system does not know how to use.";
  }
  /* A job that is back in the queue is most often here: the vendor replied and
     sent no assets (src/creative/generate.mjs:191). That is the vendor ANSWERING,
     which is why the requeued note below no longer says it was unreachable. */
  if (/returned zero assets/i.test(text)) {
    return "The service answered, but sent nothing back.";
  }
  if (!text) return "The job list below shows what happened.";
  return "The reason is on the job in the list below.";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db });
  if (!principal) return;

  const body = req.body || {};
  const maxJobs = Math.min(10, Math.max(1, Number(body.max_jobs) || 3));

  try {
    if (body.all === true || body.all === 1 || body.all === "1") {
      if (principal.kind !== "staff") {
        return res.status(403).json({ ok: false, error: "staff_only_for_all" });
      }
      const out = await runDue(db, { maxJobsPerPartner: maxJobs });
      return res.status(200).json({ ok: true, ...out });
    }

    const partnerId = resolvePartnerId(principal, {
      partner_id: body.partner_id || (req.query || {}).partner_id
    });
    if (!partnerId) {
      return res.status(400).json({ ok: false, error: "partner_id_required" });
    }

    const jobs = await withPartnerScope({ kind: "partner", partnerId }, async (tx) => {
      const out = [];
      for (let i = 0; i < maxJobs; i++) {
        const job = await claim(tx, { partnerId });
        if (!job) break;
        out.push({ job_id: job.id, ...(await run(tx, job)) });
      }
      return out;
    });

    /* THE CHECKER'S VERDICT on every piece of copy, on the words exactly as
       saved (Quick copy, design docs/specs/command-center-design-2026-10-05.md
       §2 J9 and §3.2 "Existing"; unit X3): the repo's own ad checker, strict,
       in Chris's words. Pictures and videos have no words and get none. */
    for (const j of jobs) {
      for (const a of j.assets || []) {
        if (a && a.kind === "copy" && typeof a.copy_text === "string") a.check = quickCopyVerdict(a.copy_text);
      }
    }

    /* WHAT ACTUALLY HAPPENED, not just how many rows were touched.

       `ran` counts jobs CLAIMED, and a claimed job that failed still counts. So
       "Ran 1 job." was the whole answer even when the job died on "no active
       provider configured" and made nothing — the screen read as success. The
       counts and the first failure reason are added alongside the existing
       fields; `ran`, `jobs` and `note` keep their meaning, so no caller that
       reads them breaks. The runner cron reads runDue() directly and is not
       affected either way. */
    const failed = jobs.filter((j) => j.status === "failed").length;
    const succeeded = jobs.filter((j) => j.status === "succeeded").length;
    const requeued = jobs.filter((j) => j.status === "queued").length;
    const firstReason = plainReason((jobs.find((j) => j.error) || {}).error);

    let note;
    if (!jobs.length) {
      note = "Nothing was waiting to run. Add a batch first, then press this again.";
    } else if (failed && !succeeded) {
      note = (failed === 1
        ? "It did not work, and nothing was made. "
        : "None of them worked, and nothing was made. ") + firstReason;
    } else if (failed) {
      note = "Some did not work. " + firstReason;
    } else if (requeued && !succeeded) {
      /* NO CAUSE IS ASSERTED HERE. This used to say "The service could not be
         reached", which is one of several ways a job gets requeued and not the
         commonest — a vendor that replies with zero assets is requeued too, and
         it was plainly reachable. State only what is certain (they are going to
         be tried again) and let the translator add a reason when it recognises
         one. */
      note = "They are back in the queue and will be tried again. " + firstReason;
    } else {
      note = undefined;
    }

    return res.status(200).json({
      ok: true,
      ran: jobs.length,
      succeeded,
      failed,
      requeued,
      jobs,
      note
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
