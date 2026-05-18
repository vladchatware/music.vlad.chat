import { NextResponse } from 'next/server'
import { resolveTrackStreamUrl } from '../../../../../soundcloud'
import { fetchQuery } from "convex/nextjs"
import { api } from '../../../../../convex/_generated/api'
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server'

export async function GET(_req: Request, { params }) {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Track ID is required' }, { status: 400 })
  }
  try {
    let userToken: string | undefined
    try {
      const token = await convexAuthNextjsToken()
      if (token) {
        userToken = await fetchQuery(api.users.soundcloudToken, {}, { token }) ?? undefined
      }
    } catch {}

    const streamUrl = await resolveTrackStreamUrl(id, userToken)
    const headers = new Headers()
    headers.set('Location', streamUrl)
    headers.set('Cache-Control', 'private, max-age=30')
    return new NextResponse(null, { status: 307, headers })
  } catch {
    return NextResponse.json({ error: 'Failed to resolve track stream URL' }, { status: 502 })
  }
}
