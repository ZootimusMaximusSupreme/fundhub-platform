# /thank-you redraft — every mark, in plain words

Page: https://apply.fundhub.ai/thank-you (Direct Book funnel). Round 1 draft, not live.
Built by `marketing/landing-pages/preview/thank-you-reorg-draft-build.mjs`.

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
2. Video, right under the headline (the draft shows its first frame; the video goes in by its own job)
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
| 1 | Line under the headline | “We'll see you then” says the same thing as the last line on the page (“We'll see you soon.”). “Here's what to expect” is filler. | “Your advisor is holding this time for you.” Chris says this in the video. |
| 2 | The two lines under the video | “You took the first real step toward getting funded.” is a feel-good line. It gives them nothing to do. The next line says to check their email, and the calendar block right below says it again. | Fold both lines into one “Confirm your call” block that leads with the one thing to do: “Accept the calendar invite in your email so your time is locked in.” (Chris's words in the video.) |
| 3 | Confirm your call, gray line | Says “it is in your email” again, right after the line above it. | “Your date, time and Google Meet link are in that email.” The page already says the Meet link is in that email. |
| 4 | What the call decides | Repeats. The three roads are said again in step 03 right below, and again in the three paths section. “We read your file the way a bank does” is in the FAQ too. | Cut this block. Its last line, “Nobody gets turned away.”, moves word for word into the three paths section. |
| 5 | What happens on the call, step 02 | The soft pull is explained here, then again in the three paths section (“Your advisor runs a tri-bureau soft pull plus an Experian business report with you”). | Say it once, here: “Tri-bureau plus an Experian business report. It does not touch your score.” |
| 6 | What happens on the call, step 03 | Says “roads.” Everything below says “paths” (Path 1, Path 2, Path 3). Two words for one thing. | Title: “You get one of three paths.” Line: “You leave knowing how much you qualify for based on where you're at right now, and the path to get it.” |
| 7 | Before we talk, line 1 | Says they share their screen. In the video Chris says to join from a computer, because the advisor goes through the file on screen with them. | “Join from your computer, somewhere quiet, so you can see your file on screen with your advisor.” |
| 8 | Before we talk, line 3 | The link is a raw web address. On a phone it breaks over two lines and looks like code. The video tells people to use “the reschedule link on this page,” so it has to be easy to see. | “Need to move it? Reschedule your call.” The words “Reschedule your call” are the link, to the same address. |
| 9 | Fundhub Portal app card | A black card built for the top of the page. It is the loudest thing on screen and pulls eyes away from the blue calendar button, the button that matters most. | A white card like “Before we talk”: app icon on the left, an outline button, small label “Get the app” (the same words as step 1 of the paths strip). The blue calendar button stays the only main button. The Apple link and the tap tracking stay the same. |
| 10 | App card, middle line | “Keep your Fundhub file close” is a figure of speech, not a fact. | “See where your Fundhub file stands and open your portal for the next step.” |
| 11 | App card, small line | “Sign in with your Fundhub account.” Someone who just booked has no login yet. It is made on the call, when the advisor runs the soft pull. “Opens the official Apple App Store listing” says what the button already says. | “Download it now. Your login is made on your call, when your advisor runs your soft pull.” |
| 12 | Three paths, small label | “What happens on your call” is almost the same label as “What happens on the call” two blocks up. | “Your three paths” |
| 13 | Three paths, line under the headline | Explains the soft pull a second time (see step 02). | “What your file shows on the call puts you on one of these three paths. Nobody gets turned away.” |
| 14 | Sample files A to E and the three path cards | The samples do not agree with the cards. The rule is one sample file, one story. Sample file B is score 618, 11 inquiries, 2 outdated addresses, 64% used. The Path 2 card it points to shows 612, 9 inquiries, 3 outdated items, 2 negative items, 68% used. File D points to the same card. Files A, C and E all show the same $318,000 funding sequence, and E has no business. | Each card shows the file named on it, as UnderwriteIQ prints it for that file. Not written into the clean version: it needs a real UnderwriteIQ run of each sample file first. |
| 15 | Path 2 card, top text | “and fund you once your file is ready” sounds like Fundhub is the lender. The FAQ and the footer say Fundhub is not a lender. The card's last line already says “Once your file is ready, you move to funding.” | “We show you exactly what's holding your file back and optimize your credit for you.” |
| 16 | FAQ: What makes Fundhub different? | Made-up names a buyer has never heard (“the Conveyor Belt,” “a Pod”), a one-word start (“The engine.”), another company's name (Credit Karma), and the longest answer on the page. | “UnderwriteIQ reviews your file the way a lender does, matches it against thousands of lenders, and finds the 30 to 50 that fit. We apply in rounds and clear the new inquiries between rounds, so you go after real money without wrecking your score. A funding advisor, a credit specialist and an ops specialist work your file together.” |
| 17 | FAQ: Do I need a business to qualify? | “We fund individuals too.” Fundhub is not a lender. The first answer on this list says so. | Start with “No. Individuals qualify too.” The rest stays. |
| 18 | FAQ: What if my credit isn't great? | “We handle repair too.” Fundhub says credit optimization, never credit repair. “If the numbers aren't fundable” is vague. | “Still take the call. If your file isn't fundable yet, we tell you straight and you leave with the exact fix. We optimize your credit too, so there's a path either way.” |
| 19 | FAQ: What does this cost? | “Exact numbers get walked through live on your call.” Vague, and it hides who does it. | End with “Your advisor walks you through the pricing for your path on the call.” Chris's words in the video. The rest stays. |
| 20 | FAQ: Do I have to go done-for-you? | Says “credit repair.” Fundhub says credit optimization. | “…the same playbook for funding and credit optimization to run on your own.” The rest stays. |

## What this draft cannot show

- The video plays only on the live page. The draft shows its first frame.
- The sample file buttons (A to E) and the path animations move only on the live page. The draft shows sample file A, standing still.
- When a booking time is saved in the browser, the gray calendar line shows the real date and time, and an Apple / Outlook button shows. The draft shows the page without a saved time.
- The "Open your inbox" button shows only for Gmail, Outlook, Yahoo and iCloud addresses.

## What stays the same

The headline words, the video spot, the calendar buttons and their tracking, the approvals, the order of the FAQ questions, the footer, and every id and class the scripts and tests use. Step 1 of the paths strip stays "Get the app" (Chris approved it 2026-10-23).
