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
`
