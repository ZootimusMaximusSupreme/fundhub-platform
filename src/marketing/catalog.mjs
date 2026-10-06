// src/marketing/catalog.mjs — the animation catalog the script writer picks from.
//
// WHAT IT MAKES. marketing/broll/catalog.json: one entry per Remotion
// composition the B-roll kit registers, in Root.tsx order:
//   {id, width, height, fps, min_frames, max_frames, default_props, purpose, data_tied}
// The writer (spec §7.6) may only name a template that is in this list, may only
// send prop keys that are in its default_props, and must keep its seconds
// between min_frames / fps and max_frames / fps. src/marketing/animation-plan.mjs
// holds those checks.
//
// WHY IT READS SOURCE TEXT INSTEAD OF RUNNING THE KIT. The kit is TypeScript and
// React. TypeScript is only a transitive install at the repo root, and the kit's
// own node_modules (remotion, react) are not installed here or in CI. Declaring
// either would be a new dependency (CLAUDE.md §8). So this file carries a small
// reader for the subset of TypeScript the kit's registration code is written in:
// numbers, strings, object and array literals, spreads, member access, `as`
// casts, arrow functions with an expression or a `const ... return` body,
// Math.min/max/round, ternaries, `??`, `typeof`, and self-closing JSX. It folds
// those expressions to values. It never runs a template, never renders a frame,
// and never imports anything from the kit.
//
// ANYTHING IT CANNOT READ IS A HARD STOP, NEVER A GUESS. A value outside that
// subset throws CatalogReadError naming the file and line. The builder brief
// says: if a value cannot be read without executing TypeScript, stop and ask.
// A thrown error is that stop. Nothing here fills a gap with a default.
//
// WHERE EACH FIELD COMES FROM
// - The list: the tree RemotionRoot (src/Root.tsx) returns, followed through
//   the modules it imports, so a composition counts only if Root registers it.
//   ContactSheet and DepthKitDemo are tools, not ad clips, and are skipped
//   (spec §7.3).
// - id, width, height, fps, default_props: the <Composition> element's props.
// - min_frames, max_frames: the composition's own calculateMetadata clamp,
//   evaluated with a very short and a very long requested length. Each clip
//   family in the kit has its own clamp (60-90, 75-105, 75-120, 90-120,
//   105-135, 120-180 frames), so one kit-wide number would be wrong for most.
// - purpose: for the registry templates, the registry's own `title` and `what`
//   strings. For the rest, the first paragraph of the header comment in the
//   file that defines the component. No comment means null, and the caller
//   lists it. A purpose is never written by this file.
// - data_tied: isDataTied() from ./animation-plan.mjs (spec §7.3: these read
//   only their own sample or approval files, so the writer sends them no props).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isDataTied } from "./animation-plan.mjs";

/** Compositions that are kit tools, never ad clips (spec §7.3). */
export const CATALOG_SKIP = Object.freeze(["ContactSheet", "DepthKitDemo"]);

/** The kit's entry point and the component that registers every composition. */
export const ROOT_FILE = "src/Root.tsx";
export const ROOT_EXPORT = "RemotionRoot";
/** The registry list whose title and what strings become a template's purpose. */
export const REGISTRY_EXPORT = "TEMPLATES";

/* The lengths used to read each clamp. A clamp that hands either one straight
   back has no floor or no ceiling, which the kit never does today; the builder
   stops rather than write a range that is not one. */
const PROBE_SHORT = 1;
const PROBE_LONG = 100000;

export class CatalogReadError extends Error {
  constructor(message) {
    super(message);
    this.name = "CatalogReadError";
  }
}

// ---------------------------------------------------------------------------
// Lexer. JavaScript tokens only; JSX is read straight from the text by the
// parser, because JSX text is not JavaScript (an apostrophe in it is not a
// string).

const PUNCTUATORS = [
  ">>>=", "...", "===", "!==", "**=", "??=", "&&=", "||=", "<<=", ">>=", ">>>",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "**", "++", "--", "+=", "-=",
  "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>",
  "{", "}", "(", ")", "[", "]", ";", ",", "<", ">", "+", "-", "*", "/", "%", "&",
  "|", "^", "!", "~", "?", ":", "=", ".", "@", "#"
];

/* Words after which a slash starts a regular expression rather than a division. */
const REGEX_AFTER_WORDS = new Set([
  "return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void",
  "throw", "instanceof", "yield", "await"
]);

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[\w$]/;
const NUMBER_RE = /^(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/;

function lineOf(src, pos) {
  let line = 1;
  for (let i = 0; i < pos && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

class Lexer {
  constructor(src, pos, file) {
    this.src = src;
    this.pos = pos;
    this.file = file;
    this.prev = null; // last significant token, for the regex-or-division call
  }

  fail(msg, at = this.pos) {
    throw new CatalogReadError(`${this.file}:${lineOf(this.src, at)}: ${msg}`);
  }

  skipTrivia() {
    const s = this.src;
    for (;;) {
      const c = s[this.pos];
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v" || c === "﻿") { this.pos++; continue; }
      if (c === "/" && s[this.pos + 1] === "/") {
        const nl = s.indexOf("\n", this.pos);
        this.pos = nl === -1 ? s.length : nl + 1;
        continue;
      }
      if (c === "/" && s[this.pos + 1] === "*") {
        const end = s.indexOf("*/", this.pos + 2);
        if (end === -1) this.fail("a comment never closes");
        this.pos = end + 2;
        continue;
      }
      return;
    }
  }

  regexAllowed() {
    const p = this.prev;
    if (!p) return true;
    if (p.type === "punc") return ![")", "]", "}"].includes(p.v);
    if (p.type === "name") return REGEX_AFTER_WORDS.has(p.v);
    return false;
  }

  next() {
    this.skipTrivia();
    const s = this.src;
    const start = this.pos;
    if (start >= s.length) return this.emit({ type: "eof", v: null, pos: start, end: start });
    const c = s[start];

    if (ID_START.test(c)) {
      let i = start + 1;
      while (i < s.length && ID_PART.test(s[i])) i++;
      this.pos = i;
      return this.emit({ type: "name", v: s.slice(start, i), pos: start, end: i });
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(s[start + 1] || ""))) {
      const m = NUMBER_RE.exec(s.slice(start, start + 64));
      if (!m) this.fail("a number could not be read", start);
      this.pos = start + m[0].length;
      if (m[0].endsWith("n")) this.fail("a BigInt literal is not supported", start);
      return this.emit({ type: "num", v: Number(m[0].replace(/_/g, "")), pos: start, end: this.pos });
    }
    if (c === "'" || c === '"') return this.emit(this.readString(c, start));
    if (c === "`") return this.emit(this.readTemplate(start));
    if (c === "/" && this.regexAllowed()) return this.emit(this.readRegex(start));

    for (const p of PUNCTUATORS) {
      if (s.startsWith(p, start)) {
        // `a?.5:b` is a conditional with a decimal, not optional chaining.
        if (p === "?." && /\d/.test(s[start + 2] || "")) continue;
        this.pos = start + p.length;
        return this.emit({ type: "punc", v: p, pos: start, end: this.pos });
      }
    }
    return this.fail(`unexpected character ${JSON.stringify(c)}`, start);
  }

  emit(tok) {
    if (tok.type !== "eof") this.prev = tok;
    return tok;
  }

  readEscape(i) {
    // i points at the backslash. Returns [text, nextIndex].
    const s = this.src;
    const e = s[i + 1];
    const simple = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" };
    if (e === undefined) this.fail("a string ends in a backslash", i);
    if (e === "\n") return ["", i + 2];
    if (e === "\r") return ["", s[i + 2] === "\n" ? i + 3 : i + 2];
    if (e in simple && !(e === "0" && /\d/.test(s[i + 2] || ""))) return [simple[e], i + 2];
    if (e === "x") {
      const h = s.slice(i + 2, i + 4);
      if (!/^[0-9a-fA-F]{2}$/.test(h)) this.fail("a \\x escape could not be read", i);
      return [String.fromCharCode(parseInt(h, 16)), i + 4];
    }
    if (e === "u") {
      if (s[i + 2] === "{") {
        const close = s.indexOf("}", i + 3);
        const h = s.slice(i + 3, close);
        if (close === -1 || !/^[0-9a-fA-F]+$/.test(h)) this.fail("a \\u{} escape could not be read", i);
        return [String.fromCodePoint(parseInt(h, 16)), close + 1];
      }
      const h = s.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(h)) this.fail("a \\u escape could not be read", i);
      return [String.fromCharCode(parseInt(h, 16)), i + 6];
    }
    return [e, i + 2];
  }

  readString(quote, start) {
    const s = this.src;
    let i = start + 1;
    let out = "";
    for (;;) {
      if (i >= s.length || s[i] === "\n") this.fail("a string never closes", start);
      const c = s[i];
      if (c === quote) break;
      if (c === "\\") {
        const [t, n] = this.readEscape(i);
        out += t;
        i = n;
        continue;
      }
      out += c;
      i++;
    }
    this.pos = i + 1;
    return { type: "str", v: out, pos: start, end: this.pos };
  }

  readTemplate(start) {
    const s = this.src;
    let i = start + 1;
    let cooked = "";
    const quasis = [];
    const exprs = [];
    for (;;) {
      if (i >= s.length) this.fail("a template string never closes", start);
      const c = s[i];
      if (c === "`") break;
      if (c === "\\") {
        const [t, n] = this.readEscape(i);
        cooked += t;
        i = n;
        continue;
      }
      if (c === "$" && s[i + 1] === "{") {
        quasis.push(cooked);
        cooked = "";
        const sub = new Lexer(s, i + 2, this.file);
        let depth = 0;
        let tok;
        for (;;) {
          tok = sub.next();
          if (tok.type === "eof") this.fail("a ${...} in a template string never closes", i);
          if (tok.type === "punc" && tok.v === "{") depth++;
          else if (tok.type === "punc" && tok.v === "}") {
            if (depth === 0) break;
            depth--;
          }
        }
        exprs.push([i + 2, tok.pos]);
        i = tok.end;
        continue;
      }
      cooked += c;
      i++;
    }
    quasis.push(cooked);
    this.pos = i + 1;
    return { type: "tmpl", v: null, quasis, exprs, pos: start, end: this.pos };
  }

  readRegex(start) {
    const s = this.src;
    let i = start + 1;
    let inClass = false;
    for (;;) {
      const c = s[i];
      if (c === undefined || c === "\n") this.fail("a regular expression never closes", start);
      if (c === "\\") { i += 2; continue; }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) break;
      i++;
    }
    i++;
    while (i < s.length && ID_PART.test(s[i])) i++;
    this.pos = i;
    return { type: "regex", v: s.slice(start, i), pos: start, end: i };
  }
}

// ---------------------------------------------------------------------------
// Parser. Expressions only (plus the two statements an arrow body may hold).
// Nodes carry {file, pos} so an evaluation error can name the line.

const BINARY_PRECEDENCE = {
  "??": 2, "||": 2, "&&": 3, "|": 4, "^": 5, "&": 6,
  "==": 7, "!=": 7, "===": 7, "!==": 7,
  "<": 8, ">": 8, "<=": 8, ">=": 8, instanceof: 8, in: 8,
  "<<": 9, ">>": 9, ">>>": 9,
  "+": 10, "-": 10, "*": 11, "/": 11, "%": 11, "**": 12
};
const AS_PRECEDENCE = 8;

class Parser {
  constructor(src, pos, file) {
    this.src = src;
    this.file = file;
    this.lx = new Lexer(src, pos, file);
    this.tok = this.lx.next();
  }

  fail(msg, at = this.tok.pos) {
    throw new CatalogReadError(`${this.file}:${lineOf(this.src, at)}: ${msg}`);
  }

  advance() {
    const t = this.tok;
    this.tok = this.lx.next();
    return t;
  }

  save() { return { pos: this.lx.pos, prev: this.lx.prev, tok: this.tok }; }
  restore(s) { this.lx.pos = s.pos; this.lx.prev = s.prev; this.tok = s.tok; }

  /** Move the lexer to a raw text position (after a JSX element). */
  seek(pos) {
    this.lx.pos = pos;
    this.lx.prev = { type: "name", v: "jsx" }; // a slash after JSX divides
    this.tok = this.lx.next();
  }

  isP(v) { return this.tok.type === "punc" && this.tok.v === v; }
  isN(v) { return this.tok.type === "name" && this.tok.v === v; }

  eat(v) {
    if (!this.isP(v)) this.fail(`expected "${v}" but found ${this.describe()}`);
    return this.advance();
  }

  describe() {
    const t = this.tok;
    if (t.type === "eof") return "the end of the file";
    if (t.type === "str") return JSON.stringify(t.v);
    return `"${this.src.slice(t.pos, t.end)}"`;
  }

  node(type, pos, extra) { return { type, pos, file: this.file, ...extra }; }

  // -- types (skipped, never checked) ---------------------------------------

  /** Skip a type until a depth-0 token in `stops`. Angle brackets count. */
  skipType(stops) {
    let depth = 0;
    for (;;) {
      const t = this.tok;
      if (t.type === "eof") return;
      if (t.type === "punc") {
        if (depth === 0 && stops.includes(t.v)) return;
        if (t.v === "(" || t.v === "[" || t.v === "{" || t.v === "<") depth++;
        else if (t.v === ")" || t.v === "]" || t.v === "}") {
          if (depth === 0) return;
          depth--;
        } else if (t.v === ">" || t.v === ">>" || t.v === ">>>") {
          depth -= t.v.length;
          if (depth < 0) depth = 0;
        } else if (t.v === ">=" || t.v === ">>=") {
          depth -= t.v.length - 1;
          if (depth < 0) depth = 0;
        }
      }
      this.advance();
    }
  }

  /** Skip the type after `as` / `satisfies`: `const`, or a type atom with | and &. */
  skipAsType() {
    if (this.isN("const")) { this.advance(); return; }
    for (;;) {
      this.skipTypeAtom();
      while (this.isP("[")) { this.skipBalanced("[", "]"); }
      if (this.isP("|") || this.isP("&")) { this.advance(); continue; }
      return;
    }
  }

  skipTypeAtom() {
    const t = this.tok;
    if (t.type === "name") {
      if (t.v === "typeof" || t.v === "keyof" || t.v === "readonly" || t.v === "unique") {
        this.advance();
        return this.skipTypeAtom();
      }
      this.advance();
      while (this.isP(".") ) { this.advance(); this.advance(); }
      if (this.isP("<")) this.skipAngles();
      return;
    }
    if (t.type === "str" || t.type === "num" || t.type === "tmpl") { this.advance(); return; }
    if (this.isP("(")) return this.skipBalanced("(", ")");
    if (this.isP("{")) return this.skipBalanced("{", "}");
    if (this.isP("[")) return this.skipBalanced("[", "]");
    if (this.isP("-") ) { this.advance(); this.advance(); return; }
    this.fail(`a type could not be read at ${this.describe()}`);
  }

  skipAngles() {
    let depth = 0;
    for (;;) {
      const t = this.tok;
      if (t.type === "eof") this.fail("a type's <...> never closes");
      if (t.type === "punc") {
        if (t.v === "<") depth++;
        else if (t.v === ">" || t.v === ">>" || t.v === ">>>") {
          depth -= t.v.length;
          if (depth <= 0) { this.advance(); return; }
        }
      }
      this.advance();
    }
  }

  skipBalanced(open, close) {
    let depth = 0;
    for (;;) {
      const t = this.tok;
      if (t.type === "eof") this.fail(`a "${open}" never closes`);
      if (t.type === "punc" && t.v === open) depth++;
      else if (t.type === "punc" && t.v === close) {
        depth--;
        if (depth === 0) { this.advance(); return; }
      }
      this.advance();
    }
  }

  // -- expressions ------------------------------------------------------------

  parseExpression() { return this.parseAssign(); }

  parseAssign() {
    const t = this.tok;
    // x => ...
    if (t.type === "name" && t.v !== "async") {
      const s = this.save();
      this.advance();
      if (this.isP("=>")) {
        this.restore(s);
        return this.parseArrow();
      }
      this.restore(s);
    }
    // (...) => ...  or a parenthesised expression
    if (this.isP("(") && this.looksLikeArrowParams()) return this.parseArrow();
    // <P extends X>(...) => ...  (a generic arrow; JSX otherwise)
    if (this.isP("<") && this.looksLikeTypeParams()) {
      this.skipAngles();
      return this.parseArrow();
    }
    if (t.type === "name" && t.v === "async") this.fail("async functions are not supported");
    const test = this.parseBinary(0);
    if (this.isP("?")) {
      this.advance();
      const consequent = this.parseAssign();
      this.eat(":");
      const alternate = this.parseAssign();
      return this.node("Conditional", test.pos, { test, consequent, alternate });
    }
    if (this.tok.type === "punc" && /^(?:[-+*/%&|^]|\*\*|<<|>>|>>>|&&|\|\||\?\?)?=$/.test(this.tok.v) && this.tok.v !== "==") {
      this.fail("an assignment is not supported here");
    }
    return test;
  }

  looksLikeArrowParams() {
    const s = this.save();
    try {
      this.advance(); // (
      if (this.isP(")")) {
        this.advance();
        return this.isP("=>") || this.isP(":");
      }
      if (this.isP("<")) return false; // (<jsx ... />)
      this.restore(s);
      this.skipBalanced("(", ")");
      if (this.isP("=>")) return true;
      if (this.isP(":")) {
        this.advance();
        this.skipType(["=>", ",", ";", ")", "]", "}", "="]);
        return this.isP("=>");
      }
      return false;
    } catch (e) {
      if (e instanceof CatalogReadError) return false;
      throw e;
    } finally {
      this.restore(s);
    }
  }

  looksLikeTypeParams() {
    const s = this.save();
    try {
      this.advance(); // <
      if (this.tok.type !== "name") return false;
      this.advance();
      return this.isN("extends") || this.isP(",") || this.isP("=");
    } catch (e) {
      if (e instanceof CatalogReadError) return false;
      throw e;
    } finally {
      this.restore(s);
    }
  }

  parseParams() {
    const params = [];
    if (this.tok.type === "name") {
      params.push({ kind: "id", name: this.advance().v, def: null });
      return params;
    }
    this.eat("(");
    while (!this.isP(")")) {
      let rest = false;
      if (this.isP("...")) { this.advance(); rest = true; }
      let p;
      if (this.isP("{")) p = this.parseObjectPattern();
      else if (this.tok.type === "name") p = { kind: "id", name: this.advance().v };
      else this.fail(`a parameter could not be read at ${this.describe()}`);
      if (this.isP("?")) this.advance();
      if (this.isP(":")) { this.advance(); this.skipType([",", ")", "="]); }
      p.def = null;
      if (this.isP("=")) { this.advance(); p.def = this.parseAssign(); }
      p.rest = rest;
      params.push(p);
      if (this.isP(",")) this.advance();
      else if (!this.isP(")")) this.fail(`expected "," or ")" in a parameter list, found ${this.describe()}`);
    }
    this.eat(")");
    return params;
  }

  parseObjectPattern() {
    this.eat("{");
    const props = [];
    while (!this.isP("}")) {
      if (this.isP("...")) this.fail("a rest pattern is not supported");
      if (this.tok.type !== "name" && this.tok.type !== "str") this.fail(`a pattern could not be read at ${this.describe()}`);
      const key = this.advance().v;
      let local = key;
      if (this.isP(":")) {
        this.advance();
        if (this.tok.type !== "name") this.fail("a nested pattern is not supported");
        local = this.advance().v;
      }
      let def = null;
      if (this.isP("=")) { this.advance(); def = this.parseAssign(); }
      props.push({ key, local, def });
      if (this.isP(",")) this.advance();
      else if (!this.isP("}")) this.fail(`expected "," or "}" in a pattern, found ${this.describe()}`);
    }
    this.eat("}");
    return { kind: "object", props };
  }

  parseArrow() {
    const pos = this.tok.pos;
    const params = this.parseParams();
    if (this.isP(":")) { this.advance(); this.skipType(["=>"]); }
    this.eat("=>");
    let body;
    if (this.isP("{")) body = this.parseBlock();
    else body = this.parseAssign();
    return this.node("Function", pos, { params, body });
  }

  parseFunctionKeyword() {
    const pos = this.tok.pos;
    this.advance(); // function
    if (this.tok.type === "name") this.advance(); // its own name
    if (this.isP("<")) this.skipAngles();
    const params = this.parseParams();
    if (this.isP(":")) { this.advance(); this.skipType(["{"]); }
    const body = this.parseBlock();
    return this.node("Function", pos, { params, body });
  }

  /* A block body is read when the function is called, not when it is parsed:
     a component body full of JSX is never needed, and its JSX text could not be
     read as JavaScript anyway. Only its extent is found here. */
  parseBlock() {
    const start = this.tok.pos;
    const s = this.save();
    try {
      this.skipBalanced("{", "}");
    } catch (e) {
      if (!(e instanceof CatalogReadError)) throw e;
      this.restore(s);
      this.fail("a function body could not be read");
    }
    return this.node("LazyBlock", start, { start });
  }

  parseBinary(minPrec) {
    let left = this.parseUnary();
    for (;;) {
      const t = this.tok;
      if (t.type === "name" && (t.v === "as" || t.v === "satisfies") && AS_PRECEDENCE >= minPrec) {
        this.advance();
        this.skipAsType();
        continue;
      }
      const op = t.type === "punc" || (t.type === "name" && (t.v === "instanceof" || t.v === "in")) ? t.v : null;
      const prec = op != null ? BINARY_PRECEDENCE[op] : undefined;
      if (prec === undefined || prec < minPrec) return left;
      this.advance();
      const right = op === "**" ? this.parseBinary(prec) : this.parseBinary(prec + 1);
      left = this.node("Binary", left.pos, { op, left, right });
    }
  }

  parseUnary() {
    const t = this.tok;
    if (t.type === "punc" && (t.v === "!" || t.v === "-" || t.v === "+" || t.v === "~")) {
      this.advance();
      return this.node("Unary", t.pos, { op: t.v, arg: this.parseUnary() });
    }
    if (t.type === "name" && (t.v === "typeof" || t.v === "void")) {
      this.advance();
      return this.node("Unary", t.pos, { op: t.v, arg: this.parseUnary() });
    }
    if (t.type === "name" && (t.v === "delete" || t.v === "await")) this.fail(`"${t.v}" is not supported`);
    if (t.type === "punc" && (t.v === "++" || t.v === "--")) this.fail("++ and -- are not supported");
    return this.parsePostfix();
  }

  parsePostfix() {
    let e = this.parsePrimary();
    for (;;) {
      if (this.isP(".")) {
        this.advance();
        if (this.tok.type !== "name") this.fail(`a property name was expected, found ${this.describe()}`);
        e = this.node("Member", e.pos, { object: e, key: this.advance().v, optional: false });
      } else if (this.isP("?.")) {
        this.advance();
        if (this.isP("(")) e = this.node("Call", e.pos, { callee: e, args: this.parseArgs(), optional: true });
        else if (this.isP("[")) {
          this.advance();
          const k = this.parseExpression();
          this.eat("]");
          e = this.node("Index", e.pos, { object: e, index: k, optional: true });
        } else {
          if (this.tok.type !== "name") this.fail("a property name was expected");
          e = this.node("Member", e.pos, { object: e, key: this.advance().v, optional: true });
        }
      } else if (this.isP("[")) {
        this.advance();
        const k = this.parseExpression();
        this.eat("]");
        e = this.node("Index", e.pos, { object: e, index: k, optional: false });
      } else if (this.isP("(")) {
        e = this.node("Call", e.pos, { callee: e, args: this.parseArgs(), optional: false });
      } else if (this.isP("!")) {
        this.advance(); // TypeScript's non-null assertion
      } else if (this.tok.type === "tmpl") {
        this.fail("a tagged template is not supported");
      } else {
        return e;
      }
    }
  }

  parseArgs() {
    this.eat("(");
    const args = [];
    while (!this.isP(")")) {
      if (this.isP("...")) {
        const pos = this.advance().pos;
        args.push(this.node("Spread", pos, { arg: this.parseAssign() }));
      } else {
        args.push(this.parseAssign());
      }
      if (this.isP(",")) this.advance();
      else if (!this.isP(")")) this.fail(`expected "," or ")" in a call, found ${this.describe()}`);
    }
    this.eat(")");
    return args;
  }

  parsePrimary() {
    const t = this.tok;
    switch (t.type) {
      case "num":
      case "str":
        this.advance();
        return this.node("Literal", t.pos, { value: t.v });
      case "tmpl": {
        this.advance();
        const exprs = t.exprs.map(([a, b]) => {
          const sub = new Parser(this.src, a, this.file);
          const e = sub.parseExpression();
          if (sub.tok.pos !== b) sub.fail("a ${...} in a template string could not be read");
          return e;
        });
        return this.node("Template", t.pos, { quasis: t.quasis, exprs });
      }
      case "regex":
        return this.fail("a regular expression is not supported");
      case "name": {
        if (t.v === "true" || t.v === "false") { this.advance(); return this.node("Literal", t.pos, { value: t.v === "true" }); }
        if (t.v === "null") { this.advance(); return this.node("Literal", t.pos, { value: null }); }
        if (t.v === "undefined") { this.advance(); return this.node("Literal", t.pos, { value: undefined }); }
        if (t.v === "function") return this.parseFunctionKeyword();
        if (["new", "this", "class", "super", "yield", "import"].includes(t.v)) this.fail(`"${t.v}" is not supported`);
        this.advance();
        return this.node("Identifier", t.pos, { name: t.v });
      }
      case "punc":
        if (t.v === "(") {
          this.advance();
          const e = this.parseExpression();
          if (this.isP(",")) this.fail("a comma expression is not supported");
          this.eat(")");
          return e;
        }
        if (t.v === "[") return this.parseArray();
        if (t.v === "{") return this.parseObject();
        if (t.v === "<") return this.parseJsx();
        break;
      default:
        break;
    }
    return this.fail(`an expression was expected, found ${this.describe()}`);
  }

  parseArray() {
    const pos = this.eat("[").pos;
    const items = [];
    while (!this.isP("]")) {
      if (this.isP(",")) this.fail("an array hole is not supported");
      if (this.isP("...")) {
        const p = this.advance().pos;
        items.push(this.node("Spread", p, { arg: this.parseAssign() }));
      } else {
        items.push(this.parseAssign());
      }
      if (this.isP(",")) this.advance();
      else if (!this.isP("]")) this.fail(`expected "," or "]" in an array, found ${this.describe()}`);
    }
    this.eat("]");
    return this.node("Array", pos, { items });
  }

  /* An object literal. A property whose value cannot be parsed is kept as an
     Unreadable node rather than failing the whole object: VERT.W can be read
     even if some other property of VERT is code this reader does not know.
     Reading the Unreadable property itself still stops the build. */
  parseObject() {
    const pos = this.eat("{").pos;
    const props = [];
    while (!this.isP("}")) {
      if (this.isP("...")) {
        const p = this.advance().pos;
        props.push({ kind: "spread", value: this.parseAssign(), pos: p });
      } else {
        let key;
        const kt = this.tok;
        if (kt.type === "name" || kt.type === "str") key = String(this.advance().v);
        else if (kt.type === "num") key = String(this.advance().v);
        else if (this.isP("[")) this.fail("a computed property name is not supported");
        else this.fail(`a property name was expected, found ${this.describe()}`);
        if ((key === "get" || key === "set") && this.tok.type === "name") this.fail("getters and setters are not supported");
        if (this.isP(":")) {
          this.advance();
          props.push({ kind: "prop", key, value: this.parseTolerant(), pos: kt.pos });
        } else if (this.isP("(")) {
          const fpos = this.tok.pos;
          const params = this.parseParams();
          if (this.isP(":")) { this.advance(); this.skipType(["{"]); }
          const body = this.parseBlock();
          props.push({ kind: "prop", key, value: this.node("Function", fpos, { params, body }), pos: kt.pos });
        } else if (kt.type === "name") {
          props.push({ kind: "prop", key, value: this.node("Identifier", kt.pos, { name: key }), pos: kt.pos });
        } else {
          this.fail(`expected ":" after a property name, found ${this.describe()}`);
        }
      }
      if (this.isP(",")) this.advance();
      else if (!this.isP("}")) this.fail(`expected "," or "}" in an object, found ${this.describe()}`);
    }
    this.eat("}");
    return this.node("Object", pos, { props });
  }

  parseTolerant() {
    const s = this.save();
    try {
      return this.parseAssign();
    } catch (e) {
      if (!(e instanceof CatalogReadError)) throw e;
      this.restore(s);
      const pos = this.tok.pos;
      this.skipToDelimiter();
      return this.node("Unreadable", pos, { reason: e.message });
    }
  }

  skipToDelimiter() {
    let depth = 0;
    for (;;) {
      const t = this.tok;
      if (t.type === "eof") this.fail("an object property never ends");
      if (t.type === "punc") {
        if (depth === 0 && (t.v === "," || t.v === "}")) return;
        if (t.v === "(" || t.v === "[" || t.v === "{") depth++;
        else if (t.v === ")" || t.v === "]" || t.v === "}") depth--;
      }
      this.advance();
    }
  }

  // -- JSX, read from the raw text ---------------------------------------------

  parseJsx() {
    const lt = this.tok;
    const { node, end } = this.readJsxElement(lt.pos);
    this.seek(end);
    return node;
  }

  rawSkipSpace(i) {
    const s = this.src;
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s.startsWith("//", i)) { const nl = s.indexOf("\n", i); i = nl === -1 ? s.length : nl + 1; continue; }
      if (s.startsWith("/*", i)) { const e = s.indexOf("*/", i + 2); if (e === -1) this.fail("a comment never closes", i); i = e + 2; continue; }
      return i;
    }
  }

  /** Parse one expression starting at raw position i; it must end at a "}". */
  readBraced(i) {
    const sub = new Parser(this.src, i, this.file);
    const expr = sub.parseExpression();
    if (!sub.isP("}")) sub.fail(`expected "}" after a JSX expression, found ${sub.describe()}`);
    return { expr, end: sub.tok.end };
  }

  /** i is the position of "<". Returns {node, end}. */
  readJsxElement(i) {
    const s = this.src;
    const pos = i;
    i = this.rawSkipSpace(i + 1);
    if (s[i] === ">") {
      const { children, end } = this.readJsxChildren(i + 1, "");
      return { node: this.node("Jsx", pos, { tag: null, attrs: [], children }), end };
    }
    const m = /^[A-Za-z_$][\w$.\-:]*/.exec(s.slice(i, i + 200));
    if (!m) this.fail("a JSX tag name could not be read", i);
    const tag = m[0];
    i += tag.length;
    const attrs = [];
    for (;;) {
      i = this.rawSkipSpace(i);
      if (s.startsWith("/>", i)) {
        return { node: this.node("Jsx", pos, { tag, attrs, children: [] }), end: i + 2 };
      }
      if (s[i] === ">") {
        const { children, end } = this.readJsxChildren(i + 1, tag);
        return { node: this.node("Jsx", pos, { tag, attrs, children }), end };
      }
      if (s[i] === "{") {
        const j = this.rawSkipSpace(i + 1);
        if (!s.startsWith("...", j)) this.fail("a JSX attribute could not be read", i);
        const { expr, end } = this.readBraced(j + 3);
        attrs.push({ kind: "spread", value: expr, pos: i });
        i = end;
        continue;
      }
      const am = /^[A-Za-z_$][\w$\-:]*/.exec(s.slice(i, i + 200));
      if (!am) this.fail("a JSX attribute name could not be read", i);
      const name = am[0];
      const apos = i;
      i = this.rawSkipSpace(i + name.length);
      if (s[i] !== "=") {
        attrs.push({ kind: "prop", key: name, value: this.node("Literal", apos, { value: true }), pos: apos });
        continue;
      }
      i = this.rawSkipSpace(i + 1);
      if (s[i] === '"' || s[i] === "'") {
        const close = s.indexOf(s[i], i + 1);
        if (close === -1) this.fail("a JSX attribute string never closes", i);
        attrs.push({ kind: "prop", key: name, value: this.node("Literal", i, { value: s.slice(i + 1, close) }), pos: apos });
        i = close + 1;
        continue;
      }
      if (s[i] === "{") {
        const { expr, end } = this.readBraced(i + 1);
        attrs.push({ kind: "prop", key: name, value: expr, pos: apos });
        i = end;
        continue;
      }
      if (s[i] === "<") {
        const { node, end } = this.readJsxElement(i);
        attrs.push({ kind: "prop", key: name, value: node, pos: apos });
        i = end;
        continue;
      }
      this.fail("a JSX attribute value could not be read", i);
    }
  }

  readJsxChildren(i, tag) {
    const s = this.src;
    const children = [];
    for (;;) {
      if (i >= s.length) this.fail(`<${tag || ""}> never closes`, i);
      if (s.startsWith("</", i)) {
        const close = s.indexOf(">", i);
        if (close === -1) this.fail("a closing tag never ends", i);
        const name = s.slice(i + 2, close).trim();
        if (name !== tag) this.fail(`</${name}> closes <${tag || ""}>`, i);
        return { children, end: close + 1 };
      }
      if (s[i] === "<") {
        const { node, end } = this.readJsxElement(i);
        children.push(node);
        i = end;
        continue;
      }
      if (s[i] === "{") {
        const j = this.rawSkipSpace(i + 1);
        if (s[j] === "}") { i = j + 1; continue; } // {/* a comment */}
        const { expr, end } = this.readBraced(i + 1);
        children.push(expr);
        i = end;
        continue;
      }
      let j = i;
      while (j < s.length && s[j] !== "<" && s[j] !== "{") j++;
      const text = s.slice(i, j).replace(/\s+/g, " ").trim();
      if (text) children.push(this.node("Literal", i, { value: text }));
      i = j;
    }
  }

  /** Statements inside an arrow or function body: const/let, return, if-return. */
  parseStatements() {
    const out = [];
    this.eat("{");
    while (!this.isP("}")) {
      if (this.isP(";")) { this.advance(); continue; }
      if (this.isN("const") || this.isN("let")) {
        this.advance();
        for (;;) {
          if (this.tok.type !== "name") this.fail("only plain const names are supported in a function body");
          const name = this.advance().v;
          if (this.isP(":")) { this.advance(); this.skipType(["=", ",", ";"]); }
          this.eat("=");
          out.push({ kind: "const", name, value: this.parseAssign() });
          if (this.isP(",")) { this.advance(); continue; }
          break;
        }
        continue;
      }
      if (this.isN("return")) {
        this.advance();
        out.push({ kind: "return", value: this.isP(";") || this.isP("}") ? null : this.parseExpression() });
        continue;
      }
      if (this.isN("if")) {
        this.advance();
        this.eat("(");
        const test = this.parseExpression();
        this.eat(")");
        if (!this.isN("return")) this.fail("only `if (...) return ...` is supported in a function body");
        this.advance();
        out.push({ kind: "ifReturn", test, value: this.isP(";") || this.isP("}") ? null : this.parseExpression() });
        continue;
      }
      this.fail(`a statement could not be read at ${this.describe()}`);
    }
    this.eat("}");
    return out;
  }
}

// ---------------------------------------------------------------------------
// Modules: top-level declarations and imports, found by scanning lines.

function resolvePath(sources, fromFile, spec) {
  if (!spec.startsWith(".")) return null; // a package: remotion, react, ...
  const parts = fromFile.split("/");
  parts.pop();
  for (const seg of spec.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  const base = parts.join("/");
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (Object.prototype.hasOwnProperty.call(sources, cand)) return cand;
  }
  throw new CatalogReadError(`${fromFile}: the import "${spec}" does not resolve to a file in the kit`);
}

function parseImportClause(clause, from, target, imports) {
  let c = clause.trim();
  if (c.startsWith("type ")) return; // import type {...}
  const named = /\{([\s\S]*)\}/.exec(c);
  if (named) {
    for (const raw of named[1].split(",")) {
      let item = raw.trim();
      if (!item) continue;
      if (item.startsWith("type ")) continue;
      const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(item);
      if (!m) throw new CatalogReadError(`${from}: an import could not be read: ${item}`);
      imports.set(m[2] || m[1], { target, imported: m[1] });
    }
    c = c.replace(named[0], "").replace(/,\s*$/, "").replace(/^\s*,/, "").trim();
  }
  if (!c) return;
  const ns = /^\*\s+as\s+([\w$]+)$/.exec(c);
  if (ns) { imports.set(ns[1], { target, imported: "*" }); return; }
  const def = /^([\w$]+)$/.exec(c.replace(/,$/, "").trim());
  if (def) { imports.set(def[1], { target, imported: "default" }); return; }
  throw new CatalogReadError(`${from}: an import could not be read: ${clause.trim()}`);
}

const DECL_RE = /^(?:export\s+)?(?:declare\s+)?(const|let|var|function)\s+([A-Za-z_$][\w$]*)/;

class Module {
  constructor(sources, file) {
    this.file = file;
    this.src = sources[file];
    this.decls = new Map(); // name -> {pos (of the keyword), kind}
    this.imports = new Map(); // local -> {target (file | {pkg}), imported}
    this.reexports = new Map(); // exported -> {target, imported}
    this.localExports = new Map(); // `export {local as exported}` -> local
    this.starExports = []; // files
    this.values = new Map(); // name -> evaluated value (memo)
    this.busy = new Set();
    this.scan(sources);
  }

  scan(sources) {
    const src = this.src;
    // The clause holds no ";" or quote, so a match never runs on past a
    // side-effect import (`import './x';`) into the next statement.
    const importRe = /^import\s+([^;'"]*?)\s+from\s+['"]([^'"]+)['"]/gm;
    let m;
    while ((m = importRe.exec(src))) {
      const target = resolvePath(sources, this.file, m[2]) ?? { pkg: m[2] };
      parseImportClause(m[1], this.file, target, this.imports);
    }
    const localRe = /^export\s+\{([^}]*)\}\s*;?[ \t]*$/gm;
    while ((m = localRe.exec(src))) {
      for (const raw of m[1].split(",")) {
        const item = raw.trim().replace(/^type\s+/, "");
        const mm = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(item);
        if (mm) this.localExports.set(mm[2] || mm[1], mm[1]);
      }
    }
    const reRe = /^export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/gm;
    while ((m = reRe.exec(src))) {
      const target = resolvePath(sources, this.file, m[2]) ?? { pkg: m[2] };
      for (const raw of m[1].split(",")) {
        const item = raw.trim().replace(/^type\s+/, "");
        if (!item) continue;
        const mm = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(item);
        if (mm) this.reexports.set(mm[2] || mm[1], { target, imported: mm[1] });
      }
    }
    const starRe = /^export\s+\*\s+from\s+['"]([^'"]+)['"]/gm;
    while ((m = starRe.exec(src))) {
      const target = resolvePath(sources, this.file, m[1]);
      if (target) this.starExports.push(target);
    }
    // Top-level declarations start at column 0 in this kit.
    let lineStart = 0;
    while (lineStart < src.length) {
      const nl = src.indexOf("\n", lineStart);
      const line = src.slice(lineStart, nl === -1 ? src.length : nl);
      const d = DECL_RE.exec(line);
      if (d && !this.decls.has(d[2])) {
        this.decls.set(d[2], { pos: lineStart + line.indexOf(d[1], line.startsWith("export") ? 6 : 0), kind: d[1] });
      }
      if (nl === -1) break;
      lineStart = nl + 1;
    }
  }

  /** Parse a declaration's value (the initializer, or the function itself). */
  declNode(name) {
    const d = this.decls.get(name);
    const p = new Parser(this.src, d.pos, this.file);
    if (d.kind === "function") return p.parseFunctionKeyword();
    p.advance(); // const / let / var
    p.advance(); // the name
    if (p.isP(":")) { p.advance(); p.skipType(["="]); }
    p.eat("=");
    return p.parseAssign();
  }
}

class Program {
  constructor(sources) {
    this.sources = sources;
    this.modules = new Map();
    this.depth = 0;
  }

  module(file) {
    if (!this.modules.has(file)) {
      if (!Object.prototype.hasOwnProperty.call(this.sources, file)) throw new CatalogReadError(`${file}: not found in the kit`);
      this.modules.set(file, new Module(this.sources, file));
    }
    return this.modules.get(file);
  }

  /** The value a module exports under `name`. */
  exportValue(file, name, seen = new Set()) {
    const key = `${file}#${name}`;
    if (seen.has(key)) throw new CatalogReadError(`${file}: "${name}" is exported in a loop`);
    seen.add(key);
    const mod = this.module(file);
    if (mod.decls.has(name)) return this.declValue(mod, name);
    if (mod.reexports.has(name)) {
      const r = mod.reexports.get(name);
      if (r.target.pkg) return external(r.target.pkg, r.imported);
      return this.exportValue(r.target, r.imported, seen);
    }
    if (mod.localExports.has(name)) {
      const local = mod.localExports.get(name);
      if (mod.decls.has(local)) return this.declValue(mod, local);
      if (mod.imports.has(local)) return this.importValue(mod.imports.get(local), seen);
    }
    for (const star of mod.starExports) {
      if (this.exports(star, name)) return this.exportValue(star, name, seen);
    }
    throw new CatalogReadError(`${file}: nothing named "${name}" is exported`);
  }

  exports(file, name, seen = new Set()) {
    if (seen.has(file)) return false;
    seen.add(file);
    const mod = this.module(file);
    if (mod.decls.has(name) || mod.reexports.has(name) || mod.localExports.has(name)) return true;
    return mod.starExports.some((s) => this.exports(s, name, seen));
  }

  importValue(imp, seen) {
    if (imp.target.pkg) return external(imp.target.pkg, imp.imported);
    if (imp.imported === "*") throw new CatalogReadError(`a namespace import of ${imp.target} is not supported`);
    return this.exportValue(imp.target, imp.imported, seen);
  }

  declValue(mod, name) {
    if (mod.values.has(name)) return mod.values.get(name);
    if (mod.busy.has(name)) throw new CatalogReadError(`${mod.file}: "${name}" refers to itself`);
    mod.busy.add(name);
    try {
      const v = this.evaluate(mod.declNode(name), new ModuleScope(this, mod));
      mod.values.set(name, v);
      return v;
    } finally {
      mod.busy.delete(name);
    }
  }

  /** Where a binding is declared, without evaluating it: {file, name} or null. */
  origin(node, scope) {
    if (!node) return null;
    if (node.type === "Identifier") {
      for (let sc = scope; sc; sc = sc.parent) {
        if (sc instanceof ModuleScope) {
          const mod = sc.mod;
          if (mod.decls.has(node.name)) return { file: mod.file, name: node.name };
          const imp = mod.imports.get(node.name);
          if (imp) return imp.target.pkg ? null : this.exportOrigin(imp.target, imp.imported);
          return null;
        }
        if (sc.vars.has(node.name)) {
          const th = sc.vars.get(node.name);
          return th.node ? this.origin(th.node, th.scope) : null;
        }
      }
      return null;
    }
    if (node.type === "Member") {
      const objNode = this.literalOf(node.object, scope);
      if (!objNode) return null;
      const prop = [...objNode.node.props].reverse().find((p) => p.kind === "prop" && p.key === node.key);
      return prop ? this.origin(prop.value, objNode.scope) : null;
    }
    return null;
  }

  /** The object literal an expression syntactically is, through local bindings. */
  literalOf(node, scope) {
    if (!node) return null;
    if (node.type === "Object") return { node, scope };
    if (node.type === "Identifier") {
      for (let sc = scope; sc; sc = sc.parent) {
        if (sc instanceof ModuleScope) return null;
        if (sc.vars.has(node.name)) {
          const th = sc.vars.get(node.name);
          return th.node ? this.literalOf(th.node, th.scope) : null;
        }
      }
    }
    return null;
  }

  exportOrigin(file, name, seen = new Set()) {
    const key = `${file}#${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const mod = this.module(file);
    if (mod.decls.has(name)) return { file, name };
    const local = mod.localExports.get(name);
    if (local && mod.decls.has(local)) return { file, name: local };
    const r = mod.reexports.get(name);
    if (r) return r.target.pkg ? null : this.exportOrigin(r.target, r.imported, seen);
    const imp = mod.imports.get(name);
    if (imp) return imp.target.pkg ? null : this.exportOrigin(imp.target, imp.imported, seen);
    for (const star of mod.starExports) if (this.exports(star, name)) return this.exportOrigin(star, name, seen);
    return null;
  }

  // -- evaluation ---------------------------------------------------------------

  fail(node, msg) {
    const src = this.sources[node.file] ?? "";
    throw new CatalogReadError(`${node.file}:${lineOf(src, node.pos)}: ${msg}`);
  }

  evaluate(node, scope) {
    if (++this.depth > 400) this.fail(node, "the value is nested too deeply to read");
    try {
      return this.evalNode(node, scope);
    } finally {
      this.depth--;
    }
  }

  evalNode(node, scope) {
    switch (node.type) {
      case "Literal": return node.value;
      case "Template": {
        let out = node.quasis[0];
        node.exprs.forEach((e, i) => {
          const v = this.evaluate(e, scope);
          if (!isPrimitive(v)) this.fail(e, "a template string holds a value that is not text or a number");
          out += String(v) + node.quasis[i + 1];
        });
        return out;
      }
      case "Identifier": {
        const v = scope.lookup(node.name);
        if (v === NOT_FOUND) this.fail(node, `"${node.name}" is not defined anywhere the kit can see`);
        return v;
      }
      case "Unreadable": return this.fail(node, `this value could not be read (${node.reason})`);
      case "Array": {
        const out = [];
        for (const item of node.items) {
          if (item.type === "Spread") {
            const v = this.evaluate(item.arg, scope);
            if (!Array.isArray(v)) this.fail(item, "only an array can be spread into an array");
            out.push(...v);
          } else {
            out.push(this.evaluate(item, scope));
          }
        }
        return out;
      }
      case "Object": {
        const entries = node.props.map((p) =>
          p.kind === "spread"
            ? { spread: new Thunk(this, p.value, scope) }
            : { key: p.key, thunk: new Thunk(this, p.value, scope) }
        );
        return new LazyObject(this, entries, node);
      }
      case "Function": return { kind: "closure", node, scope };
      case "Jsx": return this.evalJsx(node, scope);
      case "Member":
      case "Index": {
        const obj = this.evaluate(node.object, scope);
        if (node.optional && (obj === null || obj === undefined)) return undefined;
        const key = node.type === "Member" ? node.key : this.evaluate(node.index, scope);
        return this.member(node, obj, key);
      }
      case "Call": return this.evalCall(node, scope);
      case "Conditional":
        return truthy(this.evaluate(node.test, scope))
          ? this.evaluate(node.consequent, scope)
          : this.evaluate(node.alternate, scope);
      case "Unary": {
        if (node.op === "typeof") {
          if (node.arg.type === "Identifier" && scope.lookup(node.arg.name) === NOT_FOUND) return "undefined";
          return typeOf(this.evaluate(node.arg, scope));
        }
        const v = this.evaluate(node.arg, scope);
        if (node.op === "!") return !truthy(v);
        if (node.op === "void") return undefined;
        if (typeof v !== "number") this.fail(node, `"${node.op}" needs a number`);
        if (node.op === "-") return -v;
        if (node.op === "+") return v;
        return ~v;
      }
      case "Binary": return this.evalBinary(node, scope);
      default:
        return this.fail(node, `a ${node.type} cannot be read here`);
    }
  }

  evalBinary(node, scope) {
    const { op } = node;
    if (op === "&&") { const l = this.evaluate(node.left, scope); return truthy(l) ? this.evaluate(node.right, scope) : l; }
    if (op === "||") { const l = this.evaluate(node.left, scope); return truthy(l) ? l : this.evaluate(node.right, scope); }
    if (op === "??") { const l = this.evaluate(node.left, scope); return l === null || l === undefined ? this.evaluate(node.right, scope) : l; }
    const l = this.evaluate(node.left, scope);
    const r = this.evaluate(node.right, scope);
    if (op === "===") return sameValue(l, r);
    if (op === "!==") return !sameValue(l, r);
    if (op === "==" || op === "!=") {
      const eq = (l == null && r == null) || sameValue(l, r);
      return op === "==" ? eq : !eq;
    }
    if (op === "+" && (typeof l === "string" || typeof r === "string")) {
      if (!isPrimitive(l) || !isPrimitive(r)) this.fail(node, "+ joins a value that is not text or a number");
      return String(l) + String(r);
    }
    if (typeof l !== "number" || typeof r !== "number") {
      if ((op === "<" || op === ">" || op === "<=" || op === ">=") && typeof l === "string" && typeof r === "string") {
        return op === "<" ? l < r : op === ">" ? l > r : op === "<=" ? l <= r : l >= r;
      }
      this.fail(node, `"${op}" needs two numbers`);
    }
    switch (op) {
      case "+": return l + r;
      case "-": return l - r;
      case "*": return l * r;
      case "/": return l / r;
      case "%": return l % r;
      case "**": return l ** r;
      case "<": return l < r;
      case ">": return l > r;
      case "<=": return l <= r;
      case ">=": return l >= r;
      case "<<": return l << r;
      case ">>": return l >> r;
      case ">>>": return l >>> r;
      case "&": return l & r;
      case "|": return l | r;
      case "^": return l ^ r;
      default: return this.fail(node, `"${op}" is not supported`);
    }
  }

  member(node, obj, key) {
    if (obj instanceof LazyObject) return obj.has(key) ? obj.get(key) : undefined;
    if (obj && obj.kind === "external") return external(obj.pkg, `${obj.name}.${key}`);
    if (obj === MATH) {
      if (!Object.prototype.hasOwnProperty.call(MATH_FUNCS, key)) this.fail(node, `Math.${key} is not supported`);
      return MATH_FUNCS[key];
    }
    if (Array.isArray(obj)) {
      if (key === "length") return obj.length;
      if (typeof key === "number" || /^\d+$/.test(String(key))) return obj[Number(key)];
      if (ARRAY_METHODS.has(key)) return { kind: "method", self: obj, name: key };
      this.fail(node, `the array method "${key}" is not supported`);
    }
    if (typeof obj === "string") {
      if (key === "length") return obj.length;
      if (typeof key === "number") return obj[key];
      this.fail(node, `the text method "${key}" is not supported`);
    }
    return this.fail(node, `"${String(key)}" cannot be read from ${typeOf(obj)}`);
  }

  evalCall(node, scope) {
    const callee = this.evaluate(node.callee, scope);
    if (node.optional && (callee === null || callee === undefined)) return undefined;
    const args = [];
    for (const a of node.args) {
      if (a.type === "Spread") {
        const v = this.evaluate(a.arg, scope);
        if (!Array.isArray(v)) this.fail(a, "only an array can be spread into a call");
        for (const x of v) args.push(Thunk.of(x));
      } else {
        args.push(new Thunk(this, a, scope));
      }
    }
    return this.call(node, callee, args);
  }

  call(node, callee, args) {
    if (callee && callee.kind === "closure") return this.callClosure(callee, args);
    if (callee && callee.kind === "builtin") return callee.fn(args.map((a) => a.get()), node, this);
    if (callee && callee.kind === "method") return this.callArrayMethod(node, callee, args);
    if (callee && callee.kind === "external") this.fail(node, `the kit calls ${callee.pkg} (${callee.name}) here, which this reader cannot run`);
    return this.fail(node, "this is called but it is not a function");
  }

  callClosure(fn, args) {
    const { node } = fn;
    const sc = new Scope(fn.scope);
    node.params.forEach((p, i) => {
      let value;
      if (p.rest) {
        const rest = args.slice(i);
        value = Thunk.lazy(() => rest.map((a) => a.get()));
      } else {
        const arg = args[i] || Thunk.of(undefined);
        // With no default the argument's own thunk is bound, so origin() can
        // still see the expression the caller wrote.
        value = p.def
          ? Thunk.lazy(() => {
            const v = arg.get();
            return v === undefined ? this.evaluate(p.def, sc) : v;
          })
          : arg;
      }
      if (p.kind === "id") {
        sc.vars.set(p.name, value);
        return;
      }
      for (const prop of p.props) {
        sc.vars.set(prop.local, Thunk.lazy(() => {
          const obj = value.get();
          if (!(obj instanceof LazyObject)) this.fail(node, "a destructured parameter is not an object");
          const v = obj.has(prop.key) ? obj.get(prop.key) : undefined;
          return v === undefined && prop.def ? this.evaluate(prop.def, sc) : v;
        }));
      }
    });
    if (node.body.type !== "LazyBlock") return this.evaluate(node.body, sc);
    const parser = new Parser(this.sources[node.file], node.body.start, node.file);
    const stmts = parser.parseStatements();
    for (const st of stmts) {
      if (st.kind === "const") sc.vars.set(st.name, new Thunk(this, st.value, sc));
      else if (st.kind === "return") return st.value ? this.evaluate(st.value, sc) : undefined;
      else if (st.kind === "ifReturn" && truthy(this.evaluate(st.test, sc))) return st.value ? this.evaluate(st.value, sc) : undefined;
    }
    return undefined;
  }

  callArrayMethod(node, m, args) {
    const arr = m.self;
    const fn = args[0] ? args[0].get() : undefined;
    const each = (cb) => arr.map((x, i) => cb(x, i));
    const apply = (x, i) => this.call(node, fn, [Thunk.of(x), Thunk.of(i), Thunk.of(arr)]);
    switch (m.name) {
      case "map": return each(apply);
      case "filter": return arr.filter((x, i) => truthy(apply(x, i)));
      case "some": return arr.some((x, i) => truthy(apply(x, i)));
      case "every": return arr.every((x, i) => truthy(apply(x, i)));
      case "find": return arr.find((x, i) => truthy(apply(x, i)));
      case "includes": return arr.some((x) => sameValue(x, fn));
      case "indexOf": return arr.findIndex((x) => sameValue(x, fn));
      case "join": {
        if (!arr.every(isPrimitive)) this.fail(node, "join needs an array of text or numbers");
        return arr.join(fn === undefined ? "," : String(fn));
      }
      case "slice": {
        const end = args[1] ? args[1].get() : undefined;
        return arr.slice(fn, end);
      }
      default: return this.fail(node, `the array method "${m.name}" is not supported`);
    }
  }

  evalJsx(node, scope) {
    let tag = null;
    if (node.tag !== null) {
      if (/^[a-z]/.test(node.tag) || node.tag.includes("-")) tag = node.tag; // a DOM element
      else {
        const [head, ...rest] = node.tag.split(".");
        const idNode = { type: "Identifier", name: head, pos: node.pos, file: node.file };
        tag = new Thunk(this, null, scope, () => rest.reduce((v, k) => this.member(node, v, k), this.evaluate(idNode, scope)));
      }
    }
    const entries = node.attrs.map((a) =>
      a.kind === "spread" ? { spread: new Thunk(this, a.value, scope) } : { key: a.key, thunk: new Thunk(this, a.value, scope) }
    );
    if (node.children.length) {
      const kids = node.children.map((c) => new Thunk(this, c, scope));
      entries.push({ key: "children", thunk: kids.length === 1 ? kids[0] : Thunk.lazy(() => kids.map((k) => k.get())) });
    }
    return { kind: "jsx", tag, props: new LazyObject(this, entries, node), node, scope };
  }
}

// ---------------------------------------------------------------------------
// Values and scopes

const NOT_FOUND = Symbol("not found");
const MATH = Object.freeze({ kind: "math" });
const num = (name, f) => ({
  kind: "builtin",
  fn: (args, node, prog) => {
    if (!args.every((a) => typeof a === "number")) prog.fail(node, `Math.${name} needs numbers`);
    return f(...args);
  }
});
const MATH_FUNCS = {
  min: num("min", Math.min), max: num("max", Math.max), round: num("round", Math.round),
  floor: num("floor", Math.floor), ceil: num("ceil", Math.ceil), abs: num("abs", Math.abs),
  sqrt: num("sqrt", Math.sqrt), sin: num("sin", Math.sin), cos: num("cos", Math.cos),
  pow: num("pow", Math.pow), sign: num("sign", Math.sign), trunc: num("trunc", Math.trunc),
  PI: Math.PI, E: Math.E
};
const ARRAY_METHODS = new Set(["map", "filter", "some", "every", "find", "includes", "indexOf", "join", "slice"]);
const GLOBALS = new Map([["Math", MATH], ["undefined", undefined], ["NaN", NaN], ["Infinity", Infinity]]);

function external(pkg, name) { return { kind: "external", pkg, name }; }
function isPrimitive(v) { return v === null || ["string", "number", "boolean"].includes(typeof v); }
function truthy(v) {
  if (v instanceof LazyObject || Array.isArray(v) || (v && typeof v === "object")) return true;
  return Boolean(v);
}
function sameValue(a, b) { return a === b; }
function typeOf(v) {
  if (v === null) return "object";
  if (v instanceof LazyObject || Array.isArray(v)) return "object";
  if (v && typeof v === "object") return v.kind === "closure" || v.kind === "builtin" || v.kind === "method" ? "function" : "object";
  return typeof v;
}

class Thunk {
  constructor(prog, node, scope, compute) {
    this.prog = prog;
    this.node = node;
    this.scope = scope;
    this.compute = compute || null;
    this.done = false;
    this.value = undefined;
  }
  static of(v) { const t = new Thunk(null, null, null); t.done = true; t.value = v; return t; }
  static lazy(f) { return new Thunk(null, null, null, f); }
  get() {
    if (!this.done) {
      this.value = this.compute ? this.compute() : this.prog.evaluate(this.node, this.scope);
      this.done = true;
    }
    return this.value;
  }
}

class Scope {
  constructor(parent) { this.parent = parent; this.vars = new Map(); }
  lookup(name) {
    if (this.vars.has(name)) return this.vars.get(name).get();
    return this.parent ? this.parent.lookup(name) : (GLOBALS.has(name) ? GLOBALS.get(name) : NOT_FOUND);
  }
}

class ModuleScope extends Scope {
  constructor(prog, mod) { super(null); this.prog = prog; this.mod = mod; }
  lookup(name) {
    if (this.mod.decls.has(name)) return this.prog.declValue(this.mod, name);
    const imp = this.mod.imports.get(name);
    if (imp) return this.prog.importValue(imp, new Set());
    return GLOBALS.has(name) ? GLOBALS.get(name) : NOT_FOUND;
  }
}

/* An object literal whose properties are read only when asked for. Key order
   and spread overrides follow JavaScript: a later key wins, and an overridden
   key keeps the place where it first appeared. */
class LazyObject {
  constructor(prog, entries, node) { this.prog = prog; this.entries = entries; this.node = node; }

  /** Wrap plain JSON data (built by this file, never read from the kit). */
  static from(value) {
    if (Array.isArray(value)) return value.map((v) => LazyObject.from(v));
    if (value instanceof LazyObject || value === null || typeof value !== "object") return value;
    return new LazyObject(null, Object.entries(value).map(([key, v]) => ({ key, thunk: Thunk.of(LazyObject.from(v)) })), null);
  }

  spreadOf(entry) {
    const v = entry.spread.get();
    if (v === null || v === undefined) return null;
    if (!(v instanceof LazyObject)) {
      const node = entry.spread.node || this.node;
      if (node && this.prog) this.prog.fail(node, "only an object can be spread into an object");
      throw new CatalogReadError("only an object can be spread into an object");
    }
    return v;
  }

  has(key) {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.spread) { const o = this.spreadOf(e); if (o && o.has(key)) return true; }
      else if (e.key === key) return true;
    }
    return false;
  }

  get(key) {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.spread) { const o = this.spreadOf(e); if (o && o.has(key)) return o.get(key); }
      else if (e.key === key) return e.thunk.get();
    }
    return undefined;
  }

  /** The entry for `key` as written (its thunk), when it is a plain property. */
  rawEntry(key) {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.spread) { const o = this.spreadOf(e); if (o && o.has(key)) return o.rawEntry(key); }
      else if (e.key === key) return e;
    }
    return null;
  }

  keys() {
    const out = [];
    for (const e of this.entries) {
      const ks = e.spread ? (this.spreadOf(e)?.keys() ?? []) : [e.key];
      for (const k of ks) if (!out.includes(k)) out.push(k);
    }
    return out;
  }
}

/** A value as plain JSON data. Code inside it (a function, JSX) stops the build. */
function toPlain(v, where) {
  if (v === undefined) return undefined;
  if (isPrimitive(v)) {
    if (typeof v === "number" && !Number.isFinite(v)) throw new CatalogReadError(`${where} is not a finite number`);
    return v;
  }
  if (Array.isArray(v)) {
    return v.map((x, i) => {
      const p = toPlain(x, `${where}[${i}]`);
      if (p === undefined) throw new CatalogReadError(`${where}[${i}] is undefined`);
      return p;
    });
  }
  if (v instanceof LazyObject) {
    const out = {};
    for (const k of v.keys()) {
      const p = toPlain(v.get(k), `${where}.${k}`);
      if (p !== undefined) out[k] = p;
    }
    return out;
  }
  throw new CatalogReadError(`${where} is code (${typeOf(v)}), not data, so it cannot go in the catalog`);
}

// ---------------------------------------------------------------------------
// The catalog

/* The header comment of a template file: the first run of `//` lines after the
   imports, before any code. Its first paragraph (up to an empty `//` line) is
   the purpose. A file whose first thing after the imports is not a `//`
   comment has no header, and gets null. */
export function headerComment(src) {
  const lines = String(src).split("\n");
  const IMPORT_ENDS = /(?:\bfrom\s+|^import\s+)['"][^'"]+['"]\s*;?\s*$/;
  // The last line of the import block (-1 when the file has no imports).
  let lastImportEnd = -1;
  let inImport = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inImport) {
      if (IMPORT_ENDS.test(line)) { inImport = false; lastImportEnd = i; }
      continue;
    }
    if (/^import\b/.test(line)) {
      if (IMPORT_ENDS.test(line)) lastImportEnd = i;
      else inImport = true;
      continue;
    }
    if (line.trim() === "" || /^\s*(\/\/|\/\*|\*)/.test(line)) continue;
    break; // the first line of code
  }
  let j = lastImportEnd + 1;
  while (j < lines.length && lines[j].trim() === "") j++;
  if (j >= lines.length || !/^\/\//.test(lines[j])) return null;
  const para = [];
  for (; j < lines.length && /^\/\//.test(lines[j]); j++) {
    const text = lines[j].replace(/^\/\/\s?/, "").trim();
    if (text === "") break; // the end of the first paragraph
    para.push(text);
  }
  const out = para.join(" ").replace(/\s+/g, " ").trim();
  return out || null;
}

function collectCompositions(prog, value, out, guard = 0) {
  if (guard > 50) throw new CatalogReadError("the composition tree is nested too deeply to read");
  if (Array.isArray(value)) {
    for (const v of value) collectCompositions(prog, v, out, guard + 1);
    return;
  }
  if (!value || value.kind !== "jsx") return;
  const kids = () => collectCompositions(prog, value.props.get("children"), out, guard + 1);
  if (value.tag === null || typeof value.tag === "string") return kids();
  const tag = value.tag.get();
  if (tag && tag.kind === "external" && tag.pkg === "remotion" && tag.name === "Composition") {
    out.push(value);
    return;
  }
  if (tag && tag.kind === "closure") {
    collectCompositions(prog, prog.callClosure(tag, [Thunk.of(value.props)]), out, guard + 1);
    return;
  }
  if (tag && tag.kind === "external") return kids(); // a wrapper such as remotion's Folder
  throw new CatalogReadError(`${value.node.file}:${lineOf(prog.sources[value.node.file], value.node.pos)}: <${value.node.tag}> is not a component the reader can follow`);
}

function requireNumber(v, what) {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new CatalogReadError(`${what} is not a number`);
  return v;
}

function requirePositiveInt(v, what) {
  requireNumber(v, what);
  if (!Number.isInteger(v) || v <= 0) throw new CatalogReadError(`${what} is ${v}, not a whole number above zero`);
  return v;
}

/* Read the frame range from the composition's own calculateMetadata. */
function frameRange(prog, id, props, defaults) {
  const calc = props.get("calculateMetadata");
  if (calc === undefined) {
    const d = requirePositiveInt(props.get("durationInFrames"), `${id} durationInFrames`);
    return [d, d];
  }
  if (!calc || calc.kind !== "closure") throw new CatalogReadError(`${id}: calculateMetadata is not a function the reader can follow`);
  const ask = (frames) => {
    const arg = LazyObject.from({ props: { ...defaults, durationInFrames: frames }, defaultProps: defaults, compositionId: id });
    const out = prog.callClosure(calc, [Thunk.of(arg)]);
    if (!(out instanceof LazyObject)) throw new CatalogReadError(`${id}: calculateMetadata does not return an object`);
    if (!out.has("durationInFrames")) return requirePositiveInt(props.get("durationInFrames"), `${id} durationInFrames`);
    return requirePositiveInt(out.get("durationInFrames"), `${id} calculateMetadata durationInFrames`);
  };
  const min = ask(PROBE_SHORT);
  const max = ask(PROBE_LONG);
  if (min === PROBE_SHORT) throw new CatalogReadError(`${id}: its length has no floor, so a minimum cannot be read`);
  if (max === PROBE_LONG) throw new CatalogReadError(`${id}: its length has no ceiling, so a maximum cannot be read`);
  if (min > max) throw new CatalogReadError(`${id}: its shortest length (${min}) is longer than its longest (${max})`);
  return [min, max];
}

/**
 * buildCatalogReport(sources) -> {catalog, skipped, nullPurpose}
 *
 * sources: {"src/Root.tsx": "<text>", ...}, every .ts/.tsx file of the kit,
 * keyed by its path inside marketing/broll with forward slashes.
 */
export function buildCatalogReport(sources) {
  if (!sources || typeof sources !== "object") throw new CatalogReadError("buildCatalog needs the kit's source files");
  if (!Object.prototype.hasOwnProperty.call(sources, ROOT_FILE)) throw new CatalogReadError(`${ROOT_FILE} is missing`);
  const prog = new Program(sources);
  const root = prog.module(ROOT_FILE);
  if (!root.decls.has(ROOT_EXPORT)) throw new CatalogReadError(`${ROOT_FILE}: ${ROOT_EXPORT} is not declared`);
  const rootFn = prog.declValue(root, ROOT_EXPORT);
  if (!rootFn || rootFn.kind !== "closure") throw new CatalogReadError(`${ROOT_FILE}: ${ROOT_EXPORT} is not a component`);
  const found = [];
  collectCompositions(prog, prog.callClosure(rootFn, [Thunk.of(LazyObject.from({}))]), found);

  // The registry's own words for each of its templates.
  const registry = new Map();
  const regImport = root.imports.get(REGISTRY_EXPORT);
  if (regImport && !regImport.target.pkg) {
    const list = prog.importValue(regImport, new Set());
    if (!Array.isArray(list)) throw new CatalogReadError(`${REGISTRY_EXPORT} is not a list`);
    for (const item of list) {
      if (!(item instanceof LazyObject)) throw new CatalogReadError(`an entry in ${REGISTRY_EXPORT} is not an object`);
      const id = item.get("id");
      const title = item.has("title") ? item.get("title") : null;
      const what = item.has("what") ? item.get("what") : null;
      const words = [title, what].filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
      registry.set(id, words.length ? words.map((s) => (/[.!?]$/.test(s) ? s : `${s}.`)).join(" ") : null);
    }
  }

  const catalog = [];
  const skipped = [];
  const nullPurpose = [];
  const seen = new Set();
  for (const comp of found) {
    const props = comp.props;
    const id = props.get("id");
    if (typeof id !== "string" || !id) throw new CatalogReadError(`${comp.node.file}:${lineOf(sources[comp.node.file], comp.node.pos)}: a composition has no id`);
    if (seen.has(id)) throw new CatalogReadError(`the composition id ${id} is registered twice`);
    seen.add(id);
    if (CATALOG_SKIP.includes(id)) { skipped.push(id); continue; }

    const width = requirePositiveInt(props.get("width"), `${id} width`);
    const height = requirePositiveInt(props.get("height"), `${id} height`);
    const fps = requirePositiveInt(props.get("fps"), `${id} fps`);
    const defaults = props.has("defaultProps") ? toPlain(props.get("defaultProps"), `${id} defaultProps`) : {};
    if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) throw new CatalogReadError(`${id}: defaultProps is not an object`);
    const [min, max] = frameRange(prog, id, props, defaults);

    let purpose = registry.has(id) ? registry.get(id) : null;
    if (!registry.has(id)) {
      const entry = props.rawEntry("component");
      const where = entry && entry.thunk.node ? prog.origin(entry.thunk.node, entry.thunk.scope) : null;
      purpose = where ? headerComment(sources[where.file]) : null;
    }
    if (purpose === null) nullPurpose.push(id);

    catalog.push({
      id, width, height, fps,
      min_frames: min, max_frames: max,
      default_props: defaults,
      purpose,
      data_tied: isDataTied(id)
    });
  }
  return { catalog, skipped, nullPurpose };
}

/** buildCatalog(sources) -> the catalog.json array. */
export function buildCatalog(sources) {
  return buildCatalogReport(sources).catalog;
}

/** The exact bytes catalog.json holds. The sync test compares against these. */
export function serializeCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

/** Every .ts and .tsx file under <kitDir>/src, keyed "src/...". */
export function readKitSources(kitDir) {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === "node_modules") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
        out[relative(kitDir, full).split(sep).join("/")] = readFileSync(full, "utf8");
      }
    }
  };
  walk(join(kitDir, "src"));
  return out;
}
