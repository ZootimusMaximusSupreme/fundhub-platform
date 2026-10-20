import offline from "./playwright.config.mjs";

if (process.env.UX_POLISH_SHOTS === "1") {
  throw new Error("Live proof must not replace deployed assets with the local before version.");
}

export default {
  ...offline,
  testDir: "./ops/workflows/dashboard-ux-polish",
  testMatch: "live-deployed.spec.mjs",
  testIgnore: [],
  webServer: undefined,
  timeout: 45_000,
  outputDir: "/private/tmp/dashboard-polish-live-results",
  reporter: [["list"], ["json", { outputFile: "ops/workflows/dashboard-ux-polish/evidence/live-results.json" }]],
  use: { ...offline.use, baseURL: "https://fundhub.ai", serviceWorkers: "block" }
};
