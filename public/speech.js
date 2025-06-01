import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.1.1/dist/kokoro.web.js";

const AUDIO_GENERATOR = document.getElementById('player');
AUDIO_GENERATOR.volume = 1;
const AUDIO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX"

export default class Kokoro {
  static instance

  static shared() {
    if (!Kokoro.instance) {
      Kokoro.instance = new Kokoro()
    }

    return Kokoro.instance
  }

  tts = null
  speaking = false

  async init() {
    this.tts = await KokoroTTS.from_pretrained(AUDIO_MODEL_ID, {
      device: 'webgpu',
      dtype: "fp32", // Options: needs "fp32" for WebGPU.
    });
    console.log('Kokoro loaded')
  }

  speak_text(text) {
    this.playMultiSentence(text, AUDIO_GENERATOR, "bm_george");
    console.log('speaking', text)
  }

  async speakSentence(text, audioTarget, voiceName) {
    const AUDIO = await this.tts.generate(text, {
      // Use `tts.list_voices()` to list all available voices
      voice: voiceName,
    });
    audioTarget.src = await URL.createObjectURL(AUDIO.toBlob());
    audioTarget.load();
    console.log('Speaking sub part: ' + text);
    audioTarget.addEventListener('ended', function audioEndListener() {
      audioTarget.removeEventListener('ended', audioEndListener);
      Promise.resolve()
    });
  }

  async playMultiSentence(text, audioTarget, voiceName) {
    if (this.speaking) return Promise.resolve()

    this.speaking = true;
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
        await this.speakSentence(noMarkerSentence, audioTarget, voiceName);
      }
    }
    this.speaking = false;
  }
}
