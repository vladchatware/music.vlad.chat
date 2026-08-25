import { NextResponse, NextRequest } from 'next/server'
import { fetchQuery } from 'convex/nextjs'
import { api } from '../../../../../convex/_generated/api'
import { TRACK_ANALYSIS_VERSION } from '@/lib/trackAnalysis'

// Public read-only access to a track's stored analysis (essentia metrics plus
// semantic segments) so external renderers can display per-track pages.
export async function GET(_req: NextRequest, { params }) {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Track ID is required' }, { status: 400 })
  }

  try {
    // Current version first, falling back to older stored versions.
    for (const analysisVersion of [TRACK_ANALYSIS_VERSION, 'essentia-dj-v7']) {
      const result = await fetchQuery(api.trackAnalysis.getBySoundCloudId, {
        trackId: id,
        analysisVersion,
      })
      if (result) {
        return NextResponse.json(result, {
          headers: { 'Cache-Control': 'public, max-age=86400' },
        })
      }
    }

    return NextResponse.json(
      { error: `No analysis found for track ${id}` },
      { status: 404 },
    )
  } catch (e) {
    console.error('Track analysis fetch failed:', e)
    return NextResponse.json({ error: 'Failed to load analysis' }, { status: 500 })
  }
}
