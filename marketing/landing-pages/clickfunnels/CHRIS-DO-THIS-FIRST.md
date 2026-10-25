# ClickFunnels setup — do this first

**Old. Agents do this through the API (chris-never-clickfunnels).**

**Written 2026-09-08.** About 15 minutes. Nothing else in the marketing build works
until this is done.

---

## Why this matters

When you run an ad, the link carries a number that says which ad it was. Something has
to **catch** that number and **keep** it, all the way through to the booked call.

ClickFunnels catches it into little labelled boxes. **Those boxes do not exist yet.**

Until they do, every visitor arrives anonymous. You will never be able to say "ad 42
booked me three calls" — the screen that shows that will just be empty forever, no
matter what gets built on our side.

---

# Part 1 — Make the seven boxes

**Go to:** Contacts → Settings → Custom attributes

**Make seven.** Type each name **exactly** as written. All lowercase. Underscores, not
spaces or dashes. A typo here silently drops that piece of information forever.

| # | Type this name exactly | What it holds |
|---|---|---|
| 1 | `utm_source` | which platform sent them — `fb` |
| 2 | `utm_medium` | how you got them — `paid` |
| 3 | `utm_campaign` | which lane — `funding600`, `premium`, `sorting`, `uwiq`, `wl` |
| 4 | **`utm_content`** | **the ad number.** This is the important one |
| 5 | `utm_term` | which version — `sun`, `nosun`, `sedona` |
| 6 | `landing_path` | which page they landed on first |
| 7 | `referrer_domain` | which website sent them |

**If it asks for a type, pick text.** All seven are text.

**Number 4 is the one that matters most.** It is the number that ties an ad to money.
The other six are useful. That one is load-bearing.

---

# Part 2 — Point every survey question at its box

**Go to:** your survey → each question → the setting called **Contact Attribute**

Right now the checklist in this repo says every question shows **"None"**. That means
people are answering your survey and **the answers are going nowhere.**

Go through them one at a time and set each question to the box that matches it — name
to name, phone to phone, business to business.

**Any question still showing "None" is a question whose answer is being thrown away.**

---

# Part 3 — Make the webhook fire on the booking too

**Go to:** Settings → Webhooks

Find the webhook pointing at fundhub.ai. Check what events it fires on.

It probably fires on **survey submitted**. It also needs to fire on **appointment
booked**.

**Why:** the survey tells us someone was interested. The booking is the thing you
actually paid for. If the webhook only fires on the survey, every booked call arrives
without its ad number attached — and cost per booked call can never be worked out.

---

# Part 4 — Check the catcher is on both pages

The little script that grabs the number needs to be on the page **and** it needs to
survive the jump from the video page to the form.

**Two pages, both need it:**

1. `apply.fundhub.ai/watch` — the VSL page
2. the application page with the form on it

**How to check:** Settings → Tracking Code, or a Custom HTML/JS element on the page.
Look for a block of code mentioning `fh_attribution`.

The exact code to paste is in this repo at
`marketing/landing-pages/06-utm-hidden-fields.html`. Paste the whole thing into a Custom
HTML/JS element. It shows nothing on the page and changes nothing visually.

**Why both pages:** your ad points at the video page. The form is on a different page.
The script remembers the number on page one and hands it over on page two. On the video
page alone, it catches nothing useful. On the form page alone, the number is already
gone by the time anyone gets there.

---

# Part 5 — Tell me when it's done

Then send me these three answers and I do the rest:

1. Did all seven boxes get created?
2. Are any survey questions still showing "None"?
3. Does the webhook fire on appointment booked now?

---

# How we will know it worked

Once this is done and I have deployed, we test it together with one real click:

1. You open a live ad link and go through it like a customer.
2. You book a test call.
3. The closer's screen shows that ad's number next to your booking.
4. The Ad Performance screen shows that ad with **1 lead and 1 booked call**.

If you see the number in step 3, the whole chain works and everything else can be built
on top of it.

---

# What an ad link looks like

For reference. This is the format everything above expects:

```
https://apply.fundhub.ai/watch?utm_source=fb&utm_medium=paid&utm_campaign=funding600&utm_content=42-ringlights&utm_term=sun
```

**The ad number is `42`.** The `-ringlights` part is only there so it reads nicely to a
human — our code ignores it completely. `utm_content=42` on its own works exactly the
same.

**So you never have to name an ad before anything can happen.** A number is enough.
