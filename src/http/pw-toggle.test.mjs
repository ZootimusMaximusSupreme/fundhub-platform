// Every password box gets a Show / Hide button (owner ask 2026-10-06).
// The button comes from ONE shared file, public/pw-toggle.js. This fails if a
// page gains a password box without loading it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PUBLIC = path.join(ROOT, "public");

// API key boxes on staff tools, not passwords. Owner scope 2026-10-06:
// "passwords when creating accounts and logging in".
const KEY_BOXES_NOT_PASSWORDS = new Set([
  "app/campaign-manager.html",
  "app/creative-factory.html"
]);

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "climate" || e.name === "vendor" || e.name.startsWith("_")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, out);
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

test("every page with a password box loads pw-toggle.js", () => {
  const withBoxes = [];
  for (const f of htmlFiles(PUBLIC)) {
    const rel = path.relative(PUBLIC, f).split(path.sep).join("/");
    const html = fs.readFileSync(f, "utf8");
    if (!/type=["']?password/i.test(html) || KEY_BOXES_NOT_PASSWORDS.has(rel)) continue;
    withBoxes.push(rel);
    assert.match(html, /<script src="\/pw-toggle\.js"/, `${rel} has a password box but no Show button`);
  }
  assert.deepEqual(withBoxes.sort(), ["login.html", "reset-password.html"]);
});

/* A tiny fake DOM, enough for the script: one form, one password box. */
function fakePage() {
  const listeners = {};
  function el(tag) {
    return {
      tagName: tag, type: "", attrs: {}, children: [], parentNode: null, textContent: "", className: "",
      listeners: {},
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] ?? null; },
      appendChild(c) { if (c.parentNode) c.parentNode.children = c.parentNode.children.filter((x) => x !== c); c.parentNode = this; this.children.push(c); return c; },
      insertBefore(c, ref) { c.parentNode = this; this.children.splice(this.children.indexOf(ref), 0, c); return c; },
      addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); },
      fire(n) { (this.listeners[n] || []).forEach((fn) => fn({})); },
      focus() {}
    };
  }
  const form = el("form");
  const input = el("input");
  input.type = "password";
  form.appendChild(input);
  input.form = form;
  const head = el("head");
  const document = {
    readyState: "complete", head, documentElement: head,
    createElement: el,
    querySelectorAll: (sel) => (sel === 'input[type="password"]' && input.type === "password" ? [input] : []),
    addEventListener: (n, fn) => { listeners[n] = fn; }
  };
  return { document, form, input };
}

test("Show reveals the password, Hide covers it, sending the form covers it", () => {
  const src = fs.readFileSync(path.join(PUBLIC, "pw-toggle.js"), "utf8");
  const { document, form, input } = fakePage();
  vm.runInNewContext(src, { window: {}, document });

  const wrap = input.parentNode;
  assert.equal(wrap.className, "fh-pw");
  const btn = wrap.children.find((c) => c.tagName === "button");
  assert.ok(btn, "no Show button next to the password box");
  assert.equal(btn.type, "button", "the button must not send the form");
  assert.equal(btn.textContent, "Show");
  assert.equal(btn.getAttribute("aria-label"), "Show password");

  btn.fire("click");
  assert.equal(input.type, "text");
  assert.equal(btn.textContent, "Hide");
  assert.equal(btn.getAttribute("aria-pressed"), "true");

  btn.fire("click");
  assert.equal(input.type, "password");

  btn.fire("click");
  form.fire("submit");
  assert.equal(input.type, "password", "a password left showing was sent as plain text");
  assert.equal(btn.textContent, "Show");
});
