import { FilesetResolver, LlmInference } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai';
import FileProxyCache from 'https://cdn.jsdelivr.net/gh/jasonmayes/web-ai-model-proxy-cache@main/FileProxyCache.min.js';
import { ask as _ask } from './steve.js'

const modelFileNameRemote = 'https://storage.googleapis.com/jmstore/WebAIDemos/models/Gemma2/gemma2-2b-it-gpu-int8.bin';
const modelFileName = 'https://localhost:3000/gemma2-2b-it-gpu-int8.bin';

export const extractJSON = (str) => {
  try {
    return JSON.parse(str.split('```json')[1].split('```')[0])
  } catch (e) {
    console.log('could not parse json', str)
    return null
  }
}

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

const messages = [systemMessage]

messages.push({
  role: "user",
  content: "Play Frutiger Aero songs, like 'U werent Here I really missed you' by cult member, Mirros Edge OST, Stray.wav, Hide by Dorian Concept."
})

const instructions = `
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


export default class LLM {
  static instance

  static shared() {
    if (!LLM.instance) {
      LLM.instance = new LLM()
    }

    return LLM.instance
  }

  local = false
  llm = null
  history = []

  async init() {
    if (!this.local) {
      console.log('Skip loading')
      return Promise.resolve()
    }
    console.log('Loading model')
    // const genaiFileset = await FilesetResolver.forGenAiTasks(
    //   'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm');

    // this.llm = await LlmInference.createFromOptions(genaiFileset, {
    //   baseOptions: {
    //     modelAssetPath: 'gemma2-2b-it-gpu-int8.bin'
    //   },
    //   maxTokens: 8000,
    //   topK: 1,
    //   temperature: 0.01, // More deterministic and focused.
    //   randomSeed: 64
    // });
    console.log('Model loaded')
  }

  async ask() {
    return {
  "introduction": "Let's dive into some ambient vibes and captivating sounds!",
  "artists": [
    {
      "track": "https://api.soundcloud.com/tracks/12345678",
      "justification": "To kick this off, this artist provides atmospheric beats perfect for immersion."
    },
    {
      "track": "https://api.soundcloud.com/tracks/23456789",
      "justification": "Next, this track has a dreamy quality that complements your taste in soundtracks."
    },
    {
      "track": "https://api.soundcloud.com/tracks/34567890",
      "justification": "Moving on, this piece offers a unique blend of electronic and emotional elements."
    },
    {
      "track": "https://api.soundcloud.com/tracks/45678901",
      "justification": "Next up, you'll love the intricate layers in this ambient composition."
    },
    {
      "track": "https://api.soundcloud.com/tracks/56789012",
      "justification": "Finally, this artist wraps up our list with chilling vibes that resonate deeply."
    }
  ]
}
    let entry = ''
    if (!this.history.length) {
      entry = `<start_of_turn>user\n ${instructions}<end_of_turn>\n<start_of_turn>model\n`
    } else {
      entry = `<start_of_turn>user\n play some more<end_of_turn\n<start_of_turn>model\n`
    }
    const res = await _ask([...this.history, entry].join(''), {
      model: 'llama3', stream: false, format: {
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
        },
        "required": [
          "introduction",
          "artists"
        ]
      }
    })
    // const res = await LLM.shared().llm.generateResponse(this.history.join(''))
    this.history[this.history.length] += `${res}<end_of_turn>\n`

    return JSON.parse(res)
  }
}
