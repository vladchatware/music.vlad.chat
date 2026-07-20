import { NextResponse } from 'next/server'
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server'
import { getErrorStatus } from '@/lib/server/httpError'
import { resolveStreamWithTimeout } from './streamResolver'

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

    const streamUrl = await resolveStreamWithTimeout(id, convexToken)
    const headers = new Headers()
    headers.set('Location', streamUrl)
    headers.set('Cache-Control', 'private, max-age=30')
    return new NextResponse(null, { status: 307, headers })
  } catch (e) {
    if (getErrorStatus(e) === 401) {
      return NextResponse.json(
        { error: 'SoundCloud session expired. Please sign in again.', code: 'TOKEN_EXPIRED' },
        { status: 401 },
      )
    }
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      return NextResponse.json({ error: 'Stream resolution timed out' }, { status: 504 })
    }
    console.error('Failed to resolve track stream URL:', e)
    return NextResponse.json({ error: 'Failed to resolve track stream URL' }, { status: 502 })
  }
}
