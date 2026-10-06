// The marketing machine's worker: a 15-minute background function.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 4 and §4 trap 5. Plan unit U22.
// Netlify gives a function whose name ends in -background 15 minutes and answers its
// caller 202 at once. It is started by the clock (marketing-clock.mjs, every 15 minutes),
// by a save (src/marketing/wake.mjs) and by itself when a pass ends with work left.
// The pass is src/marketing/worker.mjs runPass; this file is the shell.
//
// THIS IS AN OPEN URL. It runs nothing unless the header x-fundhub-worker equals
// MARKETING_WORKER_SECRET. No secret set is a CLOSED door (a plain 404), never an open
// one — and then nothing queued ever runs.
//
// DEFAULT EXPORT ONLY. A named `handler` export makes Netlify treat the file as an old
// Lambda-style function, and those fail to deploy once the site's variables pass 4 KB.

import { db } from "../../src/db.mjs";
import { makeWorkerHandler } from "../../src/marketing/worker.mjs";

export default makeWorkerHandler({ db });
