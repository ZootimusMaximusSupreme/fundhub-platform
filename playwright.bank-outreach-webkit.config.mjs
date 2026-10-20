// Required native WebKit geometry proof. Fictional API data; no live backend.
// Separate from the default Chromium collection so neither engine is skipped.
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT || 43147);
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/bank-outreach-webkit.proof.mjs',
  forbidOnly: Boolean(process.env.CI),
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'line',
  webServer: {
    command: 'node e2e/static-server.mjs',
    env: { E2E_PORT: String(port) },
    url: `http://127.0.0.1:${port}/app/bank-outreach.html`,
    reuseExistingServer: false,
    timeout: 20000,
    stdout: 'ignore',
    stderr: 'pipe'
  },
  use: {
    ...devices['iPhone 17 Pro Max'],
    browserName: 'webkit',
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'outreach-webkit-390', use: { viewport: { width: 390, height: 844 } } },
    { name: 'outreach-webkit-440', use: { viewport: { width: 440, height: 763 } } },
    { name: 'outreach-webkit-landscape', use: { viewport: { width: 838, height: 390 } } }
  ]
});
