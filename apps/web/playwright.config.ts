import { defineConfig, devices } from '@playwright/test';

const liveBaseUrl = process.env.STAY_E2E_BASE_URL;
const liveBrowserPath = process.env.STAY_BROWSER_PATH;
const localBaseUrl = 'http://127.0.0.1:3107';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  timeout: liveBaseUrl ? 180_000 : 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  expect: { timeout: liveBaseUrl ? 30_000 : 5_000 },
  use: {
    baseURL: liveBaseUrl ?? localBaseUrl,
    ...(liveBrowserPath ? { launchOptions: { executablePath: liveBrowserPath } } : {}),
    trace: 'on-first-retry',
  },
  ...(liveBaseUrl
    ? {}
    : {
        webServer: {
          command: 'pnpm dev --port 3107',
          url: localBaseUrl,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'echo-show-8', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'echo-show-15', use: { viewport: { width: 1920, height: 1080 } } },
  ],
});
