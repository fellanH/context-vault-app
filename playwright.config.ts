import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/suites",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.API_URL || "https://api.context-vault.com",
  },
});
