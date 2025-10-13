import { NextResponse, NextRequest } from 'next/server'
import { getAccessToken, streamTrack } from '../../../../../soundcloud'

export async function GET(req: NextRequest, { params }) {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Track ID is required' }, { status: 400 })
  }
  try {
    const res = await streamTrack(id)

    if (!res.ok) {
      return NextResponse.json({ error: 'Track not found' }, { status: res.status })
    }

    const headers = new Headers()
    if (res.headers.get('content-type')) {
      headers.set('content-type', res.headers.get('content-type')!)
    }
    if (res.headers.get('content-length')) {
      headers.set('content-length', res.headers.get('content-length')!)
    }

    return new NextResponse(res.body, { headers })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch track' }, { status: 500 })
  }
}
