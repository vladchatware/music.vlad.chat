import { describe, expect, it, vi } from "vitest";

import { loadAudioBytes } from "../../../public/audio/superpowered/hls-loader.js";

describe("loadAudioBytes", () => {
  it("returns direct audio bytes unchanged", async () => {
    const fetcher = vi.fn(async () =>
      new Response(Uint8Array.from([0x49, 0x44, 0x33, 1, 2, 3]), {
        headers: { "content-type": "audio/mpeg" },
      }),
    );

    const result = await loadAudioBytes("https://media.example/audio.mp3", fetcher);

    expect(Array.from(new Uint8Array(result))).toEqual([0x49, 0x44, 0x33, 1, 2, 3]);
  });

  it("loads and concatenates MP3 segments from an HLS media playlist", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://media.example/playlist.m3u8") {
        return new Response(
          [
            "#EXTM3U",
            "#EXT-X-VERSION:6",
            "#EXTINF:2.0,",
            "segment-1.mp3",
            "#EXTINF:2.0,",
            "audio/segment-2.mp3?sig=abc",
            "#EXT-X-ENDLIST",
          ].join("\n"),
          { headers: { "content-type": "audio/mpegurl" } },
        );
      }
      if (url === "https://media.example/segment-1.mp3") {
        return new Response(Uint8Array.from([1, 2, 3]));
      }
      if (url === "https://media.example/audio/segment-2.mp3?sig=abc") {
        return new Response(Uint8Array.from([4, 5]));
      }
      return new Response("missing", { status: 404 });
    });

    const result = await loadAudioBytes("https://media.example/playlist.m3u8", fetcher);

    expect(Array.from(new Uint8Array(result))).toEqual([1, 2, 3, 4, 5]);
  });

  it("follows an HLS master playlist before loading media segments", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://media.example/master.m3u8") {
        return new Response(
          ["#EXTM3U", "#EXT-X-STREAM-INF:BANDWIDTH=128000", "audio/media.m3u8"].join("\n"),
          { headers: { "content-type": "application/vnd.apple.mpegurl" } },
        );
      }
      if (url === "https://media.example/audio/media.m3u8") {
        return new Response(
          ["#EXTM3U", "#EXTINF:2.0,", "segment.mp3", "#EXT-X-ENDLIST"].join("\n"),
          { headers: { "content-type": "application/vnd.apple.mpegurl" } },
        );
      }
      if (url === "https://media.example/audio/segment.mp3") {
        return new Response(Uint8Array.from([9, 8, 7]));
      }
      return new Response("missing", { status: 404 });
    });

    const result = await loadAudioBytes("https://media.example/master.m3u8", fetcher);

    expect(Array.from(new Uint8Array(result))).toEqual([9, 8, 7]);
  });

  it("rejects encrypted HLS media instead of sending encrypted bytes to the decoder", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        [
          "#EXTM3U",
          '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
          "#EXTINF:2.0,",
          "segment.mp3",
        ].join("\n"),
        { headers: { "content-type": "audio/mpegurl" } },
      ),
    );

    await expect(loadAudioBytes("https://media.example/playlist.m3u8", fetcher)).rejects.toThrow(
      "Encrypted HLS streams are not supported",
    );
  });

  it("reports a failed HLS segment fetch", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("playlist.m3u8")) {
        return new Response(["#EXTM3U", "#EXTINF:2.0,", "missing.mp3"].join("\n"), {
          headers: { "content-type": "audio/mpegurl" },
        });
      }
      return new Response("missing", { status: 503 });
    });

    await expect(loadAudioBytes("https://media.example/playlist.m3u8", fetcher)).rejects.toThrow(
      "Audio fetch failed with HTTP 503: https://media.example/missing.mp3",
    );
  });
});
