import express from 'express'
import serverless from 'serverless-http'
import { createProxyMiddleware } from "http-proxy-middleware"

const app = express()

app.use('/api', createProxyMiddleware({
  target: 'https://api.openai.com/v1',
  changeOrigin: true,
  headers: {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
  },
  on: {
    proxyReq: async (proxyReq, req, res) => {
      const body = await req.json()
      if (body) {
        const bodyData = JSON.stringify(req.body)
        proxyReq.headers['Content-Length'] = Buffer.byteLength(bodyData)
        proxyReq.write(bodyData)
      }
    },
    error: (err) => console.log(err)
  }
}))

export const handler = serverless(app)
