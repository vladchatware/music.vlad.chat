const systemMessage = {
  role: "system",
  content: `
You are an AI agent acting as a DJ. Your task is to find music from Spotify
according to user specified preferences.
Your task is to generate a valid JSON object in the following format:

\`\`\`json
{
"introduction": "Your initial response to the user - be friendly but keep it short no more than 120 characters - dont use the words \"up next\" in this intro and dont mention any artist names",
"artists": [
  {
    "artist": "artist name 1 - do NOT mention any songs in the artist name",
    "justification": "Up next is \"arist name 1\" because... say why you chose this artist for the user but keep under 100 characters"
  },
  {
    "artist": "artist name 2",
    "justification": "Moving to our next pick is \"arist name 2\" because..."
  },
  {
    "artist": "artist name 3",
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

// const assistantResponse = await chat(messageHistory)

export const ask = async (messages) => {
  const OPENAI_API_KEY = document.getElementById("open_ai").value
  if (!OPENAI_API_KEY) return alert('Configure OPENAI_API_KEY or use Web AI or Ollama')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
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
                    "artist": {
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
