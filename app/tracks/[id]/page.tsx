import MusicPlayer from '@/components/music-player/MusicPlayer'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MusicPlayer initialTrackId={id} playbackProfile="trackFocus" />
}
