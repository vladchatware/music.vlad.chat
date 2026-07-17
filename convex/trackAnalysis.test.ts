/// <reference types="vite/client" />

import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.*s");

function result(trackId: string) {
  return {
    source: "soundcloud" as const,
    sourceTrackId: trackId,
    analysisVersion: "essentia-dj-v1",
    durationSec: 180,
    processingTimeMs: 1000,
    warnings: [],
    tempo: {
      bpm: 120,
      confidence: 0.9,
      beatsSec: [0, 0.5, 1],
      firstDownbeatSec: 0,
      downbeatsSec: [0],
      downbeatConfidence: 0.7,
    },
    tonal: { key: "A", scale: "minor", camelotKey: "8A", confidence: 0.8 },
    energy: { sampleRate: 2, samples: [0.2, 0.8], peaks: [1], valleys: [0] },
    structure: { phrases: [], downbeats: [0], sections: [] },
    cuePoints: { mixInSec: 16, mixOutSec: 150, confidence: 0.8, reason: "fixture" },
    segments: [{
      id: "s0", startSec: 0, endSec: 180, startBeat: 0, endBeat: 360,
      section: "unknown" as const, valence: null, arousal: null,
      energy: 0.5, energySlope: 0, vocalProbability: null, rhythmicDensity: 0.5,
      danceability: null, approachability: null, engagement: null,
      mirexMood: null, themes: null, instruments: null, genres: null, timbre: null, entryQuality: 0.5,
      exitQuality: 0.5, confidence: 0.7,
    }],
  };
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.ANALYSIS_SERVICE_SECRET;
  delete process.env.STRIPE_SECRET_KEY;
});

describe("track analysis queue", () => {
  it("lists current-version candidate analyses and excludes current track", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("trackAnalyses", {
        cacheKey: "soundcloud:1:essentia-dj-v1",
        result: result("1"),
        createdAt: 1,
      });
      await ctx.db.insert("trackAnalyses", {
        cacheKey: "soundcloud:2:essentia-dj-v1",
        result: result("2"),
        createdAt: 2,
      });
      await ctx.db.insert("trackAnalyses", {
        cacheKey: "soundcloud:3:essentia-dj-v2",
        result: { ...result("3"), analysisVersion: "essentia-dj-v2" },
        createdAt: 3,
      });
    });

    const candidates = await t.query(api.trackAnalysis.listCandidates, {
      excludeTrackId: "1",
      analysisVersion: "essentia-dj-v1",
      limit: 10,
    });

    expect(candidates.map((candidate) => candidate.sourceTrackId)).toEqual(["2"]);
  });

  it("protects HTTP queue endpoints and validates enqueue input", async () => {
    process.env.ANALYSIS_SERVICE_SECRET = "test-secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
    const t = convexTest(schema, modules);
    const unauthorized = await t.fetch("/analysis/enqueue", {
      method: "POST",
      body: JSON.stringify({ trackId: "1" }),
    });
    expect(unauthorized.status).toBe(401);

    const malformed = await t.fetch("/analysis/enqueue", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ trackId: "bad" }),
    });
    expect(malformed.status).toBe(400);

    const accepted = await t.fetch("/analysis/enqueue", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ trackIds: ["1", "2"], priority: 5 }),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ enqueued: 2 });
  });

  it("deduplicates enqueue and atomically leases one job", async () => {
    const t = convexTest(schema, modules);
    const args = { trackIds: ["42", "42"], analysisVersion: "essentia-dj-v1", priority: 10 };
    expect(await t.mutation(internal.trackAnalysis.enqueue, args)).toMatchObject({ enqueued: 1 });
    expect(await t.mutation(internal.trackAnalysis.enqueue, args)).toMatchObject({ existing: 1 });

    const first = await t.mutation(internal.trackAnalysis.claim, {
      leaseToken: "lease-1",
      leaseDurationMs: 60_000,
    });
    const second = await t.mutation(internal.trackAnalysis.claim, {
      leaseToken: "lease-2",
      leaseDurationMs: 60_000,
    });
    expect(first?.sourceTrackId).toBe("42");
    expect(second).toBeNull();
  });

  it("leases requesting user's SoundCloud access token to worker", async () => {
    const t = convexTest(schema, modules);
    const requestedBy = await t.run((ctx) => ctx.db.insert("users", {
      name: "Signed listener",
      soundcloudAccessToken: "user-access-token",
    }));
    await t.run((ctx) => ctx.db.insert("trackAnalysisJobs", {
      cacheKey: "soundcloud:43:essentia-dj-v1",
      source: "soundcloud",
      sourceTrackId: "43",
      analysisVersion: "essentia-dj-v1",
      requestedBy,
      status: "queued",
      priority: 10,
      attempts: 0,
      nextAttemptAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    const job = await t.mutation(internal.trackAnalysis.claim, {
      leaseToken: "lease-user",
      leaseDurationMs: 60_000,
    });

    expect(job).toMatchObject({
      sourceTrackId: "43",
      soundCloudAccessToken: "user-access-token",
    });
  });

  it("stores immutable result and removes completed job", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.trackAnalysis.enqueue, {
      trackIds: ["7"], analysisVersion: "essentia-dj-v1", priority: 1,
    });
    const job = await t.mutation(internal.trackAnalysis.claim, {
      leaseToken: "lease", leaseDurationMs: 60_000,
    });
    if (!job) throw new Error("Expected job");
    expect(await t.mutation(internal.trackAnalysis.complete, {
      cacheKey: job.cacheKey,
      leaseToken: job.leaseToken,
      result: result("7"),
    })).toEqual({ stored: true });

    const stored = await t.run(async (ctx) => ({
      analyses: await ctx.db.query("trackAnalyses").collect(),
      jobs: await ctx.db.query("trackAnalysisJobs").collect(),
    }));
    expect(stored.analyses).toHaveLength(1);
    expect(stored.jobs).toHaveLength(0);
  });

  it("retries with backoff then dead-letters third failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const t = convexTest(schema, modules);
    await t.mutation(internal.trackAnalysis.enqueue, {
      trackIds: ["9"], analysisVersion: "essentia-dj-v1", priority: 1,
    });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const job = await t.mutation(internal.trackAnalysis.claim, {
        leaseToken: `lease-${attempt}`, leaseDurationMs: 60_000,
      });
      if (!job) throw new Error(`Expected attempt ${attempt}`);
      const failed = await t.mutation(internal.trackAnalysis.fail, {
        cacheKey: job.cacheKey,
        leaseToken: job.leaseToken,
        error: "decode failed\nsecret",
      });
      expect(failed.dead).toBe(attempt === 3);
      vi.advanceTimersByTime(attempt === 1 ? 30_001 : 60_001);
    }

    const jobs = await t.run((ctx) => ctx.db.query("trackAnalysisJobs").collect());
    expect(jobs[0].status).toBe("dead");
    expect(jobs[0].lastError).toBe("decode failed secret");
  });

  it("defers infrastructure auth failures without consuming an attempt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const t = convexTest(schema, modules);
    await t.mutation(internal.trackAnalysis.enqueue, {
      trackIds: ["11"], analysisVersion: "essentia-dj-v1", priority: 1,
    });
    const job = await t.mutation(internal.trackAnalysis.claim, {
      leaseToken: "lease-auth", leaseDurationMs: 60_000,
    });
    if (!job) throw new Error("Expected job");

    await t.mutation(internal.trackAnalysis.defer, {
      cacheKey: job.cacheKey,
      leaseToken: job.leaseToken,
      retryMs: 30_000,
      reason: "SoundCloud authentication unavailable",
    });

    const [deferred] = await t.run((ctx) => ctx.db.query("trackAnalysisJobs").collect());
    expect(deferred).toMatchObject({
      status: "queued",
      attempts: 0,
      nextAttemptAt: Date.now() + 30_000,
    });
    expect(deferred.leaseToken).toBeUndefined();
  });

  it("revives a dead job when it is explicitly enqueued again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const t = convexTest(schema, modules);
    const args = {
      trackIds: ["10"], analysisVersion: "essentia-dj-v1", priority: 1,
    };
    await t.mutation(internal.trackAnalysis.enqueue, args);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const job = await t.mutation(internal.trackAnalysis.claim, {
        leaseToken: `lease-${attempt}`, leaseDurationMs: 60_000,
      });
      if (!job) throw new Error(`Expected attempt ${attempt}`);
      await t.mutation(internal.trackAnalysis.fail, {
        cacheKey: job.cacheKey,
        leaseToken: job.leaseToken,
        error: "worker crashed",
      });
      vi.advanceTimersByTime(attempt === 1 ? 30_001 : 60_001);
    }

    expect(await t.mutation(internal.trackAnalysis.enqueue, {
      ...args,
      priority: 100,
    })).toEqual({ enqueued: 1, cached: 0, existing: 0 });

    const [revived] = await t.run((ctx) => ctx.db.query("trackAnalysisJobs").collect());
    expect(revived).toMatchObject({
      status: "queued",
      priority: 100,
      attempts: 0,
    });
    expect(revived.lastError).toBeUndefined();
    expect(revived.leaseToken).toBeUndefined();
    expect(revived.leaseExpiresAt).toBeUndefined();
  });
});
