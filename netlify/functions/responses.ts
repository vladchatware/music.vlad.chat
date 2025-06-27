export default async (req: Request) => {
  const payload = await fetch(`https://api.openai.com/v1/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: await req.text()
  })

  const data = await payload.text()

  return new Response(data, {
    headers: {
      'Content-Type': 'application/json'
    }
  })
}

