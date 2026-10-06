// The source check, in code (design §5 rule 14). Unit X1 acceptance: "findings without a
// matching source link are dropped". Pure: built content blocks in, verdicts out.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUrl, normWords, callProvenance, researchJsonOf, parseJsonObject,
  checkQuotes, checkFindings, matchesCited, recheckDocument, quotedSpans
} from "./sources.mjs";

/** One research call's content: two search results, a cited answer, then the JSON. */
function callContent({ json, citations = [], fetch = null } = {}) {
  return [
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "broker backdoored" } },
    {
      type: "web_search_tool_result", tool_use_id: "s1",
      content: [
        { type: "web_search_result", url: "https://www.dailyfunder.com/showthread.php/123-Backdoored?utm_source=x", title: "Backdoored", encrypted_content: "e1" },
        { type: "web_search_result", url: "https://reddit.com/r/loanoriginators/comments/abc/", title: "ISO", encrypted_content: "e2" }
      ]
    },
    ...(fetch ? [
      { type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: fetch.url } },
      { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url: fetch.url, content: { type: "document", source: { type: "text", media_type: "text/plain", data: fetch.text } } } }
    ] : []),
    { type: "text", text: "Brokers say ", citations },
    { type: "text", text: JSON.stringify(json).slice(0, 20) },
    { type: "text", text: JSON.stringify(json).slice(20) }
  ];
}

describe("normalizeUrl", () => {
  test("one form per page: no www, no tracking, no fragment, no trailing slash", () => {
    assert.equal(normalizeUrl("https://www.DailyFunder.com/showthread.php/123-Backdoored?utm_source=x#post9"),
      normalizeUrl("https://dailyfunder.com/showthread.php/123-Backdoored"));
    assert.equal(normalizeUrl("https://reddit.com/r/a/comments/b/"), "reddit.com/r/a/comments/b");
    assert.equal(normalizeUrl("https://ex.com/p?b=2&a=1"), normalizeUrl("https://ex.com/p?a=1&b=2"));
  });

  test("not a web link is null: a platform name, a relative path, another scheme", () => {
    for (const bad of ["DailyFunder thread", "/r/loanoriginators", "ftp://ex.com/a", "javascript:alert(1)", "", null, 7]) {
      assert.equal(normalizeUrl(bad), null, String(bad));
    }
  });
});

describe("callProvenance and the research JSON", () => {
  test("collects the result links, Anthropic's cited text per link, fetched pages and tool errors", () => {
    const content = [
      ...callContent({
        json: {},
        citations: [{ type: "web_search_result_location", url: "https://dailyfunder.com/showthread.php/123-Backdoored", cited_text: "the lender went quiet for two weeks and then funded my merchant directly" }],
        fetch: { url: "https://ex.com/report", text: "Small business lending rose 4% in the second quarter." }
      }),
      { type: "web_search_tool_result", tool_use_id: "s2", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } }
    ];
    const prov = callProvenance(content);
    assert.ok(prov.urls.has("dailyfunder.com/showthread.php/123-backdoored"));
    assert.ok(prov.urls.has("reddit.com/r/loanoriginators/comments/abc"));
    assert.ok(prov.urls.has("ex.com/report"));
    assert.equal(prov.citations.get("dailyfunder.com/showthread.php/123-backdoored").length, 1);
    assert.match(prov.fetched.get("ex.com/report"), /rose 4%/);
    assert.deepEqual(prov.errors, ["web search: max_uses_exceeded"]);
  });

  test("the JSON is the text after the last tool block, joined with no separator", () => {
    const json = { findings: "x", quotes: [{ quote: "a b c", source: "https://ex.com/a" }], nothingNew: false };
    assert.deepEqual(researchJsonOf(callContent({ json })), json);
    assert.deepEqual(parseJsonObject("Here you go:\n```json\n{\"a\":1}\n```"), { a: 1 });
    assert.equal(parseJsonObject("no json here"), null);
    assert.equal(researchJsonOf([{ type: "text", text: "{\"a\":" }]), null);
  });
});

describe("checkQuotes: a quote keeps its link or it is thrown out", () => {
  const CITED = "the lender went quiet for two weeks and then funded my merchant directly";
  const prov = callProvenance(callContent({
    json: {},
    citations: [{ type: "web_search_result_location", url: "https://dailyfunder.com/showthread.php/123-Backdoored", cited_text: `${CITED}...` }]
  }));

  test("FINDINGS WITHOUT A MATCHING SOURCE LINK ARE DROPPED", () => {
    const { kept, dropped } = checkQuotes([
      { quote: "We all got backdoored at least once.", source: "https://made-up-forum.example/thread/1" },
      { quote: "Funders want volume before they sign you.", source: "DailyFunder, a thread about ISOs" },
      { quote: "Nobody answers the phone after you pay.", source: "" },
      { quote: "Renewals are the whole game.", source: "https://reddit.com/r/loanoriginators/comments/OTHER" }
    ], prov);
    assert.equal(kept.length, 0, "not one of these links was in this search's own results");
    assert.equal(dropped.length, 4);
    assert.deepEqual(dropped.map((d) => d.reason), [
      "the link was not in this search's results", "no link", "no link", "the link was not in this search's results"
    ]);
  });

  test("a quote whose words match Anthropic's cited text for the same link is word for word", () => {
    const { kept, dropped } = checkQuotes([
      { quote: "The lender went quiet for two weeks, and then funded my merchant directly!", source: "https://www.dailyfunder.com/showthread.php/123-Backdoored", tag: "Pain" }
    ], prov);
    assert.equal(dropped.length, 0);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].verbatim, true);
    assert.equal(kept[0].tag, "pain");
  });

  test("a real link whose words cannot be matched is kept only as a paraphrase", () => {
    const { kept } = checkQuotes([
      { quote: "My lender cut me out and took the client.", source: "https://dailyfunder.com/showthread.php/123-Backdoored" },
      { quote: "Renewals pay you twice for one sale and that is why", source: "https://reddit.com/r/loanoriginators/comments/abc" },
      { quote: "The lender went quiet for two weeks and then funded my merchant directly", source: "https://dailyfunder.com/showthread.php/123-Backdoored", paraphrase: true }
    ], prov);
    assert.deepEqual(kept.map((k) => k.verbatim), [false, false, false]);
  });

  test("the same words cited for ANOTHER link do not make a quote word for word", () => {
    const { kept } = checkQuotes([{ quote: CITED, source: "https://reddit.com/r/loanoriginators/comments/abc" }], prov);
    assert.equal(kept[0].verbatim, false);
  });

  test("a quote found in a page this call fetched is word for word", () => {
    const p2 = callProvenance(callContent({ json: {}, fetch: { url: "https://ex.com/report", text: "Brokers told us: we never own the renewal, the funder does. That was the top complaint." } }));
    const { kept } = checkQuotes([{ quote: "we never own the renewal, the funder does", source: "https://ex.com/report" }], p2);
    assert.equal(kept[0].verbatim, true);
  });

  test("too short to prove is never word for word", () => {
    assert.equal(matchesCited("ripped off", ["you are getting ripped off"]), false);
  });
});

describe("checkFindings", () => {
  test("a finding is kept only when its link was in this call's search or fetch results", () => {
    const prov = callProvenance(callContent({ json: {}, fetch: { url: "https://ex.com/report", text: "x" } }));
    const { kept, dropped } = checkFindings([
      { source: "https://ex.com/report", information: "Lending rose." },
      { source: "https://www.sba.gov/made-up-study", information: "An invented statistic." },
      { information: "No source at all." }
    ], prov);
    assert.deepEqual(kept.map((k) => k.information), ["Lending rose."]);
    assert.equal(dropped.length, 2);
  });
});

describe("recheckDocument", () => {
  test("a quoted line not in the checked set is marked [UNCHECKED] and counted; nothing is deleted", () => {
    const doc = 'He says "the lender went quiet for two weeks and then funded my merchant directly" and also "I made ten grand my first week easy money".';
    const { text, unchecked } = recheckDocument(doc, [{ quote: "The lender went quiet for two weeks and then funded my merchant directly" }]);
    assert.deepEqual(unchecked, ["I made ten grand my first week easy money"]);
    assert.match(text, /easy money" \[UNCHECKED\]\.$/);
    assert.match(text, /directly" and also/);
    assert.equal(recheckDocument(text, []).unchecked.length, 1, "marked once, never twice");
  });

  test("short quoted words are not treated as quotes", () => {
    assert.equal(quotedSpans('a "named thing" here').length, 0);
    assert.equal(normWords("It’s “OK”..."), "its ok");
  });
});
