import { $ } from 'bun'

const image = 'pic.jpeg'
const username = 'vlad.chat'

const sequence = [
]

if (!sequence.length) {
  console.log('Error: provide a valid sequence')
  return 1
}

const process = (chunk: string[], i: number) => {
  return Promise.all(chunk.map(async (content, index) => {
    const s = i + index;
    const props = {
      image,
      username,
      content,
      sound: `speech-${s}.mp3`
    }
    const out = `sequence-${s}.mp4`
    await $`bun sound.ts "${props.content}" > ../public/speech-${s}.mp3`
    await $`npx remotion render index.ts  Main ${out} --props='${JSON.stringify(props)}'`
  }));
}

for (let i = 0; i < sequence.length; i += 10) {
  const chunk = sequence.slice(i, i + 10);
  await process(chunk, i);
}

