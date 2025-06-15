import LLM from './llm.js'
// import api from '/api.js'
// import { play_artist } from "./player.js"
import Kokoro from './speech.js'
import { ask, messages } from './open_ai.js'

const auth_button = document.getElementById('auth_button')
const send_button = document.getElementById('send_button')
const prompt_input = document.getElementById('prompt_input')

const state = {
  introduction: "Hello, I'm your new DJ. I'm going to be recommending some new music for you to listen to. Let's get started!",
  activeArtist: 0,
  artists: [{
    artist: "Londrelle",
    justification: "Lets manifest some moneeey."
  }]
}

const start_sequence = async (_state) => {
  // TODO send the history of played tracks
  const res = await ask('Find some songs from soundcloud for Frutiger Aero aethtetics. Respond with json object: {"justification": "Why this track", "track": "https://api.soundcloud.com/tracks/13692671"} and nothing else.')
  const payload = JSON.parse(res.output[2].content[0].text)
  console.log('track', payload.justification)
  // const res = await ask(messages)
  // state.introduction = res.introduction
  // state.artists = res.artists
  // await Kokoro.shared().init()
  // await Kokoro.shared().speak_text(state.introduction)
  play_artist(payload.track)
}

const revibe = async (_state) => {
  await Kokoro.shared().speak_text(_state.artists[_state.activeArtist].justification)
  await Kokoro.shared().speak_text(_state.artists[_state.activeArtist].track)
  play_artist(_state.artists[_state.activeArtist].track)
}

const more = async (_state) => {
  // api.refreshAuth()
  const payload = await ask(messages)
  console.log(payload)

  state.introduction = payload.introduction
  state.artists = payload.artists
  state.activeArtist = 0

  await Kokoro.shared().speak_text(state.introduction)
  return revibe(state)
}

const main = (controller) => {
  controller.addListener('ready', async () => {
    document.getElementById('revibe').addEventListener('click', async () => {
      await LLM.shared().init()
      await start_sequence(state, controller)
      api.refreshAuth()
    })
  })
  let timeout = 0;
  controller.addListener('playback_update', async e => {
    clearTimeout(timeout);
    timeout = setTimeout(async () => {
      console.log('update triggered')
      console.log('paused', e.data.isPaused)
      console.log('buffering', e.data.isBuffering)
      console.log('duration', e.data.duration)
      console.log('position', e.data.position)
      if (e.data.isPaused) {
        if (e.data.position === 0 && e.data.duration === 0) { // start of the new track
          console.log('track just started playing')
        } else if (e.data.position === 0) {
          console.log('track just finished playing')
          if (state.artists.length - 1 > state.activeArtist) {
            state.activeArtist += 1
            await revibe(state, controller)
          } else {
            state.activeArtist = 0
            await Promise.all([
              Kokoro.shared().speak_text("Hold on, lemme vibe it out!"),
              more(state, controller)
            ])
          }
        }
      }
    }, 6000);
  });
}

// window.onSpotifyIframeApiReady = (IFrameAPI) => {
//   const element = document.getElementById('embed-iframe');
//   // Set a default playlist to render before user interaction.
//   const options = {
//     uri: 'spotify:playlist:4j4GF3Ka6QsGqnjL17ju3k',
//     width: 400,
//     height: 400
//   };

//   IFrameAPI.createController(element, options, main);
// };

// api.init('devices')

// auth_button.addEventListener('click', () => {
//   api.requestAuth(
//     document.getElementById('clientId').value,
//     document.getElementById('clientSecret').value
//   )
// })

const widgetIframe = document.getElementById('sc-widget')
const widget = SC.Widget(widgetIframe)
const newSoundUrl = 'https://api.soundcloud.com/tracks/13692671'

const play_artist = (url) => {
  console.log('attempt to load', url)
  widget.load(url, { callback: () => widget.play() })
}

widget.bind(SC.Widget.Events.READY, async () => {
  document.getElementById('revibe').addEventListener('click', async () => {
    await LLM.shared().init()
    await start_sequence(state)
  })
  widget.bind(SC.Widget.Events.FINISH, async () => {
    if (state.artists.length - 1 > state.activeArtist) {
      state.activeArtist += 1
      await revibe(state)
    } else {
      state.activeArtist = 0
      await Promise.all([
        Kokoro.shared().speak_text("Hold on, lemme vibe it out!"),
        more(state)
      ])
    }
  });
  widget.bind(SC.Widget.Events.ERROR, async () => {
    console.log('caught exception')
    if (state.artists.length - 1 > state.activeArtist) {
      state.activeArtist += 1
      await revibe(state)
    } else {
      state.activeArtist = 0
      await Promise.all([
        Kokoro.shared().speak_text("Hold on, lemme vibe it out!"),
        more(state)
      ])
    }
  })
});

