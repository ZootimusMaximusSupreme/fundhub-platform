// Practice test (real page, fake /api answers) for four Company Brain controls in batch 10: the
// "N waiting" pending badges, the + document button and file picker, the Open in Drive and Client record
// links under an answer, and the Which quiz picker.
// The expected words and requests are worked out in this file from the fake data, not copied from the
// page. It reads no live data and it never follows the Drive link. Each row is claimed only inside the
// callback that asserts it.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { json, OWNER, proofRows, sharedScreens, waitFor } from "./fin-b10-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";
const DRIVE = "https://drive.google.com/file/d/abc123/view";

const asRole = (role) => ({ ok: true, staff: { id: `staff-${role}`, name: "Casey Reed", email: "casey@fundhub.ai", role, org_id: "org-1", status: "active" } });

const UPLOADS = (n) => ({
  ok: true,
  pendingCount: n,
  uploads: Array.from({ length: Math.max(n, 1) }, (_, i) => ({
    id: `file-${i + 1}`, name: `Pending note ${i + 1}.pdf`, approvalStatus: "pending", sizeBytes: 2048,
    accessTier: "staff", uploadedByName: "Casey Reed", uploadedAt: "2026-10-10T10:00:00Z",
  })),
});

async function openBrain({ session = OWNER, uploads = UPLOADS(2), extra = {} } = {}) {
  const seen = { uploadReads: 0, posts: [], asked: [] };
  const handlers = {
    "/api/company-brain/threads": { ok: true, threads: [] },
    "/api/company-brain/reviews": { ok: true, reviews: [] },
    "/api/company-brain/upload": async (route, { method }) => {
      if (method === "POST") {
        const request = route.request();
        const body = request.postData() || "";
        seen.posts.push({ type: request.headers()["content-type"] || "", body });
        // extra.uploadGate holds the answer, so a test can act while the upload is still in flight.
        if (extra.uploadGate) await extra.uploadGate;
        const answer = typeof extra.uploadAnswer === "function" ? extra.uploadAnswer(body) : (extra.uploadAnswer || { ok: true, file: { name: "plan.pdf", approvalStatus: "pending" } });
        return route.fulfill({ status: answer.status || 200, contentType: "application/json", body: JSON.stringify(answer.body || answer) });
      }
      seen.uploadReads += 1;
      const next = typeof uploads === "function" ? uploads(seen.uploadReads) : uploads;
      return json(route, next);
    },
    "/api/read/company-brain": async (route) => {
      seen.asked.push(JSON.parse(route.request().postData() || "{}"));
      return json(route, extra.answer || {
        ok: true, thread_id: "thread-1", role: "owner",
        answer: { text: "Open with the payment link, then ask for the deposit.", source: "ai", thin: false },
        sources: [],
      });
    },
  };
  const { page, errors } = await screens.open("/app/company-brain.html", { session, handlers });
  await page.waitForFunction(() => document.getElementById("docList") && !document.querySelector("#docList .sk"));
  return { page, errors, seen };
}

test("N waiting badges: both show the pending count, hide at zero, follow a refresh, and clear when the read fails", async () => {
  await proof.check(/^'N waiting' pending badges/, async () => {
    const { page, seen, errors } = await openBrain({ uploads: (n) => UPLOADS(n === 1 ? 3 : n === 2 ? 0 : 5) });
    const top = page.locator("#pendPill");
    const panel = page.locator("#pendPill2");
    assert.equal(await top.getAttribute("hidden"), null, "the badge on the Documents button shows");
    assert.equal(await top.textContent(), "3 waiting");
    assert.equal(await panel.textContent(), "3 waiting");
    assert.equal(await panel.getAttribute("hidden"), null);

    // Open the Documents panel and press Refresh: the count goes to zero and both badges are put away.
    await page.locator("#docsBtn").click();
    assert.equal(await panel.isVisible(), true);
    await page.locator("#refreshDocs").click();
    await waitFor(() => seen.uploadReads === 2, "the second upload read");
    await waitFor(async () => (await top.getAttribute("hidden")) !== null, "the badge hidden at zero");
    assert.notEqual(await panel.getAttribute("hidden"), null);
    assert.equal(await panel.isVisible(), false);

    // And it comes back with the next count.
    await page.locator("#refreshDocs").click();
    await waitFor(async () => (await top.textContent()) === "5 waiting", "the new count");
    assert.equal(await panel.textContent(), "5 waiting");
    assert.deepEqual(errors, []);
    await page.close();

    // A read that fails after a good one clears the badge: it never keeps a count it cannot back.
    const later = await openBrain({ uploads: (n) => (n === 1 ? UPLOADS(3) : { ok: false, error: "forbidden_role" }) });
    assert.equal(await later.page.locator("#pendPill").textContent(), "3 waiting");
    await later.page.locator("#docsBtn").click();
    await later.page.locator("#refreshDocs").click();
    await waitFor(async () => (await later.page.locator("#pendPill").getAttribute("hidden")) !== null, "the badge cleared by the failed read");
    assert.notEqual(await later.page.locator("#pendPill2").getAttribute("hidden"), null);
    assert.match(await later.page.locator("#docList").textContent(), /Your role is not allowed to use Company Brain\./);
    await later.page.close();

    // And a read that fails from the start shows no badge at all.
    const failed = await openBrain({ uploads: { ok: false, error: "forbidden_role" } });
    assert.notEqual(await failed.page.locator("#pendPill").getAttribute("hidden"), null);
    assert.notEqual(await failed.page.locator("#pendPill2").getAttribute("hidden"), null);
    await failed.page.close();
  });
});

test("Add a document + button: opens the file picker for the six kinds, sends the file once, and says what happened", async () => {
  await proof.check(/^Add a document: '\+' button/, async () => {
    const { page, seen, errors } = await openBrain();
    const accept = await page.locator("#fileInput").getAttribute("accept");
    for (const ext of [".pdf", ".txt", ".md", ".docx", ".xlsx", ".pptx"]) assert.ok(accept.split(",").includes(ext), `${ext} is accepted`);
    const pick = async (file) => {
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator("#attachBtn").click()]);
      await chooser.setFiles(file);
    };

    // A file goes up as multipart with a file part carrying its name; no chat is open yet, so no thread part.
    const readsBefore = seen.uploadReads;
    await pick({ name: "plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 fake plan") });
    await waitFor(() => seen.posts.length === 1, "the upload request");
    assert.match(seen.posts[0].type, /^multipart\/form-data; boundary=/);
    assert.match(seen.posts[0].body, /name="file"; filename="plan\.pdf"/);
    assert.doesNotMatch(seen.posts[0].body, /name="thread_id"/);
    await waitFor(async () => /Uploaded plan\.pdf\. An owner has to approve it before it can be used in answers\./.test(await page.locator("#msgs").textContent()), "the pending words");
    // The list is read again and the Documents panel opens on it.
    await waitFor(() => seen.uploadReads === readsBefore + 1, "the files read again");
    assert.match(await page.locator("#chat").getAttribute("class"), /\bdocs-open\b/);
    assert.equal(await page.locator("#attachBtn").isDisabled(), false, "the button is back");

    // After a question the chat has a thread: the next upload carries it.
    await page.locator("#q").fill("How do I close a call?");
    await page.keyboard.press("Enter");
    await waitFor(() => seen.asked.length === 1, "the question");
    await waitFor(async () => /Open with the payment link/.test(await page.locator("#msgs").textContent()), "the answer");
    await pick({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("call notes") });
    await waitFor(() => seen.posts.length === 2, "the second upload");
    assert.match(seen.posts[1].body, /name="file"; filename="notes\.txt"/);
    assert.match(seen.posts[1].body, /name="thread_id"\r?\n\r?\nthread-1/);
    assert.deepEqual(errors, []);
    await page.close();

    // An owner's file lands approved, and the words say so.
    const approved = await openBrain({ extra: { uploadAnswer: { ok: true, file: { name: "sop.docx", approvalStatus: "approved" } } } });
    const [chooser] = await Promise.all([approved.page.waitForEvent("filechooser"), approved.page.locator("#attachBtn").click()]);
    await chooser.setFiles({ name: "sop.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("sop") });
    await waitFor(async () => /Uploaded sop\.docx\. It is approved, so it can be used in answers now\./.test(await approved.page.locator("#msgs").textContent()), "the approved words");
    await approved.page.close();
  });
  await proof.check(/^Add a document: '\+' button/, async () => {
    // The 25 MB cap, a file it cannot read, and an empty file each come back as a plain sentence.
    const cases = [
      [{ status: 413, body: { ok: false, error: "file_too_large" } }, /That file is too big\. Files have to be under 25 MB\./],
      [{ status: 415, body: { ok: false, error: "unsupported_file_type" } }, /Company Brain cannot read that kind of file\. Use a PDF, Word, Excel, PowerPoint, or a plain text file\./],
      [{ status: 400, body: { ok: false, error: "empty_file" } }, /That file has nothing in it\./],
    ];
    for (const [answer, words] of cases) {
      const { page, seen } = await openBrain({ extra: { uploadAnswer: answer } });
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator("#attachBtn").click()]);
      await chooser.setFiles({ name: "big.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") });
      await waitFor(async () => words.test(await page.locator("#msgs").textContent()), `${answer.body.error} words`);
      assert.equal(seen.posts.length, 1);
      assert.equal(await page.locator("#attachBtn").isDisabled(), false);
      await page.close();
    }
  });
  await proof.check(/^Add a document: '\+' button/, async () => {
    // While a file is going up the + button is held three ways: it is disabled, a press that still gets
    // through (the disabled flag lifted by hand) opens no picker, and a second file that arrives through the
    // input is not sent. One file goes up, once, and the button comes back.
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { page, seen, errors } = await openBrain({ extra: { uploadGate: gate } });
    let choosers = 0;
    page.on("filechooser", () => { choosers += 1; });

    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator("#attachBtn").click()]);
    await chooser.setFiles({ name: "first.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 first") });
    await waitFor(() => seen.posts.length === 1, "the first upload request");
    choosers = 0;

    // In flight: the button is off and the Send button says it is busy.
    assert.equal(await page.locator("#attachBtn").isDisabled(), true, "the + button is off while a file is going up");
    assert.equal(await page.locator("#askBtn").isDisabled(), true);
    assert.equal(await page.locator("#askBtn").textContent(), "Sending…");
    assert.match(await page.locator("#msgs").textContent(), /Sending first\.pdf…/);

    // A press that gets through anyway (the flag lifted by hand) is still refused by the click handler.
    await page.evaluate(() => { document.getElementById("attachBtn").disabled = false; });
    await page.locator("#attachBtn").click();
    await page.waitForTimeout(300);
    assert.equal(choosers, 0, "no file picker opens while a file is going up");

    // A second file handed to the input is refused by the upload itself: no second request.
    await page.locator("#fileInput").setInputFiles({ name: "second.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 second") });
    await page.waitForTimeout(300);
    assert.equal(seen.posts.length, 1, "the second file was not sent");
    assert.doesNotMatch(await page.locator("#msgs").textContent(), /Sending second\.pdf/);

    release();
    await waitFor(async () => /Uploaded plan\.pdf\./.test(await page.locator("#msgs").textContent()), "the answer words");
    assert.equal(seen.posts.length, 1, "exactly one file went up");
    assert.equal(await page.locator("#attachBtn").isDisabled(), false, "the button is back");
    assert.equal(await page.locator("#askBtn").textContent(), "Send");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Answer source list: Open in Drive and Client record are real links, and a source without them shows only its name", async () => {
  await proof.check(/^Answer source list/, async () => {
    const answer = {
      ok: true, thread_id: "thread-9", role: "owner",
      answer: { text: "Dana asked for $50,000 and the file says Drive has the SOP.", source: "ai", thin: false },
      sources: [
        { n: 1, fileName: "Funding SOP.pdf", webViewLink: DRIVE, clientId: CLIENT, accessTier: "staff", excerpt: "Step one is the soft pull." },
        { n: 2, fileName: "Uploaded note.txt", webViewLink: null, clientId: null, accessTier: "staff" },
        { n: 3, fileName: "Call recording.mp4", webViewLink: DRIVE, mimeType: "video/mp4" },
      ],
    };
    const { page, errors } = await openBrain({ extra: { answer } });
    await page.locator("#q").fill("What does the file say about Dana?");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".src");
    const sources = await page.$$eval(".src", (els) => els.map((el) => ({
      name: el.querySelector(".sname").textContent,
      links: [...el.querySelectorAll("a.lnk")].map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")]),
      text: el.textContent,
    })));
    assert.equal(sources.length, 3);
    assert.equal(sources[0].name, "[1] Funding SOP.pdf");
    assert.deepEqual(sources[0].links, [
      ["Open in Drive", DRIVE, "_blank", "noopener"],
      ["Client record", `client-control-panel.html?client_id=${CLIENT}`, null, null],
    ]);
    // A source with no link and no client shows its name alone, and never the word "null".
    assert.equal(sources[1].name, "[2] Uploaded note.txt");
    assert.deepEqual(sources[1].links, []);
    assert.doesNotMatch(sources[1].text, /null/);
    // A Drive link on its own, with a recording badge.
    assert.deepEqual(sources[2].links.map((l) => l[0]), ["Open in Drive"]);
    assert.match(sources[2].text, /recording/);
    assert.match(await page.locator(".srchd").innerText(), /Files used · 3/);

    // Open in Drive is a real link that nothing covers (a trial press checks that and does not follow it).
    await page.locator('.src a.lnk:has-text("Open in Drive")').first().click({ trial: true });
    // Client record opens that client's file in this tab.
    await page.locator('.src a.lnk:has-text("Client record")').click();
    await page.waitForURL(new RegExp(`/app/client-control-panel\\.html\\?client_id=${CLIENT}$`));
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// The quizzes, read from the page's own data file, so the expected lists below are worked out by seat.
function quizzes() {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "public/app/ramp-quizzes.js"), "utf8"), sandbox);
  // Copied out of the other realm so the arrays compare as plain arrays.
  return JSON.parse(JSON.stringify(sandbox.FH_RAMP_QUIZZES.map((q) => ({ id: q.id, seat: q.seat, title: q.title, day: q.day,
    questions: q.questions.length, texts: q.questions.map((item) => item.q), mustMissZero: q.mustMissZero }))));
}

test("Which quiz picker: each role gets its own quizzes, and picking one paints that quiz with its own questions and score", async () => {
  await proof.check(/^Class quiz: 'Which quiz' picker/, async () => {
    const all = quizzes();
    assert.equal(all.length, 20);
    // Only the owner and an admin can open this screen (the page's link gate sends every other role to its
    // own home), and both are offered every quiz, in the file's order.
    for (const role of ["owner", "admin"]) {
      const { page, errors } = await openBrain({ session: asRole(role) });
      const options = await page.$$eval("#quizPick option", (els) => els.map((e) => [e.value, e.textContent]));
      assert.deepEqual(options, all.map((q) => [q.id, q.title]), `${role}: the quizzes offered`);
      assert.deepEqual(errors, [], role);
      // The role filter the picker is built on hands a closer only closer quizzes, an inquiry specialist the
      // inquiry and repair ones, and anyone else all of them.
      const filtered = await page.evaluate(() => Object.fromEntries(["closer", "funding_advisor", "inquiry_specialist", "owner"].map((r) => [r, quizzesForRole(r).map((q) => q.id)])));
      assert.deepEqual(filtered.closer, all.filter((q) => q.seat === "closer").map((q) => q.id));
      assert.deepEqual(filtered.funding_advisor, all.filter((q) => q.seat === "funding_advisor").map((q) => q.id));
      assert.deepEqual(filtered.inquiry_specialist, all.filter((q) => q.seat === "inquiry" || q.seat === "repair").map((q) => q.id));
      assert.deepEqual(filtered.owner, all.map((q) => q.id));
      await page.close();
    }

    // Picking another quiz paints its questions, and Check answers scores the ones typed.
    const { page, errors } = await openBrain({ session: asRole("admin") });
    const first = all.find((q) => q.id === "closer-d1");
    // The picker lives in the Documents panel, which is shut until the Documents button is pressed.
    assert.equal(await page.locator("#quizPick").isVisible(), false);
    await page.locator("#docsBtn").click();
    assert.equal(await page.locator("#quizPick").isVisible(), true);
    assert.equal(await page.locator("#quizPick").inputValue(), "closer-d1", "the first quiz is on at first");
    assert.equal(await page.locator("#quizBox .qitem").count(), first.questions);
    // The box holds THAT quiz's own questions (Day 1 and Day 2 have the same count, so words are compared).
    const labels = (quiz) => quiz.texts.map((q, i) => `${i + 1}. ${q}`);
    const painted = () => page.$$eval("#quizBox .qitem label", (els) => els.map((e) => e.textContent));
    assert.deepEqual(await painted(), labels(first), "the first quiz is painted on load, not another one");
    // Every quiz in the picker paints its own questions and carries its own pick.
    for (const quiz of all) {
      await page.locator("#quizPick").selectOption(quiz.id);
      assert.equal(await page.locator("#quizPick").inputValue(), quiz.id);
      assert.deepEqual(await painted(), labels(quiz), `${quiz.id}: its own questions`);
    }
    await page.locator("#quizPick").selectOption("closer-d5");
    const day5 = all.find((q) => q.id === "closer-d5");
    assert.equal(await page.locator("#quizBox .qitem").count(), day5.questions, "the Day 5 quiz is drawn");
    assert.match(await page.locator("#quizBox .qitem label").first().textContent(), /^1\. What is funding here\?$/);
    // Nothing typed: every question says to write an answer, and the Day 5 rule fails the quiz.
    await page.locator("#quizForm button[type=submit]").click();
    assert.deepEqual(await page.$$eval("#quizBox .qmark", (els) => els.map((e) => e.textContent)), Array(day5.questions).fill("Write an answer."));
    assert.equal(await page.locator("#quizResult").textContent(), `Fail. Day 5 must miss zero. You got 0 of ${day5.questions} right.`);
    // All five answered well: the Day 5 rule passes.
    const good = [
      "We are not the bank. We help you apply and the lenders decide.",
      "The $32 is the soft pull, a look at your file.",
      "700 for funding, 500 for the course, and the cash downsell.",
      "The start counts toward the 10%.",
      "Never promise a score, that you are approved, or a dollar amount.",
    ];
    assert.equal(good.length, day5.questions);
    for (const [i, answer] of good.entries()) await page.locator(`#qa-${i}`).fill(answer);
    await page.locator("#quizForm button[type=submit]").click();
    assert.deepEqual(await page.$$eval("#quizBox .qmark", (els) => els.map((e) => e.textContent)), Array(day5.questions).fill("Right"));
    assert.equal(await page.locator("#quizResult").textContent(), `Pass. You got every question right (${day5.questions} of ${day5.questions}).`);

    // Day 5 must miss zero: ONE question short is a fail, however many are right.
    for (const wrong of [1, 2, 4]) {
      for (const [i, answer] of good.entries()) await page.locator(`#qa-${i}`).fill(i < good.length - wrong ? answer : "something else entirely");
      await page.locator("#quizForm button[type=submit]").click();
      const right = good.length - wrong;
      assert.deepEqual(await page.$$eval("#quizBox .qmark", (els) => els.map((e) => e.textContent)),
        good.map((_, i) => (i < right ? "Right" : "Wrong")), `${wrong} wrong: marks`);
      assert.equal(await page.locator("#quizResult").textContent(), `Fail. Day 5 must miss zero. You got ${right} of ${day5.questions} right.`, `${wrong} wrong`);
    }

    // Back on Day 1, typed answers are marked right and wrong one by one.
    await page.locator("#quizPick").selectOption("closer-d1");
    assert.equal(await page.locator("#quizBox .qitem").count(), first.questions);
    await page.locator("#qa-0").fill("no");
    await page.locator("#qa-1").fill("yes");
    await page.locator("#qa-2").fill("the soft pull of their credit file");
    await page.locator("#quizForm button[type=submit]").click();
    assert.deepEqual(await page.$$eval("#quizBox .qmark", (els) => els.map((e) => e.textContent)), ["Right", "Wrong", "Right", "Write an answer."]);
    assert.equal(await page.locator("#quizResult").textContent(), "You got 2 of 4 right.");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
