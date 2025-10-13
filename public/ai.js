const url = 'https://music.vlad.chat' // CORS sensitive

export const speech = async (text) => {
  const payload = await fetch(`${url}/api/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      input: text,
      voice: 'ash'
    })
  })

  return payload.blob()
}

export const ask = async (input) => {
  const body = {
    model: 'gpt-5-mini',
    input,
    tools: [{
      type: 'mcp',
      server_label: 'soundcloud',
      server_url: `${url}/mcp`,
      require_approval: 'never',
      allowed_tools: ['tracks', 'users', 'playlists']
    }],
    text: {
      format: { type: 'json_object' }
    }
  }

  const res = await fetch(`${url}/api/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body)
  })
  return res.json()
}
