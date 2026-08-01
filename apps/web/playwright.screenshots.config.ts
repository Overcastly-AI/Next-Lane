import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for PRODUCT SCREENSHOT capture — not testing.
 *
 * Separate from `playwright.config.ts` so the capture run can differ where it
 * has to and cannot leak into CI:
 *   - `testMatch` targets `*.capture.ts`, which the test config never matches;
 *   - `deviceScaleFactor: 2` for retina-quality PNGs, which would only slow
 *     the real suite down;
 *   - `reducedMotion` is NOT forced, because animated surfaces (the knowledge
 *     graph's force layout) should be captured in their settled state rather
 *     than their skipped one;
 *   - one worker, because two browsers writing the same output directory is
 *     the sort of thing that produces one torn PNG per reshoot.
 *
 * Viewports match the existing set in `docs/screenshots/README.md`: desktop
 * 1440x900 @2x, mobile 393x852 @2x. Changing them makes the new shots
 * inconsistent with the ones not being reshot, so don't, unless reshooting all.
 */
const chromiumPath = process.env.PW_CHROMIUM_PATH;
const launchOptions = chromiumPath ? { executablePath: chromiumPath } : {};

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.capture\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.PW_BASE_URL ?? 'http://localhost:3000',
    launchOptions,
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: process.env.PW_NO_WEBSERVER
    ? undefined
    : {
        command: 'pnpm exec vite preview --port 3000 --strictPort',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
