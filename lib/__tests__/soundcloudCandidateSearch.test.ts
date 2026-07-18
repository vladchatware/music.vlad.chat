import { describe, expect, it, vi } from "vitest";

import {
  buildRelaxedTrackQueries,
  searchTrackCandidates,
} from "../server/soundcloudCandidateSearch";

describe("SoundCloud candidate search", () => {
  it("relaxes over-constrained aesthetic searches into usable descriptors", () => {
    expect(buildRelaxedTrackQueries({
      q: "frutiger aero hidden gem",
      genres: "electronic",
      tags: "frutiger aero,breakcore,ambient",
      "bpm[from]": "120",
    })).toEqual([
      { q: "frutiger aero hidden gem" },
      { q: "frutiger aero" },
      { q: "breakcore" },
      { q: "ambient" },
      { q: "electronic" },
    ]);
  });

  it("falls back, deduplicates results, and removes played IDs", async () => {
    const search = vi.fn(async ({ q }: { q: string }) => {
      if (q === "breakcore") return [{ id: 2 }, { id: 3 }];
      if (q === "ambient") return [{ id: 3 }, { id: 4 }];
      return [];
    });

    await expect(searchTrackCandidates({
      query: { q: "frutiger aero", tags: "breakcore,ambient" },
      search,
      isPlayable: () => true,
      excludeIds: [2],
      desiredCount: 3,
    })).resolves.toEqual([{ id: 3 }, { id: 4 }]);
  });

  it("retries a rejected over-constrained search without advanced filters", async () => {
    const badRequest = Object.assign(new Error("bad filter"), { status: 400 });
    const search = vi.fn(async (query: { q: string; [key: string]: unknown }) => {
      if (query["bpm[from]"]) throw badRequest;
      return [{ id: 9 }];
    });

    await expect(searchTrackCandidates({
      query: { q: "deep house", "bpm[from]": "fast" },
      search,
      isPlayable: () => true,
      desiredCount: 1,
    })).resolves.toEqual([{ id: 9 }]);
    expect(search).toHaveBeenNthCalledWith(2, { q: "deep house" });
  });

  it("broadens descriptors supplied only in q", () => {
    expect(buildRelaxedTrackQueries({
      q: "frutiger aero ambient synth dreamwave chill downtempo",
    })).toEqual([
      { q: "frutiger aero ambient synth dreamwave chill downtempo" },
      { q: "frutiger" },
      { q: "aero" },
      { q: "ambient" },
      { q: "synth" },
      { q: "dreamwave" },
    ]);

    expect(buildRelaxedTrackQueries({ q: "frutiger aero hidden gem" })).toContainEqual({
      q: "frutiger aero",
    });
  });
});
