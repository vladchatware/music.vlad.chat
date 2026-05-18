import { NextResponse, NextRequest } from 'next/server'
import { track, seedFromConvexSettings } from '../../../../soundcloud'
import { fetchQuery } from "convex/nextjs"
import { api } from '../../../../convex/_generated/api'
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
        seedFromConvexSettings(token)
      }
    } catch {
      // User not authenticated, will use server credentials
    }

    const _track = await track(id, userToken)

    if (!_track) return NextResponse.json({ error: 'Track not found' }, { status: 404 })

    return NextResponse.json(_track)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch track' }, { status: 500 })
  }
}
