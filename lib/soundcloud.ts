export const fetchTrack = async (id) => {
  const res = await fetch(`http://localhost:3000/api/tracks/${id}`)
  return res.json()
}

export const streamTrack = (id) => {
  if (!id) return ''
  return `http://localhost:3000/api/tracks/${id}/stream`
}
