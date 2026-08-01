import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import Stripe from "stripe";
import { internal } from "./_generated/api";
import { TRACK_ANALYSIS_VERSION, type TrackAnalysis } from "../lib/trackAnalysis";
import type { Id } from "./_generated/dataModel";
import { extractInstagramLiveComments, verifyMetaSignature } from "../lib/instagramLive";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const webhook_secret = process.env.STRIPE_WEBHOOK_SECRET

const http = httpRouter();

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

function isAnalysisServiceAuthorized(req: Request): boolean {
  const secret = process.env.ANALYSIS_SERVICE_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function analysisRoute(
  path: string,
  handler: Parameters<typeof httpAction>[0],
) {
  http.route({ path, method: "POST", handler: httpAction(handler) });
}

auth.addHttpRoutes(http);

analysisRoute("/soundcloud/service-credentials", async (ctx, req) => {
  if (!isAnalysisServiceAuthorized(req)) return json({ error: "Unauthorized" }, 401);

  // Prefer env var (set via `npx convex env set` on the deployment).
  const envAccess = process.env.SOUNDCLOUD_SERVICE_USER_ACCESS_TOKEN;
  if (envAccess) {
    return json({
      accessToken: envAccess,
      refreshToken: process.env.SOUNDCLOUD_SERVICE_USER_REFRESH_TOKEN ?? null,
    });
  }

  // Fallback: look up the auth account in the database (production).
  const body = await req.json().catch(() => null) as { soundcloudUserId?: unknown } | null;
  if (typeof body?.soundcloudUserId !== "string" || !body.soundcloudUserId) {
    return json({ error: "soundcloudUserId is required" }, 400);
  }
  const credentials = await ctx.runQuery(internal.users.serviceSoundcloudCredentials, {
    soundcloudUserId: body.soundcloudUserId,
  });
  if (!credentials) return json({ error: "Service user SoundCloud credentials not found" }, 404);
  return json(credentials);
});

http.route({
  path: "/instagram/webhook",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (
      mode !== "subscribe" ||
      !challenge ||
      !process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ||
      token !== process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN
    ) {
      return new Response("Forbidden", { status: 403 });
    }
    return new Response(challenge, { status: 200 });
  }),
});

http.route({
  path: "/instagram/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.text();
    const appSecret = process.env.INSTAGRAM_APP_SECRET ?? "";
    const valid = await verifyMetaSignature(
      body,
      req.headers.get("x-hub-signature-256"),
      appSecret,
    );
    if (!valid) return new Response("Invalid signature", { status: 401 });

    let deliveries;
    try {
      deliveries = extractInstagramLiveComments(JSON.parse(body));
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    for (const delivery of deliveries) {
      await ctx.runMutation(internal.liveStreams.ingestComments, delivery);
    }
    return new Response("EVENT_RECEIVED", { status: 200 });
  }),
});

http.route({
  path: '/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const signature = req.headers.get('stripe-signature')
    if (!signature) return new Response(null, { status: 400 })
    if (!webhook_secret) {
      console.error("STRIPE_WEBHOOK_SECRET is not configured")
      return new Response(null, { status: 500 })
    }
    try {
      const payload = await req.text()
      const event = await stripe.webhooks.constructEventAsync(payload, signature, webhook_secret)

      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded': {
          const session = event.data.object
          if (session.payment_status !== "paid") break
          const userId = session.metadata?.userId as Id<"users"> | undefined
          const tokens = Number.parseInt(session.metadata?.tokens ?? "", 10)
          if (!userId || !Number.isSafeInteger(tokens) || tokens <= 0) {
            throw new Error("Paid checkout session has invalid credit metadata")
          }
          const result = await ctx.runMutation(internal.users.applyPayment, {
            stripeEventId: event.id,
            checkoutSessionId: session.id,
            userId,
            tokens,
            amountTotal: session.amount_total ?? undefined,
            currency: session.currency ?? undefined,
          })
          if (result.applied) {
            await ctx.scheduler.runAfter(0, internal.telemetry.recordBusinessEvent, {
              event: "commerce.payment.completed",
              userId: String(result.userId),
              amountTotal: session.amount_total ?? undefined,
              currency: session.currency ?? undefined,
              tokens,
            })
          }
          break;
        }
        default:
          console.log(event.type)
      }
    } catch (error) {
      console.error("Stripe webhook failed", error)
      const status = error instanceof Stripe.errors.StripeSignatureVerificationError ? 400 : 500
      return new Response(null, { status })
    }
    return new Response(null, { status: 200 })
  })
})

analysisRoute("/analysis/enqueue", async (ctx, req) => {
  if (!isAnalysisServiceAuthorized(req)) return json({ error: "Unauthorized" }, 401);
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const trackIds = ((body.trackIds ?? [body.trackId]) as Array<string | number>)
      .map((id) => String(id ?? ""))
      .filter((id) => /^\d+$/.test(id));
    if (trackIds.length === 0 || trackIds.length > 20) {
      return json({ error: "trackIds must contain 1-20 positive numeric IDs" }, 400);
    }
    const result = await ctx.runMutation(internal.trackAnalysis.enqueue, {
      trackIds,
      priority: Number.isFinite(body.priority) ? Number(body.priority) : 0,
      force: body.force === true,
      analysisVersion: (body.analysisVersion as string) ?? TRACK_ANALYSIS_VERSION,
      ...(body.soundcloudUserId ? { soundcloudUserId: body.soundcloudUserId as string } : {}),
      ...(body.traceContexts ? { traceContexts: body.traceContexts as any } : {}),
    });
    return json(result);
  } catch (error) {
    console.error("Analysis enqueue failed", error);
    return json({ error: "Invalid enqueue request" }, 400);
  }
});

analysisRoute("/analysis/claim", async (ctx, req) => {
  if (!isAnalysisServiceAuthorized(req)) return json({ error: "Unauthorized" }, 401);
  try {
    const body = (await req.json().catch(() => ({}))) as { leaseDurationMs?: number };
    const leaseDurationMs = Math.min(
      30 * 60_000,
      Math.max(60_000, Number(body.leaseDurationMs) || 15 * 60_000),
    );
    const job = await ctx.runMutation(internal.trackAnalysis.claim, {
      leaseToken: crypto.randomUUID(),
      leaseDurationMs,
    });
    return json({ job });
  } catch (error) {
    console.error("Analysis claim failed", error);
    return json({ error: "Failed to claim analysis job" }, 500);
  }
});

analysisRoute("/analysis/claim-specific", async (ctx, req) => {
  if (!isAnalysisServiceAuthorized(req)) return json({ error: "Unauthorized" }, 401);
  try {
    const body = (await req.json()) as { cacheKey?: string; leaseDurationMs?: number };
    if (!body.cacheKey) return json({ error: "cacheKey is required" }, 400);
    const leaseDurationMs = Math.min(
      30 * 60_000,
      Math.max(60_000, Number(body.leaseDurationMs) || 15 * 60_000),
    );
    const result = await ctx.runMutation(internal.trackAnalysis.claimSpecific, {
      cacheKey: body.cacheKey,
      leaseToken: crypto.randomUUID(),
      leaseDurationMs,
    });
    return json(result);
  } catch (error) {
    console.error("Specific analysis claim failed", error);
    return json({ error: "Failed to claim analysis job" }, 500);
  }
});

analysisRoute("/analysis/complete", async (ctx, req) => {
  if (!isAnalysisServiceAuthorized(req)) return json({ error: "Unauthorized" }, 401);
  try {
    const body = (await req.json()) as {
      cacheKey: string;
      leaseToken: string;
      result: DeepMutable<TrackAnalysis>;
    };
    const result = await ctx.runMutation(internal.trackAnalysis.complete, body);
    return json(result);
  } catch (error) {
    console.error("Analysis completion failed", error);
    return json({ error: "Invalid completion request" }, 400);
  }
});

analysisRoute("/analysis/fail", async (ctx, req) => {
  if (!isAnalysisServiceAuthorized(req)) return json({ error: "Unauthorized" }, 401);
  try {
    const raw = (await req.json()) as Record<string, unknown>;
    console.log("analysis.fail.body", { cacheKey: raw.cacheKey, leaseToken: raw.leaseToken });
    const result = await ctx.runMutation(internal.trackAnalysis.fail, {
      cacheKey: raw.cacheKey as string,
      leaseToken: raw.leaseToken as string,
      error: (raw.error as string) ?? "",
      ...(raw.noRetry === true ? { noRetry: true } : {}),
    });
    return json(result);
  } catch (error) {
    console.error("Analysis failure report failed", error instanceof Error ? error.message : error);
    return json({ error: "Invalid failure request" }, 400);
  }
});

analysisRoute("/analysis/defer", async (ctx, req) => {
  if (!isAnalysisServiceAuthorized(req)) return json({ error: "Unauthorized" }, 401);
  try {
    const body = (await req.json()) as {
      cacheKey: string;
      leaseToken: string;
      retryMs: number;
      reason: string;
    };
    await ctx.runMutation(internal.trackAnalysis.defer, body);
    return json({ deferred: true });
  } catch (error) {
    console.error("Analysis deferral failed", error);
    return json({ error: "Invalid deferral request" }, 400);
  }
});

export default http;
