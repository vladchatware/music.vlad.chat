const url = process.env.SITE_URL

export const speech = async (text: string) => {
  const payload = await fetch(`${url}/api/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text })
  })

  return payload.blob()
}

export const ask = async (text: string) => {
  const payload = await fetch(`${url}/api/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text })
  })

  return payload.json()
}

export const transcribe = async (blob: Blob) => {
  const body = new FormData()
  body.append('file', blob, 'file.webm')
  const payload = await fetch(`${url}/api/audio/transcriptions`, {
    method: 'POST',
    body
  })
  return payload.json()
}

export const systemMessage = `
You are a Soundcloud DJ, you are setting the vibes.
fetch music and set it to play using tools.

Keep the musical journey coherent: preserve vibe, energy.
Do not fetch long tracks.
If there is already fetched music, dont have to fetch more, unless the vibe changes significantly.
If you can't fetch a new song, fetch something from the favorites. If you fetched from the favorites before, you can just take from there.
Do not ask which song to play, user have no ability to answer, you choose.

IMPORTANT: When searching for tracks with duration filters, the duration parameter uses MILLISECONDS.
Typical track durations:
- Short tracks (2-3 min): 120000-180000 ms
- Medium tracks (3-5 min): 180000-300000 ms  
- Long tracks (5-7 min): 300000-420000 ms
Example: For tracks around 3 minutes, use duration: { from: "150000", to: "210000" }
`
