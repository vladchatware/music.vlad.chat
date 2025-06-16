const { CLIENT_ID, CLIENT_SECRET } = process.env;

const credentials = {}

const readAccessToken = async () => {
  try {
    if (!credentials.access_token) return getAccessToken()

    if (credentials.access_token && Date.now() < credentials.expires_at) {
      return credentials.access_token
    }

    if (credentials.refresh_token && Date.now() > credentials.expires_at) {
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
  ids?: string,
  urns?: string,
  limit?: string
}) => {
  const access_token = await readAccessToken()
  const res = await fetch('https://api.soundcloud.com/users', {
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json'
    },
    body: new URLSearchParams(query).toString()
  })
  const payload = await res.json()

  return payload
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
}) => {
  const access_token = await readAccessToken()
  const params = new URLSearchParams(query).toString()
  const res = await fetch(`https://api.soundcloud.com/tracks?${params}`, {
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
  const access_token = await readAccessToken()
  const res = await fetch('https://api.soundcloud.com/users', {
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json'
    },
    body: new URLSearchParams(query).toString()
  })
  const payload = await res.json()

  return payload
}
