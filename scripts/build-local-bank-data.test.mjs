// The two builders behind the local-bank directory (Finance OS unit LOC):
// scripts/build-fdic-branch-data.mjs and scripts/build-ncua-membership-data.mjs.
// Pure parts only. No network.
import { test } from "node:test";
import assert from "node:assert/strict";

import { compactFdic } from "./build-fdic-branch-data.mjs";
import { csvFields, membershipCodes } from "./build-ncua-membership-data.mjs";

test("FDIC: active banks only, US offices only, five-digit ZIPs, sorted, dated", () => {
  const out = compactFdic({
    institutions: [
      { CERT: 628, NAME: "JPMorgan Chase Bank, National Association", SPECGRP: 1, ASSET: 4091315000 },
      { CERT: 57512, NAME: "Western Alliance Bank", SPECGRP: 4, ASSET: 90000000 },
      { CERT: 9, NAME: "  No   Offices  Bank ", SPECGRP: null, ASSET: "" }
    ],
    locations: [
      { CERT: "628", ADDRESS: "2 N  Central Ave", CITY: "Phoenix", STALP: "az", ZIP: "85004" },
      { CERT: "57512", ADDRESS: "1 E Washington St", CITY: "Phoenix", STALP: "AZ", ZIP: "85004-2233" },
      { CERT: "3510", ADDRESS: "Not active", CITY: "X", STALP: "AZ", ZIP: "85004" },
      { CERT: "628", ADDRESS: "50 Shirley Street", CITY: "Nassau", STALP: "", ZIP: "00000" },
      { CERT: "628", ADDRESS: "33 King Williams Street", CITY: "London", STALP: "", ZIP: "0EC4R" }
    ],
    index: { name: "locations_20261106100008", createTimestamp: "2026-11-06T12:54:15Z" }
  });
  assert.equal(out.source.asOf, "2026-11-06");
  assert.equal(out.source.index, "locations_20261106100008");
  assert.deepEqual(out.institutionFields, ["name", "specgrp", "assetThousands"]);
  assert.deepEqual(out.institutions, {
    "628": ["JPMorgan Chase Bank, National Association", 1, 4091315000],
    "57512": ["Western Alliance Bank", 4, 90000000]
  }, "a bank with no office kept is not listed");
  assert.deepEqual(out.branches, [
    ["628", "2 N Central Ave", "Phoenix", "AZ", "85004"],
    ["57512", "1 E Washington St", "Phoenix", "AZ", "85004"]
  ]);
});

test("FDIC: an unreadable stamp leaves the date unknown, never made up", () => {
  const out = compactFdic({ institutions: [], locations: [], index: { createTimestamp: "soon" } });
  assert.equal(out.source.asOf, null);
  assert.deepEqual(out.branches, []);
});

test("NCUA: quoted CSV fields, commas and quotes inside quotes", () => {
  assert.deepEqual(csvFields('1,"A, B",x,"say ""hi""",'), ["1", "A, B", "x", 'say "hi"', ""]);
});

test("NCUA: TOM_CODE per charter, trimmed; a row with no two-digit code is skipped", () => {
  const text = [
    '"CU_NUMBER","CU_NAME","TOM_CODE"',
    '5536,"NAVY FEDERAL CREDIT UNION","05  "',
    '68713,"DESERT FINANCIAL","99  "',
    '15847,"U-HAUL, INC","22"',
    '7,"NO CODE",""',
    'x,"BAD CHARTER","00"'
  ].join("\r\n");
  assert.deepEqual(membershipCodes(text), { "5536": "05", "68713": "99", "15847": "22" });
  assert.throws(() => membershipCodes('"A","B"\n1,2'), /TOM_CODE/);
  assert.deepEqual(membershipCodes(""), {});
});
