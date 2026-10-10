// ClickFunnels funnel doors (apply.fundhub.ai). CRM doors stay on fundhub.ai.
// Audit only. GET pings. Never auto-fix.

export const DEFAULT_FUNNEL_BASE_URL = "https://apply.fundhub.ai";

async function readUrl(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { accept: "text/html" } });
  const text = await res.text();
  return { status: res.status, text };
}

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix, kind: "funnel" };
}

/** SLO $297 sales page — the main paid entry for new buyers. */
export async function checkFunnelRoadmapSales({ fetchImpl, baseUrl = DEFAULT_FUNNEL_BASE_URL }) {
  const origin = String(baseUrl || DEFAULT_FUNNEL_BASE_URL).replace(/\/+$/, "");
  const url = `${origin}/roadmap`;
  try {
    const { status, text } = await readUrl(fetchImpl, url);
    const hasOrder = /id=["']fh-order["']|#fh-order/i.test(text);
    const hasOffer = /Funding Roadmap|Get My Roadmap/i.test(text);
    if (status >= 200 && status < 300 && hasOrder && hasOffer) {
      return check(
        "funnel:roadmap-sales",
        "PASS",
        "apply.fundhub.ai/roadmap loaded with checkout anchor and roadmap offer copy"
      );
    }
    return check(
      "funnel:roadmap-sales",
      "FAIL",
      `roadmap sales ${status}, fh-order missing=${!hasOrder}, offer copy missing=${!hasOffer}`,
      "Open https://apply.fundhub.ai/roadmap and restore the SLO sales HTML (ClickFunnels custom page)."
    );
  } catch (err) {
    return check(
      "funnel:roadmap-sales",
      "FAIL",
      `roadmap sales unreachable: ${String((err && err.message) || err).slice(0, 160)}`,
      "Confirm apply.fundhub.ai DNS and the ClickFunnels page are live."
    );
  }
}
