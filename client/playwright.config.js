import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173', channel: 'msedge', headless: true },
});
