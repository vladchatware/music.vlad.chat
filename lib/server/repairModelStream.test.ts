import { describe, expect, it } from "vitest";
import type { TextStreamPart, ToolSet } from "ai";

import { repairMissingStreamPartStarts } from "./repairModelStream";

async function run(parts: TextStreamPart<ToolSet>[]) {
  const transform = repairMissingStreamPartStarts<ToolSet>()({
    tools: {},
    stopStream() {},
  });
  const writer = transform.writable.getWriter();
  const outputPromise = (async () => {
    const output: TextStreamPart<ToolSet>[] = [];
    const reader = transform.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) return output;
      output.push(value);
    }
  })();

  for (const part of parts) await writer.write(part);
  await writer.close();
  return outputPromise;
}

describe("repairMissingStreamPartStarts", () => {
  it("inserts a missing text start before the first delta", async () => {
    const output = await run([
      { type: "text-delta", id: "text-1", text: "hello" },
      { type: "text-end", id: "text-1" },
    ]);

    expect(output).toEqual([
      { type: "text-start", id: "text-1", providerMetadata: undefined },
      { type: "text-delta", id: "text-1", text: "hello" },
      { type: "text-end", id: "text-1" },
    ]);
  });

  it("leaves a valid stream unchanged", async () => {
    const parts = [
      { type: "reasoning-start", id: "reasoning-1" },
      { type: "reasoning-delta", id: "reasoning-1", text: "thinking" },
      { type: "reasoning-end", id: "reasoning-1" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", text: "done" },
      { type: "text-end", id: "text-1" },
    ] satisfies TextStreamPart<ToolSet>[];

    expect(await run(parts)).toEqual(parts);
  });
});
