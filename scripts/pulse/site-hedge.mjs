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
// Proof tooling only (scripts/pulse/prove.mjs). The live pulse-probe provider is not changed.

export const HEDGE_MS = 1000;
export const MAX_EXTRA_REQUESTS = 2;

const pathOf = (url) => {
  try { return new URL(url).pathname; } catch { return "?"; }
};

/**
 * Wrap a fetch so a silent connection to `siteHost` gets up to MAX_EXTRA_REQUESTS more tries, HEDGE_MS apart.
 * @param {Function} fetchImpl the real fetch
 * @param {{ siteHost: string, hedgeMs?: number, maxExtra?: number, log?: Array<object> }} opts `log` gets one
 *   row per hedged request ({ method, path, sent, winner: 1..sent or 0, ms }); the path never holds a query string.
 */
export function hedgedSiteFetch(fetchImpl, { siteHost, hedgeMs = HEDGE_MS, maxExtra = MAX_EXTRA_REQUESTS, log = [] } = {}) {
  const host = String(siteHost || "").toLowerCase();
  return async function siteFetch(input, init = {}) {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    let target = null;
    try { target = new URL(url).host.toLowerCase(); } catch { /* not a web address: pass it through */ }
    if (!host || target !== host || (method !== "GET" && method !== "HEAD")) return fetchImpl(input, init);

    const outer = init && init.signal;
    const started = Date.now();
    const attempt = () => {
      const controller = new AbortController();
      if (outer) {
        if (outer.aborted) controller.abort(outer.reason);
        else outer.addEventListener("abort", () => controller.abort(outer.reason), { once: true });
      }
      return Promise.resolve()
        .then(() => fetchImpl(url, { ...init, signal: controller.signal }))
        .then((res) => ({ res }), (err) => ({ err }));
    };

    let row = null;
    const outcome = await new Promise((resolve) => {
      let sent = 0;
      let open = 0;
      let firstErr = null;
      let done = false;
      let timer = null;
      const finish = (value) => { if (done) return; done = true; clearTimeout(timer); resolve(value); };
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
          if (r.res) return finish({ res: r.res, n });
          if (!firstErr) firstErr = r.err;
          // Every request so far has failed outright (not gone silent): that is the answer.
          if (open === 0) finish({ err: firstErr });
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
    return outcome.res;
  };
}
