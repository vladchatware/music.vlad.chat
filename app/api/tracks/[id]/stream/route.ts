import { NextResponse, NextRequest } from 'next/server'
import { streamTrack } from '../../../../../soundcloud'
import { fetchQuery } from "convex/nextjs"
import { api } from '../../../../../convex/_generated/api'
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server'

export async function GET(req: NextRequest, { params }) {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Track ID is required' }, { status: 400 })
  }
  try {
    // Try to get the user's SoundCloud token if they're authenticated
    let userToken: string | undefined
    try {
      const token = await convexAuthNextjsToken()
      if (token) {
        userToken = await fetchQuery(api.users.soundcloudToken, {}, { token }) ?? undefined
      }
    } catch {
      // User not authenticated, will use server credentials
    }

    const res = await streamTrack(id, userToken)

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
