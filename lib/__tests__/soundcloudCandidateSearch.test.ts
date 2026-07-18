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
    })).toEqual([
      { q: "frutiger aero hidden gem", genres: undefined, tags: undefined },
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

  it("broadens descriptors supplied only in q", () => {
    expect(buildRelaxedTrackQueries({
      q: "frutiger aero ambient synth dreamwave chill downtempo",
    })).toEqual([
      { q: "frutiger aero ambient synth dreamwave chill downtempo", tags: undefined, genres: undefined },
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
