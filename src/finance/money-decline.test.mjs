// The Money Helper's reading of a pasted bank decline (src/finance/money-decline.mjs).
// Pure: no database, no clock, no network. The letter is the role-play's own sample
// (src/finance/money-agent-sim.mjs SAMPLE_DECLINE_LETTER): a Chase business-card
// decline, reasons too many inquiries and a balance-to-limit ratio that is too high,
// one phone number the bank gives (800-555-0142) and a credit bureau's own in its
// address block.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  readDeclinePaste, letterText, clientIntro, extractBank, bankInText, textHas, declineFacts, declineRulesReply,
  declineFollowUpReply, DECLINE_TOPIC_RE, declineReplyProblems, declineRecordedIn, lastDeclineInThread, phonesIn,
  quotedPassages, reasonsCheck, stepOrder, MIN_PASTE_CHARS, MAX_PASTE_CHARS, MAX_DECLINE_REPLY_CHARS
} from "./money-decline.mjs";
import { SAMPLE_DECLINE_LETTER } from "./money-agent-sim.mjs";
import { MAX_LETTER_CHARS } from "../blueprint/decline-analyze.mjs";

const LETTER = SAMPLE_DECLINE_LETTER;
const PASTE = `I just got declined by Chase — here's the letter:\n\n${LETTER}`;
const paste = readDeclinePaste(PASTE);

describe("is this message a pasted decline?", () => {
  test("the sample letter is, with or without the client's own line ahead of it, and on one flattened line", () => {
    for (const input of [PASTE, LETTER, PASTE.replace(/\n+/g, " ")]) {
      const p = readDeclinePaste(input);
      assert.ok(p, input.slice(0, 40));
      assert.equal(p.analysis.looks_like, "decline");
      assert.deepEqual(p.analysis.reasons.map((r) => r.category), ["too_many_inquiries", "high_utilization"]);
    }
  });

  test("it is held to the analyzer's own signals: long enough, application wording, read as a decline, one reason-shaped signal", () => {
    assert.equal(MAX_PASTE_CHARS, MAX_LETTER_CHARS, "the same cap the reader and the decline store use");
    assert.equal(readDeclinePaste("Chase declined me for the Ink card, why?"), null, "short");
    assert.equal(readDeclinePaste("x".repeat(MAX_PASTE_CHARS + 1)), null, "longer than any letter");
    assert.equal(readDeclinePaste(""), null);
    assert.equal(readDeclinePaste(null), null);
    const store = "My business card was declined at the store yesterday and I think it is because my utilization is too high and the inquiries on my report. What should I do about the payments due next week and should I pay the Amex first? I am worried about my balances and I am also confused about the plan.";
    assert.ok(store.length > MIN_PASTE_CHARS);
    assert.equal(readDeclinePaste(store), null, "a card declined at a store is not an application letter");
    const chatty = "I have been thinking about my money a lot lately and I wanted to ask you a few things about my plan, my cards, my loan and what I should pay first this month because I am a little confused about what is due and when. Unfortunately I cannot remember everything. Thanks for your help with all of this, I really do appreciate it a lot.";
    assert.equal(readDeclinePaste(chatty), null, "'unfortunately' alone, with no application and no reason");
  });

  test("an approval, a counteroffer, and a request for papers are not declines", () => {
    const approval = "Dear Test Test,\n\nThank you for applying for the Chase Ink Business Unlimited credit card. Congratulations, you have been approved for a credit limit of $10,000. Your card will arrive in 7 to 10 business days. Please activate it when it arrives, and call us with any questions about your application.\n\nSincerely,\nChase Card Services";
    const counter = "Dear Test Test,\n\nThank you for applying for the Chase Ink Business Unlimited credit card. We approved your application for a reduced credit limit of $3,000 instead of the amount you asked for. Please let us know if you accept the lower amount within 30 days of this notice. We obtained your credit report from Equifax.\n\nSincerely,\nChase Card Services";
    const papers = "Dear Test Test,\n\nThank you for applying for the Chase Ink Business Unlimited credit card. We need additional documentation before we can finish your application. Please provide two months of business bank statements and a copy of your identification so we can verify your identity. We obtained your credit report from Equifax.\n\nSincerely,\nChase Card Services";
    for (const input of [approval, counter, papers]) assert.equal(readDeclinePaste(input), null, input.slice(60, 120));
  });

  test("a decline with no reason the reader can place is still a decline, and says a person has to read it", () => {
    const vague = "Dear Test Test,\n\nThank you for applying for a Chase Ink Business Unlimited credit card. We are unable to approve your application at this time. We obtained your credit report from Equifax. If you have questions about this decision, please write to us at the address on your statement and we will get back to you as soon as we can.\n\nSincerely,\nChase Card Services";
    const p = readDeclinePaste(vague);
    assert.ok(p);
    const f = declineFacts(p, { buyer: false });
    assert.deepEqual(f.reasons, []);
    assert.equal(f.needs_a_person_to_read.yes, true);
    assert.match(declineRulesReply(f), /^I read your letter, but I could not find a clear reason in it\./);
  });

  test("a line the reader cannot place is kept as a part nobody could match, and a person is asked to read it", () => {
    const odd = LETTER.replace("- Too many inquiries on your credit report", "- Too many inquiries on your credit report\n- Requested credit line exceeds our guidelines");
    const f = declineFacts(readDeclinePaste(odd), { buyer: true });
    assert.deepEqual(f.parts_nobody_could_match, ["Requested credit line exceeds our guidelines"]);
    assert.equal(f.needs_a_person_to_read.yes, true);
    assert.match(declineRulesReply(f), /A Fundhub person has to read this part of the letter: "Requested credit line exceeds our guidelines"\./);
  });
});

describe("the letter as the helper keeps it", () => {
  test("the client's own numbers are masked the way decline-analyze masks them; line breaks stay", () => {
    const t = letterText("Dear Test,\r\nSSN 987-65-4321, Date of birth: 04/05/1980,\ncard 5500 0000 0000 0004, account 998877665.\n\n\n\nBye\u0000");
    assert.ok(!/987-65-4321|04\/05\/1980|5500|998877665/.test(t), t);
    assert.match(t, /Date of birth: \[number removed\]/);
    assert.equal(t.split("\n").length, 5, "lines kept, a long run of blank lines folded to one");
    assert.ok(!t.includes("\u0000"));
    assert.ok(paste.text.includes("\n"), "the stored letter keeps its lines");
    assert.ok(!paste.text.includes("4471902238"), "the application number is masked");
  });

  test("the hash is the decline store's own: the same letter, the same hash; spacing and case do not make a second letter", () => {
    assert.equal(readDeclinePaste(PASTE.toUpperCase()).hash, paste.hash);
    assert.equal(readDeclinePaste(PASTE.replace(/\n\n/g, "\n   \n")).hash, paste.hash);
    assert.notEqual(readDeclinePaste(LETTER).hash, paste.hash, "the client's own line is part of what was pasted");
  });

  test("the client's own words are the short first paragraph ahead of the letter — never the bank's notices", () => {
    assert.equal(clientIntro(PASTE), "I just got declined by Chase — here's the letter:");
    assert.equal(clientIntro(LETTER), "", "a letter that opens with its own subject line has no words of the client's");
    assert.equal(clientIntro(`Dear Test,\n\n${LETTER}`), "");
    assert.equal(clientIntro("only one paragraph"), "");
    assert.equal(clientIntro(`${"x".repeat(301)}\n\n${LETTER}`), "", "a long first paragraph is the letter");
    assert.equal(clientIntro("STOP\n\nthe letter follows here"), "STOP");
  });
});

describe("the bank's name", () => {
  test("from the client's words, then from the letter's own signature; null when it cannot be told", () => {
    assert.equal(extractBank("I just got declined by Chase — here's the letter:\n\nDear x"), "Chase");
    assert.equal(extractBank("Denied by Capital One. Here is the email:\n\nDear x"), "Capital One");
    assert.equal(extractBank("Bank of America declined me yesterday\n\nDear x"), "Bank of America");
    assert.equal(extractBank("got declined by chase today, letter below\n\nDear x"), "Chase");
    assert.equal(extractBank("The email from Wells Fargo is below:\n\nDear x"), "Wells Fargo");
    assert.equal(extractBank(LETTER), "Chase", "from 'Chase Card Services' in the letter's own signature");
    assert.equal(extractBank("Sincerely\nAmerican Express National Bank"), "American Express National Bank");
    assert.equal(extractBank("Thank you for applying. We are unable to approve your application."), null);
    assert.equal(extractBank("I got declined by them. Here it is:\n\nDear x"), null, "a pronoun is not a bank");
  });

  test("a bank the model names must be written in the letter", () => {
    assert.equal(bankInText("Chase", paste.text), true);
    assert.equal(bankInText("Chase Bank, N.A.", paste.text), true);
    assert.equal(bankInText("Wells Fargo", paste.text), false);
    assert.equal(bankInText("", paste.text), false);
    assert.equal(textHas("Chase Ink Business Unlimited", paste.text), true);
    assert.equal(textHas("Sapphire Reserve", paste.text), false);
    assert.equal(textHas("ab", paste.text), false, "too short to mean anything");
  });
});

describe("what the model is handed — FACTS.decline_analysis", () => {
  const f = declineFacts(paste, { buyer: true, from: "this message", recorded: false });

  test("the shape: who, what the bank wrote, the plan in order, what to fix, timing, the bank's phone", () => {
    assert.deepEqual(Object.keys(f), [
      "from", "client_is_blueprint_buyer", "already_saved", "bank_named", "looks_like", "reasons", "parts_nobody_could_match",
      "needs_a_person_to_read", "steps_in_order", "fix_first", "timing", "phone_numbers_in_letter", "bureaus_named", "numbers_hidden_for_safety"
    ]);
    assert.deepEqual([f.from, f.client_is_blueprint_buyer, f.already_saved, f.bank_named], ["this message", true, false, "Chase"]);
    assert.deepEqual(f.reasons[0], {
      reason: "Too many recent credit checks",
      in_plain_words: "The bank saw too many recent credit checks (hard inquiries) on your report.",
      the_bank_wrote: "Too many inquiries on your credit report"
    });
    assert.deepEqual(f.phone_numbers_in_letter.map((p) => p.number), ["800-555-0142"]);
    assert.deepEqual(f.bureaus_named, ["equifax"]);
    assert.equal(f.numbers_hidden_for_safety, true);
    assert.equal(f.timing.dates_picked.includes("Staff set"), true, "no date is picked");
  });

  test("the plan is in the analysis's order, each step says who does it, and every worded step names where it came from", () => {
    assert.deepEqual(f.steps_in_order.map((s) => s.key), [
      "read_letter", "get_letter", "find_recon_line", "gather_facts", "call_recon", "ask_manual_review", "ask_rm",
      "say:too_many_inquiries", "say:high_utilization", "call_again", "log_call", "second_no"
    ]);
    assert.deepEqual(f.steps_in_order.map((s) => s.who), ["agent", "client", "agent", "agent", "ops", "ops", "ops", "ops", "ops", "ops", "ops", "ops"]);
    for (const s of f.steps_in_order) {
      if (s.a_person_must_write) assert.equal(s.provenance, undefined, "a blank has no source");
      else assert.ok(s.provenance, `${s.key} has no source`);
    }
    const find = f.steps_in_order.find((s) => s.key === "find_recon_line");
    assert.equal(find.status, "done");
    assert.equal(find.found, "Letter: 800-555-0142");
  });

  test("a line no source covers is a blank for a person, in plain words — never a made-up script", () => {
    const blank = f.steps_in_order.find((s) => s.key === "say:too_many_inquiries");
    assert.equal(blank.a_person_must_write, 'what to say about "Too many recent credit checks"');
    assert.equal(blank.step, undefined);
    assert.ok(!JSON.stringify(f).includes("Write it here"));
  });

  test("what to fix first is its own list, each line tied to its reason; the lender book never appears", () => {
    assert.deepEqual(f.fix_first.map((x) => [x.for_reason, x.who]), [
      ["Too many recent credit checks", "client"], ["Too many recent credit checks", "ops"],
      ["Cards used too much", "client"], ["Cards used too much", "client"], ["Cards used too much", "client"]
    ]);
    assert.ok(f.steps_in_order.every((s) => !/^(fix|book):/.test(s.key)));
    assert.ok(!/lender book/i.test(JSON.stringify(f)), "the one plan line that names the lender book is cleaned for the client's helper");
    assert.equal(f.steps_in_order.find((s) => s.key === "find_recon_line").step, "Find Chase's reconsideration phone number. Use a number from the letter if there is one; if not, look it up.");
  });

  test("timing is the plan's own: call again at least 4 times; the windows it states; none picked", () => {
    assert.match(f.timing.call_again, /at least 4 times/);
    assert.ok(f.timing.apply_again_when.some((t) => /6 months/.test(t)));
    assert.deepEqual(f.timing.bank_deadlines_in_the_letter, []);
  });

  test("a client who has not bought the Capital Blueprint, and a letter already saved, say so", () => {
    const n = declineFacts(paste, { buyer: false, from: "earlier in this chat", recorded: true });
    assert.deepEqual([n.client_is_blueprint_buyer, n.from, n.already_saved], [false, "earlier in this chat", true]);
  });
});

describe("what a decline answer may never say", () => {
  const f = declineFacts(paste, { buyer: false });
  const check = (reply) => declineReplyProblems(reply, { facts: f, text: paste.text });

  test("only the bank's own phone number; a made-up one and a credit bureau's are both caught", () => {
    assert.deepEqual(check("Call 800-555-0142 and ask for a second look."), []);
    assert.deepEqual(check("Call (800) 555-0142."), [], "the same number written another way");
    assert.deepEqual(check("Call 800-123-4567."), ["phone_not_in_the_letter: 800-123-4567"]);
    assert.deepEqual(check("Call Equifax at 1-800-685-1111."), ["phone_not_in_the_letter: 1-800-685-1111"]);
    assert.deepEqual(phonesIn("a 800-555-0142, b (602) 555.0199, c 12-34"), ["800-555-0142", "602-555-0199"]);
  });

  test("words in quotation marks must be words the bank wrote; the tip may be quoted too", () => {
    assert.deepEqual(check('It wrote: "Too many inquiries on your credit report".'), []);
    assert.deepEqual(check('It wrote: "too many … report".'), [], "an ellipsis cuts a quote into pieces, each of which is in the letter");
    assert.deepEqual(check('It wrote: "Your business is too new for this card".'), ['quote_not_in_the_letter: "Your business is too new for this card"']);
    assert.deepEqual(check('Ask for a "manual review" on the call.'), [], "fewer than four words is a phrase, not a quote of the bank");
    assert.deepEqual(check('Say "ask for a manual review" on the call.'), [], "a line of the analysis the helper was handed may be quoted too");
    assert.deepEqual(check('Say "please wire the money today" on the call.'), ['quote_not_in_the_letter: "please wire the money today"'], "four words or more in quotation marks must be somewhere the helper was told");
    assert.deepEqual(declineReplyProblems('UnderwriteIQ says: "Bring revolving balances down before you apply."', { facts: f, text: paste.text, tip: "Bring revolving balances down before you apply." }), []);
    assert.deepEqual(quotedPassages('a "tiny" and “curly quotes here are long enough”'), ["curly quotes here are long enough"], "under eight characters is not a quote");
  });

  test("a reason the reader did not find is caught, whatever its wording; the ones it found are not", () => {
    assert.deepEqual(check("The bank saw too many recent credit checks and high balances compared to your credit limits."), []);
    assert.deepEqual(check("It also said your income was too low."), ["reason_not_in_the_letter: Income or revenue too low"]);
    assert.deepEqual(check("Your business is too new."), ["reason_not_in_the_letter: Business too new"]);
    assert.deepEqual(check("There were late payments on your report."), ["reason_not_in_the_letter: Late payments or collections"]);
    assert.deepEqual(check('The bank wrote: "Your income was too low for this card".'), ['quote_not_in_the_letter: "Your income was too low for this card"'], "inside quotation marks it is the quote check, not a claim");
  });
});

describe("the no-model answer", () => {
  test("a client who has not bought: the reasons with the bank's words, the steps they can take on their own, what to fix, one Blueprint line", () => {
    const r = declineRulesReply(declineFacts(paste, { buyer: false }));
    assert.equal(r, [
      "I read your letter. These are the likely reasons, not sure ones.",
      "The bank saw too many recent credit checks (hard inquiries) on your report. The bank wrote: \"Too many inquiries on your credit report\".",
      "The bank saw high balances compared to your card limits. The bank wrote: \"Proportion of balances to credit limits is too high on revolving accounts\".",
      "Here is how you can ask the bank for a second look, in order.",
      "First, find Chase's reconsideration phone number. Use a number from the letter if there is one; if not, look it up. The letter gives this number: 800-555-0142.",
      "Next, call Chase's reconsideration line. Ask about the recent application and what limit was approved. Stay friendly and patient.",
      "Then, when they give the reason, say it does not match the file and ask if it can go to reconsideration — a manual review. Point to the strong parts of the report that are true for this file, like a long history, on-time payments, no negative items or low card use.",
      "Last, if they will not reconsider, hang up and call again. Try at least 4 times — the playbook says 4 to 6.",
      "What to fix first:",
      "You have a high number of recent hard inquiries. Cleaning these up will prevent auto-declines and open up better approvals.",
      "Lower your revolving utilization below ~30% for optimal approval odds and limit assignments.",
      "Use the paydown plan in FinanceOS to choose which cards to pay first.",
      "The Capital Blueprint team can run the second look for you.",
      "The bank makes the final call."
    ].join("\n"));
  });

  test("a buyer: Fundhub's own steps in the client's words; saved, already saved, or asked for the bank", () => {
    const f = declineFacts(paste, { buyer: true });
    const saved = declineRulesReply(f, { willSave: true });
    assert.match(saved, /Here is what happens next, in order\.\nFirst, we find the bank's phone line for a second look\. The letter gives this number: 800-555-0142\.\nNext, we get your file ready for the call\./);
    assert.match(saved, /Then, we ask our banker contact at Chase to push for a second look\.\nLast, if they say no, we call again\. We try at least 4 times\./);
    assert.match(saved, /I saved this decline, and your Fundhub funding team has the second look\.\nThe bank makes the final call\.$/);
    assert.match(declineRulesReply(declineFacts(paste, { buyer: true, recorded: true })), /This decline is already saved with your Fundhub funding team\./);
    assert.match(declineRulesReply(f, { willSave: false }), /I could not tell which bank sent the letter\. Paste it again with the bank's name in your first line, like "Chase declined me", and I will start the second look\./);
    assert.doesNotMatch(saved, /Capital Blueprint team can run/, "a buyer is not sold the Blueprint");
  });

  test("a question after the paste: the fix lines and the one line about the second look — the reasons and steps were said already", () => {
    const non = declineFollowUpReply(declineFacts(paste, { buyer: false, from: "earlier in this chat" }));
    assert.equal(non, [
      "What to fix first:",
      "You have a high number of recent hard inquiries. Cleaning these up will prevent auto-declines and open up better approvals.",
      "Lower your revolving utilization below ~30% for optimal approval odds and limit assignments.",
      "Use the paydown plan in FinanceOS to choose which cards to pay first.",
      "The Capital Blueprint team can run the second look for you.",
      "The bank makes the final call."
    ].join("\n"));
    assert.match(declineFollowUpReply(declineFacts(paste, { buyer: true, recorded: true })), /This decline is already saved with your Fundhub funding team\./);
    assert.match(declineFollowUpReply(declineFacts(paste, { buyer: true }), { willSave: true }), /I saved this decline, and your Fundhub funding team has the second look\./);
    const noFix = { ...declineFacts(paste, { buyer: false }), fix_first: [] };
    assert.match(declineFollowUpReply(noFix), /^I have no fix to name from this letter\. A Fundhub person can read it with you\./);
    for (const yes of ["What should I fix first?", "can you start the second look", "why was I declined", "what do the reasons mean", "what did that letter say"]) assert.ok(DECLINE_TOPIC_RE.test(yes), yes);
    for (const no of ["What is due this week?", "Can you remind me the day before?", "Thanks.", "What's my balance?"]) assert.ok(!DECLINE_TOPIC_RE.test(no), no);
  });

  test("it fits the cap: fix lines go first, then the steps from the end, never the reasons", () => {
    const big = declineFacts(paste, { buyer: false });
    big.steps_in_order = big.steps_in_order.concat(Array.from({ length: 40 }, () => ({ key: "call_recon", who: "ops", status: "open", step: `Call the line and ask once more about the application, in plain words. ${"More words. ".repeat(10)}`, say_to_client: "x" })));
    const r = declineRulesReply(big);
    assert.ok(r.length <= MAX_DECLINE_REPLY_CHARS, r.length);
    assert.match(r, /The bank wrote: "Proportion of balances/);
    assert.match(r, /The Capital Blueprint team can run the second look for you\.\nThe bank makes the final call\.$/);
  });
});

describe("the score card's readers", () => {
  const f = declineFacts(paste, { buyer: true });
  const good = declineRulesReply(f, { willSave: true });

  test("reasons: every reason the analysis found is said, none it did not find", () => {
    const c = reasonsCheck(good, f);
    assert.deepEqual([c.covered.length, c.missing, c.invented], [2, [], []]);
    const half = reasonsCheck('The bank saw too many recent credit checks on your report. It wrote: "Too many inquiries on your credit report".', f);
    assert.deepEqual(half.missing, ["Cards used too much"]);
    assert.deepEqual(reasonsCheck("Your income was too low.", f).invented, ["Income or revenue too low"]);
    assert.deepEqual(reasonsCheck("I could not tell.", f).covered, []);
  });

  test("steps: the ones said come in the order the analysis lists them", () => {
    const o = stepOrder(good, f);
    assert.ok(o.mentioned >= 4, JSON.stringify(o));
    assert.equal(o.inOrder, true);
    const lines = good.split("\n");
    const call = lines.findIndex((l) => /^Next, we get your file/.test(l));
    const push = lines.findIndex((l) => /^Then, we ask our banker contact/.test(l));
    const swapped = lines.slice();
    [swapped[call], swapped[push]] = [swapped[push], swapped[call]];
    assert.equal(stepOrder(swapped.join("\n"), f).inOrder, false);
    assert.deepEqual(stepOrder("Nothing useful here.", f), { mentioned: 0, inOrder: true, hits: [] });
  });
});

describe("what a real model said (Claude Code through the bridge, role-play 2026-10-07, a client who has not bought)", () => {
  /* Both replies are verbatim from the live run. The first passed the helper's own checks and then failed
     the score card's step-order reader (two steps claimed one sentence). The second was blocked for putting
     quotation marks around a fix line the analysis itself holds. Neither was the model's mistake. */
  const f = declineFacts(paste, { buyer: false });
  const turn1 = "These are the likely reasons Chase said no, not sure ones. First, too many recent credit checks, since Chase wrote \"Too many inquiries on your credit report\". Second, high card balances compared to your limits, since Chase wrote \"Proportion of balances to credit limits is too high on revolving accounts\". You can ask for a second look on your own by calling the line in the letter, 1-800-555-0142. Ask if it can go to a manual review, and point to the strong parts of your file that are true for you. If they say no, hang up and call again, at least 4 times, but a second look is only a request and Chase decides. Fix first: clean up your recent hard inquiries, because that can prevent auto-declines. On card use, your cards are at 23.3% overall, already under 30%, but your Personal Visa is at 38.7%, so pay before its statement date, the day the balance reports. If you want, the Capital Blueprint team can run the second look for you.";
  const turn2 = "Fix the credit checks first: \"You have a high number of recent hard inquiries. Cleaning these up will prevent auto-declines and open up better approvals.\" For card use, your cards overall are already at 23.3%, under the ~30% mark, but your Personal Visa alone is at 38.7%. Use the paydown plan in FinanceOS to choose which cards to pay first.";

  test("the answer that said the steps in order is read as in order, with every reason said and none invented", () => {
    const o = stepOrder(turn1, f);
    assert.equal(o.inOrder, true, JSON.stringify(o));
    assert.ok(o.mentioned >= 2, JSON.stringify(o));
    assert.deepEqual(reasonsCheck(turn1, f), { covered: ["Too many recent credit checks", "Cards used too much"], missing: [], invented: [] });
    assert.deepEqual(declineReplyProblems(turn1, { facts: f, text: paste.text }), []);
  });

  test("a line of the analysis in quotation marks is not a made-up quote", () => {
    assert.deepEqual(declineReplyProblems(turn2, { facts: f, text: paste.text }), []);
  });

  test("two steps cannot claim one sentence: 'call again' is the call-again step, not also the relationship-manager step", () => {
    const o = stepOrder(turn1, f);
    const steps = o.hits.map((h) => f.steps_in_order[h.step].key);
    assert.ok(!steps.includes("ask_rm"), steps.join(", "));
    assert.ok(steps.includes("call_again") && steps.includes("ask_manual_review"));
  });
});

describe("a decline earlier in the chat", () => {
  const saved = { kind: "message", input: PASTE, reply: "ok", actions: [{ type: "record_decline", status: "done", bank: "Chase", letter_hash: paste.hash }] };

  test("the latest pasted letter in the last few turns is found again; a task or a plain chat is skipped", () => {
    const thread = [{ kind: "message", input: "hello", reply: "hi", actions: [] }, saved, { kind: "message", input: "thanks", reply: "np", actions: [] }, { kind: "task", input: "Do task: x", actions: [] }];
    const r = lastDeclineInThread(thread);
    assert.equal(r.paste.hash, paste.hash);
    assert.equal(r.recorded, true);
    assert.equal(lastDeclineInThread([{ kind: "message", input: "hello" }]), null);
    assert.equal(lastDeclineInThread([]), null);
    assert.equal(lastDeclineInThread(undefined), null);
  });

  test("a letter is saved once: only an action that did not fail, for this letter, counts", () => {
    assert.equal(declineRecordedIn([saved], paste.hash), true);
    assert.equal(declineRecordedIn([saved], "another-hash"), false);
    assert.equal(declineRecordedIn([{ actions: [{ type: "record_decline", status: "failed", letter_hash: paste.hash }] }], paste.hash), false);
    assert.equal(declineRecordedIn([{ actions: [{ type: "record_decline", status: "skipped", letter_hash: paste.hash }] }], paste.hash), true, "already saved is saved");
    assert.equal(declineRecordedIn([{ actions: [{ type: "record_decline", status: "would_do", letter_hash: paste.hash }] }], paste.hash), true, "a role-play run counts, so a persona does not save twice");
    assert.equal(declineRecordedIn([], paste.hash), false);
  });
});
