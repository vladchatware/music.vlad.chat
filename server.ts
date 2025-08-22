import express from "express"
import api from "./routes/api"
import mcp from "./routes/mcp"
import tracks from "./routes/tracks"

const app = express()

app.use(express.json())

const allowedOrigins = [
  'http://localhost:3000',
  'https://clownz-army.kinsta.app',
  'https://music.vlad.chat',
  'https://a0006e19375d.ngrok-free.app'
]

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (!origin || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }

  res.set({
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept, Range"
  });

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204)
  }

  next()
})

app.use('/mcp', mcp)
app.use('/api', api)

app.use(express.static('public'))

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html')
})

app.use('/tracks', tracks)

app.listen(3000, () => {
  console.log('Server running on port 3000')
})

