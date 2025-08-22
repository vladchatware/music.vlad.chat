import { Router } from "express"
import fs from 'node:fs'
import { tracks, related } from "../soundcloud"

const router = Router()

router.get('/new', async (req, res) => {
  const historyFile = fs.readFileSync(`${__dirname}/history.json`, 'utf8')
  const _history = JSON.parse(historyFile)
  const history = new Set(_history)
  const _res = await tracks({
    q: '',
    tags: 'dreamscape, instrumental',
    // 'bpm[from]': '100',
    // 'bpm[to]': '150',
    // 'duration[from]': '30',
    // 'duration[to]': '300',
    'created_at[from]': '2025-08-18 00:00:00',
    'created_at[to]': '2025-08-19 00:00:00',
    // limit: '10'
  })
  console.log(_res)
  if (_res.status && _res.status !== 200) {
    return res.json({status: _res.status})
  }

  let track = null
  for (const t of _res) {
    if (!history.has(t.id)) {
      history.add(t.id)
      track = t.id
      break
    }
  }

  if (!track) {
    return res.status(404).send('No new tracks found')
  }

  fs.writeFileSync(`${__dirname}/history.json`, JSON.stringify([...history], null, 2))

  const template = fs.readFileSync(`${__dirname}/../public/index.html`, 'utf8')

  if (!template) return res.status(500).send('Error reading template')
  
  const payload = template.replace('692509783', track)

  res.send(payload)
})

router.get('/:id', (req, res) => {
  const template = fs.readFileSync(`${__dirname}/../public/index.html`, 'utf8')

  if (!template) return res.status(500).send('Error reading template')

  const payload = template.replace('692509783', req.params.id)

  res.send(payload)
})

router.get('/:id/related', async (req, res) => {
  const id = req.params.id

  const tracks = await related(id)

  const track = tracks[0].id

  const template = fs.readFileSync(`${__dirname}/../public/index.html`, 'utf8')

  if (!template) return res.status(500).send('Error reading template')

  const payload = template.replace('692509783', track)

  res.send(payload)
})

export default router