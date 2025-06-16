import { ask, messages } from './ai.js'

const widgetIframe = document.getElementById('sc-widget')
const widget = SC.Widget(widgetIframe)

const revibe_button = document.getElementById('revibe')
const remix_indicator = document.getElementById('remix-indicator')

widget.bind(SC.Widget.Events.READY, async () => {
  revibe_button.addEventListener('click', async () => {
    await start_sequence()
  })
  widget.bind(SC.Widget.Events.FINISH, async () => {
    // Hold on, lemme vibe it out
    await revibe()
  });
  widget.bind(SC.Widget.Events.ERROR, async () => {
    // Error encountered
    console.log('Song error')
  })
})

const start_sequence = async () => {
  remix_indicator.style.visibility = 'visible'
  remix_indicator.innerText = 'Hello, I am a virtual DJ, let me play some music.'
  revibe_button.disabled = true
  await revibe()
  revibe_button.disabled = false
}

const play_artist = async (url) => {
  await new Promise((callback) => {
    widget.load(url, { callback })
  })
  return widget.play()
}

const revibe = async () => {
  remix_indicator.style.visibility = 'visible'
  remix_indicator.innerText = 'Remixing...'
  const res = await ask('Find some songs from soundcloud for Frutiger Aero aethtetics. Respond with json object: {"justification": "Why this track", "track": "https://api.soundcloud.com/tracks/13692671"} and nothing else.')
  const payload = JSON.parse(res.output[2].content[0].text)
  remix_indicator.innerText = payload.justification
  return play_artist(payload.track)
}
