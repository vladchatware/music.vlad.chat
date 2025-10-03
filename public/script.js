import { ask, messages, speech as play_sound, speech } from './ai.js'

const widgetIframe = document.getElementById('sc-widget')
window.player = SC.Widget(widgetIframe)

const connect = document.getElementById('connect')
const connect_image = document.getElementById('connect-image')
let connected = false

const revibe_button = document.getElementById('revibe')
const remix_indicator = document.getElementById('remix-indicator')
const inner_container = document.getElementById('inner-container')
const speech_button = document.getElementById('speech')
const audio = document.getElementById('control')

connect.addEventListener('click', (e) => {
  const params = new URLSearchParams({
    client_id: 'wrAA8ZBg2HQOEBcGNPt8qivFxrsn18pp',
    redirect_uri: 'http://localhost:3000/auth',
    response_type: 'code',
    //   code_challenge: '',
    //   code_challenge_method: '',
    //   state: ''
  })

  window.location.href = `https://secure.soundcloud.com/authorize?${params.toString()}`
})

speech_button.disabled = true

// connect with soundcloud
const urlParams = new URLSearchParams(window.location.search)
if (urlParams.has('access_token')) {
  connected = true
  speech_button.disabled = false
  connect_image.src = 'https://connect.soundcloud.com/2/btn-disconnect-s.png'
}

let started = false
let startTimeout = null
let pauseTimeout = null

inner_container.addEventListener('click', (e) => {
  if (e.target.id === 'revibe') return window.start_sequence()
  if (e.target.id === 'speech') return toggle_speech()
  if (e.target.id === 'inner-container') {
    inner_container.style.visibility = 'hidden'
  }
})

let track = null
let mediaRecorder = null
let chunks = []

const toggle_speech = async () => {
  if (track) {
    inner_container.classList.remove('speaking')
    speech_button.classList.remove('recording')
    track.stop()
    track = null
    return
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const tracks = stream.getTracks()
    track = tracks[0]

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/webm'
    })
    mediaRecorder.onstart = () => {
      speech_button.classList.add('recording')
    }
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data)
      }
    }
    mediaRecorder.onstop = async () => {
      speech_button.classList.remove('recording')
      const blob = new Blob(chunks)
      const body = new FormData()
      body.append('file', blob, 'file.webm')
      const res = await fetch(`https://music.vlad.chat/api/audio/transcriptions`, {
        method: 'POST',
        body
      })
      const payload = await res.json()
      console.log(payload)
      instructions = payload.text
      setTimeout(() => {
        inner_container.classList.remove('speaking')
        // instructions = 'Play some y2k music'
        queue.clear()
        history.clear()
        revibe()
      }, 1000)
      chunks = []
    }

    mediaRecorder.start(1000)
  } catch (e) {
    speech_button.disabled = true
    alert(`Recording has been disabled.`, e.message)
    console.log('video/webm is supported?', MediaRecorder.isTypeSupported('audio/webm'))
    // await window.play_sound('You gotta allow me to hear what ya saying bro')
  }
}

const unbind = () => {
  window.player.unbind(SC.Widget.Events.READY, window.player_ready)
  window.player.unbind(SC.Widget.Events.PLAY, window.player_play)
  window.player.unbind(SC.Widget.Events.PAUSE, window.player_pause)
  window.player.unbind(SC.Widget.Events.FINISH, window.player_finish)
}

window.player_ready = () => {
  console.log('player state: START')
  window.player.play()
}

window.player_play = () => {
  started = true
  if (!started) return

  clearTimeout(startTimeout)
  clearTimeout(pauseTimeout)
  startTimeout = setTimeout(() => {
    console.log('Player: PLAY')
    inner_container.style.visibility = 'hidden'
    window.obsstudio?.startRecording()
  }, 1000)
}

window.player_pause = () => {
  if (!started) return
  console.log('Player: PAUSE')
  clearTimeout(pauseTimeout)
  pauseTimeout = setTimeout(() => {
    window.obsstudio?.stopRecording()
    inner_container.style.visibility = 'visible'
  }, 3000)
}

window.player_finish = () => {
  console.log('Player: FINISH')
  window.obsstudio?.stopRecording()
  inner_container.style.visibility = 'visible'
  return revibe()
}

const rebind = () => {
  window.player.bind(SC.Widget.Events.READY, window.player_ready)
  window.player.bind(SC.Widget.Events.PLAY, window.player_play)
  window.player.bind(SC.Widget.Events.PAUSE, window.player_pause)
  window.player.bind(SC.Widget.Events.FINISH, window.player_finish)
}

rebind()

window.play_artist = async (url) => {
  unbind()
  await new Promise((callback) => {
    window.player.load(url, {
      auto_play: true,
      visual: true,
      show_comments: true,
      show_user: true,
      hide_related: true,
      show_reposts: true,
      callback: () => {
        window.innerHeight = 1280
        window.innerWidth = 720
        callback()
      }
    })
  })
  rebind()
}

window.play_sound = async (text) => {
  window.player.setVolume(30)
  inner_container.classList.add('speaking')
  const blob = await speech(text)
  speech_button.style.visibility = 'hidden'
  return new Promise(async (res, rej) => {
    audio.src = URL.createObjectURL(blob)
    audio.muted = false
    audio.autoplay = true
    audio.style.visibility = 'visible'
    audio.play()
    audio.onended = () => {
      window.player.setVolume(100)
      audio.style.visibility = 'hidden'
      speech_button.style.visibility = 'inherit'
      inner_container.classList.remove('speaking')
      delete audio.onended
      res()
    }
  })
}

window.start_sequence = async (e) => {
  if (revibe_button.disabled) return
  if (queue.length()) return revibe()

  revibe_button.disabled = true
  remix_indicator.innerHTML = '<p>Hello, I am a virtual DJ, let me play some music.</p>'
  await window.play_sound('Hello, I am a virtual DJ, let me play some music.')
  return revibe()
}

const history = {
  get: () => window.localStorage.getItem('history'),
  push: (name) => {
    const _history = history.get()
    if (!_history) window.localStorage.setItem('history', `${name}`)

    window.localStorage.setItem('history', `${name}, ${history.get()}`)
  },
  clear: () => {
    window.localStorage.setItem('history', '')
  }
}

const queue = {
  get: () => {
    const q = window.localStorage.getItem('queue')
    if (!q) return []

    try {
      const tracks = JSON.parse(q)
      return tracks
    } catch (e) {
      console.log('error retriving a queue')
      return []
    }
  },
  length: () => {
    const tracks = queue.get()
    return tracks.length
  },
  shift: () => {
    const tracks = queue.get()
    const track = tracks.shift()
    queue.set(tracks)
    return track
  },
  set: (tracks) => {
    window.localStorage.setItem('queue', JSON.stringify(tracks))
  },
  clear: () => {
    window.localStorage.setItem('queue', '[]')
  }
}

let limiter = 0
let instructions = `Find some songs from soundcloud for Star Wars Flashback Disco
like as if it was in older star wars, dont repeat previous tracks.`

const revibe = async () => {
  inner_container.classList.add('speaking')
  if (queue.length()) {
    const track = queue.shift()
    history.push(track.track)
    remix_indicator.innerHTML = `<p>${track.justification}</p>`
    window.obsstudio?.startRecording()
    await window.play_sound(track.justification)
    return window.play_artist(track.track)
  }

  remix_indicator.innerHTML = '<p>Hold on, lemme vibe it out!</p>'

  try {
    clearTimeout(limiter)
    limiter = setTimeout(async () => {

      const system_instructions = `
Use search to find the tracks.
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
and nothing else.
`

      await window.play_sound('Hold on, lemme vibe it out!')
      const res = await ask(`${instructions}\n ${system_instructions}`, urlParams.get('access_token'))
      const payload = JSON.parse(res.output[res.output.length - 1].content[0].text)
      payload.tracks.map(track => console.log(`${track.justification}`))
      queue.set(payload.tracks)

      revibe_button.disabled = false
      inner_container.classList.remove('speaking')
      return revibe()
    }, 3000)
  } catch (e) {
    await window.play_sound('Could not start bro, lets try one more time!')
    revibe_button.disabled = false
    inner_container.classList.remove('speaking')
    return revibe()
  }
}
