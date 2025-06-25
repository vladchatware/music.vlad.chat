import { ask, messages, speech as play_sound, speech } from './ai.js'

const widgetIframe = document.getElementById('sc-widget')
window.player = SC.Widget(widgetIframe)

const revibe_button = document.getElementById('revibe')
const remix_indicator = document.getElementById('remix-indicator')
const inner_container = document.getElementById('inner-container')

window.player.bind(SC.Widget.Events.READY, async () => {
  inner_container.style.visibility = 'visible'
  revibe_button.addEventListener('click', async () => {
    await start_sequence()
  })
  window.player.bind(SC.Widget.Events.FINISH, async () => {
    // Hold on, lemme vibe it out
    inner_container.style.visibility = 'visible'
    await revibe()
  });
  window.player.bind(SC.Widget.Events.PAUSE, async () => {
    inner_container.style.visibility = 'visible'
  })
  window.player.bind(SC.Widget.Events.ERROR, async () => {
    // Error encountered
    inner_container.style.visibility = 'visible'
    console.log('Song error')
  })
})

window.play_sound = async (text) => {
  window.player.setVolume(30)
  const blob = await speech(text)
  return new Promise(async (res, rej) => {
    const audio = document.getElementById('control')
    audio.src = URL.createObjectURL(blob)
    audio.controls = true
    audio.muted = false
    audio.style.display = 'none'
    document.body.appendChild(audio)
    audio.play()
    audio.addEventListener('ended', () => {
      // audio.remove()
      window.player.setVolume(100)
      res()
    })
  })
}

window.start_sequence = async () => {
  if (revibe_button.disabled) return
  if (queue.length) return revibe()
  revibe_button.disabled = true
  remix_indicator.innerHTML = '<p>Hello, I am a virtual DJ, let me play some music.</p>'
  await window.play_sound('Hello, I am a virtual DJ, let me play some music.')
  return revibe()
}

window.play_artist = async (url) => {
  return new Promise((callback) => {
    window.player.load(url, {
      auto_play: true,
      show_artwork: true,
      show_comments: true,
      show_playcount: true,
      show_user: true,
      callback: () => {
        window.player.play()
        callback()
      }
    })
  })

  // return window.player.play()
}

const history = {
  get: () => window.localStorage.getItem('history'),
  push: (name) => {
    const _history = history.get()
    if (!_history) window.localStorage.setItem('history', `${name}`)

    window.localStorage.setItem('history', `${name}, ${history.get()}`)
  }
}

let queue = []

const revibe = async () => {
  if (queue.length) {
    inner_container.style.visibility = 'visible'
    const track = queue.shift()
    history.push(track.track)
    remix_indicator.innerHTML = `<p>${track.justification}</p>`
    await window.play_sound(track.justification)
    await window.play_artist(track.track)
    inner_container.style.visibility = 'hidden'
    return
  }

  inner_container.style.visibility = 'visible'
  remix_indicator.innerHTML = '<p>Hold on, lemme vibe it out!</p>'
  const [res] = await Promise.all([
    ask(`
Find some songs from soundcloud for Star Wars Flashback Disco
like as if it was in older star wars, dont repeat previous tracks
Previous tracks: ${history.get()}
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
and nothing else.`),
    window.play_sound('Hold on, lemme vibe it out!')
  ])
  const payload = JSON.parse(res.output[2].content[0].text)
  payload.tracks.map(track => console.log(`${track.justification}`))
  queue = payload.tracks

  revibe_button.disabled = false
  return revibe()
}
