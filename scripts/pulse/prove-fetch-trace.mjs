// Diagnostics for the read-only morning proof. Only fixed Fundhub hosts are named;
// URL credentials, query strings, fragments, headers and bodies never enter a trace.

const HOSTS = new Set(["fundhub.ai", "apply.fundhub.ai"]);
const ERROR_NAMES = new Set(["AbortError", "TimeoutError", "TypeError", "Error", "FetchError", "AggregateError"]);
const ERROR_CODES = new Set([
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN", "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
  "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED"
]);

function safeTarget(method, address) {
  if (method !== "GET" && method !== "HEAD") return null;
  try {
    const url = new URL(address);
    const host = url.hostname.toLowerCase();
    return HOSTS.has(host) ? `${host}${url.pathname}` : null;
  } catch { return null; }
}

const elapsed = (now, started) => Math.max(0, now() - started);

export function makeProofFetchTrace({ now = Date.now } = {}) {
  const entries = [];
  return {
    start(method, address) {
      const target = safeTarget(method, address);
      if (!target) return null;
      const started = now();
      let headerMs = null;
      let status = 0;
      let finished = false;
      return {
        headers(value) {
          headerMs = elapsed(now, started);
          status = Number(value) || 0;
        },
        done() {
          if (finished) return;
          finished = true;
          const totalMs = elapsed(now, started);
          entries.push({ method, target, status, headerMs, bodyMs: headerMs === null ? null : totalMs - headerMs, totalMs, phase: "done" });
        },
        fail(error) {
          if (finished) return;
          finished = true;
          const totalMs = elapsed(now, started);
          const name = String(error?.name || "Error");
          const code = String(error?.cause?.code || "");
          entries.push({
            method, target, status, headerMs,
            bodyMs: headerMs === null ? null : totalMs - headerMs,
            totalMs, phase: headerMs === null ? "headers" : "body",
            error: ERROR_NAMES.has(name) ? name : "Error",
            code: ERROR_CODES.has(code) ? code : code ? "other" : "none"
          });
        }
      };
    },
    slowOrFailed(minMs = 1000) {
      return entries.filter((entry) => entry.phase !== "done" || entry.totalMs >= minMs);
    }
  };
}

/** Preserve the existing native fetch options and Response read order while observing timing. */
export async function proofFetch(fetchImpl, url, init, method, trace) {
  const sample = trace.start(method, url);
  try {
    const res = await fetchImpl(url, init);
    const status = res.status;
    sample?.headers(status);
    const headers = [...res.headers.entries()];
    const body = method === "HEAD" ? "" : await res.text();
    const result = { status, headers, body, url: res.url };
    sample?.done();
    return result;
  } catch (error) {
    sample?.fail(error);
    throw error;
  }
}

export function formatProofFetchTrace(entry) {
  const header = entry.headerMs === null ? "n/a" : `${entry.headerMs}ms`;
  const body = entry.bodyMs === null ? "n/a" : `${entry.bodyMs}ms`;
  const failure = entry.phase === "done" ? "" : ` phase=${entry.phase} error=${entry.error} code=${entry.code}`;
  return `${entry.method} ${entry.target} status=${entry.status} headers=${header} body=${body} total=${entry.totalMs}ms${failure}`;
}
