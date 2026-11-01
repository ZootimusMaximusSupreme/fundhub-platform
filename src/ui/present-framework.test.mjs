import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../public/app/present-framework.js", import.meta.url), "utf8");
const listeners = {};
const doc = {
  addEventListener: (event, handler) => { listeners[event] = handler; },
  createElement: () => ({ textContent: "" }),
  head: { appendChild() {} }
};
const window = { document: doc, FHDeckVisuals: {} };
vm.runInNewContext(source, { window, globalThis: window });

const names = ["callMap", "alignment", "goalLine", "pullSplit", "iceberg", "blindMatched", "revenueSplit", "sequence", "clock", "partnerStaircase", "blueprintRoute", "doorMatrix", "moneyStrip", "guarantees", "nextSteps"];
const full = {
  source: "engine", pulledOn: "2026-10-30", todayTotal: 96524, optimizedTotal: 174625,
  cards: [{ creditor: "CARD FROM FILE", usePct: 40 }], items: [{ creditor: "ITEM FROM FILE" }],
  mismatches: [{ field: "address" }], companies: [{ name: "Business from file" }]
};
function ctx(state) {
  return {
    clientId: "framework-" + state,
    visual: state === "no data" ? null : state === "withheld" ? { ...full, todayTotal: null, optimizedTotal: null } : full,
    sample: state === "sample", door: state === "repair-only" ? "optimize" : "fund",
    survey: { target: "$100k to $200k", use: "A second location" },
    handoff: { problem: "A lender said no." },
    costOfWaiting: 500,
    money: (n) => "$" + Number(n).toLocaleString("en-US"),
    price: () => "—", offerAmount: () => null, feePercent: null,
    offerKey: state === "repair-only" ? "REPAIR_DFY" : "FUNDING_DFY"
  };
}

for (const name of names) {
  test(`${name} draws full, sample, no data, repair-only and withheld`, () => {
    for (const state of ["full", "sample", "no data", "repair-only", "withheld"]) {
      const html = window.FHDeckVisuals[name](ctx(state));
      assert.match(html, new RegExp(`data-fhv="${name}"`), `${name}: ${state}`);
      assert.doesNotMatch(html, /(?:undefined|NaN|\[object Object\])/);
      assert.doesNotMatch(html, /FIRST PLATYPUS|Chase Bank|Bank of America/);
      if (state === "sample") assert.match(html, /Sample file/);
      if (state === "withheld") assert.doesNotMatch(html, /\$96,524|\$174,625/);
      if (state === "no data") assert.doesNotMatch(html, /\$96,524|\$174,625/);
      const taps = [...html.matchAll(/data-fhw-step="\d+"/g)];
      if (taps.length) assert.ok(taps.length >= 3 && taps.length <= 5, `${name}: ${taps.length} taps`);
    }
  });
}

test("door matrix only identifies the selected door and reads prices from the catalog", () => {
  const html = window.FHDeckVisuals.doorMatrix({ ...ctx("full"), price: (key) => key === "FUNDING_DFY" ? "$3,000" : "—" });
  assert.match(html, /Built for your file/);
  assert.match(html, /\$78,101 left on the table/);
  assert.doesNotMatch(html, /\$3,000/); // Price is the final tap.
});

test("the action listener redraws a tapped picture without sending or saving", () => {
  const context = ctx("full");
  const first = window.FHDeckVisuals.callMap(context);
  const host = { outerHTML: first, getAttribute: (key) => key === "data-fhw-key" ? "framework-full:callMap" : "callMap" };
  const button = { getAttribute: () => "3", closest: () => host };
  listeners.click({ target: { closest: () => button } });
  assert.match(host.outerHTML, /data-fhw-step="3" aria-pressed="true"/);
});
