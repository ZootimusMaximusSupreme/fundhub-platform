// CP-06 — the portal's upload doors, when the server refuses a file.
//
// Two things were wrong on public/app/client-portal.html:
//
//   1. Every door said it would take a .heic. The server sniffs the bytes and
//      only takes jpg, png and pdf (src/documents/upload-validate.mjs), so an
//      iPhone photo was offered, picked, and then refused.
//   2. Every failure, of any kind, set the button to "Try again" and said
//      nothing else. The button then re-sent the same refused file, so the
//      client could not even pick a different one.
//
// The first test reads the shipped HTML. The rest RUN the door script from that
// same HTML against a small fake page, because a text scan cannot prove what a
// button does after a failed send.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { ALLOWED_MIME_TYPES, validateUpload } from "../documents/upload-validate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(HERE, "../../public/app/client-portal.html"), "utf8");

/* ── what the doors offer vs what the server takes ───────────────────────── */

const EXTENSIONS_FOR = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "application/pdf": [".pdf"]
};

describe("CP-06 — the doors only offer what the server takes", () => {
  test("every file picker lists only extensions the server accepts", () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      assert.ok(EXTENSIONS_FOR[mime], `the server now takes ${mime}; add its extensions to this test`);
    }
    const allowed = new Set(ALLOWED_MIME_TYPES.flatMap((m) => EXTENSIONS_FOR[m] || []));

    const pickers = html.match(/<input\b[^>]*\bdata-file-input\b[^>]*>/g) || [];
    assert.equal(pickers.length, 3, "expected the three upload doors (funding, inquiry, bureau)");
    for (const tag of pickers) {
      const accept = (tag.match(/\baccept="([^"]*)"/) || [])[1];
      assert.ok(accept, `a door picker has no accept list: ${tag}`);
      for (const ext of accept.split(",").map((s) => s.trim().toLowerCase())) {
        assert.ok(allowed.has(ext), `door offers ${ext}, which the server refuses`);
      }
    }
  });

  test("the server does refuse a HEIC photo", () => {
    // 4-byte box size, then the "ftyp" brand "heic" — the start of a real HEIC file.
    const heic = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
    const verdict = validateUpload({ buffer: heic, declaredMimeType: "image/heic" });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.code, "invalid_file_type");
  });

  test("each door has a message line for the reason", () => {
    assert.equal((html.match(/data-door-msg/g) || []).length >= 3, true,
      "each of the three doors needs a [data-door-msg] line under its button");
  });
});

/* ── the door script, run against a fake page ────────────────────────────── */

function fakeElement(attrs = {}, extra = {}) {
  const listeners = {};
  return {
    textContent: attrs.textContent || "",
    hidden: !!attrs.hidden,
    value: "",
    files: [],
    clicks: 0,
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type) { for (const fn of listeners[type] || []) fn(); },
    click() { this.clicks += 1; },
    ...extra
  };
}

function doorScriptSource() {
  const start = html.indexOf("/* ── document upload doors");
  const end = html.indexOf("/* ── account & history tabs");
  assert.ok(start > 0 && end > start, "could not find the upload door script in the page");
  return html.slice(start, end);
}

/** Boot one door. `reply` is what FHData.uploadFiles hands back (a function or a value). */
function bootDoor(reply) {
  const btn = fakeElement({ textContent: "Upload documents" });
  const input = fakeElement();
  const msg = fakeElement({ hidden: true });
  const typeSel = fakeElement();
  const slots = { "[data-upload-btn]": btn, "[data-file-input]": input, "[data-subtype]": typeSel, "[data-door-msg]": msg };
  const door = fakeElement({ "data-kind": "client_upload" }, {
    querySelector(sel) { return slots[sel] || null; }
  });
  const root = fakeElement({}, { querySelectorAll() { return [door]; } });

  const calls = [];
  const sandbox = {
    document: { getElementById: (id) => (id === "upload-doors" ? root : null) },
    location: { search: "?id=00000000-0000-4000-8000-000000000001" },
    localStorage: { getItem: () => null },
    URLSearchParams,
    JSON,
    FHData: {
      uploadFiles(url, files, fields) {
        calls.push({ url, files, fields });
        return Promise.resolve(typeof reply === "function" ? reply(calls.length) : reply);
      }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(doorScriptSource(), sandbox);

  return {
    btn, input, msg, calls,
    pick(...names) { input.files = names.map((name) => ({ name })); input.fire("change"); },
    async tap() { btn.fire("click"); await new Promise((r) => setImmediate(r)); }
  };
}

const SERVER_WORDS = validateUpload({
  buffer: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
  declaredMimeType: "image/heic"
}).message;

describe("CP-06 — a refused file says why", () => {
  test("the server's own sentence is printed under the button", async () => {
    const door = bootDoor({ ok: false, source: "badrequest", data: null, error: SERVER_WORDS });
    door.pick("holiday.heic");
    assert.equal(door.msg.hidden, true, "no message before anything was sent");

    await door.tap();

    assert.equal(door.msg.hidden, false, "the reason must be on screen");
    assert.ok(door.msg.textContent.includes(SERVER_WORDS),
      `expected the server's words, got: ${door.msg.textContent}`);
    assert.notEqual(door.btn.textContent, "Try again",
      "'Try again' on its own is exactly the old failure");
  });

  test("a refused file is dropped, so the next tap opens the picker instead of re-sending it", async () => {
    const door = bootDoor({ ok: false, source: "badrequest", data: null, error: SERVER_WORDS });
    door.pick("holiday.heic");
    await door.tap();
    assert.equal(door.calls.length, 1);

    await door.tap();

    assert.equal(door.calls.length, 1, "the same refused file must not be sent twice");
    assert.equal(door.input.clicks, 1, "the second tap must open the file picker");
    assert.equal(door.btn.textContent, "Upload documents", "the button goes back to its first label");
  });

  test("a dropped connection keeps the file and says so in plain words", async () => {
    const door = bootDoor((n) => (n === 1
      ? { ok: false, source: "offline", data: null, error: "Failed to fetch" }
      : { ok: true, source: "api", data: { ok: true }, error: null }));
    door.pick("statement.pdf");

    await door.tap();

    assert.equal(door.btn.textContent, "Try again");
    assert.equal(door.msg.hidden, false, "even a network failure must say something");
    assert.ok(!door.msg.textContent.includes("Failed to fetch"),
      "a developer string must not reach a client");

    await door.tap();
    assert.equal(door.calls.length, 2, "Try again re-sends the same file");
    assert.equal(door.btn.textContent, "Sent");
    assert.equal(door.msg.hidden, true, "the message clears once the file lands");
  });

  test("picking a new file clears the old reason", async () => {
    const door = bootDoor({ ok: false, source: "badrequest", data: null, error: SERVER_WORDS });
    door.pick("holiday.heic");
    await door.tap();
    assert.equal(door.msg.hidden, false);

    door.pick("id-front.jpg");

    assert.equal(door.msg.hidden, true);
    assert.equal(door.btn.textContent, "Send 1 file");
  });

  test("a good upload still reads Sent with no message", async () => {
    const door = bootDoor({ ok: true, source: "api", data: { ok: true }, error: null });
    door.pick("id-front.jpg");
    await door.tap();
    assert.equal(door.btn.textContent, "Sent");
    assert.equal(door.msg.hidden, true);
    assert.equal(door.calls[0].url, "/api/documents-upload");
    assert.equal(door.calls[0].fields.kind, "client_upload");
  });
});
