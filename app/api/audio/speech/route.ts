import { NextResponse, NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const payload = await fetch(`https://api.openai.com/v1/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  })

  const arrayBuffer = await payload.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length.toString()
    }
  })
}
