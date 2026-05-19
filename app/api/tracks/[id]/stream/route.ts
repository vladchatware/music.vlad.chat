import { NextResponse } from 'next/server'
import { resolveTrackStreamUrl, refreshUserToken } from '../../../../../soundcloud'
import { fetchQuery, fetchMutation } from "convex/nextjs"
import { api } from '../../../../../convex/_generated/api'
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server'

async function resolveStreamWithUserRefresh(id: string, convexToken: string) {
  const tokens = await fetchQuery(api.users.soundcloudTokens, {}, { token: convexToken })
  if (!tokens?.accessToken) return resolveTrackStreamUrl(id)

  try {
    return await resolveTrackStreamUrl(id, tokens.accessToken)
  } catch (e) {
    if ((e as any).status !== 401 || !tokens.refreshToken) throw e

    console.log('User SoundCloud token expired, refreshing...')
    const refreshed = await refreshUserToken(tokens.refreshToken)
    await fetchMutation(api.users.updateSoundcloudTokens, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
    }, { token: convexToken })
    return await resolveTrackStreamUrl(id, refreshed.accessToken)
  }
}

export async function GET(_req: Request, { params }) {
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
        const streamUrl = await resolveStreamWithUserRefresh(id, convexToken)
        const headers = new Headers()
        headers.set('Location', streamUrl)
        headers.set('Cache-Control', 'private, max-age=30')
        return new NextResponse(null, { status: 307, headers })
      } catch (e) {
        if ((e as any).status === 401) {
          return NextResponse.json(
            { error: 'SoundCloud session expired. Please sign in again.', code: 'TOKEN_EXPIRED' },
            { status: 401 },
          )
        }
        throw e
      }
    }

    const streamUrl = await resolveTrackStreamUrl(id)
    const headers = new Headers()
    headers.set('Location', streamUrl)
    headers.set('Cache-Control', 'private, max-age=30')
    return new NextResponse(null, { status: 307, headers })
  } catch (e) {
    console.error('Failed to resolve track stream URL:', e)
    return NextResponse.json({ error: 'Failed to resolve track stream URL' }, { status: 502 })
  }
}
