// Reads a test file's SOURCE and says whether the tests a proof row names are
// really live tests. Tests only; nothing here is product code.
//
// WHY THIS EXISTS. The first version of the batch 05 guard asked
// `source.includes(title)`. That stays green when the test is switched off
// (`test.skip(...)`, `{ skip: true }`), when the title is only left in a
// comment, and when the test body asserts nothing, and node's test runner exits 0
// on a skipped test. A proof row that the lane counts as checked must name tests
// that actually run, so the guard asks this instead.
//
// What counts as a live named test:
//   * a top-level call at column 0:  test("<title>", async () => { ... });
//     (not in a comment, not in a string, not nested in an `if`, no options object)
//   * with at least one assertion in its body
// And the file as a whole must hold no skip / todo / only marker and no process.exit.
//
// It is a source reader, not a parser: it blanks comments with a small scanner that
// understands strings, template literals and regex literals, then matches the
// call shape. The scanner keeps every offset and every newline, so what it returns
// can be matched with ordinary regular expressions.

const WORD = /[A-Za-z0-9_$]/;
const REGEX_AFTER = new Set("(,=:[!&|?{};+-*%<>~^".split(""));
const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "case", "throw", "in", "of", "new", "delete", "void", "yield", "await", "else", "do",
]);

/**
 * The source with every comment replaced by spaces (newlines and length kept).
 * With `{ strings: true }` the inside of every string, template text and regex
 * literal is blanked as well, so a word that only lives in a title cannot be
 * mistaken for code.
 */
export function blankComments(source, { strings = false } = {}) {
  const src = String(source);
  const n = src.length;
  const out = src.split("");
  let prev = "";
  let word = "";
  let lastWasWord = false;

  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k += 1) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  const skipString = (from, quote) => {
    let k = from + 1;
    while (k < n) {
      const c = src[k];
      if (c === "\\") { k += 2; continue; }
      if (c === quote) { if (strings) blank(from + 1, k); return k + 1; }
      if (c === "\n") return k;
      k += 1;
    }
    return k;
  };
  let scanCode;
  const skipTemplate = (from) => {
    let k = from + 1;
    while (k < n) {
      const c = src[k];
      if (c === "\\") { if (strings) blank(k, k + 2); k += 2; continue; }
      if (c === "`") return k + 1;
      if (c === "$" && src[k + 1] === "{") { k = scanCode(k + 2, true) + 1; continue; }
      if (strings) blank(k, k + 1);
      k += 1;
    }
    return k;
  };
  const skipRegex = (from) => {
    let k = from + 1;
    let inClass = false;
    while (k < n) {
      const c = src[k];
      if (c === "\\") { k += 2; continue; }
      if (c === "\n") return k;
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) { if (strings) blank(from + 1, k); k += 1; break; }
      k += 1;
    }
    while (k < n && WORD.test(src[k])) k += 1;
    return k;
  };

  // scanCode returns the index of the closing brace when closeOnBrace, else the end.
  scanCode = (from, closeOnBrace) => {
    let k = from;
    let braces = 0;
    while (k < n) {
      const c = src[k];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") { lastWasWord = false; k += 1; continue; }
      if (c === "/") {
        const next = src[k + 1];
        if (next === "/") {
          let end = k;
          while (end < n && src[end] !== "\n") end += 1;
          blank(k, end);
          k = end;
          continue;
        }
        if (next === "*") {
          let end = src.indexOf("*/", k + 2);
          end = end === -1 ? n : end + 2;
          blank(k, end);
          k = end;
          continue;
        }
        const startsRegex = prev === "" || REGEX_AFTER.has(prev) || (lastWasWord === false && REGEX_AFTER_WORD.has(word));
        if (startsRegex) {
          k = skipRegex(k);
          prev = ")";
          word = "";
          lastWasWord = false;
          continue;
        }
        prev = "/";
        word = "";
        lastWasWord = false;
        k += 1;
        continue;
      }
      if (c === '"' || c === "'") {
        k = skipString(k, c);
        prev = ")";
        word = "";
        lastWasWord = false;
        continue;
      }
      if (c === "`") {
        k = skipTemplate(k);
        prev = ")";
        word = "";
        lastWasWord = false;
        continue;
      }
      if (c === "{") braces += 1;
      if (c === "}") {
        if (closeOnBrace && braces === 0) return k;
        braces -= 1;
      }
      if (WORD.test(c)) {
        word = lastWasWord ? word + c : c;
        lastWasWord = true;
        prev = c;
      } else {
        word = "";
        lastWasWord = false;
        prev = c;
      }
      k += 1;
    }
    return k;
  };

  scanCode(0, false);
  return out.join("");
}

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Anything that switches a test off, or lets a run end before the tests do.
const MARKERS = /\b(?:test|it|describe|suite)\s*\.\s*(?:skip|todo|only)\b|\b(?:skip|todo|only)\s*:|\bprocess\s*\.\s*exit\b/g;
const ASSERTS = /\bassert\w*\s*[.(]/;

/**
 * @param {string} source  a test file's text
 * @param {string[]} titles the test titles a proof row names
 * @returns {{ missing: string[], hollow: string[], markers: string[] }}
 *   missing  no live top-level test with that exact title
 *   hollow   found, but its body holds no assertion
 *   markers  skip / todo / only / process.exit left in the executable code
 */
export function inspectNamedTests(source, titles) {
  const code = blankComments(source);
  // Markers are looked for in code only: a title that says "skip:" is not a skipped test.
  const markers = [...blankComments(source, { strings: true }).matchAll(MARKERS)].map((m) => m[0].replace(/\s+/g, " "));
  const missing = [];
  const hollow = [];
  for (const title of titles) {
    const call = new RegExp(
      `^(?:test|it)\\(\\s*(["'\`])${escapeRegExp(title)}\\1\\s*,\\s*(?:async\\s*)?(?:\\(|function\\b|[A-Za-z_$][\\w$]*\\s*=>)`,
      "m"
    );
    const hit = call.exec(code);
    if (!hit) {
      missing.push(title);
      continue;
    }
    const end = code.indexOf("\n});", hit.index);
    const body = code.slice(hit.index, end === -1 ? code.length : end);
    if (!ASSERTS.test(body)) hollow.push(title);
  }
  return { missing, hollow, markers };
}
