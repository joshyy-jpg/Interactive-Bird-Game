import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  use: {
    // 5174, not Vite's default 5173: another local project uses 5173, and
    // reuseExistingServer would otherwise run these tests against the wrong app.
    baseURL: "http://localhost:5174",
    launchOptions: {
      // Auto-grant the camera permission prompt and provide a fake webcam so
      // getUserMedia resolves headlessly.
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
  },
  webServer: {
    command: "npm run dev -- --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
