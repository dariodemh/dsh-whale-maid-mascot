import { defineConfig } from '@playwright/test'

// Set WHM_BROWSER_CHANNEL=msedge (or chrome) to reuse an installed browser
// instead of downloading Playwright's own Chromium.
export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.js',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:8123',
    ...(process.env.WHM_BROWSER_CHANNEL ? { channel: process.env.WHM_BROWSER_CHANNEL } : {}),
  },
  webServer: {
    command: 'node test/server.js',
    url: 'http://127.0.0.1:8123',
  },
})
