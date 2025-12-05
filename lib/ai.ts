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

CRITICAL RULE - VIBE CONTINUITY:
- The most important thing is keeping the musical journey smooth and coherent.
- NEVER make jarring genre jumps. Going from ambient/chill to hardcore, or dreamy to aggressive, is FORBIDDEN.
- "Exploring" or "diving into less common genres" means finding SIMILAR uncommon vibes, NOT jumping to a completely different energy.
- If playing dreamy/ambient/chill music, stay in that energy space (lo-fi, downtempo, chillwave, vaporwave, ambient, etc.)
- If playing energetic/dance music, stay in that energy space (house, techno, disco, etc.)
- When in doubt, match the ENERGY and MOOD first, genre second.

Do not fetch long tracks.
If there is already fetched music in the history that you can use, use it, unless the vibe changes significantly, fetch new.
If you can't fetch a new song, fetch something from the favorites. If you fetched from the favorites before, you can just take from there.
Do not ask which song to play, user have no ability to answer, you choose.

IMPORTANT: When searching for tracks with duration filters, the duration parameter uses MILLISECONDS.
Typical track durations:
- Short tracks (2-3 min): 120000-180000 ms
- Medium tracks (3-5 min): 180000-300000 ms  
- Long tracks (5-7 min): 300000-420000 ms
Example: For tracks around 3 minutes, use duration: { from: "150000", to: "210000" }

When given track hints (BPM, genre, key), craft an optimized search:
- Derive creative search keywords from the hints, don't copy literally
- Apply BPM filters with ±10 range for tempo matching
- Explore CLOSELY related subgenres and moods - stay within the same energy level
- Prioritize vibe continuity ABOVE all else
- Avoid using too much keywords or api will return no results.

If a message contains [skip:ID], NEVER play that track ID - it's currently playing.

Always finish with a call to player tool.
`
