// Shoot Day's request checks (unit X5), no database: what POST marketing/shoot
// and POST marketing/shoot/mark accept, and the plain-word refusals.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { InvalidError } from "./http.mjs";
import { parseWpm, parseRootIds, parseShootDate, parseStatus, parseShootWrite, parseMarkWrite } from "./shoot-store.mjs";

const A = "00000000-0000-4000-8000-000000000101";
const B = "00000000-0000-4000-8000-000000000201";
const S = "00000000-0000-4000-8000-000000000901";

const refused = (fn, field) =>
  assert.throws(fn, (e) => e instanceof InvalidError && e.field === field && typeof e.message === "string" && /\s/.test(e.message));

describe("shoot request checks", () => {
  test("wpm: 80 to 260, default 150", () => {
    assert.equal(parseWpm({}), 150);
    assert.equal(parseWpm({ wpm: "200" }), 200);
    assert.equal(parseWpm({ wpm: 80 }), 80);
    refused(() => parseWpm({ wpm: "79" }), "wpm");
    refused(() => parseWpm({ wpm: "261" }), "wpm");
    refused(() => parseWpm({ wpm: "fast" }), "wpm");
  });

  test("root_script_ids: uuids, each once, at least one", () => {
    assert.deepEqual(parseRootIds([A.toUpperCase(), B]), [A, B]);
    refused(() => parseRootIds([]), "root_script_ids");
    refused(() => parseRootIds("x"), "root_script_ids");
    refused(() => parseRootIds([A, A]), "root_script_ids");
    refused(() => parseRootIds(["nope"]), "root_script_ids");
    refused(() => parseRootIds(Array.from({ length: 101 }, () => A)), "root_script_ids");
  });

  test("shoot_date: a real day; status: the four words", () => {
    assert.equal(parseShootDate("2026-10-13"), "2026-10-13");
    assert.equal(parseShootDate(undefined), null);
    refused(() => parseShootDate("2026-02-30"), "shoot_date");
    refused(() => parseShootDate("10/13/2026"), "shoot_date");
    assert.equal(parseStatus("done"), "done");
    assert.equal(parseStatus(null), null);
    refused(() => parseStatus("closed"), "status");
  });

  test("create, change, close", () => {
    assert.deepEqual(parseShootWrite({ root_script_ids: [A] }), { kind: "create", shootDate: null, ids: [A] });
    refused(() => parseShootWrite({}), "root_script_ids");
    refused(() => parseShootWrite({ root_script_ids: [A], status: "done" }), "status");
    assert.deepEqual(parseShootWrite({ id: S, status: "done" }), { kind: "update", id: S, shootDate: null, status: "done", ids: null });
    assert.deepEqual(parseShootWrite({ id: S, root_script_ids: [B, A] }).ids, [B, A]);
    refused(() => parseShootWrite({ id: S }), "body");
    refused(() => parseShootWrite({ id: "x", status: "done" }), "id");
  });

  test("mark: got_it or another_take, on a shoot and a script", () => {
    assert.deepEqual(parseMarkWrite({ shoot_id: S, root_script_id: A, mark: "got_it" }), { shootId: S, root: A, mark: "got_it" });
    refused(() => parseMarkWrite({ shoot_id: S, root_script_id: A, mark: "keep" }), "mark");
    refused(() => parseMarkWrite({ shoot_id: "x", root_script_id: A, mark: "got_it" }), "shoot_id");
    refused(() => parseMarkWrite({ shoot_id: S, root_script_id: null, mark: "got_it" }), "root_script_id");
  });
});
