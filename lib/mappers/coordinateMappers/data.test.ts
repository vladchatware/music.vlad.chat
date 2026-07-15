import { describe, expect, it } from "vitest";

import { CoordinateMapper_Data } from "./data";

describe("CoordinateMapper_Data", () => {
  it("resizes its mutable input buffer without changing amplitude", () => {
    const mapper = new CoordinateMapper_Data({ amplitude: 2, size: 2 });
    mapper.data.set([0.25, 0.5]);

    mapper.resize(4);

    expect(mapper.params).toEqual({ amplitude: 2, size: 4 });
    expect(mapper.data).toEqual(new Float32Array(4));
    expect(mapper.amplitude).toBe(2);
  });

  it("keeps the existing buffer when its size already matches", () => {
    const mapper = new CoordinateMapper_Data({ amplitude: 1, size: 2 });
    const data = mapper.data;

    mapper.resize(2);

    expect(mapper.data).toBe(data);
  });
});
