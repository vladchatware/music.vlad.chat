import { NextResponse, NextRequest } from 'next/server'
import { track, refreshUserToken } from '../../../../soundcloud'
import { fetchQuery, fetchMutation } from "convex/nextjs"
import { api } from '../../../../convex/_generated/api'
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server'
import { enqueueTrackAnalysis } from '@/lib/server/analysisQueue'
import { getErrorRetryAfterMs, getErrorStatus } from '@/lib/server/httpError'

async function fetchTrackWithUserRefresh(id: string, convexToken: string) {
  const tokens = await fetchQuery(api.users.soundcloudTokens, {}, { token: convexToken })
  if (!tokens?.accessToken) return track(id)

  try {
    return await track(id, tokens.accessToken)
  } catch (e) {
    if (getErrorStatus(e) !== 401 || !tokens.refreshToken) throw e

    console.log('User SoundCloud token expired, refreshing...')
    const refreshed = await refreshUserToken(tokens.refreshToken)
    await fetchMutation(api.users.updateSoundcloudTokens, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
    }, { token: convexToken })
    return await track(id, refreshed.accessToken)
  }
}

export async function GET(req: NextRequest, { params }) {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Track ID is required' }, { status: 400 })
  }

  try {
    let convexToken: string | undefined
    try {
      convexToken = await convexAuthNextjsToken()
    } catch {}

    if (convexToken) {
      try {
        const _track = await fetchTrackWithUserRefresh(id, convexToken)
        if (!_track) return NextResponse.json({ error: 'Track not found' }, { status: 404 })
        await enqueueTrackAnalysis(id, 100).catch(() => false)
        return NextResponse.json(_track)
      } catch (e) {
        if (getErrorStatus(e) === 401) {
          return NextResponse.json(
            { error: 'SoundCloud session expired. Please sign in again.', code: 'TOKEN_EXPIRED' },
            { status: 401 },
          )
        }
        throw e
      }
    }

    const _track = await track(id)
    if (!_track) return NextResponse.json({ error: 'Track not found' }, { status: 404 })
    await enqueueTrackAnalysis(id, 100).catch(() => false)
    return NextResponse.json(_track)
  } catch (e) {
    if (getErrorStatus(e) === 429) {
      const headers = new Headers()
      const retryAfterMs = getErrorRetryAfterMs(e)
      if (retryAfterMs !== null) headers.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)))
      return NextResponse.json(
        { error: 'SoundCloud rate limit reached. Try again later.', code: 'RATE_LIMITED' },
        { status: 429, headers },
      )
    }
    console.error('Failed to fetch track:', e)
    return NextResponse.json({ error: 'Failed to fetch track' }, { status: 500 })
  }
}
