"use client"

import MusicPlayer from '@/components/music-player/MusicPlayer'

// 50/50 pick of the initial song on every visit
const INITIAL_TRACKS = [2414716896, 2420315892] as const

export default function Page() {
  return (
    <MusicPlayer
      initialTrackId={INITIAL_TRACKS[Math.random() < 0.5 ? 0 : 1]}
    />
  )
}
