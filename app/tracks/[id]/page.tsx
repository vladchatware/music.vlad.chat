"use client"

import { useParams } from 'next/navigation'
import MusicPlayer from '@/components/MusicPlayer'

export default function Page() {
  const { id } = useParams()
  return <MusicPlayer initialTrackId={id as string | number} />
}
