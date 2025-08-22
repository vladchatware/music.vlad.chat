import { IgtvApi, UserApi, VideoApi } from "./apis"
import fs from 'node:fs'
import path from 'node:path'
import ffmpeg from 'fluent-ffmpeg'

const sessionid = '1555050288%3AgyLlrLYXJUgwnz%3A28%3AAYcTZ-3AJns1qywemVcjYaAkmS9KJHmgYVxkDwz-Xw'
const filepath = path.join('D:', 'mp3', '2025-07-03 13-11-03.mp4')
const outputpath = path.join('D:', 'mp3', 'output.mp4')

await Bun.$`D:\\mp3\\ffmpeg.exe -i ${filepath} -t 90 ${outputpath} -y`

const filebuffer = fs.readFileSync(outputpath)

const blob = new Blob([filebuffer], { type: 'audio/mpeg' })

const userAPI = new UserApi({
    basePath: 'http://localhost:8000',
    middleware: []
})

// const info = await userAPI.userIdFromUsernameUserIdFromUsernamePost({
//     sessionid,
//     username: 'music.vlad.chat'
// })

const videoAPI = new VideoApi({
    basePath: 'http://localhost:8000',
    middleware: []
})

const igtv = new IgtvApi({
    basePath: 'http://localhost:8000',
    middleware: []
})

// const res = await igtv.igtvUploadIgtvUploadPost({
//     sessionid,
//     title: 'Dream sequence',
//     caption: 'Dream sequence',
//     file: blob
// })

const res = await videoAPI.videoUploadVideoUploadPost({
    sessionid,
    caption: '#soundcloudfinds #agenticai',
    file: blob
})

console.log(res)

