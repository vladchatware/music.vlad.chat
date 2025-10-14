const url = "https://music.vlad.chat"

export const fetchTrack = async (id) => {
  const res = await fetch(`${url}/api/tracks/${id}`)
  return res.json()
}

export const streamTrack = (id) => {
  if (!id) return ''
  return `${url}/api/tracks/${id}/stream`
}
