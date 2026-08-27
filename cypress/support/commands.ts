/// <reference types="cypress" />

/**
 * Mint a Convex auth session and inject it into the browser as cookies.
 *
 * The app uses @convex-dev/auth with an Anonymous provider. `auth:signIn` is a
 * public action on the deployment, so we can call it directly (no OAuth UI
 * required) and set the same cookies ConvexAuthNextjsProvider expects on
 * localhost (`__convexAuthJWT`, `__convexAuthRefreshToken`; httpOnly, no
 * __Host- prefix). The next `cy.visit` hydrates SSR + client auth from them.
 *
 * Note: this creates a fresh anonymous user per call. It authenticates the
 * *browser session*, while server-side pages keep using the service user.
 */
Cypress.Commands.add("signIn", () => {
  const convexUrl = Cypress.env("convexUrl") as string | undefined;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL not found — add it to .env.local for auth specs");
  }
  cy.request({
    method: "POST",
    url: `${convexUrl}/api/action`,
    body: {
      path: "auth:signIn",
      args: [{ provider: "anonymous", params: {} }],
      format: "json",
    },
  }).then((response) => {
    const result = response.body as {
      status: string;
      value?: { tokens?: { token?: string; refreshToken?: string } };
    };
    const tokens = result.value?.tokens;
    if (result.status !== "success" || !tokens?.token) {
      throw new Error(`auth:signIn failed: ${JSON.stringify(result).slice(0, 300)}`);
    }
    const options = { httpOnly: true, sameSite: "lax", path: "/" } as const;
    cy.setCookie("__convexAuthJWT", tokens.token, options);
    if (tokens.refreshToken) {
      cy.setCookie("__convexAuthRefreshToken", tokens.refreshToken, options);
    }
  });
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /** Mint a Convex auth session (anonymous provider) and inject session cookies. */
      signIn(): Chainable<void>;
    }
  }
}

export {};
