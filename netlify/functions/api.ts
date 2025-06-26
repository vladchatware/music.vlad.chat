import express from 'express'
import { PassThrough } from 'stream'
import serverless from 'serverless-http'
import { createProxyMiddleware } from "http-proxy-middleware"

const app = express()

app.use(express.json())

app.use('/api/responses', createProxyMiddleware({
  target: 'https://api.openai.com/v1',
  changeOrigin: true,
  headers: {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
  }
}))

export const handler = serverless(app)
