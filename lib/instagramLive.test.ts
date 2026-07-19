import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { extractInstagramLiveComments, verifyMetaSignature } from "./instagramLive";

describe("Instagram Live webhook", () => {
  it("extracts change and top-level live comment payloads", () => {
    expect(extractInstagramLiveComments({
      object: "instagram",
      entry: [{
        id: "17841400000000000",
        changes: [{
          field: "live_comments",
          value: {
            id: "comment-1",
            from: { id: "viewer-1", username: "dancer_one" },
            text: "🔥",
            timestamp: 1_700_000_000,
          },
        }],
      }, {
        id: "17841400000000000",
        field: "live_comments",
        value: {
          id: "comment-2",
          from: { username: "dancer_two" },
          text: "jump",
        },
      }],
    })).toEqual([{
      instagramAccountId: "17841400000000000",
      comments: [{
        commentId: "comment-1",
        instagramUserId: "viewer-1",
        username: "dancer_one",
        text: "🔥",
        timestamp: 1_700_000_000_000,
      }, {
        commentId: "comment-2",
        instagramUserId: undefined,
        username: "dancer_two",
        text: "jump",
        timestamp: undefined,
      }],
    }]);
  });

  it("verifies Meta HMAC signatures", async () => {
    const body = JSON.stringify({ entry: [] });
    const secret = "fixture-secret";
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    await expect(verifyMetaSignature(body, `sha256=${signature}`, secret)).resolves.toBe(true);
    await expect(verifyMetaSignature(`${body}x`, `sha256=${signature}`, secret)).resolves.toBe(false);
  });
});
