import { describe, expect, it, vi } from "vitest";

import { createDJToolCallBudget } from "./djToolCallBudget";

describe("createDJToolCallBudget", () => {
  it("bounds repeated instrument calls without replacing the model's choice", async () => {
    const execute = vi.fn(async (input: { q: string }) => ({ tracks: [input.q] }));
    const bounded = createDJToolCallBudget({
      toolName: "tracks",
      maxCalls: 2,
      execute,
    });

    await expect(bounded({ q: "a" }, undefined)).resolves.toEqual({ tracks: ["a"] });
    await expect(bounded({ q: "b" }, undefined)).resolves.toEqual({ tracks: ["b"] });
    await expect(bounded({ q: "c" }, undefined)).resolves.toEqual({
      status: "tool_budget_exhausted",
      toolName: "tracks",
      instruction: "Reuse the results already returned and continue toward one player decision.",
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
