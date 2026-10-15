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
//     (not in a comment, not in a string, not inside any bracket pair such as an
//     `if` block or a `describe`, no options object)
//   * with at least one assertion in its body that is not a tautology
//     (assert.ok(true), assert.equal(1, 1) hold no result and do not count)
//   * whose body never leaves early: no `return`, `break` or `continue` at the
//     callback's own level (inside a nested function they are ordinary code).
//     A test that returns before its assertions still passes, and so does one
//     that calls t.skip() and returns; node's runner exits 0 on both.
// The assertion helpers the file declares at top level (function assertX(...))
// are held to the same two rules, because a test that calls a helper that was
// emptied or made to return at once is a test that was switched off one step away.
// And the file as a whole must hold no skip / todo / only call or key (t.skip,
// ctx.todo, test.only, { skip: ... }), no constant-false `if`, and no
// process.exit.
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
// `.skip` / `.todo` / `.only` are matched on ANY receiver, not only `test`: the
// first version read test.skip and nothing else, so t.skip("off") then return
// kept the guard green. A constant-false `if` is the same switch written by hand.
const MARKERS = new RegExp([
  "\\.\\s*(?:skip|todo|only)\\b",
  "\\b(?:skip|todo|only)\\s*:",
  "\\bprocess\\s*\\.\\s*(?:exit|abort|kill)\\b",
  "\\bif\\s*\\(\\s*(?:false|0|null|undefined)\\s*\\)",
].join("|"), "g");
const ASSERTS = /\bassert\w*\s*[.(]/;
// Statements that end a callback, or a loop turn inside it, before its last line.
const EXIT_WORDS = new Set(["return", "break", "continue"]);
// A `(`...`)` before a `{` is a function body unless the word before the `(` is one of these.
const CONTROL_WORDS = new Set(["if", "for", "while", "switch", "catch", "with", "await"]);
// assert.<these>(...) with only literal arguments can never fail.
const TAUTOLOGY_CALLS = /^assert(?:\s*\.\s*(?:ok|equal|strictEqual|deepEqual|deepStrictEqual|notEqual|notStrictEqual|notDeepEqual|notDeepStrictEqual|match|doesNotMatch))?$/;
const LITERAL_ARG = /^\s*(?:true|false|null|undefined|NaN|-?\d[\d_.]*|"[^"]*"|'[^']*'|`[^`]*`|\/[^/]*\/[a-z]*|\[\s*\]|\{\s*\})\s*$/;

/** Index of the bracket that closes the one at `open`, or -1. `shape` has strings and comments blanked. */
function matching(shape, open, up, down) {
  let depth = 0;
  for (let i = open; i < shape.length; i += 1) {
    if (shape[i] === up) depth += 1;
    else if (shape[i] === down) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Top-level comma split of an argument list text. */
function splitArgs(text) {
  const args = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (c === "," && depth === 0) {
      args.push(text.slice(from, i));
      from = i + 1;
    }
  }
  const last = text.slice(from);
  if (last.trim() !== "") args.push(last);
  return args;
}

/**
 * Where the callback of a matched `test("title", <callback>` call has its body:
 * { open, close } are the indexes of its `{` and `}`; null for an expression body.
 * `from` is the index just past the matched call prefix, `matched` its text.
 */
function callbackBody(shape, from, matched) {
  let i = from;
  if (matched.endsWith("(")) {
    const close = matching(shape, from - 1, "(", ")");
    if (close === -1) return null;
    i = close + 1;
  } else if (/function$/.test(matched)) {
    const open = shape.indexOf("(", from);
    const close = open === -1 ? -1 : matching(shape, open, "(", ")");
    if (close === -1) return null;
    i = close + 1;
  }
  while (i < shape.length && /\s/.test(shape[i])) i += 1;
  if (shape.startsWith("=>", i)) {
    i += 2;
    while (i < shape.length && /\s/.test(shape[i])) i += 1;
  }
  if (shape[i] !== "{") return null;
  const close = matching(shape, i, "{", "}");
  return { open: i, close: close === -1 ? shape.length : close };
}

/** Does the `{` at `at` open a function body (as opposed to a block or an object)? */
function opensFunction(shape, at) {
  let k = at - 1;
  while (k >= 0 && /\s/.test(shape[k])) k -= 1;
  if (k >= 1 && shape[k] === ">" && shape[k - 1] === "=") return true;
  if (shape[k] !== ")") return false;
  let depth = 0;
  let q = k;
  for (; q >= 0; q -= 1) {
    if (shape[q] === ")") depth += 1;
    else if (shape[q] === "(") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  let p = q - 1;
  while (p >= 0 && /\s/.test(shape[p])) p -= 1;
  let e = p;
  while (e >= 0 && WORD.test(shape[e])) e -= 1;
  return !CONTROL_WORDS.has(shape.slice(e + 1, p + 1));
}

/**
 * The `return` / `break` / `continue` statements that belong to the callback
 * itself (or a loop or block inside it), not to a function nested in it.
 */
export function ownLevelExits(shape, open, close) {
  const found = new Set();
  const stack = [];
  for (let i = open + 1; i < close; i += 1) {
    const c = shape[i];
    if (c === "{") {
      stack.push(opensFunction(shape, i));
      continue;
    }
    if (c === "}") {
      stack.pop();
      continue;
    }
    if (!/[A-Za-z_$]/.test(c) || (i > 0 && WORD.test(shape[i - 1]))) continue;
    let j = i;
    while (j < close && WORD.test(shape[j])) j += 1;
    const word = shape.slice(i, j);
    let b = i - 1;
    while (b >= 0 && /\s/.test(shape[b])) b -= 1;
    if (EXIT_WORDS.has(word) && shape[b] !== "." && !stack.includes(true)) found.add(word);
    i = j - 1;
  }
  return [...found];
}

/** Every assert call in a body, with its argument texts. */
function assertionCalls(shapeBody) {
  const calls = [];
  const re = /\b(assert\w*(?:\s*\.\s*\w+)?)\s*\(/g;
  for (let m = re.exec(shapeBody); m; m = re.exec(shapeBody)) {
    const open = m.index + m[0].length - 1;
    const close = matching(shapeBody, open, "(", ")");
    const inner = shapeBody.slice(open + 1, close === -1 ? shapeBody.length : close);
    calls.push({ name: m[1].replace(/\s+/g, ""), args: splitArgs(inner) });
  }
  return calls;
}

/** True when the body holds an assertion that can fail: not a helper-free tautology. */
function holdsRealAssertion(shapeBody) {
  return assertionCalls(shapeBody).some(({ name, args }) => {
    const tautology = TAUTOLOGY_CALLS.test(name) && args.length > 0 && args.every((arg) => LITERAL_ARG.test(arg));
    return !tautology;
  });
}

/**
 * @param {string} source  a test file's text
 * @param {string[]} titles the test titles a proof row names
 * @returns {{ missing: string[], hollow: string[], markers: string[], earlyExit: string[], gutted: string[] }}
 *   missing    no live top-level test with that exact title
 *   hollow     found, but its body holds no assertion, or only tautologies
 *   markers    skip / todo / only / process.exit / a constant-false if, left in the code
 *   earlyExit  found, but its body can return, break or continue at its own level
 *   gutted     a top-level assert* helper with no assertion that can fail, or that can
 *              return, break or continue at its own level
 */
export function inspectNamedTests(source, titles) {
  const code = blankComments(source);
  // Markers and nesting are read from code only: a title that says "skip:" is not
  // a skipped test, and a bracket inside a string does not open a block.
  const shape = blankComments(source, { strings: true });
  const markers = [...shape.matchAll(MARKERS)].map((m) => m[0].replace(/\s+/g, " "));
  // Bracket depth at every offset: a test is only live when its call sits at depth 0.
  const depthAt = new Int32Array(shape.length + 1);
  for (let i = 0, d = 0; i < shape.length; i += 1) {
    depthAt[i] = d;
    const c = shape[i];
    if (c === "(" || c === "{" || c === "[") d += 1;
    else if (c === ")" || c === "}" || c === "]") d -= 1;
  }
  const missing = [];
  const hollow = [];
  const earlyExit = [];
  for (const title of titles) {
    const call = new RegExp(
      `^(?:test|it)\\(\\s*(["'\`])${escapeRegExp(title)}\\1\\s*,\\s*(?:async\\s*)?(?:\\(|function\\b|[A-Za-z_$][\\w$]*\\s*=>)`,
      "gm"
    );
    const hit = [...code.matchAll(call)].find((m) => depthAt[m.index] === 0);
    if (!hit) {
      missing.push(title);
      continue;
    }
    const callback = callbackBody(shape, hit.index + hit[0].length, hit[0]);
    const open = callback ? callback.open : hit.index;
    const close = callback ? callback.close : shape.length;
    const body = shape.slice(open, close + 1);
    if (!ASSERTS.test(body) || !holdsRealAssertion(body)) hollow.push(title);
    if (callback && ownLevelExits(shape, callback.open, callback.close).length) earlyExit.push(title);
  }
  const gutted = [];
  const helper = /^(?:async\s+)?function\s+(assert\w*)\s*\(/gm;
  for (const m of shape.matchAll(helper)) {
    if (depthAt[m.index] !== 0) continue;
    const callback = callbackBody(shape, m.index + m[0].length, m[0]);
    if (!callback) {
      gutted.push(m[1]);
      continue;
    }
    const body = shape.slice(callback.open, callback.close + 1);
    if (!holdsRealAssertion(body) || ownLevelExits(shape, callback.open, callback.close).length) gutted.push(m[1]);
  }
  return { missing, hollow, markers, earlyExit, gutted };
}
