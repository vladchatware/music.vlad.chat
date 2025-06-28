import {$} from 'bun'

const image = 'path'
const username = 'vlad.chat'

const sequence = ['This is my first message.', 'This is my second message.']

let s = 0

for (const content of sequence) {
  s = s + 1
  const props = {
    image,
    username,
    content
  }
  const out = `sequence-${s}.mp4`
  await $`bun sound.ts "${props.content}" > ../public/speech.mp3`
  await $`npx remotion render remotion/index.ts  Main ${out} --props='${JSON.stringify(props)}'`
}

