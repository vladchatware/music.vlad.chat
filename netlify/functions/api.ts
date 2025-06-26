import express from 'express'
import serverless from 'serverless-http'
import { createProxyMiddleware } from "http-proxy-middleware"

const app = express()

app.use(express.json())

app.use('/api', createProxyMiddleware({
  target: 'https://api.openai.com/v1',
  changeOrigin: true,
  headers: {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      if (req.body) {
        const bodyData = JSON.stringify(req.body)
        proxyReq.headers['Content-Length'] = Buffer.byteLength(bodyData)
        proxyReq.write(bodyData)
      }
    },
    error: (err) => console.log(err)
  }
}))

export const handler = serverless(app)
