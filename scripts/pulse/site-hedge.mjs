// site-hedge — the pulse proof's way to the live site when one connection goes silent.
//
// WHY (measured 2026-10-20, diag runs 39508925935 and 39513051795 on GitHub ubuntu-latest):
// from a GitHub Ubuntu runner, some connections to the site's apex load balancer (fundhub.ai ->
// 75.2.60.5 / 99.83.231.61) go silent. TCP connects in a few ms, the server acknowledges every byte we
// send, and then nothing comes back: no TLS answer, or no HTTP answer, until our own timeout. curl and
// Node both hit it, with the post-quantum or the classic TLS key share alike; DNS and TCP were clean.
//   14 TLS handshakes at once: 59 of 1,120 got no answer. One at a time: 3 of 600.
// The Mac and the live hourly pulse on Netlify do not see it (0 timeouts in 73 live runs). So one silent
// connection on the ship runner is the runner's road, not a broken door, and it was stopping every Linux
// ship at the hourly bundle proof with one GET stuck for the probe's whole 8 s.
//
// The silence comes in clumps: 14 handshakes at once to the apex went silent 74 of 700 times, often 5 or 6
// in the same instant, while Netlify's ordinary edge road lost 3 of 700 and one-at-a-time lost 0 of 150 on
// both (run 39523413721). So a single retry 1 s later could land in the next bad instant: ship run
// 39522194091 lost GET /roadmap on both connections. The tries are spread 1 s apart instead.
//
// WHAT IT DOES: for a GET or HEAD to the site host only, while no answer has started, it sends one more
// identical request after HEDGE_MS and, if still nothing, one more after 2 x HEDGE_MS (MAX_EXTRA_REQUESTS
// in all). Each new request gets another connection, because the silent ones are still busy. The first
// answer wins. Nothing else changes: the caller's abort signal and deadline cover every request, a fast
// error passes straight through, and a door that answers none of them is still a failure.
// No beat deadline, no half-deadline rule and no probe timeout is raised or loosened.
//
// THE BODY, TOO (ship run 39552478955, 2026-10-21): a connection can also stall AFTER the answer starts. The
// live /app/shell.js sent its headers in 83 ms and then no more of its body for 15 s, so a check's own 4 s read
// timed out in one of the proof's two runs, and the app-role / staff-access comparison saw "na" against "skip"
// and stopped the ship. For a GET with a body, this file now reads the whole body: if it is not complete
// BODY_HEDGE_MS after the answer started, ONE more identical request is sent and whichever full body arrives
// first is handed back (a fresh Response with the same status, headers and url). Same rules as above: the
// caller's abort signal and deadline cover every request, and a body that never completes is still a failure.
//
// Proof tooling only (scripts/pulse/prove.mjs). The live pulse-probe provider is not changed.

export const HEDGE_MS = 1000;
export const MAX_EXTRA_REQUESTS = 2;
export const BODY_HEDGE_MS = 2000;

const NULL_BODY = new Set([101, 204, 205, 304]);

/** A Response with the same status, headers, url and redirected flag, holding the body already read. */
function rebuilt(res, buf) {
  const out = new Response(NULL_BODY.has(res.status) ? null : buf, {
    status: res.status, statusText: res.statusText, headers: res.headers
  });
  Object.defineProperty(out, "url", { value: res.url });
  Object.defineProperty(out, "redirected", { value: res.redirected });
  return out;
}

const pathOf = (url) => {
  try { return new URL(url).pathname; } catch { return "?"; }
};

/**
 * Wrap a fetch so a silent connection to `siteHost` gets up to MAX_EXTRA_REQUESTS more tries, HEDGE_MS apart,
 * and a body that stalls after its headers gets one more request.
 * @param {Function} fetchImpl the real fetch
 * @param {{ siteHost: string, hedgeMs?: number, maxExtra?: number, bodyHedgeMs?: number, log?: Array<object> }} opts
 *   `log` gets one row per hedged request ({ method, path, sent, winner: 1..sent or 0, ms, phase? }); the path never
 *   holds a query string.
 */
export function hedgedSiteFetch(fetchImpl, { siteHost, hedgeMs = HEDGE_MS, maxExtra = MAX_EXTRA_REQUESTS, bodyHedgeMs = BODY_HEDGE_MS, log = [] } = {}) {
  const host = String(siteHost || "").toLowerCase();
  return async function siteFetch(input, init = {}) {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    let target = null;
    try { target = new URL(url).host.toLowerCase(); } catch { /* not a web address: pass it through */ }
    if (!host || target !== host || (method !== "GET" && method !== "HEAD")) return fetchImpl(input, init);

    const outer = init && init.signal;
    const started = Date.now();
    const controllers = [];
    const attempt = () => {
      const controller = new AbortController();
      controllers.push(controller);
      if (outer) {
        if (outer.aborted) controller.abort(outer.reason);
        else outer.addEventListener("abort", () => controller.abort(outer.reason), { once: true });
      }
      return Promise.resolve()
        .then(() => fetchImpl(url, { ...init, signal: controller.signal }))
        .then((res) => ({ res }), (err) => ({ err }));
    };

    /* The whole body of a GET, read here; a body that stalls gets ONE more request. HEAD has no body. */
    const readAll = (r) => (r.err ? Promise.resolve(r) : r.res.arrayBuffer().then((buf) => ({ res: rebuilt(r.res, buf) }), (err) => ({ err })));
    const finish = async (res) => {
      if (method !== "GET" || !res.body) return res;
      const whole = readAll({ res });
      let bodyTimer;
      const stalled = new Promise((resolve) => { bodyTimer = setTimeout(() => resolve(null), bodyHedgeMs); });
      const done = await Promise.race([whole, stalled]);
      clearTimeout(bodyTimer);
      if (done) {
        if (done.err) throw done.err;
        return done.res;
      }
      if (outer && outer.aborted) {
        const r = await whole;
        if (r.err) throw r.err;
        return r.res;
      }
      const row = { method, path: pathOf(url), sent: 2, winner: 0, ms: null, phase: "body" };
      log.push(row);
      const tagged = [whole.then((r) => ({ ...r, n: 1 })), attempt().then(readAll).then((r) => ({ ...r, n: 2 }))];
      const firstDone = await Promise.race(tagged);
      let win = firstDone.res ? firstDone : null;
      if (!win) {
        const other = await tagged[firstDone.n === 1 ? 1 : 0];
        row.ms = Date.now() - started;
        if (!other.res) throw (firstDone.n === 1 ? firstDone.err : other.err);
        win = other;
      }
      row.winner = win.n;
      row.ms = Date.now() - started;
      // The winner's body is already read into its fresh Response, so the other download is cut off here and its
      // connection is not left hanging.
      for (const c of controllers) c.abort();
      return win.res;
    };

    let row = null;
    const outcome = await new Promise((resolve) => {
      let sent = 0;
      let open = 0;
      let firstErr = null;
      let done = false;
      let timer = null;
      const settle = (value) => { if (done) return; done = true; clearTimeout(timer); resolve(value); };
      const launch = () => {
        const n = ++sent;
        open++;
        attempt().then((r) => {
          open--;
          if (done) {
            // A late answer is read off and dropped, so its connection goes back to the pool.
            if (r.res && r.res.body) r.res.body.cancel().catch(() => {});
            return;
          }
          if (r.res) return settle({ res: r.res, n });
          if (!firstErr) firstErr = r.err;
          // Every request so far has failed outright (not gone silent): that is the answer.
          if (open === 0) settle({ err: firstErr });
        });
      };
      // While every request is still silent, one more after hedgeMs, up to maxExtra more.
      const arm = () => {
        timer = setTimeout(() => {
          if (done || sent > maxExtra || (outer && outer.aborted)) return;
          if (!row) { row = { method, path: pathOf(url), sent: 1, winner: 0, ms: null }; log.push(row); }
          launch();
          row.sent = sent;
          if (sent <= maxExtra) arm();
        }, hedgeMs);
      };
      launch();
      arm();
    });
    if (row) { row.winner = outcome.n || 0; row.ms = Date.now() - started; }
    if (outcome.err) throw outcome.err;
    return finish(outcome.res);
  };
}
