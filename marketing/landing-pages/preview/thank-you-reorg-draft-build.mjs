/* /thank-you (Direct Book funnel) — reorganized DRAFT with the bad lines marked.
 *
 * Chris, 2026-10-23: "Make sure the thank you page is reorganized. So it's cleaner.
 * And on brand ... because I think the text isn't on brand but maybe it is. But then
 * really it's the download the app should be beneath."
 *
 * Law: .claude/rules/page-edits-marked-draft.md. Built like ../slo/preview/reorg-draft-build.mjs:
 * one script makes the red draft, the green draft and the clean live source.
 *
 * The live page is partly built at run time by footer scripts (thankyou-sort.js,
 * funding-paths.js, fundhub-prompter-download.js), so the draft starts from the live
 * page's FINAL page, read in a real browser. That read is frozen in
 * thank-you-reorg-live-snapshot.json so round 1 stays the same after the page changes
 * (--resnap reads the live page again). Nothing here touches the live page.
 *
 *   Round 1 (red)   the frozen live page in the NEW order: blue dashed boxes around
 *                   the blocks that move, a red box and a number on every bad line,
 *                   the problem and the fix under each. Old words, word for word.
 *   Round 2 (green) the clean source (below) run in a real browser with the live
 *                   page's own scripts swapped for the clean ones, then every fix
 *                   marked green with the same number as round 1. It fails if the
 *                   clean source does not put the blocks in the new order.
 *   --live          writes the clean source, every mark gone:
 *                     ../05-thank-you.html (old copy frozen as 05-thank-you.before-reorg.html)
 *                     public/funnel/thankyou-sort.js, funding-paths.js, fundhub-prompter-download.js
 *                   Push the page afterwards with
 *                     node scripts/cf-push-custom-html.mjs push --only=apply-thank-you
 *                   and ship the three scripts with main. Only when Chris says push it.
 *
 * The share copies are one self-contained file each: no live script runs, every
 * picture is shrunk and baked in (a shared page can load nothing from fundhub.ai or
 * ClickFunnels). The video spot shows the finished video's first frame; the video
 * itself goes in by its own job (VIDEO_SRC in thankyou-sort.js is not touched here).
 *
 * Run:  node marketing/landing-pages/preview/thank-you-reorg-draft-build.mjs
 *         [--out=<dir>]      where the share copies, marks.md and shots go (default: this folder)
 *         [--poster=<jpg>]   first frame of the video, when https://fundhub.ai/funnel/thank-you-video-poster.jpg is not live yet
 *         [--shots]          desktop (1280) and phone (390) screenshots, marks on and off
 *         [--resnap]         read the live page again
 *         [--live]           write the clean source files (see above)
 * Out:  thank-you-reorg-r1.html   round 1, red
 *       thank-you-reorg-r2.html   round 2, green
 *       thank-you-reorg-marks.md  every mark and move in plain words
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const LIVE_URL = "https://apply.fundhub.ai/thank-you";
const FUNNEL = "https://fundhub.ai/funnel/";
const FRAG_FILE = join(ROOT, "marketing/landing-pages/05-thank-you.html");
const FROZEN_FRAG = join(HERE, "05-thank-you.before-reorg.html");
const SNAP_FILE = join(HERE, "thank-you-reorg-live-snapshot.json");
const JS_FILES = {
  sort: join(ROOT, "public/funnel/thankyou-sort.js"),
  paths: join(ROOT, "public/funnel/funding-paths.js"),
  app: join(ROOT, "public/funnel/fundhub-prompter-download.js"),
};
const JS_URL = {
  sort: FUNNEL + "thankyou-sort.js",
  paths: FUNNEL + "funding-paths.js",
  app: FUNNEL + "fundhub-prompter-download.js",
};
const POSTER_URL = FUNNEL + "thank-you-video-poster.jpg";
/* Lead sends, pixels, Clarity and Direct ROAS are blocked so these reads count as nothing. */
const BLOCKED = /fundhub\.ai\/api\/|facebook\.(com|net)|clarity\.ms|fundhub\.ai\/js\/clarity|googletagmanager|google-analytics|directroas|sdk\.myclickfunnels/;

const arg = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : null;
};
const flag = (k) => process.argv.includes(`--${k}`);
const OUT = resolve(arg("out") || HERE);
mkdirSync(OUT, { recursive: true });

/* ======================= the new words (one place) =======================
   Every fact comes from the page, the repo or Chris:
   · "the time your advisor is holding for you is locked in", "the pricing for your
     path", "how much you're qualified for based on where you're at right now",
     "join from your computer ... your advisor ... goes through your file with you",
     "use the reschedule link on this page": Chris, in the thank-you video
     (marketing/landing-pages video job, 2026-10-23)
   · "how much you qualify for based on where you're at right now": .claude/rules/copy-certainty.md
   · Google Meet link in the confirmation email: this page's own calendar link text
   · the Experian business report: funding-paths.js (the paths section's own line)
   · login made on the call: api/soft-pull-approve.mjs opens the portal account when
     the client approves the soft pull, and mails the sign-in link then
   · credit optimization, never credit repair: CLAUDE.md owner terms
   · Fundhub is not a lender: this page's FAQ and footer */
const NEW = {
  lede: "Your advisor is holding this time for you.",
  calLead: "Accept the calendar invite in your email so your time is locked in.",
  calWhen: "Your date, time and Google Meet link are in that email.",
  step2d: "Tri-bureau plus an Experian business report. It does not touch your score.",
  step3t: "You get one of three paths",
  step3d: "You leave knowing how much you qualify for based on where you're at right now, and the path to get it.",
  prep1: "Join from your computer, somewhere quiet, so you can see your file on screen with your advisor.",
  resched: "Reschedule your call",
  appEyebrow: "Get the app",
  appCopy: "See where your Fundhub file stands and open your portal for the next step.",
  appNote: "Download it now. Your login is made on your call, when your advisor runs your soft pull.",
  pathsKicker: "Your three paths",
  pathsSub: "What your file shows on the call puts you on one of these three paths. Nobody gets turned away.",
  path2: "We show you exactly what's holding your file back and optimize your credit for you.",
  faqDifferent:
    "UnderwriteIQ reviews your file the way a lender does, matches it against thousands of lenders, and finds the 30 to 50 that fit. We apply in rounds and clear the new inquiries between rounds, so you go after real money without wrecking your score. A funding advisor, a credit specialist and an ops specialist work your file together.",
  faqBusiness: "No. Individuals qualify too.",
  faqCredit:
    "Still take the call. If your file isn't fundable yet, we tell you straight and you leave with the exact fix. We optimize your credit too, so there's a path either way.",
  faqCost: "Your advisor walks you through the pricing for your path on the call.",
  faqDiy: "the same playbook for funding and credit optimization to run on your own",
};

/* ======================= the marks =======================
   sel/has: the line on the live page (round 1). host: the block the note sits under.
   r2: where the fix sits on the clean page (round 2), or cut / open. */
const MARKS = [
  { id: "lede", where: "Line under the headline", sel: ".fh-root .hero .lede",
    problem: "“We'll see you then” says the same thing as the last line on the page (“We'll see you soon.”). “Here's what to expect” is filler.",
    fix: `“${NEW.lede}” Chris says this in the video.`,
    r2: { sel: ".fh-root .hero .lede" } },
  { id: "prose", where: "The two lines under the video", sel: ".fh-root .prose",
    problem: "“You took the first real step toward getting funded.” is a feel-good line. It gives them nothing to do. The next line says to check their email, and the calendar block right below says it again.",
    fix: `Fold both lines into one “Confirm your call” block that leads with the one thing to do: “${NEW.calLead}” (Chris's words in the video.)`,
    r2: { sel: "#fh-cal-cta .cal-lead" } },
  { id: "calwhen", where: "Confirm your call, gray line", sel: "#fh-cal-when",
    problem: "Says “it is in your email” again, right after the line above it.",
    fix: `“${NEW.calWhen}” The page already says the Meet link is in that email.`,
    r2: { sel: "#fh-cal-when" } },
  { id: "decides", where: "What the call decides", sel: "#fh-ty-decides",
    problem: "Repeats. The three roads are said again in step 03 right below, and again in the three paths section. “We read your file the way a bank does” is in the FAQ too.",
    fix: "Cut this block. Its last line, “Nobody gets turned away.”, moves word for word into the three paths section.",
    r2: { cut: "#fh-cal-cta", text: "Cut here: “What the call decides.” It said the same thing as the call steps and the three paths." } },
  { id: "step2", where: "What happens on the call, step 02", sel: "#fh-expect .step", has: "We run your soft pull on the call",
    problem: "The soft pull is explained here, then again in the three paths section (“Your advisor runs a tri-bureau soft pull plus an Experian business report with you”).",
    fix: `Say it once, here: “${NEW.step2d}”`,
    r2: { sel: "#fh-expect .step .d", has: NEW.step2d } },
  { id: "step3", where: "What happens on the call, step 03", sel: "#fh-expect .step", has: "You get one of three roads",
    problem: "Says “roads.” Everything below says “paths” (Path 1, Path 2, Path 3). Two words for one thing.",
    fix: `Title: “${NEW.step3t}.” Line: “${NEW.step3d}”`,
    r2: { sel: "#fh-expect .step", has: NEW.step3t } },
  { id: "prep1", where: "Before we talk, line 1", sel: "#fh-prep li", has: "share your screen", host: "#fh-prep",
    problem: "Says they share their screen. In the video Chris says to join from a computer, because the advisor goes through the file on screen with them.",
    fix: `“${NEW.prep1}”`,
    r2: { sel: "#fh-prep li", has: NEW.prep1 } },
  { id: "prep3", where: "Before we talk, line 3", sel: "#fh-prep li", has: "Reschedule at", host: "#fh-prep",
    problem: "The link is a raw web address. On a phone it breaks over two lines and looks like code. The video tells people to use “the reschedule link on this page,” so it has to be easy to see.",
    fix: `“Need to move it? ${NEW.resched}.” The words “${NEW.resched}” are the link, to the same address.`,
    r2: { sel: "#fh-prep li a", has: NEW.resched } },
  { id: "applook", where: "Fundhub Portal app card", sel: "#fh-prompter-download", host: "#fh-prompter-download",
    problem: "A black card built for the top of the page. It is the loudest thing on screen and pulls eyes away from the blue calendar button, the button that matters most.",
    fix: `A white card like “Before we talk”: app icon on the left, an outline button, small label “${NEW.appEyebrow}” (the same words as step 1 of the paths strip). The blue calendar button stays the only main button. The Apple link and the tap tracking stay the same.`,
    r2: { sel: ["#fh-prompter-download", ".fh-prompter-download__eyebrow"] } },
  { id: "appcopy", where: "App card, middle line", sel: ".fh-prompter-download__copy", host: "#fh-prompter-download",
    problem: "“Keep your Fundhub file close” is a figure of speech, not a fact.",
    fix: `“${NEW.appCopy}”`,
    r2: { sel: ".fh-prompter-download__copy" } },
  { id: "appnote", where: "App card, small line", sel: ".fh-prompter-download__note", host: "#fh-prompter-download",
    problem: "“Sign in with your Fundhub account.” Someone who just booked has no login yet. It is made on the call, when the advisor runs the soft pull. “Opens the official Apple App Store listing” says what the button already says.",
    fix: `“${NEW.appNote}”`,
    r2: { sel: ".fh-prompter-download__note" } },
  { id: "kicker", where: "Three paths, small label", sel: ".fhp .fhp-kicker", host: ".fhp .fhp-sub",
    problem: "“What happens on your call” is almost the same label as “What happens on the call” two blocks up.",
    fix: `“${NEW.pathsKicker}”`,
    r2: { sel: ".fhp .fhp-kicker" } },
  { id: "sub", where: "Three paths, line under the headline", sel: ".fhp .fhp-sub", host: ".fhp .fhp-sub",
    problem: "Explains the soft pull a second time (see step 02).",
    fix: `“${NEW.pathsSub}”`,
    r2: { sel: ".fhp .fhp-sub" } },
  { id: "samples", where: "Sample files A to E and the three path cards", sel: ".fhp .fhp-ai", host: ".fhp .fhp-ai",
    problem: "The samples do not agree with the cards. The rule is one sample file, one story. Sample file B is score 618, 11 inquiries, 2 outdated addresses, 64% used. The Path 2 card it points to shows 612, 9 inquiries, 3 outdated items, 2 negative items, 68% used. File D points to the same card. Files A, C and E all show the same $318,000 funding sequence, and E has no business.",
    fix: "Each card shows the file named on it, as UnderwriteIQ prints it for that file. Not written into the clean version: it needs a real UnderwriteIQ run of each sample file first.",
    r2: { open: ".fhp .fhp-ai", text: "Not fixed in this draft. It needs a real UnderwriteIQ run of each sample file first." } },
  { id: "path2", where: "Path 2 card, top text", sel: "#fhp-p2 header p", host: ".fhp .fhp-grid",
    problem: "“and fund you once your file is ready” sounds like Fundhub is the lender. The FAQ and the footer say Fundhub is not a lender. The card's last line already says “Once your file is ready, you move to funding.”",
    fix: `“${NEW.path2}”`,
    r2: { sel: "#fhp-p2 header p" } },
  { id: "faqdiff", where: "FAQ: What makes Fundhub different?", sel: ".fh-root .faq details .a", has: "Conveyor Belt", host: "details",
    problem: "Made-up names a buyer has never heard (“the Conveyor Belt,” “a Pod”), a one-word start (“The engine.”), another company's name (Credit Karma), and the longest answer on the page.",
    fix: `“${NEW.faqDifferent}”`,
    r2: { sel: ".fh-root .faq details .a", has: NEW.faqDifferent.slice(0, 40) } },
  { id: "faqbiz", where: "FAQ: Do I need a business to qualify?", sel: ".fh-root .faq details .a", has: "We fund individuals too", host: "details",
    problem: "“We fund individuals too.” Fundhub is not a lender. The first answer on this list says so.",
    fix: `Start with “${NEW.faqBusiness}” The rest stays.`,
    r2: { sel: ".fh-root .faq details .a", has: NEW.faqBusiness, text: NEW.faqBusiness } },
  { id: "faqcredit", where: "FAQ: What if my credit isn't great?", sel: ".fh-root .faq details .a", has: "We handle repair too", host: "details",
    problem: "“We handle repair too.” Fundhub says credit optimization, never credit repair. “If the numbers aren't fundable” is vague.",
    fix: `“${NEW.faqCredit}”`,
    r2: { sel: ".fh-root .faq details .a", has: NEW.faqCredit.slice(0, 40) } },
  { id: "faqcost", where: "FAQ: What does this cost?", sel: ".fh-root .faq details .a", has: "Exact numbers get walked through", host: "details",
    problem: "“Exact numbers get walked through live on your call.” Vague, and it hides who does it.",
    fix: `End with “${NEW.faqCost}” Chris's words in the video. The rest stays.`,
    r2: { sel: ".fh-root .faq details .a", has: NEW.faqCost, text: NEW.faqCost } },
  { id: "faqdiy", where: "FAQ: Do I have to go done-for-you?", sel: ".fh-root .faq details .a", has: "credit repair to run on your own", host: "details",
    problem: "Says “credit repair.” Fundhub says credit optimization.",
    fix: `“…${NEW.faqDiy}.” The rest stays.`,
    r2: { sel: ".fh-root .faq details .a", has: NEW.faqDiy, text: NEW.faqDiy } },
];

/* The new order. moved: a blue dashed box, with what moved and why. */
const VIDEO_TAG = "Video · stays right under the headline · first frame shown here; the video goes in by its own job";
const ORDER_R1 = [
  ["hero", "1 · Headline"],
  ["video", `2 · ${VIDEO_TAG}`],
  ["prose", "3a · Two lines under the video"],
  ["cal", "3b · Confirm your call"],
  ["decides", "Cut · What the call decides", "cut"],
  ["expect", "4 · What happens on the call"],
  ["prep", "5 · Before we talk · MOVED UP from under the three paths, so the call steps and the prep list sit together", "moved"],
  ["app", "6 · Fundhub Portal app · MOVED DOWN from the top of the page, where it sat above the video. The call comes first now", "moved"],
  ["paths", "7 · Your three paths · MOVED DOWN two blocks, so it follows the app card (its step 1 is “Get the app”)", "moved"],
  ["proof", "8 · Client approvals"],
  ["faq", "9 · Common questions"],
  ["signoff", "10 · Sign-off"],
];
const ORDER_R2 = [
  ["hero", "1 · Headline"],
  ["video", `2 · ${VIDEO_TAG}`],
  ["cal", "3 · Confirm your call · now one block"],
  ["expect", "4 · What happens on the call"],
  ["prep", ORDER_R1[6][1], "moved"],
  ["app", ORDER_R1[7][1], "moved"],
  ["paths", ORDER_R1[8][1], "moved"],
  ["proof", "8 · Client approvals"],
  ["faq", "9 · Common questions"],
  ["signoff", "10 · Sign-off"],
];

/* ======================= clean source =======================
   swap(): exact strings, each must be found (the base is the frozen original page).
   patch(): for the three scripts, which stay where they are. Safe to run again after
   --live: a patch whose new text is already there is skipped. */
function swap(label, src, edits) {
  let out = src;
  for (const [from, to] of edits) {
    if (!out.includes(from)) throw new Error(`${label}: not found: ${from.slice(0, 100)}`);
    out = out.split(from).join(to);
  }
  return out;
}
function patch(label, src, edits) {
  let out = src;
  for (const [from, to] of edits) {
    if (to && out.includes(to)) continue;
    if (out.includes(from)) { out = out.split(from).join(to); continue; }
    if (!to) continue;
    throw new Error(`${label}: patch did not match: ${from.slice(0, 100)}`);
  }
  return out;
}
function between(label, src, start, end, block) {
  if (src.includes(block)) return src;
  const a = src.indexOf(start), b = src.indexOf(end, a + 1);
  if (a < 0 || b < 0) throw new Error(`${label}: markers not found`);
  return src.slice(0, a) + block + src.slice(b);
}
const J = JSON.stringify;
/* a single-quoted JS string, the way funding-paths.js writes its own */
const SQ = (t) => `'${t.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
/* plain words only: these sit inside a single-quoted HTML string in fundhub-prompter-download.js */
for (const k of ["appEyebrow", "appCopy", "appNote"]) {
  if (/['<>&"\\]/.test(NEW[k])) throw new Error(`NEW.${k} must be plain words`);
}

function cleanFragment() {
  const base = readFileSync(existsSync(FROZEN_FRAG) ? FROZEN_FRAG : FRAG_FILE, "utf8");
  const calOld = base.match(/<section class="cal-cta"[\s\S]*?<\/section>/);
  if (!calOld) throw new Error("fragment: calendar block not found");
  const calNew = swap("calendar block", calOld[0], [[
    `<span class="kicker">Your calendar</span><p class="cal-when" id="fh-cal-when">Your date and time are in your confirmation email.</p>`,
    `<span class="kicker">Confirm your call</span><p class="cal-lead">${NEW.calLead}</p><p class="cal-when" id="fh-cal-when">${NEW.calWhen}</p>`,
  ]]);
  const RESCHED = "https://apply.fundhub.ai/funding-book-call";
  return swap("fragment", base, [
    // Confirm your call moves up under the headline (the video goes between them at run time)
    // and takes the two lines that sat under the video.
    [calOld[0], ""],
    [`<h1 class="sec" id="fh-hero-sec">We've Got Your Application.</h1>`, `<h1 class="sec" id="fh-hero-sec">Your Call Is Booked.</h1>`],
    [`<span class="eyebrow" id="fh-eyebrow">Received · Funding Path</span>`, `<span class="eyebrow" id="fh-eyebrow">Confirmed · Funding Path</span>`],
    [`<p class="lede" id="fh-hero-lede">Here's what happens next.</p></section><div class="prose"><p class="lead">You took the first real step toward getting funded.</p><p id="fh-prose-mail">Check your email — we'll be in touch with your next step.</p></div>`,
     `<p class="lede" id="fh-hero-lede">${NEW.lede}</p></section>${calNew}`],
    [`<div class="d">Tri-bureau, and it does not touch your score.</div>`, `<div class="d">${NEW.step2d}</div>`],
    [`<div class="t">You get one of three roads</div><div class="d">You leave knowing exactly what you qualify for and the path to get it.</div>`,
     `<div class="t">${NEW.step3t}</div><div class="d">${NEW.step3d}</div>`],
    [`<li>Take the call somewhere quiet where you can share your screen.</li>`, `<li>${NEW.prep1}</li>`],
    [`<li>Need to move it? Reschedule at <a href="${RESCHED}">${RESCHED}</a>.</li>`, `<li>Need to move it? <a href="${RESCHED}">${NEW.resched}</a>.</li>`],
    // The app card fills this slot (fundhub-prompter-download.js); the three paths follow it (funding-paths.js).
    [`</ul></section><section class="faq">`, `</ul></section><div id="fh-ty-app-slot"></div><section class="faq">`],
    [`<div class="a">The engine. UnderwriteIQ reads your credit the way a bank underwriter actually reads it, not the way Credit Karma shows it to you, then matches your file against thousands of lenders and finds the 30 to 50 that actually fit. We call that the Conveyor Belt. From there we submit in rounds, keeping your credit clean between each one, so we can go after real money without wrecking your score on the way. Your file runs with a Pod: a funding advisor, a credit specialist, and an ops specialist, not one account manager juggling fifty files.</div>`,
     `<div class="a">${NEW.faqDifferent}</div>`],
    [`<div class="a">No. We fund individuals too.`, `<div class="a">${NEW.faqBusiness}`],
    [`Still take the call. If the numbers aren't fundable yet, we tell you straight and you leave with the exact fix. We handle repair too, so there's a route either way.`, NEW.faqCredit],
    [`Exact numbers get walked through live on your call.`, NEW.faqCost],
    [`the same playbook for funding and credit repair to run on your own`, NEW.faqDiy],
    [`.fh-root .cal-cta .cal-btn-secondary:hover{background:var(--soft)}`,
     `.fh-root .cal-cta .cal-btn-secondary:hover{background:var(--soft)}
.fh-root .cal-cta .cal-lead{max-width:34ch;margin:0 auto 8px;font-size:19px;font-weight:600;letter-spacing:-.02em;line-height:1.35;color:var(--ink);text-wrap:balance}
.fh-root .prep li a{color:var(--ink2);font-weight:600;text-decoration:underline;text-underline-offset:3px}`],
    [`<!-- Sorting Hat: booking check, "What the call decides", step 03 wording, real approvals + texts. Served from public/funnel/thankyou-sort.js. -->`,
     `<!-- Sorting Hat: booking check, video, confirm-your-call, step 03 wording, real approvals. Served from public/funnel/thankyou-sort.js. Order (2026-10-23): headline, video, confirm your call, call steps, before we talk, app card (#fh-ty-app-slot), three paths, approvals, FAQ. -->`],
  ]);
}

function cleanSort(src) {
  return patch("thankyou-sort.js", src, [
    [` *   2. "What the call decides" after the hero: one call, three roads.
 *   3. Step 03 reads "You get one of three roads".
 *   4. "Real approvals, real screenshots" before the FAQ: three approvals. No`,
     ` *   2. Step 03 reads "You get one of three paths".
 *   3. "Real approvals, real screenshots" before the FAQ: three approvals. No`],
    [` * The FAQ, the calendar, the prep list, the $32 wording and the speed wording are
 * not touched. No links off the page.`,
     ` * The FAQ, the calendar, the prep list, the $32 wording and the speed wording are
 * not touched. No links off the page.
 * Owner reorder 2026-10-23 (marketing/landing-pages/preview/thank-you-reorg-draft-build.mjs):
 * "What the call decides" is cut, because it repeated step 03 and the three paths.`],
    [`    "#fh-ty-decides{max-width:660px;margin:36px auto 0;text-align:center}",
    "#fh-ty-decides p{max-width:52ch;margin:12px auto 0;font-size:16.5px;line-height:1.62;color:#52525B}",
`, ""],
    [`setText(hero.querySelector(".lede"), "We'll see you then. Here's what to expect.");`, `setText(hero.querySelector(".lede"), ${J(NEW.lede)});`],
    [`    var anchor = prose || hero;
    if (cal && prose) { after(prose, cal); anchor = cal; }

    /* 2. What the call decides. */
    var decides = el(
      '<section id="fh-ty-decides">' +
        '<span class="kicker">What the call decides</span>' +
        "<p>We read your file the way a bank does. Then you get one of three roads: get funded now, fix the file first, or learn to do it yourself. Nobody gets turned away.</p>" +
      "</section>"
    );
    after(anchor, decides);

    /* 3. Step 03. */`,
     `    /* An older copy of the page body still has .prose: the confirm block goes under it there.
       The current body already has the confirm block right under the headline. */
    if (cal && prose) after(prose, cal);

    /* 2. Step 03. */`],
    [`if (/exact funding number/i.test(titles[i].textContent)) titles[i].textContent = "You get one of three roads";`,
     `if (/exact funding number|three roads/i.test(titles[i].textContent)) titles[i].textContent = ${J(NEW.step3t)};`],
    [`    /* 4. Real approvals — before the FAQ. */`, `    /* 3. Real approvals — before the FAQ. */`],
    [`    else after(decides, proof);`, `    else after(prep || expect || hero, proof);`],
  ]);
}

function cleanPaths(src) {
  return patch("funding-paths.js", src, [
    [` *   /thank-you  -> inserted right after the approvals section (#fh-proof, or .expect if proof is hidden),`,
     ` *   /thank-you  -> inserted right after the app card slot (#fh-ty-app-slot, owner reorder 2026-10-23),
 *                  or after .expect on a page without the slot,`],
    [`    if (onThankYou) {
      var proof = document.getElementById('fh-proof');`,
     `    if (onThankYou) {
      /* Under the app card, which fills #fh-ty-app-slot after "Before we talk". */
      var slot = document.getElementById('fh-ty-app-slot');
      if (slot) return slot;
      var proof = document.getElementById('fh-proof');`],
    [`      sec.querySelector('.fhp-kicker').textContent = 'What happens on your call';
      sec.querySelector('.fhp-sub').textContent = 'Your advisor runs a tri-bureau soft pull plus an Experian business report with you. What your file shows puts you on one of these three paths.';`,
     `      sec.querySelector('.fhp-kicker').textContent = ${SQ(NEW.pathsKicker)};
      sec.querySelector('.fhp-sub').textContent = ${SQ(NEW.pathsSub)};
      /* Fundhub is not the lender (this page's FAQ and footer). */
      sec.querySelector('#fhp-p2 header p').textContent = ${SQ(NEW.path2)};`],
  ]);
}

const APP_CSS = [
  ".fh-root .fh-prompter-download{box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1fr);gap:16px;width:100%;max-width:660px;margin:30px auto 0;padding:20px 22px;border:1px solid #E4E4E7;border-radius:12px;background:#FFFFFF;color:#0A0A0A;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:left;box-shadow:0 1px 3px rgba(10,10,10,.05)}",
  ".fh-root .fh-prompter-download *{box-sizing:border-box}",
  ".fh-root .fh-prompter-download__top{display:flex;align-items:flex-start;gap:14px;min-width:0}",
  ".fh-root .fh-prompter-download__icon{display:block;width:52px;height:52px;flex:0 0 52px;border-radius:12px;background:#0A0A0A}",
  ".fh-root .fh-prompter-download__eyebrow{margin:0 0 4px;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,monospace;font-size:10.5px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:#8A8A93}",
  ".fh-root .fh-prompter-download__title{margin:0;font-size:19px;font-weight:700;line-height:1.2;letter-spacing:-.02em;color:#0A0A0A}",
  ".fh-root .fh-prompter-download__copy{margin:6px 0 0;font-size:15px;line-height:1.6;color:#52525B}",
  /* An outline button: the blue calendar button stays the page's one main button. */
  ".fh-root .fh-prompter-download__button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:48px;padding:0 20px;border:1px solid #0A0A0A;border-radius:9px;background:#FFFFFF;color:#0A0A0A;font-size:15px;font-weight:600;line-height:1;text-decoration:none;white-space:nowrap;transition:background .15s}",
  ".fh-root .fh-prompter-download__button:hover{background:#F4F4F5}",
  ".fh-root .fh-prompter-download__button:focus-visible{outline:2px solid #0A0A0A;outline-offset:3px}",
  ".fh-root .fh-prompter-download__note{margin:0;padding-top:14px;border-top:1px solid #E4E4E7;font-size:13px;line-height:1.5;color:#71717A}",
  "@media(min-width:640px){.fh-root .fh-prompter-download{grid-template-columns:minmax(0,1fr) auto;column-gap:24px;align-items:center}.fh-root .fh-prompter-download__note{grid-column:1 / -1}}",
  "@media(max-width:639.98px){.fh-root .fh-prompter-download{padding:20px 18px}.fh-root .fh-prompter-download__button{width:100%}}",
].join("");

const APP_BLOCK = `  function addStyles() {
    if (document.getElementById("fh-prompter-download-css")) return;
    var style = document.createElement("style");
    style.id = "fh-prompter-download-css";
    /* .fh-root rules on the page (margin/padding 0, links inherit color) load after this; the .fh-root prefix outranks them.
       Owner reorder 2026-10-23: a white card like "Before we talk", with an outline button, so the blue
       calendar button stays the page's one main button. */
    style.textContent = ${J(APP_CSS)};
    (document.head || document.documentElement).appendChild(style);
  }

  function card(url) {
    if (document.getElementById("fh-prompter-download")) return;
    var root = document.querySelector(".fh-root");
    if (!root) return;
    /* Owner, 2026-10-23: "the download the app should be beneath". The card fills #fh-ty-app-slot,
       under "Before we talk". A page body without the slot keeps the old spot under the headline. */
    var slot = document.getElementById("fh-ty-app-slot");
    var hero = root.querySelector(".hero");
    if (!slot && (!hero || !hero.parentNode)) return;
    addStyles();
    var section = document.createElement("section");
    section.id = "fh-prompter-download";
    section.className = "fh-prompter-download";
    section.setAttribute("aria-label", "Fundhub Portal for iPhone");
    section.innerHTML =
      '<div class="fh-prompter-download__top">' +
      '<img class="fh-prompter-download__icon" src="https://fundhub.ai/apple-touch-icon.png" alt="Fundhub" width="52" height="52">' +
      '<div><p class="fh-prompter-download__eyebrow">${NEW.appEyebrow}</p><h2 class="fh-prompter-download__title">Fundhub Portal</h2>' +
      '<p class="fh-prompter-download__copy">${NEW.appCopy}</p></div>' +
      '</div>' +
      '<a class="fh-prompter-download__button" href="' + url + '" target="_blank" rel="noopener noreferrer">Get it on the App Store <span aria-hidden="true">→</span></a>' +
      /* No login yet: api/soft-pull-approve.mjs opens the portal account on the call. */
      '<p class="fh-prompter-download__note">${NEW.appNote}</p>';
    if (slot) slot.appendChild(section);
    else hero.parentNode.insertBefore(section, hero.nextSibling);
  }

`;
function cleanApp(src) {
  return between("fundhub-prompter-download.js", src, "  function addStyles() {", "  function run() {", APP_BLOCK);
}

function cleanSources() {
  const read = (k) => readFileSync(JS_FILES[k], "utf8");
  return {
    frag: cleanFragment(),
    sort: cleanSort(read("sort")),
    paths: cleanPaths(read("paths")),
    app: cleanApp(read("app")),
  };
}

/* ======================= browser reads ======================= */
async function readPage(browser, { clean } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  await ctx.route(BLOCKED, (r) => r.abort());
  if (clean) {
    const doc = `<!doctype html>
<html lang="en"><head><title>Thank You</title><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>
${clean.frag}
<script src="${FUNNEL}fh-events.js"></script>
<script src="${JS_URL.app}"></script>
</body></html>`;
    await ctx.route(/^https:\/\/apply\.fundhub\.ai\/thank-you/, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: doc }));
    for (const k of Object.keys(JS_URL)) {
      await ctx.route((u) => u.href.split("?")[0] === JS_URL[k], (r) => r.fulfill({ status: 200, contentType: "application/javascript; charset=utf-8", body: clean[k] }));
    }
  }
  const p = await ctx.newPage();
  await p.goto(`${LIVE_URL}?cb=${Date.now()}`, { waitUntil: "networkidle" }).catch(() => {});
  for (const sel of ["#fh-ty-video", "#fhp-root", "#fh-ty-proof", "#fh-prompter-download"]) {
    await p.waitForSelector(sel, { state: "attached", timeout: 15000 });
  }
  /* walk down the page so every on-screen trigger and lazy picture fires */
  const h = await p.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 600) { await p.evaluate((v) => window.scrollTo(0, v), y); await p.waitForTimeout(120); }
  await p.waitForTimeout(1500);
  const snap = await p.evaluate(() => ({
    takenAt: new Date().toISOString(),
    styles: [...document.querySelectorAll("style")].map((s) => s.textContent),
    links: [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href),
    root: document.querySelector(".fh-root").outerHTML,
  }));
  await ctx.close();
  return snap;
}

/* ======================= the share page ======================= */
const PILL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';

const MARK_CSS = `
html{background:#FCFCFC !important;background-image:linear-gradient(rgba(10,10,10,.048) 1px,transparent 1px),linear-gradient(90deg,rgba(10,10,10,.048) 1px,transparent 1px) !important;background-size:44px 44px !important;color-scheme:light}
body::before{display:none !important}
.fhx-banner{font:600 13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;padding:calc(10px + env(safe-area-inset-top,0px)) 16px 10px;text-align:center}
.fhx-banner.r1{background:#B42318}.fhx-banner.r2{background:#0B5D1E}
.fhx-legend{display:flex;flex-wrap:wrap;gap:6px 18px;justify-content:center;align-items:center;padding:10px 16px;background:#fff;border-bottom:1px solid #E4E4E7;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#3F3F46}
.fhx-key{display:inline-flex;align-items:center;gap:7px}
.fhx-sw{display:inline-block;width:18px;height:12px;border-radius:3px}
.fhx-sw.red{border:3px solid #E5484D}.fhx-sw.blue{border:2px dashed #2F6FEB}.fhx-sw.green{background:rgba(22,163,74,.18);box-shadow:0 0 0 2px rgba(22,163,74,.55)}
.fhx-still{flex-basis:100%;text-align:center;color:#71717A;font-size:12.5px}
.fhx-btn{font:600 13px system-ui,-apple-system,sans-serif;background:#111113;color:#fff;border:0;border-radius:8px;padding:9px 13px;min-height:40px;cursor:pointer}
.fhx-btn:focus-visible{outline:2px solid #2F6FEB;outline-offset:2px}
.fhx-float{position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:2147483000;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.fh-root .fhx-tag{display:block;width:max-content;max-width:100%;margin:34px auto 10px;padding:4px 9px;border-radius:5px;background:#EEF2F6;color:#344054;font:700 11.5px/1.35 system-ui,-apple-system,sans-serif;letter-spacing:.01em;text-align:center;text-transform:none;white-space:normal}
.fh-root .fhx-tag.moved{background:#2F6FEB;color:#fff}
.fh-root .fhx-tag.cut{background:#B42318;color:#fff}
.fh-root .fhx-movebox{margin:30px -12px 0;padding:8px 10px 16px;border:2px dashed #2F6FEB;border-radius:12px}
.fh-root .fhx-movebox>.fhx-tag{margin-top:2px}
.fh-root .fhx-bad{outline:3px solid #E5484D !important;outline-offset:3px;border-radius:4px}
.fh-root .fhx-badge,.fh-root .fhx-gbadge{position:static;display:inline-grid;place-items:center;flex:0 0 auto;align-self:flex-start;min-width:22px;height:22px;margin:0 8px 0 0;padding:0 6px;border-radius:11px;color:#fff;font:700 12px/22px system-ui,-apple-system,sans-serif;letter-spacing:0;text-transform:none;vertical-align:2px}
.fh-root .fhx-badge{background:#E5484D}
.fh-root .fhx-gbadge{background:#15803D}
.fh-root .fhx-note{display:block;max-width:660px;margin:16px auto 24px;padding:11px 13px;border:2px solid #E5484D;border-left-width:6px;border-radius:8px;background:#FFF5F5;color:#2B0B0C;font:14.5px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:0;text-align:left;text-transform:none}
.fh-root .fhx-note .fhx-n{display:inline-grid;place-items:center;min-width:22px;height:22px;margin-right:8px;padding:0 5px;border-radius:11px;background:#E5484D;color:#fff;font-weight:700;font-size:12px;vertical-align:1px}
.fh-root .fhx-note .fhx-p{display:inline}
.fh-root .fhx-note .fhx-f{display:block;margin-top:7px;color:#0B5D1E}
.fh-root .fhx-note b{font-weight:700}
.fh-root .fhx-note.open{border-color:#B54708;background:#FFFAEB;color:#3B2404}
.fh-root .fhx-note.open .fhx-n{background:#B54708}
.fh-root .fhx-cut{max-width:660px;margin:30px auto 0;padding:10px 13px;border:2px dashed #B42318;border-radius:8px;background:#fff;color:#7A1A12;font:14px/1.45 system-ui,-apple-system,sans-serif;text-align:left}
.fh-root .fhx-cut .fhx-n{display:inline-grid;place-items:center;min-width:22px;height:22px;margin-right:8px;padding:0 5px;border-radius:11px;background:#15803D;color:#fff;font-weight:700;font-size:12px}
.fh-root .fhx-new{background-image:linear-gradient(rgba(22,163,74,.12),rgba(22,163,74,.12)) !important;outline:2px solid rgba(22,163,74,.6) !important;outline-offset:2px}
.fh-root .fhx-txt{background:rgba(22,163,74,.18);box-shadow:0 0 0 2px rgba(22,163,74,.45);border-radius:3px}
.fh-root .fhx-poster{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
html.fhx-clean .fhx-tag,html.fhx-clean .fhx-badge,html.fhx-clean .fhx-gbadge,html.fhx-clean .fhx-note,html.fhx-clean .fhx-cut{display:none !important}
html.fhx-clean .fhx-bad{outline:0 !important}
html.fhx-clean .fhx-movebox{border-color:transparent;margin:0;padding:0}
html.fhx-clean .fhx-new{background-image:none !important;outline:0 !important}
html.fhx-clean .fhx-txt{background:none;box-shadow:none}
`;

function shell(snap, round) {
  const fonts = [...new Set(snap.links)].filter((h) => h.startsWith("https://fonts.googleapis.com/"))
    .map((h) => `<link rel="stylesheet" href="${h}">`).join("\n");
  const r1 = round === 1;
  const banner = r1
    ? `<div class="fhx-banner r1">DRAFT, NOT LIVE · apply.fundhub.ai/thank-you · Round 1: what is wrong, and the new order</div>`
    : `<div class="fhx-banner r2">DRAFT, NOT LIVE · apply.fundhub.ai/thank-you · Round 2: the fixes written in</div>`;
  const keys = r1
    ? `<span class="fhx-key"><i class="fhx-sw red"></i>Red box = a line with a problem. The fix is under it.</span>`
    : `<span class="fhx-key"><i class="fhx-sw green"></i>Green = the fix, written in. Numbers match round 1.</span>`;
  const legend = `<div class="fhx-legend">${keys}
<span class="fhx-key"><i class="fhx-sw blue"></i>Blue dashed box = a block that moved.</span>
<span class="fhx-key">Gray label = the new order.</span>
<button type="button" class="fhx-btn" data-fhx-toggle>Hide the marks</button>
<span class="fhx-still">This copy is a still picture of the page. The buttons, the video and the moving parts work only on the live page.</span></div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
<title>${r1 ? "Thank-You Page Redraft" : "Thank-You Page Fixes"}</title>
${fonts}
${snap.styles.map((s) => `<style>${s.replace(/<\/style/gi, "<\\/style")}</style>`).join("\n")}
<style>${MARK_CSS}</style>
</head><body>
${banner}
${legend}
${snap.root}
<button type="button" class="fhx-btn fhx-float" data-fhx-toggle>Hide the marks</button>
</body></html>`;
}

const TOGGLE_JS = `<script>
(function(){
  var h=document.documentElement,bs=document.querySelectorAll('[data-fhx-toggle]');
  function set(off){h.classList.toggle('fhx-clean',off);for(var i=0;i<bs.length;i++)bs[i].textContent=off?'Show the marks':'Hide the marks';}
  for(var i=0;i<bs.length;i++)bs[i].addEventListener('click',function(){set(!h.classList.contains('fhx-clean'));});
  if(location.hash==='#clean')set(true);
})();
</script>`;

/* Runs in the browser on the share page. Round 1: move, box and number. Round 2: check the order, mark green. */
function markPage({ round, marks, order, numbers, poster, pill }) {
  const $ = (s) => document.querySelector(s);
  const wrap = $(".fh-root .wrap");
  const S = {
    hero: $(".fh-root .hero"), video: $("#fh-ty-video"), prose: $(".fh-root .prose"), cal: $("#fh-cal-cta"),
    decides: $("#fh-ty-decides"), expect: $("#fh-expect"), prep: $("#fh-prep"),
    app: round === 1 ? $("#fh-prompter-download") : $("#fh-ty-app-slot"),
    paths: $("#fhp-root"), proof: $("#fh-ty-proof"), faq: $(".fh-root .faq"), signoff: $(".fh-root .signoff"),
  };
  const keys = order.map((o) => o[0]);
  const missing = keys.filter((k) => !S[k]);
  if (missing.length) throw new Error(`round ${round}: blocks not found: ${missing.join(", ")}`);
  if (round === 2) {
    if (S.prose || S.decides) throw new Error("round 2: the cut blocks are still on the clean page");
    if (!$("#fh-ty-app-slot #fh-prompter-download")) throw new Error("round 2: the app card is not in its slot");
  }
  const kids = [...wrap.children];
  const known = keys.map((k) => S[k]);
  const extra = kids.filter((c) => !known.includes(c));
  if (extra.length) throw new Error(`round ${round}: blocks this draft does not know: ${extra.map((e) => e.outerHTML.slice(0, 70)).join(" | ")}`);
  if (round === 1) known.forEach((el) => wrap.appendChild(el));
  else if (kids.some((c, i) => c !== known[i])) {
    throw new Error(`round 2: the clean page is not in the new order: ${kids.map((c) => c.id || c.className).join(" > ")}`);
  }
  if (S.prep) S.prep.style.display = "";

  /* the video spot, shown filled */
  const media = $("#fh-ty-video .fhv-media");
  if (poster && media) {
    media.innerHTML = `<img class="fhx-poster" src="${poster}" alt="Thank-you video, first frame">` +
      `<div class="fhv-unmute"><span class="fhv-pill">${pill}Tap for sound</span></div>`;
  }

  const find = (sel, has) => {
    const list = [...document.querySelectorAll(sel)].filter((e) => !has || e.textContent.includes(has));
    if (list.length !== 1) throw new Error(`round ${round}: "${sel}"${has ? ` with "${has}"` : ""} matched ${list.length}`);
    return list[0];
  };
  const lastNote = new Map();
  const putAfter = (host, node) => {
    const at = lastNote.get(host) || host;
    at.parentNode.insertBefore(node, at.nextSibling);
    lastNote.set(host, node);
  };
  const out = {};

  if (round === 1) {
    for (const m of marks) {
      const el = find(m.sel, m.has);
      const det = el.closest("details");
      if (det) det.open = true;
      el.classList.add("fhx-bad");
      const b = document.createElement("span");
      b.className = "fhx-badge"; b.dataset.id = m.id;
      el.insertBefore(b, el.firstChild);
      const note = document.createElement("div");
      note.className = "fhx-note"; note.dataset.id = m.id;
      note.innerHTML = `<span class="fhx-n"></span><span class="fhx-p"><b>Problem:</b> ${m.problem}</span><span class="fhx-f"><b>Fix:</b> ${m.fix}</span>`;
      const host = m.host === "details" ? det : m.host ? $(m.host) : el;
      putAfter(host, note);
    }
    [...document.querySelectorAll(".fhx-badge")].forEach((b, i) => {
      out[b.dataset.id] = i + 1;
      b.textContent = String(i + 1);
    });
    document.querySelectorAll(".fhx-note").forEach((n) => { n.querySelector(".fhx-n").textContent = out[n.dataset.id]; });
  } else {
    const green = (el, n, text) => {
      if (text) {
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let t;
        while ((t = walk.nextNode()) && !t.nodeValue.includes(text));
        if (!t) throw new Error(`round 2: text not found: ${text}`);
        const at = t.nodeValue.indexOf(text);
        const mid = t.splitText(at); mid.splitText(text.length);
        const span = document.createElement("span"); span.className = "fhx-txt";
        mid.parentNode.insertBefore(span, mid); span.appendChild(mid);
      } else el.classList.add("fhx-new");
      const det = el.closest("details");
      if (det) det.open = true;
      const b = document.createElement("span");
      b.className = "fhx-gbadge"; b.textContent = String(n);
      el.insertBefore(b, el.firstChild);
    };
    for (const m of marks) {
      const n = numbers[m.id];
      if (m.r2.cut) {
        const d = document.createElement("div");
        d.className = "fhx-cut";
        d.innerHTML = `<span class="fhx-n">${n}</span>${m.r2.text}`;
        putAfter($(m.r2.cut), d);
      } else if (m.r2.open) {
        const d = document.createElement("div");
        d.className = "fhx-note open";
        d.innerHTML = `<span class="fhx-n">${n}</span><span class="fhx-p"><b>Still open:</b> ${m.r2.text}</span>`;
        putAfter($(m.r2.open), d);
      } else {
        for (const sel of [].concat(m.r2.sel)) green(find(sel, m.r2.has), n, m.r2.text);
      }
    }
  }

  /* order labels and blue boxes for the blocks that moved */
  for (const [k, label, kind] of order) {
    const el = S[k];
    const tag = document.createElement("div");
    tag.className = `fhx-tag${kind ? ` ${kind}` : ""}`;
    tag.textContent = label;
    if (kind === "moved") {
      const box = document.createElement("div");
      box.className = "fhx-movebox";
      el.parentNode.insertBefore(box, el);
      box.appendChild(tag);
      box.appendChild(el);
    } else el.parentNode.insertBefore(tag, el);
  }
  return out;
}

async function bakePictures(html) {
  const tmp = mkdtempSync(join(tmpdir(), "fh-ty-share-"));
  const urls = [...new Set([...html.matchAll(/<img\b[^>]*?\ssrc="(https:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")))];
  let n = 0;
  for (const u of urls) {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`picture ${res.status}: ${u}`);
    const type = (res.headers.get("content-type") || "").split(";")[0];
    const f = join(tmp, `${n++}`);
    writeFileSync(f, Buffer.from(await res.arrayBuffer()));
    let mime = type || "image/png";
    if (/jpe?g/.test(type)) {
      execFileSync("sips", ["-Z", "900", "-s", "format", "jpeg", "-s", "formatOptions", "72", f, "--out", `${f}.jpg`], { stdio: "ignore" });
      writeFileSync(f, readFileSync(`${f}.jpg`)); mime = "image/jpeg";
    }
    const data = `data:${mime};base64,${readFileSync(f).toString("base64")}`;
    html = html.split(u).join(data).split(u.replace(/&/g, "&amp;")).join(data);
  }
  return { html, count: urls.length };
}

async function posterData() {
  const local = arg("poster");
  let buf = null;
  if (local) buf = readFileSync(local);
  else {
    const res = await fetch(POSTER_URL).catch(() => null);
    if (res && res.ok) buf = Buffer.from(await res.arrayBuffer());
  }
  if (!buf) return null;
  const tmp = mkdtempSync(join(tmpdir(), "fh-ty-poster-"));
  writeFileSync(join(tmp, "p.jpg"), buf);
  execFileSync("sips", ["-Z", "1100", "-s", "format", "jpeg", "-s", "formatOptions", "70", join(tmp, "p.jpg"), "--out", join(tmp, "s.jpg")], { stdio: "ignore" });
  return `data:image/jpeg;base64,${readFileSync(join(tmp, "s.jpg")).toString("base64")}`;
}

async function buildShare(browser, snap, round, numbers, poster) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(BLOCKED, (r) => r.abort());
  const p = await ctx.newPage();
  await p.setContent(shell(snap, round), { waitUntil: "load" });
  const got = await p.evaluate(markPage, { round, marks: MARKS, order: round === 1 ? ORDER_R1 : ORDER_R2, numbers, poster, pill: PILL });
  let html = "<!doctype html>\n" + (await p.evaluate(() => document.documentElement.outerHTML));
  await ctx.close();
  const baked = await bakePictures(html);
  html = baked.html.replace(/ loading="lazy"/g, "").replace("</body>", `${TOGGLE_JS}\n</body>`);
  return { html, numbers: got, pictures: baked.count };
}

/* ======================= marks.md ======================= */
function marksMd(numbers, poster) {
  const byN = [...MARKS].sort((a, b) => numbers[a.id] - numbers[b.id]);
  const strip = (s) => s.replace(/<[^>]+>/g, "");
  return `# /thank-you redraft — every mark, in plain words

Page: https://apply.fundhub.ai/thank-you (Direct Book funnel). Round 1 draft, not live.
Built by \`marketing/landing-pages/preview/thank-you-reorg-draft-build.mjs\`.

## Is the text on brand?

Mostly yes. The look is on brand: Inter and JetBrains Mono, the grid paper, black type, one blue button, white cards. The words are plain and certain. There is no "maybe", "might", "could" or "we think" anywhere, and Fundhub is spelled right every time.

What is off:

1. It says the same things too many times. The three paths are told four times, the soft pull three times, and "check your email" twice.
2. The app card sits at the very top in a black box, louder than the calendar button.
3. Two lines sound like Fundhub is the lender ("We fund individuals", "fund you once your file is ready"), and it says "credit repair" twice.
4. Made-up names and filler: "the Conveyor Belt", "a Pod", "The engine.", "You took the first real step toward getting funded."
5. Facts that do not hold up: the sample files do not match the path cards, and the app card tells people to sign in before they have a login.

## The new order, top to bottom

1. Headline: "You're All Set." / "Your Call Is Booked."
2. Video, right under the headline (${poster ? "the draft shows its first frame" : "the draft shows the empty spot"}; the video goes in by its own job)
3. Confirm your call: one block, with the calendar buttons (the two lines that sat under the video fold in here)
4. What happens on the call
5. Before we talk (moved up)
6. Fundhub Portal app card (moved down, restyled)
7. Your three paths (moved down two blocks)
8. Client approvals
9. Common questions
10. Sign-off

Cut: "What the call decides" (it repeated blocks 4 and 7).

## Blue moves

- **Before we talk moved up.** It sat under the three-paths section, which is about 2,300 pixels tall on a computer and 3,000 on a phone, so most people scrolled past it. Now it sits right after "What happens on the call", so the call steps and the prep list are together.
- **The app card moved down.** It sat right under the headline, above the video. Chris asked for it beneath. Now it comes after all the call content (confirm, call steps, prep list) and before the three paths, the approvals and the FAQ. Step 1 of the paths strip right under it is "Get the app", so the card and that step sit together.
- **The three paths moved down two blocks.** Before, the paths script put itself right after the call steps. Now it follows the app card.

## Red marks

| # | Where | Problem | Fix |
|---|---|---|---|
${byN.map((m) => `| ${numbers[m.id]} | ${m.where} | ${strip(m.problem)} | ${strip(m.fix)} |`).join("\n")}

## What this draft cannot show

- The video plays only on the live page. The draft shows its first frame.
- The sample file buttons (A to E) and the path animations move only on the live page. The draft shows sample file A, standing still.
- When a booking time is saved in the browser, the gray calendar line shows the real date and time, and an Apple / Outlook button shows. The draft shows the page without a saved time.
- The "Open your inbox" button shows only for Gmail, Outlook, Yahoo and iCloud addresses.

## What stays the same

The headline words, the video spot, the calendar buttons and their tracking, the approvals, the order of the FAQ questions, the footer, and every id and class the scripts and tests use. Step 1 of the paths strip stays "Get the app" (Chris approved it 2026-10-23).
`;
}

/* ======================= run ======================= */
const browser = await chromium.launch();
try {
  let snap;
  if (!flag("resnap") && existsSync(SNAP_FILE)) snap = JSON.parse(readFileSync(SNAP_FILE, "utf8"));
  else {
    snap = await readPage(browser);
    writeFileSync(SNAP_FILE, JSON.stringify(snap));
    console.log(`read the live page ${snap.takenAt} -> ${SNAP_FILE}`);
  }
  const poster = await posterData();
  if (!poster) console.log("no video poster found: the video spot shows [ VIDEO ]");

  const r1 = await buildShare(browser, snap, 1, null, poster);
  writeFileSync(join(OUT, "thank-you-reorg-r1.html"), r1.html);
  console.log(`built thank-you-reorg-r1.html (${MARKS.length} marks, ${r1.pictures} pictures baked in, ${(r1.html.length / 1024).toFixed(0)} KB)`);

  const clean = cleanSources();
  const cleanSnap = await readPage(browser, { clean });
  const r2 = await buildShare(browser, cleanSnap, 2, r1.numbers, poster);
  writeFileSync(join(OUT, "thank-you-reorg-r2.html"), r2.html);
  console.log(`built thank-you-reorg-r2.html (the clean source in a real browser, ${(r2.html.length / 1024).toFixed(0)} KB)`);

  writeFileSync(join(OUT, "thank-you-reorg-marks.md"), marksMd(r1.numbers, poster));
  console.log("built thank-you-reorg-marks.md");

  if (flag("shots")) {
    for (const [file, tag] of [["thank-you-reorg-r1.html", "r1"], ["thank-you-reorg-r2.html", "r2"]]) {
      for (const [w, h, dev] of [[1280, 900, "desktop"], [390, 844, "phone"]]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dev === "phone" ? 2 : 1 });
        await ctx.route(/^https?:\/\/(?!fonts\.(googleapis|gstatic)\.com)/, (r) => r.abort());
        const p = await ctx.newPage();
        await p.goto(`file://${join(OUT, file)}`, { waitUntil: "load" });
        await p.waitForTimeout(800);
        const wide = await p.evaluate(() => document.documentElement.scrollWidth);
        if (wide > w + 1) throw new Error(`${file} at ${w}px scrolls sideways (${wide}px)`);
        for (const marks of ["on", "off"]) {
          if (marks === "off") await p.click(".fhx-float");
          await p.waitForTimeout(300);
          await p.screenshot({ path: join(OUT, `${tag}-${dev}-marks-${marks}${marks === "off" ? "-UNMARKED" : ""}.jpg`), type: "jpeg", quality: 70, fullPage: true });
          await p.screenshot({ path: join(OUT, `${tag}-${dev}-top-marks-${marks}${marks === "off" ? "-UNMARKED" : ""}.png`) });
        }
        await ctx.close();
      }
    }
    console.log(`screenshots in ${OUT}`);
  }

  if (flag("live")) {
    if (!existsSync(FROZEN_FRAG)) writeFileSync(FROZEN_FRAG, readFileSync(FRAG_FILE, "utf8"));
    const left = [clean.frag, clean.sort, clean.paths, clean.app].join("\n").match(/.{0,40}fhx-.{0,40}/);
    if (left) throw new Error(`draft markup in the clean source: ${left[0]}`);
    writeFileSync(FRAG_FILE, clean.frag);
    writeFileSync(JS_FILES.sort, clean.sort);
    writeFileSync(JS_FILES.paths, clean.paths);
    writeFileSync(JS_FILES.app, clean.app);
    console.log("wrote the clean source: 05-thank-you.html, thankyou-sort.js, funding-paths.js, fundhub-prompter-download.js (nothing pushed)");
  }
} finally {
  await browser.close();
}
