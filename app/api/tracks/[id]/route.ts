import { NextResponse, NextRequest } from 'next/server'
import { track } from '../../../../soundcloud'

export async function GET(req: NextRequest, { params }) {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Track ID is required' }, { status: 400 })
  }

  try {
    const _track = await track(id)

    if (!_track) return NextResponse.json({ error: 'Track not found' }, { status: 404 })

    return NextResponse.json(_track)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch track' }, { status: 500 })
  }
}
