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
 * Wrap a fetch so a silent first connection to `siteHost` gets one more try on another connection.
 * @param {Function} fetchImpl the real fetch
 * @param {{ siteHost: string, hedgeMs?: number, log?: Array<object> }} opts `log` gets one row per hedge
 *   ({ method, path, winner: 1 | 2 | 0, ms }); the path never holds a query string.
 */
export function hedgedSiteFetch(fetchImpl, { siteHost, hedgeMs = HEDGE_MS, bodyHedgeMs = BODY_HEDGE_MS, log = [] } = {}) {
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
      const row = { method, path: pathOf(url), winner: 0, ms: null, phase: "body" };
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

    const first = attempt();
    let timer;
    const quiet = new Promise((resolve) => { timer = setTimeout(() => resolve(null), hedgeMs); });
    const early = await Promise.race([first, quiet]);
    clearTimeout(timer);
    if (early) {
      if (early.err) throw early.err;
      return finish(early.res);
    }
    if (outer && outer.aborted) {
      const r = await first;
      if (r.err) throw r.err;
      return finish(r.res);
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
    return finish(win.res);
  };
}
