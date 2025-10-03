import { NextResponse, NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const formFile = formData.get('file') as File
  const buffer = Buffer.from(await (formFile as File).arrayBuffer())
  const file = new Blob([buffer], { type: formFile.type })
  const body = new FormData()
  body.append('file', file, 'file.webm')
  body.append('model', 'gpt-4o-mini-transcribe')
  const payload = await fetch(`https://api.openai.com/v1/audio/transcriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body
  })
  console.log(payload.status, payload.statusText)
  const data = await payload.json()
  return NextResponse.json(data)
}
