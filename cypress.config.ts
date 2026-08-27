import { defineConfig } from "cypress";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Minimal .env.local loader (KEY=VALUE lines, quotes stripped). */
function loadEnvFile(file: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line.trim()))
        .map((line) => {
          const index = line.indexOf("=");
          const key = line.slice(0, index).trim();
          const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
          return [key, value];
        }),
    );
  } catch {
    return {};
  }
}

const fileEnv = { ...loadEnvFile(resolve(__dirname, ".env.local")), ...process.env };

export default defineConfig({
  e2e: {
    baseUrl: fileEnv.CYPRESS_BASE_URL ?? "http://localhost:3000",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: "cypress/support/e2e.ts",
    viewportWidth: 1440,
    viewportHeight: 900,
    // Always capture video — CI uploads it as a workflow artifact
    // (cypress/videos/*.mp4). Local runs are gitignored.
    video: true,
    videoCompression: 32,
    retries: process.env.CI ? 2 : 0,
    defaultCommandTimeout: 10_000,
    env: {
      // Convex deployment used to mint browser auth sessions for the specs.
      convexUrl: fileEnv.NEXT_PUBLIC_CONVEX_URL,
      // Track with a completed analysis (enables track-backroom.cy.ts).
      trackId: fileEnv.E2E_TRACK_ID,
      // Track without an analysis (enables track-pending.cy.ts).
      pendingTrackId: fileEnv.E2E_PENDING_TRACK_ID,
      // Set E2E_DEV_SERVICE_USER=true when the target runs in development
      // with SOUNDCLOUD_USER_ID configured — enables /me + service-user specs.
      devServiceUser: fileEnv.E2E_DEV_SERVICE_USER === "true",
    },
  },
});
