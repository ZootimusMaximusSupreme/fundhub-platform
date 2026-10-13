import path from "node:path";
import { fileURLToPath } from "node:url";
import base from "./playwright.config.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const core = [
  "Ad preview reports the granted 30 fps camera rate",
  "camera quality badge follows the granted rate when switching lenses during a take",
  "Still to film keeps each title, take detail, and hook on its own line",
  "VSL preview reports the granted 30 fps camera rate",
  "VSL preview reports the granted 60 fps camera rate",
  "camera quality badge says fps unavailable when the track omits its rate",
  "the original take can be watched and shared before and after device-first save",
  "No discards the pending take without a Watch action or upload",
  "Watch stays away during a paused recording and returns for the prior saved take",
  "reopening offers Watch for the latest take still queued on this phone",
  "quick Yes and reload cancels the preview load without a page error"
];
const conflict = [
  "offline: the edit waits on this phone, lives through a reload, then goes once with the same request_id",
  "409: the filming screen stays clear, and History lets Chris keep his words",
  "409: using saved words keeps the exact phone edit in History",
  "history: who changed what and when, and whether the repo has it"
];
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cases = {
  ui: new RegExp(`(?:${core.map(escape).join("|")})$|teleprompter on an iPhone \\(touch\\) (?:${conflict.map(escape).join("|")})$`),
  ad60: /Ad preview reports the granted 60 fps camera rate$/,
  rear4k: /full 4K GPU recording preserves portrait pixels and one take across lens changes$/
};
const selectedCase = process.env.FHTP_LIVE_CASE || "ui";
if (!Object.hasOwn(cases, selectedCase)) throw new Error(`Unknown live UI case: ${selectedCase}`);
const resultTag = process.env.FHTP_LIVE_TAG || "";
if (resultTag && !/^[a-f0-9]{8}$/.test(resultTag)) throw new Error("FHTP_LIVE_TAG must be an 8-character commit prefix");
const resultName = `fundhub-live-${selectedCase === "ui" ? "final-ui" : selectedCase === "ad60" ? "ad60" : "rear4k"}-results${resultTag ? `-${resultTag}` : ""}.json`;

export default {
  ...base,
  testDir: path.join(root, "e2e"),
  testMatch: [
    "**/teleprompter-take-flow.spec.mjs",
    "**/teleprompter-local-preview.spec.mjs",
    "**/teleprompter-touch.spec.mjs"
  ],
  outputDir: path.join(root, "test-results", "teleprompter-live"),
  webServer: undefined,
  grep: cases[selectedCase],
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(root, "docs", "workflows", "teleprompter-video-2026-10-12-evidence", resultName) }]
  ],
  use: {
    ...base.use,
    baseURL: "https://fundhub.ai",
    browserName: "webkit",
    permissions: [],
    launchOptions: {}
  },
  projects: [{ name: "live-webkit" }]
};
