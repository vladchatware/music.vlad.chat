import { ImageResponse } from 'next/og'
import { fetchQuery } from 'convex/nextjs'

import { api } from '@/convex/_generated/api'
import { TRACK_ANALYSIS_VERSION } from '@/lib/trackAnalysis'
import { track } from '@/soundcloud'

export const alt = 'Revibe track analysis'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const runtime = 'nodejs'
// Next caches each dynamic track path separately. Analysis may arrive later,
// so refresh the track-specific image without regenerating it on every request.
export const revalidate = 300

const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

const percent = (value: number | null | undefined) =>
  value == null ? '—' : `${Math.round(value * 100)}%`

export default async function OpenGraphImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [soundcloudTrack, analysis] = await Promise.all([
    /^\d+$/.test(id) ? track(id).catch(() => null) : null,
    /^\d+$/.test(id)
      ? fetchQuery(api.trackAnalysis.getBySoundCloudId, {
          trackId: id,
          analysisVersion: TRACK_ANALYSIS_VERSION,
        }).catch(() => null)
      : null,
  ])

  const artwork = soundcloudTrack
    ? soundcloudTrack.artwork_url?.replace('-large', '-t500x500') ?? soundcloudTrack.user.avatar_url
    : null
  const durationSec = soundcloudTrack ? soundcloudTrack.duration / 1000 : analysis?.durationSec ?? 0
  const segmentEnergy = analysis?.segments
    ?.map((segment) => segment.energy)
    .filter((value): value is number => Number.isFinite(value)) ?? []
  const meanEnergy = segmentEnergy.length
    ? segmentEnergy.reduce((sum, value) => sum + value, 0) / segmentEnergy.length
    : null
  const chartWidth = 760
  const chartHeight = 210
  const energySamples = analysis?.energy.samples ?? []
  const sampleStep = Math.max(1, Math.ceil(energySamples.length / 160))
  const chartSamples = energySamples.filter((_value, index) => index % sampleStep === 0)
  const energyLine = chartSamples.length > 1
    ? chartSamples.map((value, index) => {
        const x = (index / (chartSamples.length - 1)) * chartWidth
        const y = chartHeight - Math.max(0, Math.min(1, value)) * (chartHeight - 18) - 9
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      }).join(' ')
    : ''
  const energyArea = energyLine
    ? `${energyLine} L${chartWidth},${chartHeight} L0,${chartHeight} Z`
    : ''
  const trackTitle = soundcloudTrack?.title ?? `Track ${id}`
  const titleFontSize = trackTitle.length <= 14 ? 82 : trackTitle.length <= 24 ? 68 : 54
  const metrics = [
    ['TEMPO', analysis ? analysis.tempo.bpm.toFixed(1) : '—', analysis ? `${percent(analysis.tempo.confidence)} CONF.` : 'PENDING'],
    ['KEY', analysis?.tonal.camelotKey ?? analysis?.tonal.key ?? '—', analysis ? `${analysis.tonal.key} ${analysis.tonal.scale}` : 'PENDING'],
    ['LENGTH', durationSec ? formatTime(durationSec) : '—', analysis ? `${analysis.tempo.beatsSec.length} BEATS` : 'SOUNDCLOUD'],
    ['ENERGY', percent(meanEnergy), analysis ? `${analysis.structure.sections.length} SECTIONS` : 'PENDING'],
  ]

  return new ImageResponse(
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: '#f3f1e8', color: '#191b16', padding: '34px 46px 0',
      fontFamily: 'Georgia, serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #c9c8bd', paddingBottom: 22 }}>
        <div style={{ display: 'flex', fontFamily: 'monospace', fontSize: 28, fontWeight: 700, letterSpacing: 1 }}>
          EXPLORE TEMPO · EMOTION · TEXTURE · CUES →
        </div>
        <div style={{ marginLeft: 'auto', border: '2px solid #697a29', color: '#526800', padding: '10px 14px', fontFamily: 'monospace', fontSize: 22, fontWeight: 700, letterSpacing: 0 }}>
          music.vlad.chat
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', flex: 1, padding: '34px 0' }}>
        <div style={{ width: 300, height: 300, display: 'flex', position: 'relative', background: '#d7d6cc', boxShadow: '14px 14px 0 #dedcd1' }}>
          {artwork
            ? <img src={artwork} width="300" height="300" style={{ width: 300, height: 300, objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa99f', fontSize: 72 }}>SC</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', marginLeft: 54, flex: 1, minWidth: 0, height: 300, overflow: 'hidden' }}>
          {analysis && (
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              width={chartWidth}
              height={chartHeight}
              style={{ position: 'absolute', inset: '0', width: '100%', height: 300 }}
            >
              {analysis.structure.sections.map((section, index) => {
                const x = durationSec ? (section.startTime / durationSec) * chartWidth : 0
                const width = durationSec
                  ? Math.max(1, ((section.endTime - section.startTime) / durationSec) * chartWidth)
                  : 0
                return (
                  <g key={`${section.type}-${section.startTime}`}>
                    <rect x={x} y="0" width={width} height={chartHeight} fill={index % 2 ? '#d7ff3f' : '#526800'} opacity={index % 2 ? '.14' : '.08'} />
                    <line x1={Math.max(1, x)} y1="0" x2={Math.max(1, x)} y2={chartHeight} stroke="#526800" strokeWidth="2" strokeDasharray="7 5" opacity=".8" />
                  </g>
                )
              })}
              {analysis.structure.sections.length > 0 && (
                <line x1={chartWidth - 1} y1="0" x2={chartWidth - 1} y2={chartHeight} stroke="#526800" strokeWidth="2" strokeDasharray="7 5" opacity=".8" />
              )}
              {energyArea && <path d={energyArea} fill="#d7ff3f" opacity=".12" />}
              {energyLine && <path d={energyLine} fill="none" stroke="#526800" strokeWidth="3" opacity=".28" />}
            </svg>
          )}
          {analysis?.structure.sections.map((section) => (
            <div
              key={`label-${section.type}-${section.startTime}`}
              style={{
                display: 'flex', position: 'absolute', top: 0, height: 42,
                left: `${durationSec ? (section.startTime / durationSec) * 100 : 0}%`,
                width: `${durationSec ? ((section.endTime - section.startTime) / durationSec) * 100 : 0}%`,
                alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                borderLeft: '2px dashed #526800', background: 'rgba(243,241,232,.72)',
                color: '#526800', fontFamily: 'monospace',
                fontSize: 23, fontWeight: 700, letterSpacing: 0,
              }}
            >
              {section.type.toUpperCase()}
            </div>
          ))}
          <div style={{ position: 'relative', color: '#526800', fontFamily: 'monospace', fontSize: 36, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', maxHeight: 44, overflow: 'hidden' }}>
            {soundcloudTrack ? `${soundcloudTrack.user.username} · ${soundcloudTrack.genre || 'UNCLASSIFIED'}` : 'SOUNDCLOUD ARCHIVE'}
          </div>
          <div style={{ position: 'relative', fontSize: titleFontSize, lineHeight: .9, letterSpacing: '-4px', marginTop: 18, overflow: 'hidden', maxHeight: 145 }}>
            {trackTitle}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', height: 176, borderTop: '1px solid #c9c8bd' }}>
        {metrics.map(([label, value, note], index) => (
          <div key={label} style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'center', padding: '8px 20px 12px', borderRight: index < metrics.length - 1 ? '1px solid #c9c8bd' : 'none' }}>
            <div style={{ fontFamily: 'monospace', color: '#4f5248', fontSize: 38, fontWeight: 700, letterSpacing: 0 }}>{label}</div>
            <div style={{ fontSize: 56, lineHeight: 1, marginTop: 4 }}>{value}</div>
            <div style={{ fontFamily: 'monospace', color: '#4f5248', fontSize: 28, fontWeight: 700, letterSpacing: 0, marginTop: 3 }}>{note}</div>
          </div>
        ))}
      </div>
    </div>,
    size,
  )
}
