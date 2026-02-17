"use client"

import { useParams } from 'next/navigation'
import MusicPlayerV2 from '@/components/music-player/MusicPlayerV2'

export default function Page() {
  const { id } = useParams()
  return <MusicPlayerV2 initialTrackId={id as string | number} />
}
