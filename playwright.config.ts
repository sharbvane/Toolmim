import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const chrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform === 'win32' && process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe') : '');
export default defineConfig({
  testDir: './tests/e2e', workers: 1, timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:4320', viewport: { width: 1440, height: 1024 }, launchOptions: fs.existsSync(chrome) ? { executablePath: chrome } : {}, screenshot: 'only-on-failure' },
  webServer: { command: 'npm start', url: 'http://127.0.0.1:4320/api/health', timeout: 60_000, reuseExistingServer: false,
    env: { TOOLMIM_PORT: '4320', TOOLMIM_DATA: 'test-results/app-data' } },
});
