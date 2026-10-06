// The word bank merge, the saved files and the campaign map. Pure. Unit X1.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeBank, parseBank, bankLine } from "./word-bank.mjs";
import { avatarFiles, avatarPaths, stampVersion, avatarName, thinLines, runCounts, withClientVoice, GATES } from "./document.mjs";
import { campaignForOfferKey, offerKeyForCampaign, campaignWords, defaultServiceDescription } from "./campaigns.mjs";
import { evaluate, splitFrontMatter, parseFrontMatter } from "../../../scripts/flywheel/status.mjs";
import { avatarCostLine } from "../costs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REAL_BANK = fs.readFileSync(path.join(ROOT, "marketing/flywheel/partner/01-avatar/Market_Language_Bank.md"), "utf8");

describe("the word bank is merged, never replaced", () => {
  test("the real partner bank parses, and a merge keeps every byte of it", () => {
    const old = parseBank(REAL_BANK);
    assert.ok(old.length > 400, `parsed ${old.length} entries`);
    const out = mergeBank(REAL_BANK, [
      { quote: "brand new words from a forum thread about renewals", source: "https://ex.com/t/1", tag: "desire", verbatim: true },
      { quote: old[0].words, source: "https://ex.com/t/2", tag: "desire", verbatim: true }
    ], { date: "2026-10-06", jobId: "abcdef12-0000-0000-0000-000000000000" });
    assert.ok(out.text.startsWith(REAL_BANK.trimEnd()), "the old file is kept word for word");
    assert.equal(out.kept, new Set(old.map((e) => e.key)).size, "different entries, each counted once");
    assert.equal(out.added, 1, "a quote already in the bank is not added twice");
    assert.equal(out.entries, out.kept + 1);
    assert.match(out.text, /## Added by the server run on 2026-10-06 \(job abcdef12\)\n\n- \*\*brand new words/);
  });

  test("nothing new: the file comes back unchanged; no bank yet: a titled one is started", () => {
    assert.equal(mergeBank("# Bank\n\n- **a b c d** — _pain_ (x)\n", [], { date: "d", jobId: "j" }).text, "# Bank\n\n- **a b c d** — _pain_ (x)\n");
    const fresh = mergeBank(null, [{ quote: "one two three four", source: "https://ex.com", verbatim: false }], { date: "2026-10-06", jobId: "j", campaignWords: "Partner offer" });
    assert.match(fresh.text, /^# Market Language Bank — Partner offer/);
    assert.match(fresh.text, /- \*\*\[PARAPHRASE\] one two three four\*\* — _tone_/);
    assert.equal(parseBank(fresh.text)[0].key, "one two three four", "a paraphrase matches its words later");
  });

  test("a bank line reads back as an entry", () => {
    const line = bankLine({ quote: "we got backdoored (again)", source: "https://ex.com/a", tag: "pain", verbatim: true });
    assert.equal(parseBank(line).length, 1);
  });
});

describe("the saved files", () => {
  const progress = {
    docs: {
      foundation: "# F", overview: "# O", desire: "# D", mechanism: "# M", info: "# I", bank: "# B\n",
      final: "# Core_Avatar_Profile.md\n\n## Avatar Name: **\"Backdoored Brandon\"**\n\nBody."
    },
    quotes: { round: 2, kept: [
      { quote: "q one two three four", source: "https://ex.com/1", url: "ex.com/1", verbatim: true, tag: "pain" },
      { quote: "q five six seven eight", source: "https://ex.com/2", url: "ex.com/2", verbatim: false, tag: "pain" }
    ], dropped: 3, errors: ["Round 1, Review sites: web search: too_many_requests"] },
    info: { families: { 0: { kept: [{ source: "https://ex.com/r", information: "A fact." }] } }, dropped: 1 },
    bank: { kept: 455, added: 141, entries: 596 },
    check: { unchecked: ["a line that was not found anywhere"], issues: [] },
    searches_used: 40
  };

  test("eight files, the stamp the status script reads, and the stage passes its gates", () => {
    const files = avatarFiles(progress, { campaign: "partner", jobId: "j1", date: "2026-10-06", version: 2, builtAt: "2026-10-06T19:00:00.000Z" });
    const p = avatarPaths("partner");
    assert.deepEqual(Object.keys(files).sort(), Object.values(p).sort());
    const meta = parseFrontMatter(splitFrontMatter(files[p.main]).frontMatter);
    assert.equal(meta.stage, 1);
    assert.equal(meta.version, 2);
    assert.equal(meta.status, "draft");
    assert.equal(meta.counts.quotes, 2);
    assert.equal(meta.counts.languageEntries, 596);
    assert.equal(stampVersion(files[p.main]), 2);
    assert.match(files[p.sources], /Round 1, Review sites: web search: too_many_requests/);
    assert.match(files[p.sources], /## Treat with caution \(1\)/);
    assert.match(files[p.sources], /3 \+ 1|4 thrown out/);
    // The status script's own gates, on a temporary campaign folder.
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "fw-"));
    try {
      fs.writeFileSync(path.join(dir, "01-avatar.md"), files[p.main]);
      const row = evaluate(dir)[0];
      assert.equal(row.state, "FAILED", "2 quotes is under the gate of 20: the row must say so, not pass");
      assert.match(row.reasons.join(" "), /quotes is 2, needs at least 20/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("thin results say so, with the counts; names and sections are read off the text", () => {
    const counts = runCounts(progress);
    assert.deepEqual(thinLines(counts), [`Thin: 2 checked quotes, needs ${GATES.quotes}.`]);
    assert.deepEqual(thinLines({ ...counts, languageEntries: 61 }), [`Thin: 61 phrases, needs ${GATES.languageEntries}.`, `Thin: 2 checked quotes, needs ${GATES.quotes}.`]);
    assert.equal(avatarName(progress.docs.final), "Backdoored Brandon");
    assert.match(withClientVoice("# D\n\nSECTION 4 IS FILLED IN BY THE CHECKER.\n", progress.quotes.kept), /## 4\. Client Voice Evidence/);
    assert.match(withClientVoice("# D\n", []), /Thin: no quote could be checked/);
  });
});

describe("campaigns", () => {
  test("partner sells the partner program; any other offer key is its own folder", () => {
    assert.equal(offerKeyForCampaign("partner"), "PARTNER_ENTRY");
    assert.equal(campaignForOfferKey("PARTNER_ENTRY"), "partner");
    assert.equal(campaignForOfferKey("FUNDING_DFY"), "funding-dfy");
    assert.equal(offerKeyForCampaign("funding-dfy"), "FUNDING_DFY");
    assert.equal(offerKeyForCampaign("no-such-offer"), null);
    assert.equal(offerKeyForCampaign("../etc"), null);
    assert.equal(campaignWords("partner"), "Partner offer");
  });

  test("What we sell is pre-filled with the price from the offer config, never typed", () => {
    assert.match(defaultServiceDescription("partner"), /^The Fundhub \$10,000 white-label partnership/);
    assert.doesNotMatch(defaultServiceDescription("partner"), /FundHub/);
    assert.equal(defaultServiceDescription("no-such-offer"), null);
  });
});

describe("the avatar cost line", () => {
  test("unknown until measured, with the cap and the search ceiling; then the last run", () => {
    const unmeasured = avatarCostLine({ run_caps: { avatar: 20 }, month: { used_usd: 12.5, cap_usd: 300 }, kinds: { avatar: null }, limits: { avatar: { max_searches: 184, max_search_usd: 1.84, steps: 10 } } });
    assert.match(unmeasured, /^Cost: unknown, not measured yet\. This run stops by itself at \$20/);
    assert.match(unmeasured, /\$12\.50 of \$300 used this month/);
    assert.match(unmeasured, /at most 184 searches, so at most \$1\.84 of it is search/);
    const measured = avatarCostLine({ run_caps: { avatar: 20 }, month: { used_usd: 30, cap_usd: 300 }, kinds: { avatar: { last_cost_usd: 6.123, last_minutes: 47, measured_at: "2026-10-07T20:00:00.000Z" } } });
    assert.equal(measured, "About $6.12 and 47 minutes (last run, Oct 7). Stops at $20. $30 of $300 used this month.");
  });
});
