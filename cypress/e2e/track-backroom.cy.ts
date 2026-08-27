/// <reference types="cypress" />
import { suiteWithTrackId } from "../support/e2e";

const trackId = Cypress.env("trackId") as string | undefined;
const trackSuite = suiteWithTrackId();

trackSuite(`/tracks/${trackId ?? "<E2E_TRACK_ID>"}/backroom — analysis desk`, () => {
  const url = `/tracks/${trackId}/backroom`;

  beforeEach(() => cy.visit(url));

  it("shows the topbar with an analysis badge", () => {
    cy.contains("REVIBE ANALYSIS DESK").should("be.visible");
    // Ready badge shows the analysis version, pending badge shows text.
    cy.get("main [class*='ready'], main [class*='pending']").should("be.visible");
  });

  it("renders the hero identity block", () => {
    cy.get("h1").invoke("text").should("have.length.above", 0);
    cy.get("[class*='artwork']").first().should("exist");
  });

  it("renders the metrics strip with tempo and tonal center", () => {
    cy.contains("TEMPO").should("be.visible");
    cy.contains("TONAL CENTER").should("be.visible");
  });

  it("paints the energy chart and structure rails", () => {
    cy.get("svg[aria-label*='energy']").should("exist");
    cy.contains("DJ SEGMENTS").scrollIntoView().should("be.visible");
  });

  it("opens the segment popover on hover and hides it on leave", () => {
    cy.get("[class*='segmentBlock']").first().as("segment");
    cy.get("@segment").scrollIntoView().should("be.visible");
    cy.get("@segment").trigger("mouseover");
    cy.get("[class*='hoverCard']")
      .scrollIntoView()
      .should("be.visible")
      .and("contain.text", "Energy")
      .and("contain.text", "Entry")
      .and("contain.text", "Exit");
    // React synthesizes onMouseLeave from bubbling `mouseout` — a native
    // (non-bubbling) mouseleave event never reaches the React root.
    cy.get("@segment").trigger("mouseout");
    cy.get("[class*='hoverCard']").should("not.exist");
  });

  it("shows the mix-in / mix-out cue summary", () => {
    cy.contains("MIX IN").scrollIntoView().should("be.visible");
    cy.contains("MIX OUT").scrollIntoView().should("be.visible");
  });

  it("lists all four numbered sections", () => {
    cy.get("[class*='sectionHeading'] > span").then(($spans) => {
      const numbers = [...$spans].map((el) => el.textContent?.trim() ?? "");
      ["01", "02", "03", "04"].forEach((number) => {
        expect(numbers, `section ${number} present`).to.include(number);
      });
    });
  });

  it("hides the redo-analysis control for anonymous visitors", () => {
    // AnalysisRedoButton returns null when useConvexAuth is not authenticated.
    cy.contains("Redo analysis").should("not.exist");
  });
});
