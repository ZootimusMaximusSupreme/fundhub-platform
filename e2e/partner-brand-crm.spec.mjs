/* Playwright: a partner's own brand paints the CRM, and the status colours survive it.
 *
 * TWO THINGS ARE BEING PROVED IN A REAL BROWSER, on the real screen a partner
 * actually lands on:
 *
 *   1. A white-label partner signing in sees THEIR brand. Until 2026-08-31 they
 *      saw Fundhub's colours, type and wordmark on every screen.
 *   2. A deliberately awful brand cannot flatten a state signal. The ramp fed in
 *      here is a single-hue gradient — six shades of one blue, the shape a real
 *      brand guideline very often has. Under the old paintBrand(), stops 0, 1, 3
 *      and 4 became --alert, --warn, --ok and --info, so "blocked" and "healthy"
 *      rendered as the same colour in 374 places across public/.
 *
 * WHY galaxy.html. It is where the shell sends a partner session, and its GX-01
 * legend prints "ahead", "behind" and "blocked" as three dots painted straight
 * from --ok, --warn and --alert (galaxy.html:169-170). So the proof is three
 * real state signals on the partner's own landing screen under a hostile brand,
 * not a swatch strip built for the test.
 *
 * IT ALSO WRITES THE EVIDENCE. Set SHOOT=1 and each test saves a marked-up PNG
 * to ops/workflows/partner-brand-evidence/ — red boxes, numbered, with a
 * legend baked into the image (CLAUDE.md §8). Off by default so the normal run
 * stays fast and writes nothing.
 *
 * No backend. e2e/harness.mjs answers every /api/** call.
 */

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openScreen, PARTNER, OWNER } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "..", "ops", "workflows", "partner-brand-evidence");
const SHOOT = process.env.SHOOT === "1";

/* The Fundhub defaults, from public/app/fundhub-brand.css. These four must come
   back unchanged no matter what brand is applied. */
const FUNDHUB_STATUS = {
  "--alert": "#F2A69B",
  "--warn": "#F5CE8F",
  "--ok": "#A8D8B0",
  "--info": "#A9C6E8"
};

/* One hue, six stops. Exactly what a single-colour brand guideline produces. */
const SINGLE_HUE_RAMP = ["#0A2A55", "#12467F", "#1A62A9", "#2F80C9", "#5FA3DC", "#9BC6EC"];

const PARTNER_BRAND = {
  ok: true,
  brand: {
    org_id: "org-1", slug: "single-hue", entity_name: "Single Hue Capital",
    wordmark_url: null,
    ink: "#0B1F3A", paper: "#F4F7FB", ramp: SINGLE_HUE_RAMP,
    display_face: "Rubik", mono_face: "Roboto Mono"
  }
};

const FUNDHUB_BRAND = {
  ok: true,
  brand: {
    org_id: "org-1", slug: "fundhub", entity_name: "Fundhub",
    wordmark_url: null,
    ink: "#0A0A0A", paper: "#FCFCFC",
    ramp: ["#F2A69B", "#F5CE8F", "#F2E39B", "#A8D8B0", "#A9C6E8", "#C4B3E5"],
    display_face: "Inter", mono_face: "JetBrains Mono"
  }
};

const handlers = (brand) => ({ "/api/org-brand": brand });

/* The four status tokens as the browser actually resolves them, plus the ones
   the brand is allowed to move. Read off the live page, not off the source. */
async function tokens(page) {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const read = (n) => cs.getPropertyValue(n).trim();
    return {
      alert: read("--alert"), warn: read("--warn"), ok: read("--ok"), info: read("--info"),
      ink: read("--ink"), paper: read("--paper"), accent: read("--accent"),
      sans: read("--sans"), spectrum: read("--spectrum")
    };
  });
}

/* mark — draw the red boxes, the numbers and the legend INTO the page, then
   screenshot it. CLAUDE.md §8: an unmarked screenshot is not a deliverable.
   Done in the browser so the marks land in the same pixels as the thing they
   point at, at whatever size it actually rendered. */
async function mark(page, file, marks, title) {
  if (!SHOOT) return;
  await page.evaluate(({ marks, title }) => {
    const layer = document.createElement("div");
    layer.style.cssText =
      "position:absolute;inset:0;z-index:2147483647;pointer-events:none;";
    document.body.appendChild(layer);

    marks.forEach((m, i) => {
      const el = document.querySelector(m.sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const pad = m.pad == null ? 6 : m.pad;
      const box = document.createElement("div");
      box.style.cssText =
        "position:absolute;border:3px solid #E01B1B;border-radius:4px;" +
        `left:${r.left + scrollX - pad}px;top:${r.top + scrollY - pad}px;` +
        `width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;`;
      const tag = document.createElement("div");
      tag.textContent = String(i + 1);
      tag.style.cssText =
        "position:absolute;left:-13px;top:-13px;width:24px;height:24px;" +
        "background:#E01B1B;color:#fff;border-radius:50%;font:700 14px/24px " +
        "system-ui,sans-serif;text-align:center;";
      box.appendChild(tag);
      layer.appendChild(box);
    });

    /* Bottom-left, so the legend never sits on top of the chrome it describes. */
    const legend = document.createElement("div");
    legend.style.cssText =
      "position:absolute;left:16px;top:" + (scrollY + innerHeight - 155) + "px;" +
      "max-width:640px;background:#fff;color:#111;border:3px solid #E01B1B;" +
      "border-radius:6px;padding:12px 14px;font:13px/1.5 system-ui,sans-serif;";
    legend.innerHTML =
      "<div style='font-weight:700;margin-bottom:6px'>" + title + "</div>" +
      marks.map((m, i) =>
        "<div><b style='color:#E01B1B'>" + (i + 1) + ".</b> " + m.caption + "</div>").join("");
    layer.appendChild(legend);
  }, { marks, title });

  await page.screenshot({ path: path.join(SHOTS, file), fullPage: false });
}

test.beforeAll(() => { if (SHOOT) fs.mkdirSync(SHOTS, { recursive: true }); });

test("a partner's own brand reaches the CRM chrome", async ({ page }) => {
  await openScreen(page, "/app/galaxy.html", PARTNER, handlers(PARTNER_BRAND));
  await page.waitForTimeout(700);
  const t = await tokens(page);

  expect(t.ink.toUpperCase(), "the partner's ink did not paint").toBe("#0B1F3A");
  expect(t.paper.toUpperCase(), "the partner's paper did not paint").toBe("#F4F7FB");
  expect(t.accent.toUpperCase(), "the partner's accent did not paint").toBe("#9BC6EC");
  expect(t.sans, "the partner's typeface did not paint").toContain("Rubik");
  expect(t.spectrum, "the partner's ramp did not build the spectrum").toContain("#0A2A55");

  await mark(page, "01-partner-brand-painted.png", [
    { sel: ".legend", caption: "The chrome is painted from the partner's own colours (#0B1F3A / #F4F7FB) and their typeface. Compare shot 3: on Fundhub's brand this bar is near-black, not navy." },
    { sel: "#fh-shell-chip", caption: "Signed in as a partner. This is a partner session, not a staff one — that is what decides whose brand paints." }
  ], "1 of 4 — a partner sees THEIR brand on the CRM (brand: Single Hue Capital)");
});

test("a single-hue partner ramp leaves blocked, behind and healthy distinguishable",
  async ({ page }) => {
    await openScreen(page, "/app/galaxy.html", PARTNER, handlers(PARTNER_BRAND));
    await page.waitForTimeout(700);
    const t = await tokens(page);

    for (const [name, want] of Object.entries(FUNDHUB_STATUS)) {
      const got = t[name.replace("--", "")].toUpperCase();
      expect(got,
        `${name} was repainted by the brand. A single-hue ramp can now make ` +
        `"blocked" and "healthy" the same colour on every screen.`).toBe(want);
    }

    // The plain-language version of the same thing.
    expect(t.alert).not.toBe(t.ok);
    expect(t.alert).not.toBe(t.warn);
    expect(t.warn).not.toBe(t.ok);

    // None of them took a stop straight off the brand ramp.
    const hue = SINGLE_HUE_RAMP.map((s) => s.toUpperCase());
    for (const k of ["alert", "warn", "ok", "info"]) {
      expect(hue, `--${k} took a stop straight off the brand ramp`)
        .not.toContain(t[k].toUpperCase());
    }
  });

test("the three state dots render in three different colours on the partner's screen",
  async ({ page }) => {
    await openScreen(page, "/app/galaxy.html", PARTNER, handlers(PARTNER_BRAND));
    await page.waitForTimeout(700);

    /* galaxy.html's GX-01 legend: .sw.g is --ok ("ahead"), .sw.a is --warn
       ("behind"), .sw.r is --alert ("blocked"). Read the RENDERED colour of
       each dot, not the token. */
    const dots = await page.evaluate(() => {
      const bg = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).backgroundColor : null;
      };
      return { ahead: bg(".sw.g"), behind: bg(".sw.a"), blocked: bg(".sw.r") };
    });

    for (const [state, colour] of Object.entries(dots)) {
      expect(colour, `the "${state}" dot did not render`).toBeTruthy();
    }
    expect(new Set(Object.values(dots)).size,
      "two or more state dots rendered in the SAME colour under a single-hue " +
      "brand — a partner's staff cannot tell blocked from healthy: " +
      JSON.stringify(dots)).toBe(3);

    /* nth-of-type counts only the <i> children and the legend opens with a <b>:
       i1 "size", i2 "brightness", i3 "on pace", i4 "ahead", i5 "behind",
       i6 "blocked". */
    await mark(page, "02-status-colours-survive.png", [
      { sel: ".legend i:nth-of-type(6)", caption: "BLOCKED — still coral. The brand's ramp stop 0 (#0A2A55, dark navy) used to overwrite this dot.", pad: 4 },
      { sel: ".legend i:nth-of-type(5)", caption: "BEHIND — still peach. Ramp stop 1 (#12467F) used to overwrite this dot.", pad: 4 },
      { sel: ".legend i:nth-of-type(4)", caption: "AHEAD — still sage. Ramp stop 3 (#2F80C9) used to overwrite this dot. All three used to be shades of the same blue.", pad: 4 }
    ], "2 of 4 — three states, three colours, under a deliberately single-hue brand");
  });

test("REPRODUCTION: the old paint made all three states the same blue", async ({ page }) => {
  /* The counter-example, so the evidence shows a difference rather than a
     claim. This puts the four deleted lines back — by hand, on the page, after
     the real paint has run — and photographs the result. Nothing in shell.js
     does this any more; if it ever does again, the test above fails first. */
  await openScreen(page, "/app/galaxy.html", PARTNER, handlers(PARTNER_BRAND));
  await page.waitForTimeout(700);

  await page.evaluate((ramp) => {
    const root = document.documentElement;
    root.style.setProperty("--alert", ramp[0]);
    root.style.setProperty("--warn", ramp[1]);
    root.style.setProperty("--ok", ramp[3]);
    root.style.setProperty("--info", ramp[4]);
  }, SINGLE_HUE_RAMP);

  const dots = await page.evaluate(() => {
    const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
    return { ahead: bg(".sw.g"), behind: bg(".sw.a"), blocked: bg(".sw.r") };
  });
  /* Three different values, but all six stops are the same hue, so on screen
     they are three shades of one blue — which is exactly the problem. The
     assertion that matters is that they are no longer the semantic colours. */
  expect(Object.values(dots)).not.toContain("rgb(242, 166, 155)"); // coral

  await mark(page, "04-before-the-fix.png", [
    { sel: ".legend i:nth-of-type(6)", caption: "BLOCKED — repainted to #0A2A55, a dark navy.", pad: 4 },
    { sel: ".legend i:nth-of-type(5)", caption: "BEHIND — repainted to #12467F.", pad: 4 },
    { sel: ".legend i:nth-of-type(4)", caption: "AHEAD — repainted to #2F80C9. Three shades of one blue: a partner's staff cannot tell a blocked file from a healthy one.", pad: 4 }
  ], "REPRODUCTION of the OLD behaviour — this is what shipping the brand change without the status-colour fix would have looked like");
});

test("a staff session still gets the org brand", async ({ page }) => {
  await openScreen(page, "/app/galaxy.html", OWNER, handlers(FUNDHUB_BRAND));
  await page.waitForTimeout(700);
  const t = await tokens(page);

  expect(t.ink.toUpperCase()).toBe("#0A0A0A");
  expect(t.paper.toUpperCase()).toBe("#FCFCFC");
  expect(t.sans).toContain("ui-rounded");
  for (const [name, want] of Object.entries(FUNDHUB_STATUS)) {
    expect(t[name.replace("--", "")].toUpperCase(),
      `${name} moved on a staff screen`).toBe(want);
  }

  await mark(page, "03-staff-unchanged.png", [
    { sel: "#fh-shell-chip", caption: "A Fundhub STAFF session on the same screen. The chrome is Fundhub's own — near-black ink, not the partner's navy." },
    { sel: ".legend i:nth-of-type(6)", caption: "BLOCKED — coral, as always.", pad: 4 },
    { sel: ".legend i:nth-of-type(5)", caption: "BEHIND — peach, as always.", pad: 4 },
    { sel: ".legend i:nth-of-type(4)", caption: "AHEAD — sage, as always. Nothing a staff member sees moved.", pad: 4 }
  ], "3 of 4 — Fundhub staff are unaffected");
});
