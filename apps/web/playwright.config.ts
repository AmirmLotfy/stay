import { defineConfig, devices } from '@playwright/test';

const liveBaseUrl = process.env.STAY_E2E_BASE_URL;
const liveBrowserPath = process.env.STAY_BROWSER_PATH;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: liveBaseUrl ?? 'http://127.0.0.1:3000',
    ...(liveBrowserPath ? { launchOptions: { executablePath: liveBrowserPath } } : {}),
    trace: 'on-first-retry',
  },
  ...(liveBaseUrl
    ? {}
    : {
        webServer: {
          command: 'pnpm dev',
          url: 'http://127.0.0.1:3000',
          reuseExistingServer: !process.env.CI,
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
