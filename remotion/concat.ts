import { $ } from 'bun'

const files = await $`ls sequence-*.mp4 | sort -V`.text()
const lines = files.split('\n').map(f => f ? `file '${f}'\n` : '\n')

await Bun.write('videos.txt', lines.join(''))

await $`ffmpeg -f concat -i videos.txt -c copy output.mp4`

await Bun.file('videos.txt').delete()
