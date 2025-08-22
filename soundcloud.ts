const { CLIENT_ID, CLIENT_SECRET } = process.env;

const endpoint = 'https://api.soundcloud.com'
const credentials: {
  access_token?: string,
  refresh_token?: string,
  expires_at?: number
} = {}

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

const readAccessToken = async () => {
  try {
    if (!credentials.access_token) return getAccessToken()

    if (credentials.access_token && Date.now() < credentials.expires_at!) {
      return credentials.access_token
    }

    if (credentials.refresh_token && Date.now() > credentials.expires_at!) {
      console.log('token expired, refreshing')
      return refreshToken(credentials.refresh_token)
    }

  } catch (e) {
    console.log('error', e)
    return null
  }
}

export const getAccessToken = async () => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Soundcloud client credentials not found in environment variables')
  }

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
    throw new Error(`Authentication failed with status: ${response.status}`);
  }

  const data = await response.json() as { access_token: string, refresh_token: string, expires_in: number };
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
    throw new Error(`Authentication failed with status: ${response.status}`);
  }
  const data = await response.json();

  credentials.access_token = data.access_token
  credentials.refresh_token = data.refresh_token
  credentials.expires_at = Date.now() + (data.expires_in * 1000)

  return credentials.access_token
}

export const users = async (query: {
  q?: string,
  limit?: string
}) => {
  const params = new URLSearchParams(query).toString()
  const access_token = await readAccessToken()
  const res = await fetch(`${endpoint}/users?${params}`, {
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json'
    }
  })
  const payload = await res.json() as User[]

  return payload
}

export type TracksQuery = {
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
}

export const tracks = async (query: TracksQuery) => {
  const access_token = await readAccessToken()
  console.log('Tracks api query params:', query)
  const params = new URLSearchParams(query).toString()
  const res = await fetch(`${endpoint}/tracks?${params}`, {
    headers: {
      Authorization: `Bearer ${access_token}`
    }
  })
  const payload = await res.json() as Track[]
  console.log('Tracks found:', payload.length)

  return payload
}

export const related = async (id) => {
  const access_token = await readAccessToken()
  const res = await fetch(`${endpoint}/tracks/soundcloud:tracks:${id}/related`, {
    headers: {
      Authorization: `Bearer ${access_token}`
    }
  })

  const payload = await res.json()

  return payload
}

export const playlists = async (query: {
  q?: string,
  limit?: string
}) => {
  const params = new URLSearchParams(query).toString()
  const access_token = await readAccessToken()
  const res = await fetch(`${endpoint}/playlists?${params}`, {
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json'
    }
  })
  const payload = await res.json() as Playlist[]

  return payload
}
