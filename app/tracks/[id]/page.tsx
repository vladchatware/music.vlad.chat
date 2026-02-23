import MusicPlayerV2 from '@/components/music-player/MusicPlayerV2'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MusicPlayerV2 initialTrackId={id} playbackProfile="trackFocus" />
}
