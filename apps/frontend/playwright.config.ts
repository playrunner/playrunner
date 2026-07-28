import { defineConfig, devices } from '@playwright/test';

const isCi = Boolean(process.env.CI);
const slowMo = Number(process.env.PLAYRUNNER_E2E_SLOW_MO ?? 0);

if (!Number.isFinite(slowMo) || slowMo < 0) {
  throw new Error('PLAYRUNNER_E2E_SLOW_MO must be a non-negative number.');
}

export default defineConfig({
  testDir: './e2e/specs',
  timeout: slowMo > 0 ? 120_000 : 30_000,
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  workers: 1,
  reporter: isCi
    ? [
        ['line'],
        ['junit', { outputFile: 'test-results/e2e-junit.xml' }],
        ['html', { open: 'never', outputFolder: '../../playwright-report' }],
      ]
    : [
        ['list'],
        ['html', { open: 'never', outputFolder: '../../playwright-report' }],
      ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { slowMo },
      },
    },
  ],
  webServer: [
    {
      command: 'npm run dev:e2e --prefix ../api',
      url: 'http://127.0.0.1:3999/health',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev:e2e',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
