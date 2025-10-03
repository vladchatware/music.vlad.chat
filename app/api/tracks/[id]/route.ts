import { NextResponse, NextRequest } from 'next/server'

export async function GET(req: NextRequest, { params }) {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Track ID is required' }, { status: 400 })
  }

  try {
    const res = await fetch(`https://api.soundcloud.com/tracks/${id}?client_id=${process.env.CLIENT_ID}`)
    if (!res.ok) {
      return NextResponse.json({ error: 'Track not found' }, { status: res.status })
    }

    const track = await res.json()
    return NextResponse.json(track)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch track' }, { status: 500 })
  }
}
