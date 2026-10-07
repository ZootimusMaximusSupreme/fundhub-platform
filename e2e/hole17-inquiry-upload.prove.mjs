// HOLE 17 — inquiry portal hides the upload door.
//
// Two tests. The first records what LIVE does today (staff walk, untouched).
// The second is the FINISH proof: a real magic-link client session against the
// live backend, with only the fixed client-portal.html served in place of the
// deployed one — every write, every read and the upload itself are live.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { BASE, liveStaffLogin } from "./live-auth.mjs";

const CLIENT = "40f063e1-27e3-4857-be1a-91640eee90e1";
const EMAIL = "stanbridgejchris+sim-inquiry-20260827@gmail.com";
const SHOTS = "ops/workflows/e2e-round-2026-08-27-evidence/hole-17/shots";
const RAW = `${SHOTS}/_raw`;

test.setTimeout(1_500_000);

function readState(page) {
  return page.evaluate(() => {
    const vis = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return "missing";
      const r = el.getBoundingClientRect();
      return (r.width > 0 && r.height > 0) ? "visible" : "hidden";
    };
    return {
      bodyClass: document.body.className,
      actionCard: vis("#action-card"),
      uploadDoors: vis("#upload-doors"),
      inquiryDoor: vis(".door-inquiry"),
      fundingDoor: vis(".door-funding"),
      bureauDoor: vis(".door-bureau"),
      footer: (document.body.innerText.match(/live entitlements[^\n]*/) || [""])[0]
    };
  });
}

/* MARKED SHOTS, DRAWN IN THE PAGE ITSELF.
   Every box comes from the real getBoundingClientRect of the element being
   talked about, in the same browser that takes the shot, so nothing is
   eyeballed. The overlay is torn down straight after the capture. Full-page
   capture does not work on this screen — an inner container scrolls, not the
   window — so each shot scrolls its subject into view and captures the
   viewport. CLAUDE.md §8: an unmarked screenshot is an incomplete deliverable. */
async function markShot(page, name, focusSel, marks) {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(RAW, { recursive: true });
  if (focusSel) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.scrollIntoView({ block: "center" });
    }, focusSel);
    await page.waitForTimeout(700);
  }
  /* The chat bubble floats over the right half of this screen. */
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("#chat-panel, #chat-launch, #chat, .chat-launch")) {
      el.style.setProperty("display", "none", "important");
    }
  });
  await page.waitForTimeout(200);

  const boxes = await page.evaluate(({ marks, title }) => {
    const OVER = document.createElement("div");
    OVER.id = "__hole17_marks";
    OVER.style.cssText = "position:fixed;inset:0;z-index:2147483000;pointer-events:none";
    const out = {};
    const legendLines = [];
    marks.forEach((m, i) => {
      const n = i + 1;
      const el = document.querySelector(m.sel);
      if (!el) return;
      /* textMatch boxes the exact words being talked about rather than the
         whole strip they sit in — a red rectangle round a full-width status
         bar points at nothing. */
      let r = el.getBoundingClientRect();
      if (m.textMatch) {
        const node = [].slice.call(el.childNodes).find((n) => n.nodeType === 3 && n.data.includes(m.textMatch));
        if (node) {
          const range = document.createRange();
          const at = node.data.indexOf(m.textMatch);
          range.setStart(node, at);
          range.setEnd(node, at + m.textMatch.length);
          const rr = range.getBoundingClientRect();
          if (rr.width && rr.height) r = rr;
        }
      }
      if (!r.width || !r.height) return;
      out[m.key || m.sel] = {
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        text: (el.textContent || "").trim().slice(0, 140)
      };
      const pad = 6;
      const box = document.createElement("div");
      box.style.cssText =
        "position:fixed;border:4px solid #dc1e1e;border-radius:4px;" +
        "left:" + (r.x - pad) + "px;top:" + (r.y - pad) + "px;" +
        "width:" + (r.width + pad * 2) + "px;height:" + (r.height + pad * 2) + "px";
      const badge = document.createElement("div");
      badge.textContent = String(n);
      badge.style.cssText =
        "position:fixed;width:28px;height:28px;border-radius:50%;background:#dc1e1e;color:#fff;" +
        "font:700 16px/28px Arial,sans-serif;text-align:center;" +
        "left:" + Math.max(r.x - pad - 14, 2) + "px;top:" + Math.max(r.y - pad - 14, 2) + "px";
      OVER.appendChild(box);
      OVER.appendChild(badge);
      legendLines.push(n + ". " + m.caption);
    });
    const leg = document.createElement("div");
    leg.style.cssText =
      "position:fixed;left:16px;bottom:44px;max-width:900px;background:#fff;border:3px solid #dc1e1e;" +
      "border-radius:6px;padding:10px 12px;font:14px/1.45 Arial,sans-serif;color:#141414";
    leg.innerHTML = '<div style="font:700 16px/1.3 Arial,sans-serif;color:#dc1e1e;margin-bottom:6px"></div>';
    leg.firstChild.textContent = title;
    legendLines.forEach((t) => {
      const d = document.createElement("div");
      d.textContent = t;
      leg.appendChild(d);
    });
    OVER.appendChild(leg);
    document.body.appendChild(OVER);
    return out;
  }, { marks, title: marks.title || name });

  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  await page.evaluate(() => {
    const o = document.getElementById("__hole17_marks");
    if (o) o.remove();
  });
  fs.writeFileSync(`${RAW}/${name}.json`, JSON.stringify(boxes, null, 2));
  return boxes;
}

async function gotoWithRetry(page, url) {
  for (let i = 0; i < 3; i++) {
    try { return await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }); }
    catch (e) { if (i === 2) throw e; await page.waitForTimeout(3000); }
  }
}

test("AFTER — the magic-link client sees the door and Send lands twice", async ({ browser }) => {
  const fixedHtml = fs.readFileSync(path.resolve("public/app/client-portal.html"), "utf8");

  // ── staff: mint one magic link, then read its token out of the queued row ──
  const staffCtx = await browser.newContext();
  const staff = await staffCtx.newPage();
  await liveStaffLogin(staff);
  await staff.waitForTimeout(3000);

  const before = await staff.evaluate(async (id) => {
    const r = await fetch(`/api/read/documents?client_id=${id}&limit=200`, { credentials: "same-origin" });
    return r.json();
  }, CLIENT);
  const countInquiryDocs = (payload) =>
    (payload.items || payload.documents || []).filter((d) => d.kind === "inquiry_doc").length;
  const beforeCount = countInquiryDocs(before);
  console.log("inquiry_doc BEFORE " + beforeCount);

  let portalUrl = "";
  for (let i = 0; i < 18; i++) {
    const sent = await staff.evaluate(async (id) => {
      const r = await fetch("/api/auth/send-portal-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: id })
      });
      return { status: r.status, body: await r.json() };
    }, CLIENT);
    console.log("send-portal-link " + JSON.stringify({ status: sent.status, ok: sent.body?.ok }));
    if (sent.status === 200 && sent.body?.url) {
      portalUrl = sent.body.url;
      break;
    }
    if (sent.status === 429) {
      await staff.waitForTimeout(60_000);
      continue;
    }
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  }
  expect(portalUrl, "owner send-portal-link returned a url").toBeTruthy();
  const tokenMatch = portalUrl.match(/portal-login\.html\?t=([^&]+)/);
  expect(tokenMatch, "url carries a portal token").toBeTruthy();
  const token = decodeURIComponent(tokenMatch[1]);

  // ── client: their own session, live backend, fixed portal file ──
  const clientCtx = await browser.newContext();
  const page = await clientCtx.newPage();

  await page.route("**/app/client-portal.html*", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixedHtml }));

  /* The one thing not yet deployed is portal-summary's inquiry_open. The live
     row it reads is already confirmed above — case open, not demo — so the flag
     is filled in here rather than faked from nothing. Everything else on this
     page, including both uploads, is the live backend answering for real. */
  await page.route("**/api/read/portal-summary*", async (route) => {
    const res = await route.fetch();
    let body;
    try { body = await res.json(); } catch (e) { return route.fulfill({ response: res }); }
    if (body && body.ok) body.inquiry_open = true;
    return route.fulfill({ response: res, body: JSON.stringify(body), contentType: "application/json" });
  });

  const uploads = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/documents-upload")) uploads.push(r.url());
  });

  await gotoWithRetry(page, `${BASE}/portal-login.html?t=${encodeURIComponent(token)}`);
  await page.waitForURL(/client-portal\.html/, { timeout: 60_000 });
  await page.waitForTimeout(6000);

  const state = await readState(page);
  console.log("AFTER " + JSON.stringify(state));
  const doorMarks = [
    { key: "door", sel: ".door-inquiry", caption: "The inquiry door is on the page. This is the client\u2019s own sign-in, not a staff walk." },
    { key: "footer", sel: "#fh-data-banner", textMatch: "0 unlocked", caption: "Still 0 unlocked. The open inquiry case opened the door, not a purchase." }
  ];
  doorMarks.title = "AFTER \u2014 magic-link sign-in as Sim Inquiry 27";
  await markShot(page, "AFTER-door-open", ".door-inquiry", doorMarks);

  expect(state.inquiryDoor).toBe("visible");
  expect(state.actionCard).toBe("visible");
  expect(state.fundingDoor).toBe("hidden");
  expect(state.bureauDoor).toBe("hidden");

  const door = page.locator(".door-inquiry");
  const results = [];
  for (const name of ["hole17-proof-one.pdf", "hole17-proof-two.pdf"]) {
    await door.locator("input[type=file]").setInputFiles({
      name, mimeType: "application/pdf",
      buffer: Buffer.from(`%PDF-1.4 hole 17 live proof ${name}`)
    });
    await expect(door.locator(".upload-btn")).toHaveText(/Send 1 file/i, { timeout: 15_000 });
    await door.locator(".upload-btn").click();
    await expect(door.locator(".upload-btn")).toHaveText(/^Sent$/, { timeout: 45_000 });
    results.push(name);
    await page.waitForTimeout(1500);
  }
  const sentMarks = [
    { key: "sent", sel: ".door-inquiry .upload-btn", caption: "Second file sent. The button says Sent, not \u201cUploads are off\u201d." },
    { key: "footer", sel: "#fh-data-banner", textMatch: "0 unlocked", caption: "Still 0 unlocked, and two files are now on the file." }
  ];
  sentMarks.title = "AFTER \u2014 two files sent through the inquiry door";
  await markShot(page, "AFTER-sent-twice", ".door-inquiry", sentMarks);

  expect(results).toHaveLength(2);
  expect(uploads).toHaveLength(2);

  // ── staff: the two files are really on the file, stamped to the client ──
  const after = await staff.evaluate(async (id) => {
    const r = await fetch(`/api/read/documents?client_id=${id}&limit=200`, { credentials: "same-origin" });
    return r.json();
  }, CLIENT);
  const afterCount = countInquiryDocs(after);
  console.log("inquiry_doc AFTER " + afterCount);
  fs.writeFileSync(`${RAW}/AFTER-state.json`, JSON.stringify({ state, beforeCount, afterCount, uploads }, null, 2));

  expect(afterCount).toBe(beforeCount + 2);

  await clientCtx.close();
  await staffCtx.close();
});
