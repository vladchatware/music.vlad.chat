import { FilesetResolver, LlmInference } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai';
import FileProxyCache from 'https://cdn.jsdelivr.net/gh/jasonmayes/web-ai-model-proxy-cache@main/FileProxyCache.min.js';

const modelFileNameRemote = 'https://storage.googleapis.com/jmstore/WebAIDemos/models/Gemma2/gemma2-2b-it-gpu-int8.bin';
const modelFileName = 'https://localhost:3000/gemma2-2b-it-gpu-int8.bin';

export const extractJSON = (str) => JSON.parse(str.split('```json')[1].split('```')[0])

const instructions = `Imagine you are a party clown DJ who knows everything there is to know about music working for Spotify or YouTube music and throwing a Star Wars themed synth party. Your task is to generate a JSON object in the following format:

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

  llm = null
  history = [`<start_of_turn>user\n ${instructions}<end_of_turn>\n<start_of_turn>model\n`]

  async init() {
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
    const res = await LLM.shared().llm.generateResponse(this.history.join(''))
    this.history[this.history.length] += `${res}<end_of_turn>\n`

    return extractJSON(res)
  }
}
