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
// WHAT IT DOES: for a GET or HEAD to the site host only, if no answer has started after HEDGE_MS, it sends
// ONE more identical request (which gets another connection, because the silent one is still busy) and
// uses whichever answers first. Nothing else changes: the caller's abort signal and deadline cover both
// requests, a fast error passes straight through, and a door that answers neither is still a failure.
// No beat deadline, no half-deadline rule and no probe timeout is raised or loosened.
//
// Proof tooling only (scripts/pulse/prove.mjs). The live pulse-probe provider is not changed.

export const HEDGE_MS = 1000;

const pathOf = (url) => {
  try { return new URL(url).pathname; } catch { return "?"; }
};

/**
 * Wrap a fetch so a silent first connection to `siteHost` gets one more try on another connection.
 * @param {Function} fetchImpl the real fetch
 * @param {{ siteHost: string, hedgeMs?: number, log?: Array<object> }} opts `log` gets one row per hedge
 *   ({ method, path, winner: 1 | 2 | 0, ms }); the path never holds a query string.
 */
export function hedgedSiteFetch(fetchImpl, { siteHost, hedgeMs = HEDGE_MS, log = [] } = {}) {
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

    const first = attempt();
    let timer;
    const quiet = new Promise((resolve) => { timer = setTimeout(() => resolve(null), hedgeMs); });
    const early = await Promise.race([first, quiet]);
    clearTimeout(timer);
    if (early) {
      if (early.err) throw early.err;
      return early.res;
    }
    if (outer && outer.aborted) {
      const r = await first;
      if (r.err) throw r.err;
      return r.res;
    }

    // The first connection said nothing for hedgeMs. One more request; the first keeps its connection busy
    // so the pool cannot hand that silent connection to the second request.
    const row = { method, path: pathOf(url), winner: 0, ms: null };
    log.push(row);
    const second = attempt();
    const tagged = [first.then((r) => ({ ...r, n: 1 })), second.then((r) => ({ ...r, n: 2 }))];
    const settledFirst = await Promise.race(tagged);
    let win = settledFirst.res ? settledFirst : null;
    let lose = tagged[settledFirst.n === 1 ? 1 : 0];
    if (!win) {
      const other = await lose;
      if (!other.res) {
        row.ms = Date.now() - started;
        throw (settledFirst.n === 1 ? settledFirst.err : other.err);
      }
      win = other;
      lose = null;
    }
    row.winner = win.n;
    row.ms = Date.now() - started;
    // A late answer from the other request is read off and dropped, so its connection goes back to the pool.
    if (lose) lose.then((r) => { if (r.res && r.res.body) r.res.body.cancel().catch(() => {}); }).catch(() => {});
    return win.res;
  };
}
