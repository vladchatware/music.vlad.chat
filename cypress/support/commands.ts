/// <reference types="cypress" />

/**
 * Mint a Convex auth session and inject it into the browser as cookies.
 *
 * When E2E_SERVICE_LOGIN_SECRET is configured, this signs in as the *service
 * SoundCloud user* via the deployment-gated `soundcloud-service` credentials
 * provider: the secret authorizes the caller, and the session attaches to the
 * existing service-user account — same soundcloudUserId, same stored tokens.
 * Otherwise falls back to an anonymous session (UI-level tests only).
 *
 * Either way we call the public `auth:signIn` action and set the same cookies
 * ConvexAuthNextjsProvider expects on localhost (`__convexAuthJWT`,
 * `__convexAuthRefreshToken`; httpOnly, no __Host- prefix).
 */
Cypress.Commands.add("signIn", () => {
  const convexUrl = Cypress.env("convexUrl") as string | undefined;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL not found — add it to .env.local for auth specs");
  }
  const serviceSecret = Cypress.env("serviceSecret") as string | undefined;
  const provider = serviceSecret
    ? { id: "soundcloud-service", params: { secret: serviceSecret } }
    : { id: "anonymous", params: {} as Record<string, never> };
  cy.request({
    method: "POST",
    url: `${convexUrl}/api/action`,
    body: {
      path: "auth:signIn",
      args: [{ provider: provider.id, params: provider.params }],
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
