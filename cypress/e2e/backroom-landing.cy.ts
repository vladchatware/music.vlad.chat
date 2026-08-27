/// <reference types="cypress" />

describe("/backroom landing", () => {
  beforeEach(() => cy.visit("/backroom"));

  it("renders the analysis desk identity", () => {
    cy.contains("REVIBE / ANALYSIS DESK").should("be.visible");
    cy.contains("Read the record").should("be.visible");
  });

  it("exposes the library entry link with brand styling", () => {
    // Regression guard: .libraryLink had no CSS definition and fell back to
    // raw browser link styling. Assert the class resolves + brand styles apply.
    cy.get('a[href="/me"]')
      .scrollIntoView()
      .should("be.visible")
      .and("contain.text", "My records")
      .then(($a) => {
        const cls = $a.attr("class") ?? "";
        expect(cls, "libraryLink class present").to.contain("libraryLink");
        const css = window.getComputedStyle($a[0] as Element);
        expect(css.textTransform, "brand uppercase").to.eq("uppercase");
        expect(css.fontFamily.toLowerCase(), "brand mono font").to.contain("courier");
        expect(css.position, "fixed nav placement").to.eq("fixed");
      });
  });

  it("navigates to a track backroom from the lookup form", () => {
    cy.get("form[action='/backroom'] input[name='id']").type("2248709558");
    cy.get("form[action='/backroom'] button[type='submit']").click();
    cy.url().should("match", /\/tracks\/2248709558\/backroom$/);
  });

  it("rejects non-numeric lookup input", () => {
    cy.get("form[action='/backroom'] input[name='id']").type("abc").then(($input) => {
      const input = $input.get(0) as HTMLInputElement & { checkValidity: () => boolean };
      expect(input.checkValidity()).to.be.false;
    });
  });

  it("redirects /backroom?id=<numeric> straight to the track page", () => {
    cy.visit("/backroom?id=2248709558");
    cy.url().should("match", /\/tracks\/2248709558\/backroom$/);
  });

  it("keeps the theme toggle reachable", () => {
    cy.get(".backroomThemeToggle").should("be.visible").click();
  });
});
