import { NextResponse, NextRequest } from 'next/server'
import { fetchQuery } from 'convex/nextjs'
import { api } from '../../../../../convex/_generated/api'
import { suggestTransitionWindows, type DJPerformancePlan } from '@/lib/dj'
import { TRACK_ANALYSIS_VERSION } from '@/lib/trackAnalysis'

const ENERGY_ARCS = ["preserve", "build", "release", "reset"] as const

// Public read-only transition suggestions between two analyzed tracks so
// external renderers can time video transitions to real mix windows.
// GET /api/tracks/:id/transitions?with=<candidateTrackId>&arc=preserve
export async function GET(req: NextRequest, { params }) {
  const { id } = await params
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Track ID is required' }, { status: 400 })
  }

  const incomingId = req.nextUrl.searchParams.get('with') ?? ''
  if (!/^\d+$/.test(incomingId) || incomingId === id) {
    return NextResponse.json({ error: "A ?with=<candidateTrackId> query parameter is required" }, { status: 400 })
  }

  const arcParam = req.nextUrl.searchParams.get('arc') ?? 'preserve'
  const energyArc = (ENERGY_ARCS as readonly string[]).includes(arcParam)
    ? arcParam as DJPerformancePlan['energyArc']
    : 'preserve'

  try {
    // Same fallback ladder as the analysis endpoint: prefer the current
    // version, fall back to older stored versions so transitions keep
    // working across analysis-version upgrades.
    const getByVersion = async (trackId: string) => {
      for (const analysisVersion of [TRACK_ANALYSIS_VERSION, 'essentia-dj-v7']) {
        const result = await fetchQuery(api.trackAnalysis.getBySoundCloudId, {
          trackId,
          analysisVersion,
        }).catch(() => null)
        if (result) return result
      }
      return null
    }

    const [analysis, incomingAnalysis] = await Promise.all([
      getByVersion(id),
      getByVersion(incomingId),
    ])

    if (!analysis || !incomingAnalysis) {
      return NextResponse.json(
        { error: `No analysis found for track ${!analysis ? id : incomingId}` },
        { status: 404 },
      )
    }

    const suggestions = suggestTransitionWindows({ outgoing: analysis, incoming: incomingAnalysis, energyArc })
      .sort((a, b) => b.score - a.score)

    return NextResponse.json(
      { outgoingTrackId: id, incomingTrackId: incomingId, energyArc, suggestions },
      { headers: { 'Cache-Control': 'public, max-age=300' } },
    )
  } catch (e) {
    console.error('Transition suggestions fetch failed:', e)
    return NextResponse.json({ error: 'Failed to load transition suggestions' }, { status: 500 })
  }
}
