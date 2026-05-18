import { NextResponse } from 'next/server'
import { setPersonalToken } from '../../../../../soundcloud'
import { fetchQuery } from "convex/nextjs"
import { api } from '../../../../../convex/_generated/api'
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server'

export async function GET() {
  try {
    const token = await convexAuthNextjsToken()
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const refreshToken = await fetchQuery(api.users.ownerRefreshToken, {}, { token })
    if (!refreshToken) {
      return NextResponse.json({ error: 'Not the app owner or no SoundCloud tokens' }, { status: 403 })
    }

    return NextResponse.json({ refreshToken })
  } catch {
    return NextResponse.json({ error: 'Failed to get token' }, { status: 500 })
  }
}

export async function POST() {
  try {
    const token = await convexAuthNextjsToken()
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const creds = await fetchQuery(api.users.mySoundcloudCredentials, {}, { token })
    if (!creds?.accessToken || !creds.refreshToken) {
      return NextResponse.json({ error: 'No SoundCloud tokens found' }, { status: 400 })
    }

    const ownerId = process.env.SOUNDCLOUD_USER_ID
    if (!ownerId || creds.soundcloudId !== ownerId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    setPersonalToken(creds.accessToken, creds.refreshToken)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to seed token' }, { status: 500 })
  }
}
