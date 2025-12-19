const url = process.env.NEXT_PUBLIC_SITE_URL

export const fetchTrack = async (id) => {
  const res = await fetch(`${url}/api/tracks/${id}`)
  return res.json()
}

export const streamTrack = (id: string | number | undefined): string | undefined => {
  if (!id) return undefined
  return `${url}/api/tracks/${id}/stream`
}
