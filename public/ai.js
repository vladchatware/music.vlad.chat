const url = 'https://music.vlad.chat' // CORS sensitive

const systemMessage = {
  role: "system",
  content: `
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
}

export const messages = [systemMessage]

messages.push({
  role: "user",
  content: "Play Frutiger Aero songs, like 'U werent Here I really missed you' by cult member or Mirros Edge OST."
})

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

export const ask = async (input, authorization) => {
  const body = {
    model: 'gpt-4o-mini',
    input,
    tools: [{
      type: 'mcp',
      server_label: 'soundcloud',
      server_url: `${url}/api/mcp`,
      require_approval: 'never',
      allowed_tools: ['tracks'],
      authorization
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

export const chat = async (messages) => {
  const res = await fetch(`${url}/api/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      response_format: {
        "type": "json_schema",
        "json_schema": {
          "name": "playback",
          "schema": {
            "type": "object",
            "properties": {
              "introduction": {
                "type": "string"
              },
              "artists": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "track": {
                      "type": "string"
                    },
                    "justification": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        }
      }
    })
  })
  const payload = await res.json()
  return JSON.parse(payload.choices[0].message.content)
}
