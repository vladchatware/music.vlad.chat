import {KokoroTTS} from "https://cdn.jsdelivr.net/npm/kokoro-js@1.1.1/dist/kokoro.web.js";
import {FilesetResolver, LlmInference} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai';
import FileProxyCache from 'https://cdn.jsdelivr.net/gh/jasonmayes/web-ai-model-proxy-cache@main/FileProxyCache.min.js';

const modelFileNameRemote = 'https://storage.googleapis.com/jmstore/WebAIDemos/models/Gemma2/gemma2-2b-it-gpu-int8.bin';
const modelFileName = 'https://100.85.190.119:3000/gemma2-2b-it-gpu-int8.bin';

const main = async () => {
  // Attempt to load from cache or localhost.
  let dataUrl = await FileProxyCache.loadFromURL(modelFileName, (text) => console.log('loading model:', text));
  // If failed due to no local file stored, fetch cloud version instead from cache or remote.
  if (dataUrl === null) {
   dataUrl = await FileProxyCache.loadFromURL(modelFileNameRemote, (text) => console.log('loading remote model:', text));
  }

  console.log('Model downloaded. Initializing on GPU... Please wait.')

  const genaiFileset = await FilesetResolver.forGenAiTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm');

  const llm = await LlmInference.createFromOptions(genaiFileset, {
    baseOptions: {
      modelAssetPath: dataUrl
    },
    maxTokens: 8000,
    topK: 1,
    temperature: 0.01, // More deterministic and focused.
    randomSeed: 64
  });

  console.log('llm', llm)
}

main()
