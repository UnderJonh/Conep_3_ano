import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 150_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  outputDir: join(tmpdir(), 'conep-playwright-results'),
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 1000 }, headless: true },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
});
