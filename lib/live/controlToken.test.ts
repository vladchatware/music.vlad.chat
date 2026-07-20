import { describe, expect, it } from "vitest";

import { createEgressControlToken, readEgressControlToken } from "./controlToken";

describe("egress control token", () => {
  it("binds stop authority to egress and session", async () => {
    const token = await createEgressControlToken("EG_fixture", "ig_session", "secret-1");
    await expect(readEgressControlToken(token, "secret-1")).resolves.toEqual({
      egressId: "EG_fixture",
      sessionKey: "ig_session",
    });
    await expect(readEgressControlToken(token, "secret-2")).rejects.toThrow();
  });
});
