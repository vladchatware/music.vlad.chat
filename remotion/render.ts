import { $ } from 'bun'

const image = 'pic.jpeg'
const username = 'vlad.chat'


const sequence = [
  "This video has been rendered using react and Remotion",
  "If you have an interesting startup idea and you are funded. Hit me up, let's collaborate!"
]
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

