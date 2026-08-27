/// <reference types="cypress" />
import { suiteWithTrackId, suiteWithPendingTrackId, suiteWithServiceUser } from "../support/e2e";

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

// ─── Service SoundCloud user journeys ───────────────────────────────────────
// cy.signIn() attaches the session to the real service SoundCloud user
// (soundcloudUserId + stored tokens), so these run the token-backed paths.

const serviceSuite = suiteWithServiceUser();

serviceSuite("/me — my records (service SoundCloud user)", () => {
  beforeEach(() => {
    cy.signIn();
    cy.visit("/me");
    cy.url().should("match", /\/me$/);
  });

  it("renders the library for the signed-in SoundCloud identity", () => {
    cy.contains(/likes|playlists|library/i).should("exist");
  });

  it("lists liked tracks with analyze deep-links", () => {
    cy.get("a[href*='/backroom']").should("have.length.greaterThan", 0);
  });

  it("fetches track metadata through the signed-in user's SoundCloud tokens", function () {
    // Real request, no intercept: exercises the user-credential path in
    // GET /api/tracks/[id] (api.users.soundcloudTokens → SoundCloud API).
    const trackId = Cypress.env("trackId") as string | undefined;
    if (!trackId) {
      this.skip();
      return;
    }
    cy.request("GET", `/api/tracks/${trackId}`).its("status").should("eq", 200);
  });
});
