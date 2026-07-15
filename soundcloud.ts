import { playbackDebugServer as playbackDebug } from "./lib/playbackDebugServer"
const CLIENT_ID = process.env.CLIENT_ID ?? process.env.SOUNDCLOUD_CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? process.env.SOUNDCLOUD_CLIENT_SECRET;
const SEEDED_ACCESS_TOKEN = process.env.SOUNDCLOUD_ACCESS_TOKEN;
const SEEDED_REFRESH_TOKEN = process.env.SOUNDCLOUD_REFRESH_TOKEN;
const SEEDED_EXPIRES_AT = Number(process.env.SOUNDCLOUD_ACCESS_TOKEN_EXPIRES_AT);



const credentials: {
  access_token?: string,
  refresh_token?: string,
  expires_at?: number
} = {
  access_token: SEEDED_ACCESS_TOKEN,
  refresh_token: SEEDED_REFRESH_TOKEN,
  expires_at: Number.isFinite(SEEDED_EXPIRES_AT) ? SEEDED_EXPIRES_AT : undefined,
}

export class SoundCloudAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'SoundCloudAuthError'
  }
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('retry-after')
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

const buildQueryString = (query: Record<string, string | undefined>) => {
  const params = new URLSearchParams()
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, value)
    }
  })
  return params.toString()
}

export type Track = {
  kind: string,
  id: number,
  urn: string,
  created_at: string,
  duration: number,
  commentable: boolean,
  comment_count: number,
  sharing: string,
  tag_list: string,
  streamable: boolean,
  embeddable_by: string,
  purchase_url?: string,
  purchase_title?: string,
  genre?: string,
  title: string,
  description?: string,
  label_name?: string | null,
  release?: string | null,
  key_signature?: string | null,
  isrc?: string | null,
  bpm?: number | null,
  release_year?: number | null,
  release_month?: number | null,
  release_day?: number | null,
  license: string,
  uri: string,
  user: User,
  permalink_url: string,
  artwork_url?: string | null, // can be null if no artwork is set
  stream_url?: string, // can be undefined if not streamable
  download_url?: string, // can be undefined if not downloadable
  waveform_url?: string, // can be undefined if no waveform is available
  available_country_codes?: any, // can be undefined if not available in any country codes
  secret_uri?: any, // can be undefined if not a secret track
}

export type User = {
  avatar_url: string,
  id: number,
  urn: string,
  kind: "user",
  permalink_url: string,
  uri: string,
  username: string,
  permalink: string,
  created_at: string,
  last_modified: string,
  first_name: string | null,
  last_name: string | null,
  full_name: string | null,
  city: string | null,
  description: string | null,
  country: string | null,
  track_count: number,
  public_favorites_count: number,
  reposts_count: number,
  followers_count: number,
  followings_count: number,
  plan: 'Free' | 'Pro' | 'Pro Unlimited',
  myspace_name: string | null,
  discogs_name: string | null,
  website_title: string | null,
  website: string | null,
  comments_count: number,
  online: boolean,
  likes_count: number,
  playlist_count: number,
  subscriptions: [
    {
      product: {
        id: string,
        name: string
      }
    }
  ]
}

export type Playlist = {
  duration: number,
  genre: string,
  release_day: number,
  permalink: string,
  permalink_url: string,
  release_month: number,
  release_year: number,
  description: string | null,
  uri: string,
  label_name: string | null,
  label_id: string | null,
  label: any,
  tag_list: string,
  track_count: number,
  user_id: number,
  user_urn: string,
  last_modified: string,
  license: string,
  user: User,
  playlist_type: "album" | "single" | "ep" | "compilation",
  type: "album" | "playlist",
  id: number,
  urn: string,
  downloadable: boolean | null,
  likes_count: number,
  repost_count: number,
  sharing: string,
  created_at: string,
  release: string | null,
  tags: string,
  kind: "playlist" | "album" | "single" | "ep" | "compilation",
  title: string,
  purchase_title: string | null,
  ean: string | null,
  streamable: boolean,
  embeddable_by: "all" | "me" | "none",
  artwork_url: string | null,
  purchase_url: string | null,
  tracks_uri: string,
  tracks: Track[],
}

export const readAccessToken = async () => {
  if (!credentials.access_token) return getAccessToken()

  if (credentials.access_token && Date.now() < (credentials.expires_at ?? 0)) {
    return credentials.access_token
  }

  if (credentials.refresh_token) return refreshToken(credentials.refresh_token)

  credentials.access_token = undefined
  return getAccessToken()
}

export const getAccessToken = async () => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Soundcloud client credentials not found in environment variables')
  }

  if (credentials.access_token) return credentials.access_token

  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://secure.soundcloud.com/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials'
  })

  if (!response.ok) {
    await response.body?.cancel()
    throw new SoundCloudAuthError(
      `Authentication failed with status: ${response.status}`,
      response.status,
      retryAfterMs(response),
    );
  }

  const data = await response.json();
  credentials.access_token = data.access_token
  credentials.refresh_token = data.refresh_token
  credentials.expires_at = Date.now() + (data.expires_in * 1000)

  return credentials.access_token
}

export const refreshToken = async (refresh_token) => {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://secure.soundcloud.com/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=refresh_token&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&refresh_token=${refresh_token}`
  })

  if (!response.ok) {
    await response.body?.cancel()
    throw new SoundCloudAuthError(
      `Authentication failed with status: ${response.status}`,
      response.status,
      retryAfterMs(response),
    );
  }
  const data = await response.json();

  credentials.access_token = data.access_token
  credentials.refresh_token = data.refresh_token
  credentials.expires_at = Date.now() + (data.expires_in * 1000)

  return credentials.access_token
}

export const refreshUserToken = async (refreshToken: string) => {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('Soundcloud client credentials not found')
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
  const response = await fetch('https://secure.soundcloud.com/oauth/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=refresh_token&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&refresh_token=${refreshToken}`
  })
  if (!response.ok) throw new Error(`Token refresh failed: ${response.status}`)
  const data = await response.json()
  return { accessToken: data.access_token, refreshToken: data.refresh_token }
}

export const users = async (query: {
  q?: string,
  ids?: string,
  urns?: string,
  limit?: string
}, userToken?: string) => {
  const access_token = userToken ?? await readAccessToken()
  const params = buildQueryString(query)
  const res = await fetch(`https://api.soundcloud.com/users${params ? `?${params}` : ''}`, {
    headers: {
      Authorization: `Bearer ${access_token}`,
    }
  })

  if (!res.ok) {
    throw new Error(res.statusText)
  }
  const payload = await res.json()

  return payload
}

export const track = async (id: string | number, userToken?: string) => {
  const access_token = userToken ?? await readAccessToken()
  if (!access_token) throw new Error('No access token available')
  const res = await fetch(`https://api.soundcloud.com/tracks/${id}`, {
    headers: {
      Authorization: `Bearer ${access_token}`,
    }
  })
  if (!res.ok) {
    const body = await res.text()
    const e = new Error(`SoundCloud API error ${res.status}: ${body}`)
    ;(e as any).status = res.status
    throw e
  }

  const track = await res.json()
  track.artwork_url = track.artwork_url?.replace('large', 'original')
  return track
}

export const resolveTrackStreamUrl = async (
  id: string | number,
  userToken?: string,
  timeoutMs = 8_000,
): Promise<string> => {
  const access_token = userToken ?? await readAccessToken()
  if (!access_token) throw new Error('No access token available')
  const res = await fetch(`https://api.soundcloud.com/tracks/soundcloud:tracks:${id}/streams`, {
    headers: { Authorization: `Bearer ${access_token}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const body = await res.text()
    const e = new Error(`SoundCloud API error ${res.status}: ${body}`)
    ;(e as any).status = res.status
    throw e
  }
  const body = await res.json() as { http_mp3_128_url?: string }
  if (!body.http_mp3_128_url) throw new Error('No full stream URL in response')
  const cdn = await fetch(body.http_mp3_128_url, {
    headers: {
      Authorization: `Bearer ${access_token}`,
      Range: 'bytes=0-0',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  })
  const resolvedUrl = cdn.url
  await cdn.body?.cancel()
  return resolvedUrl
}

export const tracks = async (query: {
  q?: string,
  ids?: string,
  urns?: string,
  genres?: string,
  tags?: string,
  'bpm[from]'?: string,
  'bpm[to]'?: string,
  'duration[from]'?: string,
  'duration[to]'?: string,
  'created_at[from]'?: string,
  'created_at[to]'?: string,
  limit?: string
}, userToken?: string) => {
  const access_token = userToken ?? await readAccessToken()
  const params = buildQueryString(query)
  const res = await fetch(`https://api.soundcloud.com/tracks${params ? `?${params}` : ''}`, {
    headers: {
      Authorization: `Bearer ${access_token}`
    }
  })

  if (!res.ok) {
    throw new Error(res.statusText)
  }

  const payload = await res.json()

  return payload
}

export const playlists = async (query: {
  q?: string,
  limit?: string
}, userToken?: string) => {
  const access_token = userToken ?? await readAccessToken()
  const params = buildQueryString(query)
  const res = await fetch(`https://api.soundcloud.com/playlists${params ? `?${params}` : ''}`, {
    headers: {
      Authorization: `Bearer ${access_token}`,
    }
  })

  if (!res.ok) {
    throw new Error(res.statusText)
  }
  const payload = await res.json()

  return payload
}

export const likes = async (userId: string, query?: {
  limit?: string
}, userToken?: string) => {
  const startedAt = Date.now()
  const access_token = userToken ?? await readAccessToken()
  const params = buildQueryString(query)
  playbackDebug("soundcloud.likes.begin", {
    userId,
    limit: query?.limit ?? null,
    hasUserToken: Boolean(userToken),
  })
  const res = await fetch(`https://api.soundcloud.com/users/${userId}/likes/tracks${params ? `?${params}` : ''}`, {
    headers: {
      Authorization: `Bearer ${access_token}`,
    }
  })
  playbackDebug("soundcloud.likes.response", {
    userId,
    limit: query?.limit ?? null,
    status: res.status,
    ok: res.ok,
    elapsedMs: Date.now() - startedAt,
  })

  if (!res.ok) {
    throw new Error(res.statusText)
  }

  return res.json() as Promise<Track[]>
}

export async function allLikes(userId: string, userToken?: string): Promise<Track[]> {
  const accessToken = userToken ?? await readAccessToken();
  let nextUrl: string | null = `https://api.soundcloud.com/users/${encodeURIComponent(userId)}/likes/tracks?linked_partitioning=true&limit=200`;
  const tracks: Track[] = [];
  const visited = new Set<string>();

  while (nextUrl) {
    if (visited.has(nextUrl)) throw new Error("SoundCloud likes pagination loop detected");
    visited.add(nextUrl);
    const url = new URL(nextUrl);
    if (url.origin !== "https://api.soundcloud.com") {
      throw new Error("SoundCloud likes pagination returned an unsafe URL");
    }
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`SoundCloud likes failed (${response.status})`);
    const page = await response.json() as Track[] | { collection?: Track[]; next_href?: string | null };
    if (Array.isArray(page)) {
      tracks.push(...page);
      break;
    }
    tracks.push(...(page.collection ?? []));
    nextUrl = page.next_href ?? null;
  }

  return tracks;
}
