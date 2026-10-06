// A fake callModel for the research tests: answers each kind of research call with blocks
// shaped like Anthropic's (server_tool_use, web_search_tool_result, web_fetch_tool_result,
// text with web_search_result_location citations), and records every call it got.
// No network. Unit tests only.

export const GOOD = (round, i) => `https://good.example/page-${round}-${i}`;
export const QUOTE = "exact words that are really on the page";

function reply({ model, content, searches = 0, fetches = 0, json = null, input = 1000, output = 500 }) {
  return {
    mode: "live", status: 200, raw: { model }, error: null, request: {},
    stopReason: "end_turn", servedModel: model, json, toolInput: null,
    text: content.filter((b) => b.type === "text").map((b) => b.text).join("\n"),
    usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    content,
    serverToolUse: { web_search_requests: searches, web_fetch_requests: fetches }
  };
}

function failure(model, error) {
  return {
    mode: "live", status: 529, raw: null, error, request: {}, stopReason: null, servedModel: null, json: null,
    text: null, toolInput: null, content: [], serverToolUse: { web_search_requests: 0, web_fetch_requests: 0 },
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  };
}

/** A web call's blocks: one search with a real result, one fetch that failed, then the JSON answer split around a citation. */
function webBlocks(url, findingsJsonHead, findingsJsonTail) {
  return [
    { type: "server_tool_use", id: "srv_s1", name: "web_search", input: { query: "funding brokers" } },
    { type: "web_search_tool_result", tool_use_id: "srv_s1", content: [{ type: "web_search_result", url, title: "Good page", encrypted_content: "x", page_age: "2026" }] },
    { type: "server_tool_use", id: "srv_f1", name: "web_fetch", input: { url: "https://blocked.example/pricing" } },
    { type: "web_fetch_tool_result", tool_use_id: "srv_f1", content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" } },
    { type: "text", text: "Here is what I found." },
    { type: "text", text: findingsJsonHead, citations: [{ type: "web_search_result_location", url, title: "Good page", cited_text: `... the page says ${QUOTE} and more ...`, encrypted_index: "i" }] },
    { type: "text", text: findingsJsonTail }
  ];
}

/**
 * fakeResearchModel({ failFirst }) → { callModel, calls }
 * failFirst: a set of call labels ('plan', 'sweep', 'report', …) that fail ONCE with a 529.
 */
export function fakeResearchModel({ failFirst = [], reportLinks = [] } = {}) {
  const calls = [];
  const failed = new Set();
  const once = (label) => failFirst.includes(label) && !failed.has(label) && (failed.add(label), true);

  async function callModel(args) {
    const text = typeof args.messages?.[0]?.content === "string"
      ? args.messages[0].content
      : (args.messages?.[0]?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const model = args.model;
    let label = "other";
    if (args.outputSchema) label = "plan";
    else if (Array.isArray(args.messages?.[0]?.content) && args.messages[0].content.some((b) => b.type === "search_result")) label = "vault";
    else if (/^Round \d+ of an exhaustive/.test(text)) label = "sweep";
    else if (/cites this:/.test(text)) label = "chase";
    else if (/what did everyone MISS/.test(text)) label = "critic";
    else if (/REFUTE|MISLEADING/.test(text)) label = "verify";
    else if (/^Write the research report/.test(text)) label = "report";
    calls.push({ label, model, tools: (args.tools || []).map((t) => `${t.name}:${t.max_uses}`), text });
    if (once(label)) return failure(model, "anthropic 529: {\"type\":\"overloaded_error\"}");

    if (label === "plan") {
      const json = { subQuestions: [1, 2, 3, 4, 5].map((n) => ({ question: `Sub-question ${n}?`, sources: ["forums"], phrasings: ["broker in a box"] })) };
      return reply({ model, content: [{ type: "text", text: JSON.stringify(json) }], json });
    }
    if (label === "vault") {
      const src = args.messages[0].content.find((b) => b.type === "search_result");
      const passage = src.content[0].text;
      const words = passage.split(/\s+/).slice(0, 12).join(" ");
      const json = { findings: [
        { claim: "The vault says the offer matters most.", source: src.source, quote: words, importance: "supporting" },
        { claim: "An invented vault claim.", source: src.source, quote: "words that are not in that file at all anywhere", importance: "key" },
        { claim: "A claim from a file that was not given.", source: "marketing/knowledge/hormozi/not-given.md", quote: words, importance: "key" }
      ] };
      return reply({ model, content: [{ type: "text", text: JSON.stringify(json), citations: [{ type: "search_result_location", source: src.source, title: src.title, cited_text: words }] }] });
    }
    if (label === "sweep" || label === "chase" || label === "critic") {
      const m = /Round (\d+)/.exec(text);
      const round = m ? Number(m[1]) : 9;
      const q = (/Sub-question (\d+)/.exec(text) || [0, label === "chase" ? 7 : 8])[1];
      const url = GOOD(round, `${label}-${q}`);
      const head = `{"findings":[{"claim":"Claim ${label} r${round} q${q}","source":"${url}","quote":"${QUOTE}","importance":"key","cites":["The Smith 2026 broker survey"]},`;
      const tail = `{"claim":"Invented claim ${label} r${round} q${q}","source":"https://invented.example/nope","importance":"key"},{"claim":"Paraphrased ${label} r${round} q${q}","source":"${url}","quote":"words the page never said at all","importance":"supporting"}],"unreachable":["dailyfunder.com (403)"],"nothingNew":${round >= 2 ? "true" : "false"}}`;
      return reply({ model, content: webBlocks(url, head, tail), searches: 3, fetches: 1 });
    }
    if (label === "verify") {
      const survives = !/Paraphrased|critic/.test(text);
      return reply({ model, content: [{ type: "text", text: JSON.stringify({ survives, reason: survives ? "The page says it." : "Could not confirm." }) }], searches: 1 });
    }
    if (label === "report") {
      const firstUrl = (/https:\/\/good\.example\/[a-z0-9-]+/.exec(text) || [""])[0];
      const body = [
        "# The answer",
        "",
        `Most brokers buy a business in a box (${firstUrl}).`,
        `A made-up link: https://made-up.example/claim and ${reportLinks.join(" ")}`
      ].join("\n");
      return reply({ model, content: [{ type: "text", text: body }], input: 30000, output: 4000 });
    }
    return reply({ model, content: [{ type: "text", text: "{}" }] });
  }
  return { callModel, calls };
}
