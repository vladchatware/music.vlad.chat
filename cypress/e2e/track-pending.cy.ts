/// <reference types="cypress" />
import { suiteWithPendingTrackId } from "../support/e2e";

const pendingTrackId = Cypress.env("pendingTrackId") as string | undefined;
const pendingSuite = suiteWithPendingTrackId();

pendingSuite(`/tracks/${pendingTrackId ?? "<E2E_PENDING_TRACK_ID>"}/backroom — enqueue journey`, () => {
  const url = `/tracks/${pendingTrackId}/backroom`;

  beforeEach(() => cy.visit(url));

  it("shows the analysis-not-ready empty state", () => {
    cy.contains("ANALYSIS NOT READY").should("be.visible");
  });

  it("prompts anonymous visitors to sign in instead of exposing enqueue", () => {
    // When not authenticated the CTA must be the sign-in action, not the
    // enqueue button — otherwise clicking it silently fails server-side.
    cy.contains("Sign in with SoundCloud to analyze this track.").should("be.visible");
    cy.contains("button", "Continue with SoundCloud").should("be.visible");
    cy.contains("button", "Analyze with SoundCloud").should("not.exist");
  });
});
