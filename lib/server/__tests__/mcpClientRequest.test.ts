import { describe, expect, it } from "vitest";

import { getMcpClientRequest } from "../mcpClientRequest";

describe("getMcpClientRequest", () => {
  it("targets the current deployment and forwards its authentication cookie", () => {
    const request = new Request(
      "https://musicvladchat-preview.example/api/chat",
      { headers: { cookie: "_vercel_jwt=preview-token; session=user-token" } },
    );

    expect(getMcpClientRequest(request)).toEqual({
      url: new URL("https://musicvladchat-preview.example/api/mcp"),
      requestInit: {
        headers: {
          cookie: "_vercel_jwt=preview-token; session=user-token",
        },
      },
    });
  });
});
