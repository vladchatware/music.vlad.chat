import { Router } from "express"
import multer from "multer"

const url = 'https://api.openai.com/v1'

const upload = multer({ storage: multer.memoryStorage() })

const router = Router()

router.post('/responses', async (req, res) => {
  const payload = await fetch(`${url}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(req.body)
  })

  const data = await payload.json()

  res.status(200).json(data)
})

router.post('/audio/speech', async (req, res) => {
  const payload = await fetch(`${url}/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(req.body)
  })

  const arrayBuffer = await payload.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  res.setHeader('Content-Type', 'audio/mpeg');
  res.send(buffer);
})


router.post('/audio/transcriptions', upload.single('file'), async (req, res) => {
  const file = new Blob([req.file.buffer], { type: req.file.mimetype })
  const body = new FormData()
  body.append('file', file, 'file.webm')
  body.append('model', 'gpt-4o-mini-transcribe')
  const payload = await fetch(`${url}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body
  })
  const data = await payload.json()
  res.status(200).json(data)
})

export default router