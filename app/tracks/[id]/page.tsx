import type { Metadata } from 'next'

import MusicPlayer from '@/components/music-player/MusicPlayer'
import { track } from '@/soundcloud'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const soundcloudTrack = /^\d+$/.test(id) ? await track(id).catch(() => null) : null
  const title = soundcloudTrack
    ? `${soundcloudTrack.title} — ${soundcloudTrack.user.username}`
    : `SoundCloud track ${id}`
  const description = 'Live SoundCloud track with Revibe tempo, tonal, energy, and structure analysis.'
  const image = `/tracks/${encodeURIComponent(id)}/opengraph-image?v=8`

  return {
    title,
    description,
    openGraph: {
      type: 'music.song',
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: `${title} analysis` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MusicPlayer initialTrackId={id} playbackProfile="trackFocus" />
}
