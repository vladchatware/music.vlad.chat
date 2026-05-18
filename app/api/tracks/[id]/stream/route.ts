import { NextResponse } from 'next/server'
import { isPreviewStreamUrl, resolveTrackStreamUrl, seedFromConvexSettings } from '../../../../../soundcloud'
import { playbackDebugServer as playbackDebug } from '@/lib/playbackDebugServer'
import { fetchQuery } from "convex/nextjs"
import { api } from '../../../../../convex/_generated/api'
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server'

export async function GET(_req: Request, { params }) {
  const startedAt = Date.now()
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Track ID is required' }, { status: 400 })
  }
  try {
    playbackDebug('stream.route.begin', { trackId: id })
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

    const streamUrl = await resolveTrackStreamUrl(id, userToken)
    const preview = isPreviewStreamUrl(streamUrl)
    playbackDebug('stream.route.resolved', {
      trackId: id,
      hasUserToken: Boolean(userToken),
      preview,
      elapsedMs: Date.now() - startedAt,
      streamHost: (() => {
        try {
          return new URL(streamUrl).host
        } catch {
          return null
        }
      })(),
    })
    const headers = new Headers()
    headers.set('Location', streamUrl)
    headers.set('Cache-Control', 'private, max-age=30')
    headers.set('X-MP-Has-User-Token', userToken ? '1' : '0')
    headers.set('X-MP-Stream-Preview', preview ? '1' : '0')
    headers.set(
      'X-MP-Resolved-Host',
      (() => {
        try {
          return new URL(streamUrl).host
        } catch {
          return 'unknown'
        }
      })(),
    )
    return new NextResponse(null, { status: 307, headers })
  } catch (e) {
    playbackDebug('stream.route.failed', {
      trackId: id,
      elapsedMs: Date.now() - startedAt,
      message: e instanceof Error ? e.message : String(e),
    })
    return NextResponse.json({ error: 'Failed to resolve track stream URL' }, { status: 502 })
  }
}
