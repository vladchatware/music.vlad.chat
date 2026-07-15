import { describe, expect, it, vi } from "vitest";

import { closeAudioContextSafely, runDetached } from "./asyncSafety";

describe("async lifecycle safety", () => {
  it("absorbs AudioContext close AbortError during StrictMode cleanup", async () => {
    const close = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));

    await expect(closeAudioContextSafely(close)).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it("routes detached task rejection instead of leaking it globally", async () => {
    const onRejected = vi.fn();

    runDetached(Promise.reject(new Error("media failed")), onRejected);
    await Promise.resolve();
    await Promise.resolve();

    expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ message: "media failed" }));
  });
});
