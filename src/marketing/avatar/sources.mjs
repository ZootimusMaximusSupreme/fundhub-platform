// @ts-check
// Every research claim keeps its source link — enforced HERE, in code, not in a prompt.
//
// Design docs/specs/command-center-design-2026-10-05.md §5 rule 14 and §6 slice 5a:
//   * A web finding is kept only when its link appeared in that SAME call's search or
//     fetch result blocks. Anything else is dropped, with the reason.
//   * A quote is marked verbatim only when its words match Anthropic's `cited_text`
//     for the same normalized link in the same call (or the text of a page that call
//     fetched). Otherwise it is kept as a [PARAPHRASE].
//   * The documents a model writes afterwards are re-checked: a quoted line that is not
//     in the kept set is marked [UNCHECKED] and counted, never silently kept.
//
// Pure: content blocks in, verdicts out. No network, no database, no clock.

/** A quoted line shorter than this (after normalizing) is too short to prove. */
export const MIN_MATCH_CHARS = 12;

/** A span in a document counts as a quote when it has at least this many words. */
export const MIN_QUOTE_WORDS = 5;

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src)$/i;

/**
 * The comparable form of a link: https/http only, host lowercased without "www.",
 * no fragment, no tracking parameters, no trailing slash. null when it is not a web link.
 * @param {unknown} input
 * @returns {string | null}
 */
export function normalizeUrl(input) {
  if (typeof input !== "string") return null;
  const raw = input.trim().replace(/[)>\].,;]+$/, "");
  if (!/^https?:\/\//i.test(raw)) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".")) return null;
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}` : "";
  let pathname = u.pathname.replace(/\/+$/, "");
  try { pathname = decodeURI(pathname); } catch { /* keep it encoded */ }
  return `${host}${pathname}${query}`.toLowerCase();
}

/**
 * Words only: lowercase, straight quotes, no punctuation, single spaces. The "..." a
 * cited_text ends with (it is cut at 150 characters) is dropped first.
 * @param {unknown} text
 */
export function normWords(text) {
  return String(text ?? "")
    .replace(/(\.\.\.|…)\s*$/u, "")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\[paraphrase\]/g, " ")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What one model call can prove: the links its own search and fetch results held, the
 * text Anthropic cited for each link, the text of each page it fetched, and the
 * errors its tools hit.
 * @param {any[]} content the call's content blocks (callModel's `content`)
 */
export function callProvenance(content) {
  /** @type {Set<string>} */
  const urls = new Set();
  /** @type {Map<string, string[]>} */
  const citations = new Map();
  /** @type {Map<string, string>} */
  const fetched = new Map();
  /** @type {string[]} */
  const errors = [];
  const cite = (url, text) => {
    const k = normalizeUrl(url);
    if (!k || typeof text !== "string" || !text.trim()) return;
    if (!citations.has(k)) citations.set(k, []);
    /** @type {string[]} */ (citations.get(k)).push(text);
  };
  for (const b of Array.isArray(content) ? content : []) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "web_search_tool_result") {
      if (Array.isArray(b.content)) {
        for (const r of b.content) {
          const k = r && r.type === "web_search_result" ? normalizeUrl(r.url) : null;
          if (k) urls.add(k);
        }
      } else if (b.content && b.content.error_code) {
        errors.push(`web search: ${b.content.error_code}`);
      }
    } else if (b.type === "web_fetch_tool_result") {
      const c = b.content || {};
      if (c.type === "web_fetch_result") {
        const k = normalizeUrl(c.url);
        if (k) {
          urls.add(k);
          const src = c.content && c.content.source;
          if (src && src.type === "text" && typeof src.data === "string") fetched.set(k, src.data);
        }
      } else if (c.error_code) {
        errors.push(`web fetch: ${c.error_code}`);
      }
    } else if (b.type === "text" && Array.isArray(b.citations)) {
      for (const c of b.citations) {
        if (c && c.type === "web_search_result_location") cite(c.url, c.cited_text);
      }
    }
  }
  return { urls, citations, fetched, errors };
}

const TOOL_RESULT_TYPES = new Set([
  "web_search_tool_result", "web_fetch_tool_result", "server_tool_use",
  "code_execution_tool_result", "bash_code_execution_tool_result", "text_editor_code_execution_tool_result"
]);

/**
 * The JSON object a research call ends with: the text blocks after its last tool
 * block, joined with no separator (a cited answer is split into many text blocks), then
 * the outermost {...}. null when there is none.
 * @param {any[]} content
 */
export function researchJsonOf(content) {
  const blocks = Array.isArray(content) ? content : [];
  let lastTool = -1;
  blocks.forEach((b, i) => { if (b && TOOL_RESULT_TYPES.has(b.type)) lastTool = i; });
  const text = blocks.slice(lastTool + 1)
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  return parseJsonObject(text);
}

/** The outermost {...} in a text, parsed; null when there is none. */
export function parseJsonObject(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(t.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** True when the quote's words and one of the cited texts contain each other. */
export function matchesCited(quote, citedTexts) {
  const q = normWords(quote);
  if (q.length < MIN_MATCH_CHARS) return false;
  for (const c of citedTexts || []) {
    const n = normWords(c);
    if (n.length < MIN_MATCH_CHARS) continue;
    if (q.includes(n) || n.includes(q)) return true;
  }
  return false;
}

/**
 * checkQuotes(quotes, provenance) → { kept, dropped }
 *
 * kept:    [{ quote, source, url, tag, verbatim }] — source is the link as given,
 *          url its normalized form. verbatim only when the words match a cited text
 *          (or the fetched page) for that same link.
 * dropped: [{ quote, source, reason }] — no link, or a link this call never saw.
 *
 * @param {any[]} quotes the model's quotes ({quote, source, paraphrase?, tag?})
 * @param {ReturnType<typeof callProvenance>} prov
 */
export function checkQuotes(quotes, prov) {
  const kept = [];
  const dropped = [];
  for (const q of Array.isArray(quotes) ? quotes : []) {
    const words = typeof q?.quote === "string" ? q.quote.replace(/^\s*\[PARAPHRASE\]\s*/i, "").trim() : "";
    const source = typeof q?.source === "string" ? q.source.trim() : "";
    if (!words) continue;
    const url = normalizeUrl(source);
    if (!url) { dropped.push({ quote: words, source, reason: "no link" }); continue; }
    if (!prov.urls.has(url)) { dropped.push({ quote: words, source, reason: "the link was not in this search's results" }); continue; }
    const page = prov.fetched.get(url);
    const verbatim = q?.paraphrase !== true && (
      matchesCited(words, prov.citations.get(url) || []) ||
      (typeof page === "string" && normWords(words).length >= MIN_MATCH_CHARS && normWords(page).includes(normWords(words)))
    );
    const tag = typeof q?.tag === "string" && q.tag.trim() ? q.tag.trim().toLowerCase().slice(0, 20) : "tone";
    kept.push({ quote: words, source, url, tag, verbatim });
  }
  return { kept, dropped };
}

/**
 * checkFindings(findings, provenance) → { kept, dropped }. A finding is kept only when
 * its source link was in that call's own search or fetch results.
 * @param {any[]} findings
 * @param {ReturnType<typeof callProvenance>} prov
 */
export function checkFindings(findings, prov) {
  const kept = [];
  const dropped = [];
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!f || typeof f !== "object") continue;
    const source = typeof f.source === "string" ? f.source.trim() : "";
    const url = normalizeUrl(source);
    if (!url) { dropped.push({ ...f, reason: "no link" }); continue; }
    if (!prov.urls.has(url)) { dropped.push({ ...f, reason: "the link was not in this call's results" }); continue; }
    kept.push({ ...f, source, url });
  }
  return { kept, dropped };
}

/** Quoted spans of at least MIN_QUOTE_WORDS words ("…" or “…”) in a document. */
export function quotedSpans(text) {
  const out = [];
  const re = /["“]([^"“”\n]{8,600})["”]/g;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const span = m[1].trim();
    if (span.split(/\s+/).length >= MIN_QUOTE_WORDS) out.push({ span, index: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * recheckDocument(text, kept) → { text, unchecked }
 *
 * Every quoted line of five words or more must be found in the kept quotes (either
 * one inside the other, by words). One that is not gets " [UNCHECKED]" after its
 * closing mark and is listed. Nothing is deleted: the reader sees it and its count.
 * @param {string} text
 * @param {Array<{quote: string}>} kept
 */
export function recheckDocument(text, kept) {
  const bank = (kept || []).map((k) => normWords(k.quote)).filter((s) => s.length >= MIN_MATCH_CHARS);
  const spans = quotedSpans(text);
  /** @type {string[]} */
  const unchecked = [];
  let out = "";
  let at = 0;
  const src = String(text || "");
  for (const s of spans) {
    const n = normWords(s.span);
    const found = n.length >= MIN_MATCH_CHARS && bank.some((b) => b.includes(n) || n.includes(b));
    out += src.slice(at, s.end);
    if (!found && !src.slice(s.end, s.end + 12).startsWith(" [UNCHECKED]")) {
      out += " [UNCHECKED]";
      unchecked.push(s.span);
    }
    at = s.end;
  }
  out += src.slice(at);
  return { text: out, unchecked };
}
