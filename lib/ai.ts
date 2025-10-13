const url = 'https://1e41f9fe8db4.ngrok-free.app' // CORS sensitive

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
Your task is to generate a valid JSON object in the following format:

\`\`\`json
{
"introduction": "Your initial response to the user - be friendly but keep it short no more than 120 characters - dont use the words \"up next\" in this intro and dont mention any artist names",
"artists": [
  {
    "track": "https://api.soundcloud.com/tracks/13692671",
    "justification": "Up next is \"arist name 1\" because... say why you chose this artist for the user but keep under 100 characters"
  },
  {
    "track": "https://api.soundcloud.com/tracks/13692671",
    "justification": "Moving to our next pick is \"arist name 2\" because..."
  },
  {
    "track": "https://api.soundcloud.com/tracks/13692671",
    "justification": "Finally our last pick is \"arist name 3\" because...r"
  }
]
}
\`\`\`
Using this JSON format recommend what new music artists they should listen to next based on the user's conversation text.
Be sure to use a lead in for the justification such as "up next" or "moving on".
Use lead ins like "To kick this off" or "First up" only for the first artist only.
Use "Finally" as the lead in for the last artist only.

By reading the user's conversation text, fill out the JSON object and respond with it.
Please ensure that the JSON object adheres to this structure and includes the specified fields.
Do not include any other fields or data.
Produce at least 5 artists in your response.
`
