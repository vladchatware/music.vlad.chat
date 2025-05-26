import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.1.1/dist/kokoro.web.js";
import { FilesetResolver, LlmInference } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai';
import FileProxyCache from 'https://cdn.jsdelivr.net/gh/jasonmayes/web-ai-model-proxy-cache@main/FileProxyCache.min.js';
import spotify from '/spotify.js'

const modelFileNameRemote = 'https://storage.googleapis.com/jmstore/WebAIDemos/models/Gemma2/gemma2-2b-it-gpu-int8.bin';
const modelFileName = 'https://localhost:3000/gemma2-2b-it-gpu-int8.bin';

const extractJSON = (str) => JSON.parse(str.split('```json')[1].split('```')[0])
const auth_button = document.getElementById('auth_button')
let llm;

const bootstrap = async () => {
  console.log('Loading model')
  const genaiFileset = await FilesetResolver.forGenAiTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm');

  llm = await LlmInference.createFromOptions(genaiFileset, {
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

  const send_button = document.getElementById('send_button')
  const prompt_input = document.getElementById('prompt_input')
  
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

  const history = [`<start_of_turn>user\n ${instructions}<end_of_turn>\n<start_of_turn>model\n`]

const request_song = async () => {
  const res = await llm.generateResponse(history.join(''))
  history[0] += `${res}<end_of_turn>\n`

  const msg = extractJSON(res)
  console.log(msg)

  playlistIndex = 0
  spotController.pause()

  await speak_text(msg.introduction)
  await speak_text(msg.artists[0].justification)
  
  play_artist(msg.artists[0].artist)

  generatedList = msg
}


window.onSpotifyIframeApiReady = (IFrameAPI) => {
  const element = document.getElementById('embed-iframe');
  // Set a default playlist to render before user interaction.
  const options = {
    uri: 'spotify:playlist:4j4GF3Ka6QsGqnjL17ju3k'
  };

  IFrameAPI.createController(element, options, spotifyCallback);
};

const speak_text = (text) =>
  playMultiSentence(text, AUDIO_GENERATOR, "bm_george");

const play_artist = (artist) => {
  playlistIndex++
  spotify.call('GET', 'https://api.spotify.com/v1/search?q='+ artist + '&type=artist', null, function(data) {
    if ( this.status == 200 ) {
      var data = JSON.parse(this.responseText);
      console.log(data);
      spotify.call('GET', 'https://api.spotify.com/v1/artists/' + data.artists.items[0].id + '/top-tracks', null, function(data) {
        if (this.status == 200) {
          var data = JSON.parse(this.responseText);
          console.log(data);
          spotController.loadUri(data.tracks[0].uri);
          spotController.play();
          playing = true
        }
      });
    }
    else if (this.status == 401) {
      spotify.refreshAuth();
    }
    else {
      console.log(this.responseText);
    }
  })
}

let spotController;
let generatedList = undefined;
let playlistIndex = 0;
let playing = false;
let backoff = 2000;
let notJustLoaded = true;
let lastPlaybackUpdate = 0;
let agentPause = false;

function spotifyCallback(EmbedController) {
  spotController = EmbedController;
  let timeout = 0;
  spotController.addListener('playback_update', async e => {
    clearTimeout(timeout);
    timeout = setTimeout(async function() {
      // lastPlaybackUpdate++
      // console.log('playback_update', lastPlaybackUpdate)
      // console.log('notJustLoaded', notJustLoaded)
      // console.log('speaking', speaking)
      // console.log('agentPause', agentPause)
      // if (lastPlaybackUpdate >= 2 && notJustLoaded && !speaking && !agentPause) {
        // lastPlaybackUpdate = 0
        // Song ended or was paused by spotify auto play next.
        if (playlistIndex < generatedList.artists.length) {
          // notJustLoaded = false;
          spotController.pause();
          // Announce the next song.
          await speak_text(generatedList.artists[playlistIndex].justification)
            // Play the next song.
          play_artist(generatedList.artists[playlistIndex].artist);
        } else {
          playing = false
          await request_song()
        }
      // }
    }, 6000);
  });
}

auth_button.addEventListener('click', () => {
  spotify.requestAuth(document.getElementById('clientId').value, document.getElementById('clientSecret').value)
})

const AUDIO_GENERATOR = document.getElementById('player');
AUDIO_GENERATOR.volume = 1;
const AUDIO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX"
let tts = undefined;
let speaking = false;

async function loadKokoro() {
  tts = await KokoroTTS.from_pretrained(AUDIO_MODEL_ID, {
    device: 'webgpu',
    dtype: "fp32", // Options: needs "fp32" for WebGPU.
  });
}

async function speakSentence(text, audioTarget, voiceName) {
  return new Promise(async function(resolve) {
    const AUDIO = await tts.generate(text, {
      // Use `tts.list_voices()` to list all available voices
      voice: voiceName,
    });
    audioTarget.src = await URL.createObjectURL(AUDIO.toBlob());
    audioTarget.load();
    console.log('Speaking sub part: ' + text);
    audioTarget.addEventListener('ended', function audioEndListener() {
      audioTarget.removeEventListener('ended', audioEndListener);
      resolve();
    });
  });
}


async function playMultiSentence(text, audioTarget, voiceName) {
  if (!speaking) {
    speaking = true;
    return new Promise(async function(resolve) {
      // Temporary marker for abbreviations.
      const TEMP_MARKER = '__TEMP_JM_ABBR__';
      // Step 1: Replace periods in abbreviations with a unique marker.
      let tempText = text.replace(/\b[A-Za-z]{1,3}\.(?=\s)/g, match => match + TEMP_MARKER);
      // Step 2: Split based on periods followed by space (end of sentence)
      let sentenceArray = tempText.split('. ');
      for (let n = 0; n < sentenceArray.length; n++) {
        let trimmedSentence = sentenceArray[n].trim();
        if (trimmedSentence !== '') {
          let noMarkerSentence = trimmedSentence.replace(TEMP_MARKER, '');
          await speakSentence(noMarkerSentence, audioTarget, voiceName);
        }
      }
      speaking = false;
      resolve();
    });
  }
  return Promise.resolve()
}

const main = async () => {
  spotify.init('devices')
  await loadKokoro()
  console.log('kokoro loaded')
  generatedList = {
    "introduction": "Hello, I'm your new DJ. I'm going to be recommending some new music for you to listen to. Let's get started!",
    "artists": [
      {
        "artist": "Londrelle",
        "justification": "Lets manifest some moneeeeey"
      },
      {
        "artist": "Kendrick Lamar",
        "justification": "I'm feeling a little gangsta today"
      },
      {
        "artist": "Drake",
        "justification": "I'm feeling a little Drake today"
      }
    ]
  }
  await speak_text(generatedList.introduction)
  await speak_text(generatedList.artists[0].justification)
  play_artist(generatedList.artists[0].artist)
  await bootstrap()
  await request_song()
  
  // send_button.addEventListener('click', async (e) => {
  //   // request a song
  //   e.preventDefault()
  //   console.log('Asking')
  //   history.push(`<start_of_turn>user\n ${prompt_input.value}<end_of_turn>\n<start_of_turn>model\n`)
  //   const res = await llm.generateResponse(history.join(''))
  //   console.time(res)
  //   history.push(`${res}<end_of_turn>\n`)
  // })
}

main()
