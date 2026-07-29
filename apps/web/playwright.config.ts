import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for Next Lane QA / user-acceptance testing.
 * Runs every spec on desktop AND mobile viewports.
 *
 * Preconditions: the API must be running on :4000 with seeded demo data.
 * The web app is started automatically via the `webServer` block below
 * (set PW_NO_WEBSERVER=1 to test against an already-running web server).
 *
 * Start the API for e2e with rate limiting and the webhook SSRF guard relaxed —
 * the suite logs in/registers far more than 10/min from one IP, and the webhook
 * spec delivers to a localhost mock:
 *   RATE_LIMIT_DISABLED=true WEBHOOK_ALLOW_PRIVATE=true node dist/main.js
 * (These default to OFF/strict in production.)
 */
const WEB_PORT = Number(process.env.PW_WEB_PORT ?? 3000);
const BASE_URL = process.env.PW_BASE_URL ?? `http://localhost:${WEB_PORT}`;

// In sandboxes where a Chromium build is pre-installed but its revision doesn't
// match this Playwright version, point at it explicitly via PW_CHROMIUM_PATH.
// Left unset in normal environments so Playwright uses its managed browser.
const chromiumPath = process.env.PW_CHROMIUM_PATH;
const launchOptions = chromiumPath ? { executablePath: chromiumPath } : {};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // On CI add the `github` reporter: it emits failures as workflow
  // annotations, which surface on the PR and via the checks API. The HTML
  // report is an artifact that can only be read by downloading it, so when a
  // run goes red the annotations are the only machine-readable account of
  // WHICH spec failed and why.
  // The `json` report is what `scripts/summarize-playwright.mjs` turns into a
  // compact failing-test list printed at the very END of the CI job — the only
  // form of the results that survives a tail-only log read (see that script's
  // header for why the html/github/annotation routes all fail us here).
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never' }],
        ['github'],
        ['json', { outputFile: 'playwright-report/results.json' }],
      ]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Exercise the reduced-motion path and remove entrance-animation flakiness:
    // modal/drawer/toast animations are disabled under prefers-reduced-motion,
    // so elements are click-stable immediately (no mid-animation hit-test races).
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions,
      },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'], launchOptions },
    },
  ],
  webServer: process.env.PW_NO_WEBSERVER
    ? undefined
    : {
        command: `pnpm exec vite preview --port ${WEB_PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
