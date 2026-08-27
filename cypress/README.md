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
| `E2E_DEV_SERVICE_USER` | `devServiceUser` | `true` when the target runs dev with `SOUNDCLOUD_USER_ID`. Enables the `/me` suite. |

Pass via shell: `CYPRESS_BASE_URL=… E2E_TRACK_ID=12345 bun run e2e:run`, or put
them in `cypress.env.json` (gitignored).

## Authentication

`cy.signIn()` (in `cypress/support/commands.ts`) mints a Convex auth session by
calling the public `auth:signIn` **action** on the deployment
(`POST $NEXT_PUBLIC_CONVEX_URL/api/action` with the `anonymous` provider) and
injects the result as the `__convexAuthJWT` / `__convexAuthRefreshToken`
cookies that `@convex-dev/auth/nextjs` reads on localhost. The next `cy.visit`
is fully authenticated for both SSR and client hooks.

This authenticates the *browser* as a throwaway anonymous user; pages that need
SoundCloud data still rely on the dev service user (`SOUNDCLOUD_USER_ID`).
Backend calls in authenticated UI journeys (redo/enqueue) are intercepted so
the specs never mutate analysis queues.

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
