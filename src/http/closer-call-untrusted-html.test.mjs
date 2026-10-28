// Synthetic closer-screen render proof: untrusted customer and report fields are text.
// No server, database, provider call or production customer is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../public/app/closer-call.js", import.meta.url), "utf8");
const bootGate = '  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);';
assert.equal(source.split(bootGate).length, 2, "paint hook must remain uniquely reachable");
const harnessScript = source.replace(bootGate, "  window.__testPaint = paint;\n" + bootGate);

function renderSyntheticCall(data) {
  const credit = { innerHTML: "" };
  const payment = { innerHTML: "" };
  const staffName = { innerHTML: "" };
  const shiftChip = { innerHTML: "" };
  const queue = {
    html: "",
    querySelectorAll() { return []; },
    insertAdjacentHTML(_position, html) { this.html = html; }
  };
  const document = {
    readyState: "loading",
    addEventListener() {},
    getElementById() { return null; },
    querySelector(selector) {
      if (selector === "[data-fh-call-staff]") return staffName;
      if (selector === "[data-fh-call-head] .chip") return shiftChip;
      if (selector === "aside.rail [data-fh-up-next], aside.rail section[data-fh-up-next]") return queue;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".panel table") return [credit, payment];
      if (selector === ".logbar .logrow") {
        return [{ innerHTML: "" }, { innerHTML: "" }, { innerHTML: "" }];
      }
      return [];
    }
  };
  const window = { __FH_CLIENT_ID: null, FHData: null };
  vm.runInNewContext(harnessScript, {
    window, document, localStorage: { getItem() { return null; } }
  }, { filename: "closer-call.js", timeout: 3000 });
  assert.equal(typeof window.__testPaint, "function");
  window.__testPaint(data);
  return {
    credit: credit.innerHTML,
    payment: payment.innerHTML,
    staffName: staffName.innerHTML,
    shiftChip: shiftChip.innerHTML,
    queue: queue.html
  };
}

test("closer screen escapes client, staff, report and payment markup in every HTML sink", () => {
  const untrusted = '<img src=x onerror="report(1)">';
  const html = renderSyntheticCall({
    staff: { name: untrusted, shift: { on_shift: false, reason: untrusted } },
    client: { name: untrusted },
    credit: {
      available: true,
      scores: { experian: untrusted, equifax: 710, transunion: 715 },
      utilization: untrusted, inquiries_6mo: untrusted, derogatories: untrusted
    },
    deal: {
      latest_payment: { amount_display: untrusted, product_name: untrusted },
      success_fee_note: untrusted
    },
    up_next: [{ name: untrusted, title: untrusted }]
  });
  for (const [sink, markup] of Object.entries(html)) {
    assert.match(markup, /&lt;img /, sink + " must encode external text");
    assert.doesNotMatch(markup, /<img\b/i, sink + " must not insert attacker markup");
  }
  assert.match(html.queue, /<div class="q">/, "keep real queue structure");
  assert.match(html.credit, /710/, "keep benign bureau values");
  assert.match(html.payment, /<tr><td>Product<\/td>/, "keep payment table structure");
});

test("unavailable credit explanation is escaped while ordinary empty states render", () => {
  const note = "Not available <svg onload='evil()'> & retry";
  const html = renderSyntheticCall({
    staff: {}, client: {},
    credit: { available: false, reason: note }, deal: {}, up_next: []
  });
  assert.match(html.credit, /&lt;svg/);
  assert.match(html.credit, /&amp; retry/);
  assert.doesNotMatch(html.credit, /<svg/i);
  assert.match(html.queue, /No upcoming booked calls/);
});
