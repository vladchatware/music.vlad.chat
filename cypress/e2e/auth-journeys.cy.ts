/// <reference types="cypress" />
import { suiteWithTrackId, suiteWithPendingTrackId, suiteWithDevServiceUser } from "../support/e2e";

const trackId = Cypress.env("trackId") as string | undefined;

// ─── Authenticated track journeys ────────────────────────────────────────────
// The browser gets a real Convex auth session via cy.signIn(); backend calls
// are intercepted so re-queueing an analysis stays a UI-level assertion.

const trackSuite = suiteWithTrackId();

trackSuite(`backroom authenticated journeys (track ${trackId ?? "<E2E_TRACK_ID>"})`, () => {
  beforeEach(() => {
    cy.signIn();
    cy.visit(`/tracks/${trackId}/backroom`);
  });

  it("shows the redo-analysis control once authenticated", () => {
    cy.contains("Redo analysis").should("be.visible");
  });

  it("re-queues an analysis from the redo button without touching the backend", () => {
    cy.intercept("GET", `/api/tracks/${trackId}?force=true`, {
      statusCode: 200,
      body: { id: trackId },
    }).as("forceAnalysis");
    cy.contains("button", "Redo analysis").click();
    cy.wait("@forceAnalysis");
    cy.contains("re-queued").should("be.visible");
  });
});

// ─── Authenticated enqueue journey (track without analysis) ──────────────────

const pendingTrackId = Cypress.env("pendingTrackId") as string | undefined;
const pendingSuite = suiteWithPendingTrackId();

pendingSuite(`enqueue journey (track ${pendingTrackId ?? "<E2E_PENDING_TRACK_ID>"})`, () => {
  it("signed-in users see the enqueue CTA and a scheduled confirmation", () => {
    cy.signIn();
    cy.intercept("GET", `/api/tracks/${pendingTrackId}`, {
      statusCode: 200,
      body: { id: pendingTrackId },
    }).as("enqueue");
    cy.visit(`/tracks/${pendingTrackId}/backroom`);
    cy.contains("ANALYSIS NOT READY").should("be.visible");
    cy.contains("button", "Analyze with SoundCloud").click();
    cy.wait("@enqueue");
    cy.contains("Analysis scheduled").should("be.visible");
  });
});

// ─── My records (dev service user) ───────────────────────────────────────────

const devSuite = suiteWithDevServiceUser();

devSuite("/me — my records (service user)", () => {
  it("renders the library without redirecting", () => {
    cy.signIn();
    cy.visit("/me");
    cy.url().should("match", /\/me$/);
    // Anonymous session + dev service user still serves the server-side library.
    cy.get("main").should("be.visible");
    cy.contains(/likes|playlists|library/i).should("exist");
  });
});
