import { ask, messages, speech } from './ai.js'

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
  await speech(remix_indicator.innerText)
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

let history = []
let queue = []

const revibe = async () => {
  if (queue.length) {
    const track = queue.shift()
    history.push(track.track)
    remix_indicator.innerText = track.justification
    await speech(remix_indicator.innerText)
    return play_artist(track.track)
  }

  remix_indicator.style.visibility = 'visible'
  remix_indicator.innerText = 'Hold on, lemme vibe it out!'
  await speech(remix_indicator.innerText)
  const res = await ask(`
Find some songs from soundcloud for Frutiger Aero aethtetics.
Previous tracks: ${history.join(', ')}
Example justifications:
- Up next is "Artist Name" because...
- Moving to our next pick is "Artist Name" because...
- Finally our last pick is "Artist Name" because...
Respond with json object:
{
  "tracks": [{
      "justification": "Why this track", 
      "track": "https://api.soundcloud.com/tracks/13692671"
  }]
}
and nothing else.`)
  const payload = JSON.parse(res.output[2].content[0].text)
  console.log(payload)
  queue = payload.tracks

  return revibe()
}
