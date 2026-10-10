// Teleprompter pocket remote — Play, Pause, pick a script, edit, Save words.
//
// The remote is a phone page opened with the shoot's film key (?k=). Its Save
// words posts a new script version through the same edit route the iPad uses.
// The list said only the play maths were tested; no browser pressed the
// buttons. This presses them: the film key rides in its own header (no
// sign-in sent), the first script not marked Got it opens, Play moves the words
// and Pause stops them, and Save sends the exact edit and handles "the iPad has
// newer words".

import { test, expect } from "@playwright/test";

const SHOOT = {
  ok: true, wpm: 150,
  shoot: { scripts: [
    { id: "s1", version: 3, ad_id: 7, angle_name: "Haynes, the call that was never a roadmap", body: "Done script words.", got_it: true },
    { id: "s2", version: 5, ad_id: 8, angle_name: "The bank said no", body: "One two three four five six seven eight nine ten.", got_it: false }
  ] }
};

async function open(page, { query = "?k=film-key-abc", editAnswer } = {}) {
  const calls = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    calls.push({ url: req.url(), method: req.method(), headers: req.headers(), body: req.method() === "POST" ? req.postDataJSON() : null });
    if (req.url().includes("/api/marketing/scripts/edit")) {
      const out = editAnswer ? editAnswer(req.postDataJSON()) : { status: 200, body: { ok: true, script: { id: "s2", version: 6, body: req.postDataJSON().body } } };
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    }
    if (req.url().includes("/api/marketing/shoot")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SHOOT) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(`/app/teleprompter-remote.html${query}`);
  return { calls };
}

test.describe("teleprompter pocket remote", () => {
  test("opens the first script not marked Got it, asking with the film key header and no sign-in", async ({ page }) => {
    const { calls } = await open(page);
    await expect(page.locator("#remote-title")).toHaveText("The bank said no");
    await expect(page.locator("#remote-body")).toHaveValue("One two three four five six seven eight nine ten.");
    const read = calls.find((c) => c.url.includes("/api/marketing/shoot"));
    expect(read.headers["x-shoot-film"]).toBe("film-key-abc");
    expect(read.headers.authorization).toBeUndefined();
    await expect(page.locator("#remote-ipad")).toHaveAttribute("href", "/app/teleprompter.html?k=film-key-abc&mirror=1");
    await expect(page.locator("#remote-script")).toBeVisible();
  });

  test("Play moves the words on this phone; Pause stops them where they are", async ({ page }) => {
    await open(page);
    await expect(page.locator("#remote-roll .now")).toHaveText("One ");
    await page.locator("#remote-play").click();
    await expect(page.locator("#remote-play")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#remote-roll .now")).not.toHaveText("One ", { timeout: 3000 });
    await page.locator("#remote-play").click();
    await expect(page.locator("#remote-play")).toHaveText("Play");
    const stoppedAt = await page.locator("#remote-roll .now").textContent();
    await page.waitForTimeout(700);
    await expect(page.locator("#remote-roll .now")).toHaveText(stoppedAt);
  });

  test("picking another script shows its words", async ({ page }) => {
    await open(page);
    await page.locator("#remote-script").selectOption("0");
    await expect(page.locator("#remote-body")).toHaveValue("Done script words.");
    await expect(page.locator("#remote-title")).toHaveText("Haynes, the call that was never a roadmap");
  });

  test("Save words sends the new words as the next version of that script", async ({ page }) => {
    const { calls } = await open(page);
    await page.locator("#remote-body").fill("One two three, now with a better hook.");
    await page.locator("#remote-save").click();
    await expect(page.locator("#remote-status")).toHaveText("Saved. The iPad shows these words the next time its words are paused.");
    const edit = calls.find((c) => c.url.includes("/api/marketing/scripts/edit"));
    expect(edit.method).toBe("POST");
    expect(edit.headers["x-shoot-film"]).toBe("film-key-abc");
    expect(edit.body.id).toBe("s2");
    expect(edit.body.version).toBe(5);
    expect(edit.body.body).toBe("One two three, now with a better hook.");
    expect(typeof edit.body.request_id).toBe("string");
  });

  test("no change, or empty words, saves nothing", async ({ page }) => {
    const { calls } = await open(page);
    await page.locator("#remote-save").click();
    await expect(page.locator("#remote-status")).toHaveText("No change to save.");
    await page.locator("#remote-body").fill("   ");
    await page.locator("#remote-save").click();
    await expect(page.locator("#remote-status")).toHaveText("The script is empty. Nothing was saved.");
    expect(calls.filter((c) => c.url.includes("/scripts/edit"))).toEqual([]);
  });

  test("the iPad has newer words: the save is refused and says to reload", async ({ page }) => {
    await open(page, { editAnswer: () => ({ status: 409, body: { ok: false, error: "version_conflict" } }) });
    await page.locator("#remote-body").fill("Different words.");
    await page.locator("#remote-save").click();
    await expect(page.locator("#remote-status")).toHaveText("The iPad has newer words. Load this page again, then save.");
  });

  test("a link with no film key says so", async ({ page }) => {
    await page.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, shoot: { scripts: [] } }) }));
    await page.goto("/app/teleprompter-remote.html");
    await expect(page.locator("#remote-status")).toHaveText("This link has no film key. Open it from the shoot.");
  });
});
