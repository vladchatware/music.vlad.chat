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

const instructions = `Imagine you are a spotify DJ who knows everything there is to know about music
 working for Spotify.

Please play songs similar to 'DECKED' by VAPORCHROME. Focus on tracks that blend electronic, trap
and future bass genres, featuring pulsating basslines, ethereal synth melodies and
dynamic drum patterns. Include elements of hardcore breaks or dreampunk for an energetic yet
atmospheric vibe, with tempo around 130 bpm. Consider artists like Nuvrf, Bossa, Odetari or 
BACKGROUND and prioritize songs with immersive soundscapes and avant-garde production, similar to
those found in VAPORCHROME's Cybertrax - EP.

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
Using this JSON format recommend what new music artists they should listen to next based on the user's conversation text. Be sure to use a lead in for the justification such as "up next" or "moving on". Use lead ins like "To kick this off" or "First up" only for the first artist only. Use "Finally" as the lead in for the last artist only.

By reading the user's conversation text, fill out the JSON object and respond with it. Please ensure that the JSON object adheres to this structure and includes the specified fields. Do not include any other fields or data. Produce at least 5 artists in your response.
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
    const genaiFileset = await FilesetResolver.forGenAiTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm');

    this.llm = await LlmInference.createFromOptions(genaiFileset, {
      baseOptions: {
        modelAssetPath: 'gemma2-2b-it-gpu-int8.bin'
      },
      maxTokens: 8000,
      topK: 1,
      temperature: 0.01, // More deterministic and focused.
      randomSeed: 64
    });
    console.log('Model loaded')
  }

  async ask() {
    let entry = ''
    if (!this.history.length) {
      entry = `<start_of_turn>user\n ${instructions}<end_of_turn>\n<start_of_turn>model\n`
    } else {
      entry = `<start_of_turn>user\n one more round<end_of_turn\n<start_of_turn>model\n`
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
                "artist": {
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
