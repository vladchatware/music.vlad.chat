# Cypress E2E

End-to-end journeys for the backroom analysis desk. Runs against a live app
instance (dev server or deployed env) because pages are server-rendered from
Convex + SoundCloud and cannot be meaningfully stubbed from the browser.

## Run

```sh
bun run dev          # or point CYPRESS_BASE_URL at any running instance
bun run e2e          # interactive
bun run e2e:run      # headless
```

## Environment

| Variable | Cypress env | Purpose |
| --- | --- | --- |
| `CYPRESS_BASE_URL` | `baseUrl` | Target instance. Default `http://localhost:3000`. |
| `E2E_TRACK_ID` | `trackId` | Track with a **completed** analysis. Enables `track-backroom.cy.ts` + authenticated journeys. |
| `E2E_PENDING_TRACK_ID` | `pendingTrackId` | Track **without** an analysis. Enables `track-pending.cy.ts`. |
| `E2E_SERVICE_LOGIN_SECRET` | `serviceSecret` | Secret for the deployment-gated `soundcloud-service` provider. Enables sign-in as the service SoundCloud user. |

Pass via shell: `CYPRESS_BASE_URL=… E2E_TRACK_ID=12345 bun run e2e:run`, or put
them in `cypress.env.json` (gitignored).

## Authentication

`cy.signIn()` (in `cypress/support/commands.ts`) mints a Convex auth session by
calling the public `auth:signIn` **action** on the deployment and injects the
result as the `__convexAuthJWT` / `__convexAuthRefreshToken` cookies that
`@convex-dev/auth/nextjs` reads on localhost. The next `cy.visit` is fully
authenticated for both SSR and client hooks.

Two session modes:

- **Service SoundCloud user** (when `E2E_SERVICE_LOGIN_SECRET` is set on the
  deployment *and* locally): the `soundcloud-service` credentials provider in
  `convex/auth.ts` verifies the secret, then attaches the session to the
  existing service-user account (found via the `soundcloud` authAccount index
  by `SOUNDCLOUD_USER_ID`). Same identity, same stored SoundCloud tokens — so
  `/me`, user-credential API paths and token-backed flows are all exercised.
  The provider is never registered on deployments without the secret.
- **Anonymous fallback** (no secret): a throwaway anonymous user; only
  UI-level auth behavior can be asserted.

To provision a dev deployment: run the one-off prod→dev credential copy for
the service user, then `bunx convex env set E2E_SERVICE_LOGIN_SECRET <secret>`
and `bunx convex env set SOUNDCLOUD_USER_ID <service soundcloud user id>`.
Backend calls in intercepted journeys (redo/enqueue UI) never mutate analysis
queues.

In development with the service user (`SOUNDCLOUD_USER_ID`), run
`bun run analysis:queue-likes` / the worker to make sure at least one liked
track has an analysis for the current `TRACK_ANALYSIS_VERSION`, then export its
SoundCloud ID as `E2E_TRACK_ID`.

## Specs

- `backroom-landing.cy.ts` — landing identity, library link styling (regression
  guard for the missing `.libraryLink` class), lookup → track redirect.
- `track-backroom.cy.ts` — topbar badge, hero, metrics, chart + rails, segment
  hover popover (open/hide), cue summary, four numbered sections, redo button
  hidden when anonymous.
- `track-pending.cy.ts` — analysis-not-ready state; anonymous users see the
  sign-in CTA and never a dead enqueue button.
- `auth-journeys.cy.ts` — authenticated redo/enqueue flows (API intercepted),
  `/me` library for the service SoundCloud user (likes + analyze deep-links),
  and a real user-credential track-metadata fetch.
