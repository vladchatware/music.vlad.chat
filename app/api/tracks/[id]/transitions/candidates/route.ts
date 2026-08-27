import { NextResponse, NextRequest } from 'next/server'
import { fetchQuery } from 'convex/nextjs'
import { api } from '../../../../../../convex/_generated/api'
import { rankTransitionCandidates, type DJPerformancePlan } from '@/lib/dj'
import { TRACK_ANALYSIS_VERSION } from '@/lib/trackAnalysis'

const ENERGY_ARCS = ["preserve", "build", "release", "reset"] as const

// Public ranked transition candidates for one analyzed track — the same
// ranking the backroom page renders, for external renderers and agents.
// GET /api/tracks/:id/transitions/candidates?arc=preserve&limit=5
export async function GET(req: NextRequest, { params }) {
  const { id } = await params
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Track ID is required' }, { status: 400 })
  }

  const arcParam = req.nextUrl.searchParams.get('arc') ?? 'preserve'
  const energyArc = (ENERGY_ARCS as readonly string[]).includes(arcParam)
    ? arcParam as DJPerformancePlan['energyArc']
    : 'preserve'
  const limit = Math.min(20, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 5)))

  try {
    // Same version fallback ladder as the analysis endpoint.
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

    const [analysis, candidateAnalyses] = await Promise.all([
      getByVersion(id),
      fetchQuery(api.trackAnalysis.listCandidates, {
        excludeTrackId: id,
        analysisVersion: TRACK_ANALYSIS_VERSION,
        limit: 20,
      }).catch(() => []),
    ])
    if (!analysis) {
      return NextResponse.json({ error: `No analysis found for track ${id}` }, { status: 404 })
    }

    const validCandidates = candidateAnalyses.filter(
      (candidate): candidate is NonNullable<typeof candidate> => Array.isArray(candidate?.segments),
    )
    const ranked = rankTransitionCandidates({
      outgoing: analysis,
      candidates: validCandidates,
      energyArc,
      limit,
    })

    return NextResponse.json(
      {
        outgoingTrackId: id,
        energyArc,
        candidates: ranked.map(({ analysis: candidate, suggestions }) => ({
          trackId: candidate.sourceTrackId,
          bpm: candidate.tempo.bpm,
          camelotKey: candidate.tonal.camelotKey ?? candidate.tonal.key,
          durationSec: candidate.durationSec,
          analysisVersion: candidate.analysisVersion,
          score: suggestions[0]?.score ?? 0,
          suggestion: suggestions[0] ?? null,
        })),
      },
      { headers: { 'Cache-Control': 'public, max-age=300' } },
    )
  } catch (e) {
    console.error('Transition candidates fetch failed:', e)
    return NextResponse.json({ error: 'Failed to load transition candidates' }, { status: 500 })
  }
}
