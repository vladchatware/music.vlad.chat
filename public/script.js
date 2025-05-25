import {KokoroTTS} from "https://cdn.jsdelivr.net/npm/kokoro-js@1.1.1/dist/kokoro.web.js";
import {FilesetResolver, LlmInference} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai';
import FileProxyCache from 'https://cdn.jsdelivr.net/gh/jasonmayes/web-ai-model-proxy-cache@main/FileProxyCache.min.js';

const modelFileNameRemote = 'https://storage.googleapis.com/jmstore/WebAIDemos/models/Gemma2/gemma2-2b-it-gpu-int8.bin';
const modelFileName = 'https://localhost:3000/gemma2-2b-it-gpu-int8.bin';

const main = async () => {
  const genaiFileset = await FilesetResolver.forGenAiTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm');

  const llm = await LlmInference.createFromOptions(genaiFileset, {
    baseOptions: {
      modelAssetPath: 'gemma2-2b-it-gpu-int8.bin'
    },
    maxTokens: 8000,
    topK: 1,
    temperature: 0.01, // More deterministic and focused.
    randomSeed: 64
  });

  const res = await llm.generateResponse('Hello, how are you?')
  console.log(res)
}

main()
