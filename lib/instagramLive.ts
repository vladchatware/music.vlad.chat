export type InstagramLiveComment = {
  commentId: string;
  instagramUserId?: string;
  username: string;
  text: string;
  timestamp?: number;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? value as UnknownRecord : null;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function extractInstagramLiveComments(payload: unknown): Array<{
  instagramAccountId: string;
  comments: InstagramLiveComment[];
}> {
  const root = record(payload);
  if (!root || !Array.isArray(root.entry)) return [];
  const grouped = new Map<string, InstagramLiveComment[]>();

  for (const rawEntry of root.entry) {
    const entry = record(rawEntry);
    if (!entry) continue;
    const instagramAccountId = string(entry.id);
    if (!instagramAccountId) continue;
    const candidates: UnknownRecord[] = [];

    if (entry.field === "live_comments") {
      const value = record(entry.value);
      if (value) candidates.push(value);
    }
    if (Array.isArray(entry.changes)) {
      for (const rawChange of entry.changes) {
        const change = record(rawChange);
        if (change?.field !== "live_comments") continue;
        const value = record(change.value);
        if (value) candidates.push(value);
      }
    }

    for (const value of candidates) {
      const from = record(value.from);
      const commentId = string(value.id);
      const username = string(from?.username);
      if (!commentId || !username) continue;
      const timestampSeconds = typeof value.timestamp === "number" ? value.timestamp : undefined;
      const comments = grouped.get(instagramAccountId) ?? [];
      comments.push({
        commentId,
        instagramUserId: string(from?.id),
        username,
        text: string(value.text) ?? "",
        timestamp: timestampSeconds === undefined ? undefined : timestampSeconds * 1000,
      });
      grouped.set(instagramAccountId, comments);
    }
  }

  return [...grouped].map(([instagramAccountId, comments]) => ({
    instagramAccountId,
    comments,
  }));
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

export async function verifyMetaSignature(
  body: string,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=") || !appSecret) return false;
  const signature = hexToBytes(signatureHeader.slice("sha256=".length));
  if (!signature) return false;
  const signatureBytes = new Uint8Array(signature.length);
  signatureBytes.set(signature);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(body));
}
