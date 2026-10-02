#!/usr/bin/env node
// Bakes the banks the LenderMatchScroll B-roll scrolls through into
// src/data/lenderMatchScroll.ts, and copies each bank's logo into
// public/lender-logos/ so Remotion can load it.
//
// Sources (nothing else is allowed):
//   - The Fundhub CRM lenders table (public.lenders): a read-only SELECT saved
//     at scripts/data/crm-lenders-with-logos-2026-10-02.json. Each bank's name,
//     its logo_path (the logo the CRM shows for that bank), its lender_table and
//     its bureaus_pulled come from there.
//   - The logo files the CRM serves: public/assets/lenders/ at the repo root
//     (logo_path "/assets/lenders/chase.png" -> public/assets/lenders/chase.png).
//
// The script stops and writes nothing if a bank is not in the CRM snapshot, if
// a bank has no logo_path, more than one logo, or no bureau data, if the logo
// file is missing, or if the logo is smaller than 120 px (it would look soft).
//
// Refresh the snapshot with the SELECT in its "query" field (read only).
// Run from marketing/broll:  node scripts/bake-lender-scroll.mjs

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROLL = path.resolve(HERE, '..');
const ROOT = path.resolve(BROLL, '../..');
const SNAPSHOT = path.join(HERE, 'data/crm-lenders-with-logos-2026-10-02.json');
const OUT = path.join(BROLL, 'src/data/lenderMatchScroll.ts');
const LOGO_OUT = path.join(BROLL, 'public/lender-logos');
const MIN_LOGO_PX = 120;

// 59 banks, in the order they scroll. National names are mixed with regional
// banks. Picked by looking at every CRM logo of 120 px or more: banks whose
// CRM logo is clearly their own mark. Left out: names with notes in them,
// all-caps rows, and logos that are not the bank's mark (site-builder icons,
// browser icons, generic ".bank" tiles, blank tiles).
const PICK = [
  'Southside Bank',
  'Chase',
  'Centier Bank',
  'Bank of America',
  'Emprise Bank',
  'Wells Fargo',
  'Hanmi Bank',
  'Capital One',
  'Northrim Bank',
  'Citi',
  'Oxford Bank',
  'PNC Bank',
  'Republic Bank',
  'Fifth Third',
  'United Community Bank',
  'Santander Bank',
  'First United Bank',
  'M&T Bank',
  'Flagship Bank',
  'Huntington Bank',
  'Frandsen Bank & Trust',
  'Webster Bank',
  'Gate City Bank',
  'Synovus Bank',
  'HomeTown Bank',
  'Old National Bank',
  'Mechanics Bank',
  'UMB Bank',
  'MidFirst Bank',
  'First Citizens',
  'Newburyport Bank',
  'Bank OZK',
  'Park National Bank',
  'Ameris Bank',
  'Sharon Bank',
  'BancFirst',
  'Sterling State Bank',
  'Atlantic Union Bank',
  'TriStar Bank',
  'Cadence Bank',
  'Twin City Bank',
  'Renasant Bank',
  'Virginia National Bank',
  'Trustmark National Bank',
  'Bank of Ann Arbor',
  'Valley National Bank',
  'BankIowa',
  'Bremer Bank',
  'BankVista',
  'Eastern Bank',
  'CCF Bank',
  'Sandy Spring Bank',
  'Camden National Bank',
  'WSFS Bank',
  'ConnectOne Bank',
  'WesBanco',
  'FVC Bank',
  'FNBO',
  '1st Source Bank',
];

// The CRM's lender_table values in plain words (the blurred line under each name).
const PRODUCT = {
  InBranchBizCC: 'Business card, in branch',
  OnlineBizCC: 'Business card, online',
  PersonalCC: 'Personal card',
  PersonalLoans: 'Personal loan',
};

/** Pixel size of a PNG or JPEG file (some CRM logos are JPEGs saved with a .png name). */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return {w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'png'};
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), type: 'jpeg'};
      }
      i += 2 + len;
    }
  }
  return null;
}

const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
const problems = [];
const dupes = PICK.filter((n, i) => PICK.indexOf(n) !== i);
if (dupes.length) problems.push(`listed twice: ${dupes.join(', ')}`);

const banks = PICK.map((name) => {
  const rows = snap.rows.filter((r) => r.name === name);
  if (!rows.length) return problems.push(`${name}: not in the CRM snapshot`), null;
  const logos = [...new Set(rows.map((r) => r.logo_path).filter(Boolean))];
  if (logos.length !== 1) return problems.push(`${name}: ${logos.length} logos in the CRM (${logos.join(', ')})`), null;
  const pulled = new Set(
    rows
      .flatMap((r) => String(r.bureaus_pulled ?? '').split('/'))
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );
  if (!pulled.size) return problems.push(`${name}: no bureau data in the CRM`), null;
  const unknown = [...pulled].filter((b) => !['EX', 'EQ', 'TU'].includes(b));
  if (unknown.length) return problems.push(`${name}: unknown bureau code ${unknown.join(', ')}`), null;
  const src = path.join(ROOT, 'public', logos[0]);
  if (!fs.existsSync(src)) return problems.push(`${name}: logo file missing (${logos[0]})`), null;
  const buf = fs.readFileSync(src);
  const size = imageSize(buf);
  if (!size) return problems.push(`${name}: logo is not a PNG or JPEG (${logos[0]})`), null;
  if (Math.min(size.w, size.h) < MIN_LOGO_PX) return problems.push(`${name}: logo is ${size.w}x${size.h}, under ${MIN_LOGO_PX} px`), null;
  const products = [...new Set(rows.map((r) => PRODUCT[r.lender_table] ?? r.lender_table))];
  return {name, logoPath: logos[0], src, buf, size, bureaus: {EX: pulled.has('EX'), EQ: pulled.has('EQ'), TU: pulled.has('TU')}, products};
});

if (problems.length) {
  console.error('Refusing to write:\n- ' + problems.join('\n- '));
  process.exit(1);
}

fs.mkdirSync(LOGO_OUT, {recursive: true});
for (const b of banks) {
  const dest = path.join(LOGO_OUT, path.basename(b.logoPath));
  fs.writeFileSync(dest, b.buf);
  if (!fs.readFileSync(dest).equals(b.buf)) throw new Error(`copy of ${b.logoPath} does not match the CRM file`);
}

const entries = banks.map((b) => ({
  name: b.name,
  logo: `lender-logos/${path.basename(b.logoPath)}`,
  crmLogoPath: b.logoPath,
  logoPx: b.size.w,
  bureaus: b.bureaus,
  products: b.products.join(' · '),
}));

const body = `// GENERATED by scripts/bake-lender-scroll.mjs. Do not edit by hand; edit PICK there and re-run.
// Source: Fundhub CRM table public.lenders (read-only snapshot scripts/data/crm-lenders-with-logos-2026-10-02.json,
// ${snap.rows.length} rows that have a logo). Logos are byte-for-byte copies of the CRM's own files in public/assets/lenders/.
// bureaus = the CRM's bureaus_pulled for that bank (every product row combined). products = its lender_table, in words.
// On screen the bureau statuses and products are blurred: real data, hidden.

export type ScrollBank = {
  name: string;
  /** Path for staticFile(), a copy of the CRM logo. */
  logo: string;
  /** The CRM's logo_path for this bank. */
  crmLogoPath: string;
  logoPx: number;
  /** Which bureaus this bank pulls, from the CRM (EX = Experian, EQ = Equifax, TU = TransUnion). */
  bureaus: {EX: boolean; EQ: boolean; TU: boolean};
  products: string;
};

/** The ${entries.length} banks LenderMatchScroll scrolls through, in order. */
export const SCROLL_BANKS: readonly ScrollBank[] = ${JSON.stringify(entries, null, 2)};
`;
fs.writeFileSync(OUT, body);
console.log(`Wrote ${entries.length} banks (all in the CRM, every logo found and at least ${MIN_LOGO_PX} px) to ${path.relative(process.cwd(), OUT)}`);
