const HLS_CONTENT_TYPES = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
];

/** @typedef {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} Fetcher */

const assertOk = (response, url) => {
  if (!response.ok) throw new Error(`Audio fetch failed with HTTP ${response.status}: ${url}`);
};

const joinArrayBuffers = (buffers) => {
  const size = buffers.reduce((total, buffer) => total + buffer.byteLength, 0);
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const buffer of buffers) {
    joined.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  return joined.buffer;
};

/**
 * @param {string} url
 * @param {Fetcher} [fetcher]
 */
export async function loadAudioBytes(url, fetcher = fetch) {
  const response = await fetcher(url);
  assertOk(response, url);
  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const isHls =
    HLS_CONTENT_TYPES.includes(contentType) ||
    new URL(response.url || url).pathname.toLowerCase().endsWith(".m3u8");
  if (!isHls) return bytes;

  const playlistUrl = response.url || url;
  const playlist = new TextDecoder().decode(bytes);
  if (/^#EXT-X-KEY:.*METHOD=(?!NONE(?:,|$))/m.test(playlist)) {
    throw new Error("Encrypted HLS streams are not supported");
  }
  const segmentUrls = playlist
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => new URL(line, playlistUrl).toString());
  if (segmentUrls.length === 0) throw new Error("HLS playlist contains no media segments");
  if (playlist.includes("#EXT-X-STREAM-INF")) {
    return loadAudioBytes(segmentUrls[0], fetcher);
  }

  const segments = await Promise.all(
    segmentUrls.map(async (segmentUrl) => {
      const segment = await fetcher(segmentUrl);
      assertOk(segment, segmentUrl);
      return segment.arrayBuffer();
    }),
  );
  return joinArrayBuffers(segments);
}
