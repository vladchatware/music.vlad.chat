import { playbackDebug } from "./playbackDebug"

export const fetchTrack = async (id) => {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now()
  playbackDebug("client.fetch_track.begin", { id })
  const res = await fetch(`/api/tracks/${id}`)
  playbackDebug("client.fetch_track.response", {
    id,
    status: res.status,
    ok: res.ok,
    elapsedMs: Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt
    ),
  })
  return res.json()
}

export const streamTrack = (id: string | number | undefined): string | undefined => {
  if (!id) return undefined
  return `/api/tracks/${id}/stream`
}
