// Controls the owner deliberately removed: the staff booked-text switch and two
// teleprompter controls (finish-the-853, batch 21).
//
// The coverage map retains the removed teleprompter controls:
//
//   - the edit bar ("Put back", "History", "Done", the X and Save of a cursor edit). The owner call of
//     2026-10-13 made editing on the phone copy-and-paste only: "we just edit and copy and paste",
//     "delete the history button" (docs/journeys/CHANGELOG.md, docs/journeys/shoot-flow.md section 4b).
//     beginEdit() and placeCaret() are still in the file but nothing calls them, so no cursor and no
//     edit bar can open.
//   - the header bar (the "Shoot tab" link, "Copy name", the offline banner, the camera line). The owner
//     hid the whole top bar on 2026-10-07 so the words start at the top (commit 1802d6a94, and the
//     comment above the rule in teleprompter.css).
//
// "Nothing to judge" is only true while the control stays gone. So each row names the live files to read
// (GET only) and what must NOT be in them. The day a caller of beginEdit() appears, or the stylesheet
// shows the bar again, the claim fails and the row goes red by name, and it stays red until a real check
// is attached. A file that cannot be read is "skip", never nothing-to-judge. A file that reads fine but no
// longer looks like the file this was written for is FAIL, because the claim cannot be re-checked.
//
// NOT on this list on purpose: the Settings sheet and the "This shoot" list. Those were never retired by
// a decision. The journey docs and the spec still say Learn remote and Settings exist, and nothing on the
// glass opens them. That is a hole for Chris, not a row with nothing to judge.
//
// READ ONLY. GET only, and the GET itself is made by the display lane (gap-catalog-display.mjs), which is the
// file of the pulse allowed to reach the network. This file only judges the text it is handed. No repo file
// is read at run time: the live files arrive over HTTP.

export const OWNER_REMOVED_CODE = "catalog-display-owner-removed";

const SOURCE_FILE = "desks-f.json";
const SURFACE = "teleprompter.html (+ teleprompter.js, teleprompter-edits.js)";

/** How many times a pattern shows in the text. The pattern must carry the g flag. */
const times = (pattern) => (text) => (text.match(pattern) || []).length;

const HISTORY_BUTTON = { name: "a History button", test: /["'>]\s*History\s*["'<]/ };

export const OWNER_REMOVED = Object.freeze([
  {
    sourceFile: SOURCE_FILE,
    surface: "staff-teams.html",
    control: "Editor switch: 'Text when a call is booked' (sends the client's name, phone, email, typed score and survey answers to this person's phone)",
    removed: "the owner made booked and new-lead texts automatic for setters and owner, so the old per-person booked-call switch was removed",
    pages: Object.freeze([{
      path: "/app/staff-teams.html",
      mustHave: /id="editor"/,
      mustLack: Object.freeze([
        { name: "the retired booked-call text switch", test: /id="ed_booked_sms"/ },
        { name: "the old booked-call text choice", test: /Text when a call is booked/ },
      ]),
    }]),
  },
  {
    sourceFile: SOURCE_FILE,
    surface: SURFACE,
    control: "Edit bar while a cursor is open: 'Put back', 'History', 'Done', plus the X (throws away this edit) and 'Save' (visible only while editing)",
    removed: "editing words on the phone was taken out by owner call 2026-10-13 (copy and paste only), so no cursor and no edit bar can open",
    pages: Object.freeze([
      {
        path: "/app/teleprompter.js",
        mustHave: /__fhtp\s*=\s*\{/,
        mustLack: Object.freeze([
          { name: "a call that opens the edit bar (beginEdit)", test: /(?<!function\s+)\bbeginEdit\s*\(/ },
          { name: "a call that puts a cursor in the words (placeCaret)", test: /(?<!function\s+)\bplaceCaret\s*\(/ },
          // beginEdit() is the one place the editing state is set, and placeCaret() the one place the
          // wording class goes on. A second place means editing came back under another name.
          { name: "a second place that opens an edit", test: (text) => times(/\bediting\s*=\s*\{/g)(text) > 1 },
          { name: "a second place that puts the words in edit mode", test: (text) => times(/classList\.add\(\s*["']wording["']\s*\)/g)(text) > 1 },
          HISTORY_BUTTON,
        ]),
      },
      {
        path: "/app/teleprompter.html",
        mustHave: /id="stage"/,
        mustLack: Object.freeze([HISTORY_BUTTON]),
      },
    ]),
  },
  {
    sourceFile: SOURCE_FILE,
    surface: SURFACE,
    control: "Header bar: 'Shoot tab' link, 'Copy name' button, offline banner, camera line",
    removed: "the owner hid the whole top bar on purpose on 2026-10-07 so the words start at the top, and the stylesheet still hides it",
    pages: Object.freeze([
      {
        path: "/app/teleprompter.css",
        mustHave: /(?:^|[}\s,])#top\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/m,
        mustLack: Object.freeze([
          { name: "a rule that shows the top bar again", test: /(?:^|[}\s,])(?:header)?#top\s*\{[^}]*display:\s*(?:block|flex|grid|inline|contents)/m },
        ]),
      },
      {
        path: "/app/teleprompter.html",
        mustHave: /id="stage"/,
        mustLack: Object.freeze([
          { name: "a top bar that is shown by its own style", test: /<header\b[^>]*id="top"[^>]*style="[^"]*display:\s*(?:block|flex|grid|inline)/ },
        ]),
      },
    ]),
  },
]);

const keyOf = (item) => `${item?.sourceFile}\0${item?.surface}\0${item?.control}`;
const BY_KEY = new Map(OWNER_REMOVED.map((item) => [keyOf(item), item]));

/** The owner-removed record for a catalog entry (or for na args), or null. */
export function ownerRemovedFor(item) {
  return (item && BY_KEY.get(keyOf(item))) || null;
}

const found = (text, item) => (typeof item.test === "function" ? item.test(text) : item.test.test(text));

async function judgePage(page, get) {
  const got = await get(page.path);
  if (!got.ok) return { status: "skip", detail: got.why };
  if (!page.mustHave.test(got.text)) {
    return {
      status: "FAIL",
      detail: `${page.path} no longer looks like the file this check was written for, so "the control is gone" cannot be re-checked. Look at it and judge the control again.`,
    };
  }
  const back = page.mustLack.find((item) => found(got.text, item));
  if (back) return { status: "FAIL", detail: `${page.path} holds ${back.name} again. The control is back and has no proof attached.` };
  return { status: "na" };
}

/**
 * Judge one owner-removed control against the live files.
 *   reader.get(path)  one GET of a live file, never throws: { ok: true, text } or { ok: false, why }.
 *                     null means "this run has no GET client". The lane builds it (it is the one file
 *                     of the pulse allowed to reach the network); this file never does.
 *   reader.base       the site address, or null when it is not usable
 *   reader.cache      optional Map shared by the controls of one run, so a file is read once
 * Returns { status: "na" | "FAIL" | "skip", detail }.
 */
export async function ownerRemovedState(removed, reader = {}) {
  if (typeof reader.get !== "function") {
    return { status: "skip", detail: `${removed.control}: not re-checked, this run has no GET client.` };
  }
  if (!reader.base) {
    return { status: "skip", detail: `${removed.control}: not re-checked, the site address is not usable.` };
  }
  const cache = reader.cache || new Map();
  const get = (path) => {
    if (!cache.has(path)) cache.set(path, reader.get(path));
    return cache.get(path);
  };
  const seen = await Promise.all(removed.pages.map((page) => judgePage(page, get)));
  const worst = seen.find((item) => item.status === "FAIL") || seen.find((item) => item.status === "skip");
  if (worst) return { status: worst.status, detail: `${removed.control}: ${worst.detail}` };
  return {
    status: "na",
    detail: `${removed.control}: ${removed.removed}. The live ${removed.pages.map((p) => p.path).join(" and ")} still hold none of it, so there is nothing to judge.`,
  };
}

/**
 * The lane rows for every tracked entry that is on the list. A Map from the entry id to the row. Each
 * live file is read once per run, however many rows name it.
 */
export async function ownerRemovedResults(entries, reader = {}) {
  const out = new Map();
  const shared = { ...reader, cache: new Map() };
  await Promise.all(entries.map(async (entry) => {
    const removed = ownerRemovedFor(entry);
    if (!removed) return;
    const state = await ownerRemovedState(removed, shared);
    if (state.status === "na") {
      out.set(entry.id, {
        id: entry.id,
        status: "na",
        detail: state.detail,
        suggestedFix: null,
        na: {
          code: OWNER_REMOVED_CODE,
          args: { sourceFile: entry.sourceFile, surface: entry.surface, control: entry.control },
        },
      });
      return;
    }
    out.set(entry.id, {
      id: entry.id,
      status: state.status,
      detail: state.detail,
      suggestedFix: state.status === "FAIL"
        ? "Open the named control and attach a real check to it, or take it out again. Do not auto-fix. Chris fixes reds."
        : null,
    });
  }));
  return out;
}
