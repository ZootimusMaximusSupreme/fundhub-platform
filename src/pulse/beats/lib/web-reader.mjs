// A fetch-shaped reader over a beat's ctx.http, for truth code that was written against fetch.
//
// The morning lanes hand their checks a fetch. A beat has only ctx.http (GET and HEAD through the
// pulse probe, to the hosts the beat declared). webFromHttp(ctx.http) answers the same questions a
// fetch Response does, so one check can run on either clock:
//   status, url (where the read ended, no query string), text(), headers.get(name)
// A read that never got an answer (refused, timed out, no network) THROWS with the probe's reason,
// the way fetch rejects, so a check says "did not answer (...)" and not "answered 0".
//
// GET and HEAD only: any other method throws before anything is asked. Pure: no I/O of its own.

export function webFromHttp(http) {
  return async (url, init = {}) => {
    const method = String((init && init.method) || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") throw new Error(`a pulse beat only reads with GET or HEAD (got ${method})`);
    const headers = init && init.headers && typeof init.headers === "object" ? init.headers : undefined;
    const res = method === "HEAD" ? await http.head(url, { headers }) : await http.get(url, { headers });
    const status = Number(res && res.status) || 0;
    if (!status) throw new Error(String((res && res.error) || "no answer"));
    const body = String((res && (res.body ?? res.bodySnippet)) ?? "");
    const all = (res && res.headers && typeof res.headers === "object") ? res.headers : {};
    return {
      status,
      ok: status >= 200 && status < 300,
      url: String((res && res.finalUrl) || ""),
      truncated: res && res.truncated === true,
      headers: {
        get(name) {
          const key = Object.keys(all).find((k) => k.toLowerCase() === String(name).toLowerCase());
          return key === undefined ? null : String(all[key]);
        }
      },
      text: async () => body,
      json: async () => JSON.parse(body)
    };
  };
}
