import path from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  use: { baseURL: "http://127.0.0.1:4100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    {
      name: "phone",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: [
    { command: "bun e2e/fixture-api.ts", url: "http://127.0.0.1:4491/health" },
    {
      command: "bun run dev --hostname 127.0.0.1",
      url: "http://127.0.0.1:4100/offline.html",
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:4491",
        INTERNAL_API_URL: "http://127.0.0.1:4491",
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_FONT_GOOGLE_MOCKED_RESPONSES: path.resolve("e2e/font-responses.cjs"),
      },
    },
  ],
});
