export default async (req: Request) => {
  const payload = await fetch(`https://api.openai.com/v1/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: await req.text()
  })

  return new Response(payload.body, {
    headers: {
      'Content-Type': 'audio/mpeg'
    },
  })
}

