// Banker finder — the search words for one bank-by-state row, and how to read
// what the search engine sends back. Pure: no network, no database.
//
// Owner rules (docs/specs/bank-outreach-plan-2026-10-14.md): search by
// state + bank + position; never open or scrape linkedin.com or a bank's own
// site. We only read the search engine's own result list (title, link, short
// snippet). A result that does not clearly name this bank is dropped, not
// guessed into a contact.
import { STATE_NAMES } from '../climate/config.mjs';

export const TARGET_TITLES = Object.freeze(['relationship manager', 'business banker', 'SVP', 'vice president']);

const TERRITORY_NAMES = { AS: 'American Samoa', GU: 'Guam', MP: 'Northern Mariana Islands', PR: 'Puerto Rico', VI: 'U.S. Virgin Islands' };
export function stateName(code) { return STATE_NAMES[code] || TERRITORY_NAMES[code] || null; }

// FDIC/NCUA legal names carry suffixes nobody writes on LinkedIn.
const LEGAL_SUFFIX = /(,?\s+(national association|n\.?\s?a\.?|fsb|f\.s\.b\.|ssb|s\.s\.b\.|inc\.?|incorporated|corporation|corp\.?|co\.?|federal savings bank|federal credit union|fcu))+\s*$/i;
export function searchName(legalName) {
  let name = String(legalName || '').replace(/\s+/g, ' ').trim().replace(/^the\s+/i, '');
  for (let i = 0; i < 3; i++) name = name.replace(LEGAL_SUFFIX, '').replace(/[,\s]+$/, '');
  // "Western Alliance Bank" is "Western Alliance" on a profile. Keep the word
  // when what is left is too plain to name one bank ("First Bank").
  const short = name.replace(/\s+(bank|credit union|savings bank|bank and trust|bank & trust|trust company)$/i, '');
  if (short !== name && short.split(' ').length >= 2 && short.length >= 8) name = short;
  return name;
}

export function bankerQuery(account) {
  const bank = searchName(account?.name);
  const state = stateName(account?.state);
  if (!bank || !state) return null;
  const titles = TARGET_TITLES.map(t => `"${t}"`).join(' OR ');
  return `site:linkedin.com/in "${bank}" (${titles}) "${state}"`;
}

const words = value => String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
function mentionsBank(textValue, bank) {
  const hay = ` ${words(textValue)} `;
  const needle = words(bank);
  return needle.length >= 3 && hay.includes(` ${needle} `);
}

export function profileUrl(link) {
  let url;
  try { url = new URL(link); } catch { return null; }
  if (url.protocol !== 'https:' || !/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
  const slug = url.pathname.match(/^\/in\/([A-Za-z0-9\-_%]{3,100})\/?$/)?.[1];
  return slug ? `https://www.linkedin.com/in/${slug}` : null;
}

function personName(part) {
  const name = String(part || '').replace(/,.*$/, '').replace(/\s+/g, ' ').trim();
  const count = name.split(' ').length;
  if (count < 2 || count > 5 || /\d|linkedin|bank|credit union|jobs|profiles/i.test(name)) return null;
  if (!/^[\p{L}][\p{L}'’.\- ]+$/u.test(name)) return null;
  return name;
}

const TITLE_WORDS = /relationship manager|business banker|banker|vice president|\bsvp\b|\bvp\b|\bevp\b|president|manager|lending|lender|loan officer|director/i;

// One search result → one lead, or null. Google titles for profiles read
// "Name - Headline - Employer | LinkedIn" (dash, en dash or em dash).
export function parseResult(result, account) {
  const linkedin_url = profileUrl(result?.link || result?.url);
  if (!linkedin_url) return null;
  const bank = searchName(account?.name);
  const rawTitle = String(result?.title || '').replace(/\s*[|·-]\s*LinkedIn\s*$/i, '').trim();
  const parts = rawTitle.split(/\s+[-–—]\s+/).map(p => p.trim()).filter(Boolean);
  const name = personName(parts[0]);
  if (!name) return null;
  const snippet = String(result?.snippet || result?.description || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const employer = parts.length >= 2 ? parts[parts.length - 1] : null;
  const headline = parts.length >= 3 ? parts.slice(1, -1).join(' - ') : (parts[1] && !mentionsBank(parts[1], bank) ? parts[1] : null);
  const employerMatch = mentionsBank(employer, bank) || mentionsBank(headline, bank);
  const snippetMatch = mentionsBank(snippet, bank);
  if (!employerMatch && !snippetMatch) return null;
  const title = headline || snippet.match(/^([^·.]{3,120}?)\s+at\s+/i)?.[1]?.trim() || null;
  const titleMatch = TITLE_WORDS.test(title || '') || TITLE_WORDS.test(snippet);
  const stateSeen = mentionsBank(snippet, stateName(account?.state)) || mentionsBank(rawTitle, stateName(account?.state));
  const confidence = employerMatch && titleMatch ? 'high' : employerMatch || (snippetMatch && titleMatch) ? 'medium' : 'low';
  return { name, title: title ? title.slice(0, 250) : null, employer: employer ? employer.slice(0, 250) : null, linkedin_url, snippet, confidence, state_seen: stateSeen };
}

// All results for one row, best first, one lead per profile.
export function parseResults(results, account) {
  const rank = { high: 0, medium: 1, low: 2 };
  const leads = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const lead = parseResult(result, account);
    if (!lead || lead.confidence === 'low') continue;
    const prior = leads.get(lead.linkedin_url);
    if (!prior || rank[lead.confidence] < rank[prior.confidence]) leads.set(lead.linkedin_url, lead);
  }
  return [...leads.values()].sort((a, b) => rank[a.confidence] - rank[b.confidence]);
}
