// A fake callModel for "Research the market" (J2) tests: answers the reach check, the plan,
// each sweep surface, the teardowns, the two checks and the board with Anthropic-shaped
// blocks, and records every call. No network. Unit tests only.

const usage = (input = 1000, output = 500) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

function reply(model, content, { searches = 0, fetches = 0, json = null, input, output } = {}) {
  return {
    mode: "live", status: 200, raw: { model }, error: null, request: {}, stopReason: "end_turn", servedModel: model,
    json, toolInput: null, text: content.filter((b) => b.type === "text").map((b) => b.text).join("\n"),
    usage: usage(input, output), content, serverToolUse: { web_search_requests: searches, web_fetch_requests: fetches }
  };
}

const fetchOk = (id, url, text) => [
  { type: "server_tool_use", id, name: "web_fetch", input: { url } },
  { type: "web_fetch_tool_result", tool_use_id: id, content: { type: "web_fetch_result", url, retrieved_at: "2026-10-06T00:00:00Z", content: { type: "document", source: { type: "text", media_type: "text/plain", data: text }, title: "Page" } } }
];
const fetchErr = (id, url, code) => [
  { type: "server_tool_use", id, name: "web_fetch", input: { url } },
  { type: "web_fetch_tool_result", tool_use_id: id, content: { type: "web_fetch_tool_result_error", error_code: code } }
];
const search = (id, urls) => [
  { type: "server_tool_use", id, name: "web_search", input: { query: "broker in a box" } },
  { type: "web_search_tool_result", tool_use_id: id, content: urls.map((url) => ({ type: "web_search_result", url, title: "Result", encrypted_content: "x" })) }
];

export const PAGE_TEXT = (n) => `Start Your Own Funding Company ${n}. Our Broker Program is $997 one time. Guaranteed first deal in 90 days or your money back.`;

/** fakeMarketModel({ noReach }) → { callModel, calls } */
export function fakeMarketModel({ noReach = false } = {}) {
  const calls = [];
  async function callModel(args) {
    const text = String(args.messages?.[0]?.content || "");
    const model = args.model;
    let label = "other";
    if (args.outputSchema) label = "plan";
    else if (/^Before any research runs/.test(text)) label = "reach";
    else if (/^Round \d+ of an investigation/.test(text)) label = "sweep";
    else if (/^Open this competitor's funnel/.test(text)) label = "teardown";
    else if (/^PROVENANCE CHECK/.test(text)) label = "provenance";
    else if (/^STALENESS CHECK/.test(text)) label = "staleness";
    else if (/^Write the ad research board/.test(text)) label = "board";
    calls.push({ label, model, text, tools: (args.tools || []).map((t) => `${t.name}:${t.max_uses}`) });

    if (label === "reach") {
      if (noReach) {
        return reply(model, [...fetchErr("f1", "https://www.google.com/", "url_not_accessible"), { type: "text", text: "done" }], { fetches: 1 });
      }
      return reply(model, [
        ...fetchOk("f1", "https://www.google.com/", "Google"),
        ...fetchOk("f2", "https://www.youtube.com/", "YouTube"),
        ...fetchErr("f3", "https://www.trustpilot.com/", "url_not_accessible"),
        ...fetchErr("f4", "https://www.reddit.com/", "url_not_allowed"),
        { type: "text", text: "done" }
      ], { fetches: 4 });
    }
    if (label === "plan") {
      const json = { competitors: [{ name: "Fund&Grow", url: "https://fundandgrow.com", why: "known" }], phrasings: ["broker in a box", "ISO training"] };
      return reply(model, [{ type: "text", text: JSON.stringify(json) }], { json });
    }
    if (label === "sweep") {
      const round = Number(/^Round (\d+)/.exec(text)[1]);
      const surface = (/YOUR SURFACE: (\S+)/.exec(text) || [0, "x"])[1].slice(0, 6).replace(/[^a-z]/gi, "").toLowerCase();
      const n = `${round}${surface}`;
      const url = `https://competitor-${n}.example/program`;
      const json = {
        findings: [
          { advertiser: `Competitor ${n}`, headline: `Start Your Own Funding Company ${n}`, promise: "own a business", price: "$997", guarantee: "first deal in 90 days", cta: "Apply", angleId: "own-your-company", sourceUrl: url, evidenceTier: "C" },
          { advertiser: `Ghost ${n}`, headline: "A page nobody opened", price: "$50,000", sourceUrl: `https://ghost-${n}.example/`, evidenceTier: "C" },
          { advertiser: `Competitor ${n}`, headline: `Totally different words ${n}`, price: "$12,345", sourceUrl: url, evidenceTier: "D", angleId: "Big Money!" }
        ],
        burnedOut: [{ angle: "be your own boss", whyYouThinkSo: "everyone says it", sourceUrl: url }, { angle: "unsourced", whyYouThinkSo: "x", sourceUrl: "https://nowhere.example/" }],
        unreachable: [],
        nothingNew: round >= 2
      };
      return reply(model, [
        ...search("s1", [url]),
        ...fetchOk("f1", url, PAGE_TEXT(n)),
        ...fetchErr("f2", `https://slow-${n}.example/pricing`, "url_not_accessible"),
        ...fetchErr("f3", `https://robots-${n}.example/`, "url_not_allowed"),
        { type: "text", text: JSON.stringify(json) }
      ], { searches: 2, fetches: 3 });
    }
    if (label === "teardown") {
      const start = (/START: (\S+)/.exec(text) || [0, ""])[1];
      const json = { advertiser: "Competitor", headline: "Start Your Own Funding Company", promise: "own it", mechanism: "", prices: ["$997", "$5,000 a month"], guarantee: "money back", finalAsk: "book a call", steps: [start], stoppedBecause: "booking page" };
      return reply(model, [...fetchOk("t1", start, PAGE_TEXT("teardown")), { type: "text", text: JSON.stringify(json) }], { fetches: 1 });
    }
    if (label === "provenance") {
      const url = (/, at (\S+):/.exec(text) || [0, ""])[1];
      return reply(model, [...fetchOk("p1", url, PAGE_TEXT("p")), { type: "text", text: JSON.stringify({ survives: true, reason: "The page says it." }) }], { fetches: 1 });
    }
    if (label === "staleness") {
      return reply(model, [{ type: "text", text: JSON.stringify({ survives: true, reason: "Current." }) }], { searches: 1 });
    }
    if (label === "board") {
      const firstUrl = (/https:\/\/competitor-[a-z0-9-]+\.example\/program/.exec(text) || [""])[0];
      const body = [
        "# Ad research board — partner offer",
        "",
        "Confidence: measured",
        "",
        `## 1. The one-line answer\nThis market sells a funding company in a box at $997 (${firstUrl}).`,
        "A link nobody read: https://invented.example/page",
        "",
        "## Review card",
        "",
        "**What this decided:** the market sells boxes.",
        "",
        "**Three things to check:** Do you recognise these competitors? · Is this angle really worn out? · Is anyone actually charging this?",
        "",
        "**What I wasn't sure about:** nothing",
        "",
        "**Say one of:** approve · tweak: <what to change> · redo"
      ].join("\n");
      return reply(model, [{ type: "text", text: body }], { input: 25000, output: 5000 });
    }
    return reply(model, [{ type: "text", text: "{}" }]);
  }
  return { callModel, calls };
}
