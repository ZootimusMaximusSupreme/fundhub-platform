#!/usr/bin/env node
// Build the FDIC bank-branch directory that src/finance/local-banks.mjs reads.
//
//   node scripts/build-fdic-branch-data.mjs            writes src/finance/fdic-branch-data.json
//   node scripts/build-fdic-branch-data.mjs --check    downloads and checks, writes nothing
//
// SOURCE. The FDIC's own public API, the BankFind Suite (docs:
// https://api.fdic.gov/banks/docs/, read 2026-11-07). Two reads, both GET:
//   /banks/institutions  filters=ACTIVE:1                every active FDIC-insured bank (CERT, NAME,
//                                                        SPECGRP, ASSET)
//   /banks/locations     filters=SERVTYPE:(11 OR 12)     every full-service office: 11 = brick and
//                                                        mortar, 12 = retail (the docs' SERVTYPE list)
// The docs say: "Users are currently not required to register and obtain a
// unique key", so no key is sent. Paging is limit (max 10,000) and offset.
//
// NOTHING ABOUT ANY CLIENT LEAVES. The requests carry the FDIC's own filters
// only. The app never calls the FDIC: it reads the file this script writes,
// the same way src/blueprint/local-credit-unions.mjs reads the NCUA file.
//
// The file is compact: institutions { cert: [legal name, SPECGRP, ASSET] } and
// one row per office [cert, street, city, state, ZIP]. SPECGRP is the FDIC's
// asset specialization group and ASSET is total assets in thousands of dollars;
// src/finance/local-banks.mjs uses both to keep online, card and industrial
// banks out of "local banks". Offices of inactive banks and offices outside the
// United States (no state, no five-digit ZIP) are left out. A download that comes
// back short of the FDIC's own total is refused, never written.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API = "https://api.fdic.gov/banks";
const OUT = fileURLToPath(new URL("../src/finance/fdic-branch-data.json", import.meta.url));
const PAGE = 10000;
/* A sanity floor, not a rule: the FDIC listed 74,245 full-service offices on
   2026-11-06. Far fewer means the download broke. */
const MIN_BRANCHES = 50000;
const MIN_INSTITUTIONS = 3000;

const clean = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * compactFdic({ institutions, locations, index }) → the directory file.
 * institutions: [{ CERT, NAME, SPECGRP, ASSET }]; locations: [{ CERT, ADDRESS, CITY, STALP, ZIP }];
 * index: the API's meta.index ({ name, createTimestamp }).
 */
export function compactFdic({ institutions = [], locations = [], index = {} } = {}) {
  const names = {};
  const whole = (v) => (Number.isSafeInteger(Number(v)) && v !== null && v !== "" ? Number(v) : null);
  for (const i of institutions) {
    const cert = clean(i && i.CERT, 12);
    const name = clean(i && i.NAME, 160);
    if (/^\d+$/.test(cert) && name) names[cert] = [name, whole(i.SPECGRP), whole(i.ASSET)];
  }
  const branches = [];
  for (const r of locations) {
    const cert = clean(r && r.CERT, 12);
    if (!names[cert]) continue;
    const zip = clean(r.ZIP, 10).slice(0, 5);
    const state = clean(r.STALP, 2).toUpperCase();
    if (!/^\d{5}$/.test(zip) || !/^[A-Z]{2}$/.test(state)) continue;
    branches.push([cert, clean(r.ADDRESS), clean(r.CITY, 60), state, zip]);
  }
  branches.sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true }) || a[4].localeCompare(b[4]) ||
    a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));
  const used = new Set(branches.map((b) => b[0]));
  const kept = Object.fromEntries(Object.entries(names).filter(([cert]) => used.has(cert))
    .sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true })));
  const stamp = clean(index.createTimestamp, 40);
  return {
    version: 1,
    source: {
      name: "FDIC BankFind Suite: institution locations",
      asOf: /^\d{4}-\d{2}-\d{2}/.test(stamp) ? stamp.slice(0, 10) : null,
      index: clean(index.name, 80) || null,
      url: `${API}/locations`,
      docs: `${API}/docs/`,
      filter: "Active FDIC-insured banks; full-service offices only (SERVTYPE 11 brick and mortar, 12 retail); five-digit ZIP."
    },
    institutionFields: ["name", "specgrp", "assetThousands"],
    branchFields: ["cert", "address", "city", "state", "postalCode"],
    institutions: kept,
    branches
  };
}

async function readAll(endpoint, filters, fields, sortBy) {
  const rows = [];
  let total = null;
  let index = null;
  for (let offset = 0; total === null || offset < total; offset += PAGE) {
    const q = new URLSearchParams({ filters, fields, limit: String(PAGE), offset: String(offset), sort_by: sortBy, sort_order: "ASC" });
    const res = await fetch(`${API}/${endpoint}?${q}`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`FDIC ${endpoint} answered ${res.status}`);
    const body = await res.json();
    total = Number(body && body.meta && body.meta.total);
    if (!Number.isInteger(total)) throw new Error(`FDIC ${endpoint} sent no total`);
    index = (body.meta && body.meta.index) || index;
    const page = Array.isArray(body.data) ? body.data.map((d) => d && d.data).filter(Boolean) : [];
    if (!page.length) break;
    rows.push(...page);
  }
  if (rows.length !== total) throw new Error(`FDIC ${endpoint}: got ${rows.length} of ${total} rows. Nothing written.`);
  return { rows, index };
}

async function main() {
  const check = process.argv.includes("--check");
  const inst = await readAll("institutions", "ACTIVE:1", "CERT,NAME,SPECGRP,ASSET", "CERT");
  const locs = await readAll("locations", "SERVTYPE:(11 OR 12)", "CERT,UNINUM,ADDRESS,CITY,STALP,ZIP", "UNINUM");
  const data = compactFdic({ institutions: inst.rows, locations: locs.rows, index: locs.index || {} });
  const n = data.branches.length;
  const banks = Object.keys(data.institutions).length;
  if (n < MIN_BRANCHES || banks < MIN_INSTITUTIONS) {
    throw new Error(`Only ${n} offices at ${banks} banks came back. Nothing written.`);
  }
  console.log(`FDIC ${data.source.asOf} (${data.source.index}): ${n} offices at ${banks} banks.`);
  if (check) return;
  writeFileSync(OUT, JSON.stringify(data) + "\n");
  console.log(`Wrote ${OUT}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
}
