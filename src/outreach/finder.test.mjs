import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchName, bankerQuery, parseResult, parseResults, profileUrl, stateName } from './finder.mjs';

const chaseAZ = { name: 'JPMorgan Chase Bank, National Association', state: 'AZ' };

test('legal names become the names people write on LinkedIn, without going too plain', () => {
  assert.equal(searchName(chaseAZ.name), 'JPMorgan Chase');
  assert.equal(searchName('Bank of America, N.A.'), 'Bank of America');
  assert.equal(searchName('Western Alliance Bank'), 'Western Alliance');
  assert.equal(searchName('Desert Financial Federal Credit Union'), 'Desert Financial');
  assert.equal(searchName('First Bank'), 'First Bank');
  assert.equal(searchName('The Bank of Tampa'), 'Bank of Tampa');
});

test('the owner search: bank + state + titles, LinkedIn profiles only', () => {
  assert.equal(bankerQuery(chaseAZ), 'site:linkedin.com/in "JPMorgan Chase" ("relationship manager" OR "business banker" OR "SVP" OR "vice president") "Arizona"');
  assert.match(bankerQuery({ name: 'Banco Popular de Puerto Rico', state: 'PR' }), /"Puerto Rico"$/);
  assert.equal(bankerQuery({ name: 'X Bank', state: 'ZZ' }), null);
  assert.equal(stateName('DC'), 'District of Columbia');
});

test('only real profile links are kept, normalized, never company or job pages', () => {
  assert.equal(profileUrl('https://ca.linkedin.com/in/jane-doe-1a2b/?trk=x'), 'https://www.linkedin.com/in/jane-doe-1a2b');
  for (const bad of ['https://www.linkedin.com/company/chase', 'https://www.linkedin.com/jobs/view/1', 'https://evil.example/in/jane', 'http://www.linkedin.com/in/jane-doe', 'not a url']) assert.equal(profileUrl(bad), null, bad);
});

test('a result that names this bank becomes a lead; another bank or no person is dropped', () => {
  const lead = parseResult({ title: 'Jane Doe - Vice President, Business Banking - JPMorgan Chase & Co. | LinkedIn', link: 'https://www.linkedin.com/in/jane-doe-123/', snippet: 'Vice President at JPMorgan Chase & Co. · Location: Phoenix, Arizona' }, chaseAZ);
  assert.deepEqual({ name: lead.name, title: lead.title, confidence: lead.confidence, state_seen: lead.state_seen }, { name: 'Jane Doe', title: 'Vice President, Business Banking', confidence: 'high', state_seen: true });
  assert.equal(parseResult({ title: 'Mary Major - Relationship Manager - Wells Fargo | LinkedIn', link: 'https://www.linkedin.com/in/marymajor', snippet: 'Relationship Manager at Wells Fargo' }, chaseAZ), null);
  assert.equal(parseResult({ title: 'JPMorgan Chase Jobs | LinkedIn', link: 'https://www.linkedin.com/in/chasejobs', snippet: 'JPMorgan Chase' }, chaseAZ), null);
  assert.equal(parseResult({ title: 'Sam Roe 2 - JPMorgan Chase', link: 'https://www.linkedin.com/in/sam', snippet: '' }, chaseAZ), null);
});

test('leads are one per profile, best first; weak matches are dropped', () => {
  const leads = parseResults([
    { title: 'John Roe – JPMorgan Chase | LinkedIn', link: 'https://www.linkedin.com/in/johnroe', snippet: 'Business Relationship Manager at JPMorgan Chase. Phoenix, Arizona' },
    { title: 'John Roe – JPMorgan Chase | LinkedIn', link: 'https://ca.linkedin.com/in/johnroe', snippet: 'Business Relationship Manager at JPMorgan Chase.' },
    { title: 'Ann Lee | LinkedIn', link: 'https://www.linkedin.com/in/annlee', snippet: 'Worked near JPMorgan Chase.' }
  ], chaseAZ);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].linkedin_url, 'https://www.linkedin.com/in/johnroe');
  assert.equal(parseResults(null, chaseAZ).length, 0);
});
