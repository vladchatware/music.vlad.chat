/// <reference types="cypress" />
import "./commands";

export type E2EEnv = {
  /** Track ID with a completed analysis in the target environment (E2E_TRACK_ID). */
  trackId?: string;
  /** Track ID without an analysis, for the enqueue journey (E2E_PENDING_TRACK_ID). */
  pendingTrackId?: string;
};

const env: E2EEnv = {
  trackId: Cypress.env("trackId") as string | undefined,
  pendingTrackId: Cypress.env("pendingTrackId") as string | undefined,
};

/**
 * describe wrapper that runs only when an analyzed track is configured:
 *   const trackSuite = suiteWithTrackId(); trackSuite("…", () => { … });
 */
export function suiteWithTrackId() {
  return env.trackId ? describe : describe.skip;
}

export function suiteWithPendingTrackId() {
  return env.pendingTrackId ? describe : describe.skip;
}

/** Runs only against an environment that serves dev service-user behavior. */
export function suiteWithDevServiceUser() {
  return Cypress.env("devServiceUser") ? describe : describe.skip;
}

export default env;
