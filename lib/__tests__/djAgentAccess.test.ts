import { afterEach, describe, expect, it } from "vitest";

import { isLocalDJBypass } from "../server/localDJBypass";

const originalBypass = process.env.DJ_LOCAL_BYPASS;

afterEach(() => {
  if (originalBypass === undefined) delete process.env.DJ_LOCAL_BYPASS;
  else process.env.DJ_LOCAL_BYPASS = originalBypass;
});

describe("isLocalDJBypass", () => {
  it("allows explicit loopback bypass", () => {
    process.env.DJ_LOCAL_BYPASS = "true";
    expect(isLocalDJBypass(new Request("http://localhost:3000/api/chat"))).toBe(true);
    expect(isLocalDJBypass(new Request("http://127.0.0.1:3000/api/chat"))).toBe(true);
  });

  it("does not trust non-loopback hosts", () => {
    process.env.DJ_LOCAL_BYPASS = "true";
    expect(isLocalDJBypass(new Request("https://music.example/api/chat"))).toBe(false);
  });

  it("requires explicit opt-in outside development", () => {
    delete process.env.DJ_LOCAL_BYPASS;
    expect(isLocalDJBypass(new Request("http://localhost:3000/api/chat"))).toBe(false);
  });
});
