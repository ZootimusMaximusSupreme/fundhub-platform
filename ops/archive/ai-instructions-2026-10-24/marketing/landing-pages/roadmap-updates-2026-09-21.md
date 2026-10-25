# Roadmap sales page updates — 2026-09-21

**This is the spec only.** The live page was not changed in this pass.

**Do not upload testimonials or approval screenshots into the funnel yet.** Real images are still being gathered. Use placeholder cards only until Chris says to add the real shots.

Before any later push that includes real images, host them where ClickFunnels can load them (ClickFunnels image library, or inline compressed WebP data URIs). Relative repo paths will not resolve on ClickFunnels.

---

## Target file (not edited in this pass)

- **Repo path:** `clickfunnels-fragments/slo/slo-01-sales.html`
- **Live URL after a later push:** https://apply.fundhub.ai/roadmap

---

## 1. Document pills light up blue on scroll

**Where:** The five numbered pills in the “How To Use This mini course” card — **1 · Credit Analysis Report** through **5 · Bank and Lender Match List**.

**Behavior:**

- Each pill **lights up** when it crosses about **65% of the viewport height** (measured from the top), scrolling **top to bottom**.
- It **turns off** when scrolled back **above** that line.
- Use **IntersectionObserver** with `rootMargin: "0px 0px -35% 0px"` (bottom 35% of the root clipped → trigger line at ~65% viewport height).

**Lit state:**

- Solid border, text, and soft glow in the page’s existing primary blue (use **#2563EB** if the page has no blue CSS variable).
- Light blue fill.
- **300ms** transition between states.

**Accessibility:**

- If `prefers-reduced-motion: reduce`, switch states **instantly** and **skip the glow**.

---

## 2. Advisors section photo slot

- Add a **full-width rounded photo block** directly **under** the advisors section content.
- **Aspect ratio:** **16:9** on desktop, **4:5** on mobile.
- **`object-fit: cover`** on the image.
- **Source:** `assets/advisors/advisors-photo.jpg`.
- Until that file exists, show a **neutral placeholder block** (same layout slot, no broken image).

---

## 3. Community section approvals deck

- Add a **stacked card deck** of approval screenshots in the **community section**.
- **Keep** the existing testimonials; this deck is **in addition** to them.

**Scroll behavior (default):**

- Pin the deck with **`position: sticky`** while the user scrolls through the section.
- About every **30vh** of scroll: move the **top card** up and to the **back** of the deck; bring the **next** approval forward.
- Scrolling **up** reverses the order.

**Card styling:**

- White background, rounded corners, shadow.
- Alternating tilt of about **3 degrees**.
- Screenshot inside: **`object-fit: contain`** so approval text stays readable.
- Width: about **88vw** on mobile, **520px max** on desktop.
- **Max height: 70vh**.

**Images and placeholders:**

- Load from an array pointing at **`assets/approvals/`** (`approval-01` onward).
- Build **8 placeholder cards** until real screenshots are added.
- Create **`img` elements only** when the section is within **one screen** of the viewport (lazy mount).

**Performance:**

- One **passive** scroll listener, throttled with **`requestAnimationFrame`**.

**Reduced motion:**

- If `prefers-reduced-motion: reduce`, show approvals as a **horizontal swipe row** with **`scroll-snap`** instead of the sticky deck animation.

**Reminder:** Do not upload testimonials or approvals into the funnel yet (placeholders only until Chris approves real assets and hosting).

---

## 4. Mobile pass on the whole page

Test and fix at **360px**, **390px**, **414px**, and **768px** widths.

**Layout and type:**

- **No horizontal scrolling** anywhere; wrap long monospace labels.
- Viewport meta: **`width=device-width, initial-scale=1`**.
- Body text **at least 16px**; headings sized with **`clamp()`**.

**Touch targets:**

- Every button and tap target **at least 44px tall**.
- CTA buttons **full width** under **640px**.

**Responsive structure:**

- Multi-column rows **stack to one column** under **640px**.
- Images and video: **`max-width: 100%`**, **`height: auto`**.

**Forms:**

- Form inputs use **16px font** so iOS does not zoom on focus.

**Interactive previews:**

- “Tap any cover for a sample” previews **open and close cleanly by touch**; close button **reachable on a phone**.

**Safe areas:**

- Anything **fixed** or **sticky** respects **`env(safe-area-inset-*)`**.

---

## Out of scope for this document

This file records requirements only. **No HTML, CSS, JS, or funnel files were changed** when this spec was saved. No ClickFunnels push, no git remote push, no Google Drive upload, no image uploads.
