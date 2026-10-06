// @ts-check
// Nothing invented: the source checks for every research call, in code, not in a prompt.
//
// Design docs/specs/command-center-design-2026-10-05.md §5 safety rule 14: "A web finding
// is kept only when its link appeared in that same call's search or fetch result blocks
// or citations; a quote is marked verbatim only when its words match Anthropic's cited
// text for that link, else it is labelled a paraphrase or dropped; a vault quote must be
// a substring of the named repo file". §6 slice 10: "the research JSON parser (text after
// the last tool result only, joined with no separator, fetch citations off)". Unit X2.
//
// WHAT ONE CALL LEAVES BEHIND (Anthropic Messages API, web-search-tool and web-fetch-tool
// docs, read 2026-10-06):
//   server_tool_use          {id, name:'web_search'|'web_fetch', input:{query}|{url}}
//   web_search_tool_result   {tool_use_id, content: [{type:'web_search_result', url, title,
//                             encrypted_content, page_age}] | {type:'web_search_tool_result_error', error_code}}
//   web_fetch_tool_result    {tool_use_id, content: {type:'web_fetch_result', url,
//                             content:{type:'document', source:{type:'text', data}|{type:'base64',…}, title},
//                             retrieved_at} | {type:'web_fetch_tool_result_error', error_code}}
//   text                     {text, citations?: [{type:'web_search_result_location', url, title,
//                             cited_text (≤150 chars), encrypted_index} | {type:'search_result_location',
//                             source, title, cited_text, …}]}
// Pure functions only: no database, no network.

/** Jina Reader: a plain URL prefix that renders a page to text (the fallback reader). */
export const READER_PREFIX = "https://r.jina.ai/";

const TRACKING_PARAM = /^(utm_[a-z0-9_]+|fbclid|gclid|mc_cid|mc_eid|ref_src)$/i;

/**
 * normalizeUrl(u) → a comparable form ("host/path?query", no scheme, no www, no hash, no
 * tracking params, no trailing slash), or null when it is not a web address. A Jina Reader
 * address normalizes to the page it read.
 */
export function normalizeUrl(u) {
  let s = typeof u === "string" ? u.trim() : "";
  if (!s) return null;
  if (s.toLowerCase().startsWith(READER_PREFIX)) s = s.slice(READER_PREFIX.length);
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) s = `https://${s}`;
    else return null;
  }
  let url;
  try { url = new URL(s); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".")) return null;
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  let p = url.pathname.replace(/\/+$/, "");
  if (p === "/") p = "";
  return `${host}${p}${query}`;
}

/** The host of a URL ("trustpilot.com"), or null. */
export function hostOf(u) {
  const n = normalizeUrl(u);
  return n ? n.split(/[/?]/)[0] : null;
}

/** Same words for matching: lower case, straight quotes, one space, no edge punctuation. */
export function normText(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'.,;:!?()-]+|[\s"'.,;:!?()-]+$/g, "")
    .trim();
}

/**
 * @typedef {{
 *   urls: Map<string, {url: string, title: string|null, via: string}>,
 *   cited: Map<string, string[]>,
 *   fetched: Map<string, string>,
 *   fetchErrors: {url: string|null, code: string}[],
 *   searchErrors: string[],
 *   vaultCited: Map<string, string[]>,
 *   searchQueries: string[]
 * }} Sources
 */

/** An empty source set. */
export function emptySources() {
  return {
    urls: new Map(), cited: new Map(), fetched: new Map(),
    fetchErrors: [], searchErrors: [], vaultCited: new Map(), searchQueries: []
  };
}

function addUrl(out, url, title, via) {
  const n = normalizeUrl(url);
  if (!n) return null;
  if (!out.urls.has(n)) out.urls.set(n, { url: String(url).startsWith(READER_PREFIX) ? String(url).slice(READER_PREFIX.length) : String(url), title: title || null, via });
  return n;
}

function pushMap(map, key, value) {
  if (!key || !value) return;
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

/**
 * collectSources(blocks) → Sources: every link this call's own tool results and
 * citations hold. Nothing the model merely typed counts.
 * @param {any[]} blocks the reply's content blocks (every continuation, in order)
 * @returns {Sources}
 */
export function collectSources(blocks) {
  const out = emptySources();
  const list = Array.isArray(blocks) ? blocks : [];
  /** @type {Map<string, any>} */
  const uses = new Map();
  for (const b of list) {
    if (b && b.type === "server_tool_use" && b.id) uses.set(String(b.id), b);
  }
  for (const b of list) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "server_tool_use" && b.name === "web_search" && b.input && typeof b.input.query === "string") {
      out.searchQueries.push(b.input.query);
    }
    if (b.type === "web_search_tool_result") {
      if (Array.isArray(b.content)) {
        for (const r of b.content) {
          if (r && r.type === "web_search_result" && r.url) addUrl(out, r.url, r.title, "search");
        }
      } else if (b.content && b.content.error_code) {
        out.searchErrors.push(String(b.content.error_code));
      }
    }
    if (b.type === "web_fetch_tool_result") {
      const c = b.content || {};
      if (c.type === "web_fetch_result" && c.url) {
        const n = addUrl(out, c.url, c.content && c.content.title, "fetch");
        const src = c.content && c.content.source;
        if (n && src && src.type === "text" && typeof src.data === "string") {
          out.fetched.set(n, (out.fetched.get(n) || "") + src.data);
        }
      } else if (c.error_code) {
        const use = uses.get(String(b.tool_use_id || ""));
        const url = use && use.input && typeof use.input.url === "string" ? use.input.url : null;
        out.fetchErrors.push({ url, code: String(c.error_code) });
      }
    }
    if (b.type === "text" && Array.isArray(b.citations)) {
      for (const c of b.citations) {
        if (!c) continue;
        if (c.type === "web_search_result_location" && c.url) {
          const n = addUrl(out, c.url, c.title, "cite");
          pushMap(out.cited, n, typeof c.cited_text === "string" ? c.cited_text : "");
        } else if (c.type === "search_result_location" && c.source) {
          pushMap(out.vaultCited, String(c.source), typeof c.cited_text === "string" ? c.cited_text : "");
        }
      }
    }
  }
  return out;
}

/** Merge several calls' sources (a step that made more than one call). */
export function mergeSources(...sets) {
  const out = emptySources();
  for (const s of sets) {
    if (!s) continue;
    for (const [k, v] of s.urls) if (!out.urls.has(k)) out.urls.set(k, v);
    for (const [k, v] of s.cited) out.cited.set(k, [...(out.cited.get(k) || []), ...v]);
    for (const [k, v] of s.fetched) out.fetched.set(k, (out.fetched.get(k) || "") + v);
    for (const [k, v] of s.vaultCited) out.vaultCited.set(k, [...(out.vaultCited.get(k) || []), ...v]);
    out.fetchErrors.push(...s.fetchErrors);
    out.searchErrors.push(...s.searchErrors);
    out.searchQueries.push(...s.searchQueries);
  }
  return out;
}

/**
 * The reply's words after its last tool result, joined with NO separator. Web search
 * citations split one answer into many text blocks; joining them back with nothing in
 * between rebuilds the JSON the model wrote. Text before the last tool result is the
 * model talking to itself between searches and is never parsed.
 */
export function textAfterLastToolResult(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  let last = -1;
  list.forEach((b, i) => {
    const t = b && typeof b.type === "string" ? b.type : "";
    if (t === "server_tool_use" || t.endsWith("_tool_result")) last = i;
  });
  return list.slice(last + 1)
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

/**
 * parseJsonObject(text) → the one JSON object in a reply, or null. Takes the text from
 * the first "{" to the last "}" (a fence or a sentence around it is ignored).
 */
export function parseJsonObject(text) {
  const s = String(text || "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try {
    const v = JSON.parse(s.slice(a, b + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Is this link one the call's own results hold? */
export function linkIsSourced(url, sources) {
  const n = normalizeUrl(url);
  return !!n && sources.urls.has(n);
}

/**
 * quoteStatus(quote, url, sources) → 'verbatim' | 'paraphrase' | 'none'
 * verbatim: the words are inside Anthropic's cited text for that same link, or inside
 * the page web fetch returned for it. Anything else is a paraphrase. A blank quote is
 * 'none'. Very short quotes (under 8 letters) never count as checked.
 */
export function quoteStatus(quote, url, sources) {
  const q = normText(quote);
  if (!q) return "none";
  if (q.length < 8) return "paraphrase";
  const n = normalizeUrl(url);
  if (!n) return "paraphrase";
  for (const c of sources.cited.get(n) || []) {
    if (normText(c).includes(q)) return "verbatim";
  }
  const page = sources.fetched.get(n);
  if (page && normText(page).includes(q)) return "verbatim";
  return "paraphrase";
}

/** Does this text appear (same words) on the page or in the cited text of that link? */
export function statedOnPage(textValue, url, sources) {
  return quoteStatus(textValue, url, sources) === "verbatim";
}

/**
 * priceStated(price, url, sources) → true when that page (or Anthropic's cited text for
 * it) states the price as written. Prices are short, so the 8-letter floor for quotes does
 * not apply; a price must hold a digit ("$997", "$5,000 a month").
 */
export function priceStated(price, url, sources) {
  const p = normText(price);
  if (!p || !/\d/.test(p)) return false;
  const n = normalizeUrl(url);
  if (!n) return false;
  for (const c of sources.cited.get(n) || []) if (normText(c).includes(p)) return true;
  const page = sources.fetched.get(n);
  return !!page && normText(page).includes(p);
}

/**
 * vaultQuoteHolds(quote, fileText) → true when the quote's words are in the repo file.
 * The caller reads the file named by the finding (never the model's copy of it).
 */
export function vaultQuoteHolds(quote, fileText) {
  const q = normText(quote);
  if (q.length < 8) return false;
  return normText(fileText).includes(q);
}

const URL_IN_TEXT = /https?:\/\/[^\s)\]>"'`]+/g;

/**
 * keepOnlySourcedLinks(markdown, keptUrls) → { text, removed }
 * Every web address in a written document must be one of the kept sources. Any other
 * is replaced with "(link removed: not one of the sources this run read)". Counted.
 * @param {string} markdown
 * @param {Iterable<string>} keptUrls
 */
export function keepOnlySourcedLinks(markdown, keptUrls) {
  const kept = new Set();
  for (const u of keptUrls) {
    const n = normalizeUrl(u);
    if (n) kept.add(n);
  }
  let removed = 0;
  const text = String(markdown || "").replace(URL_IN_TEXT, (m) => {
    const trimmed = m.replace(/[.,;:!?]+$/, "");
    const tail = m.slice(trimmed.length);
    const n = normalizeUrl(trimmed);
    if (n && kept.has(n)) return m;
    removed += 1;
    return `(link removed: not one of the sources this run read)${tail}`;
  });
  return { text, removed };
}
