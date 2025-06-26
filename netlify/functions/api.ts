import express from 'express'
import serverless from 'serverless-http'
import { createProxyMiddleware } from "http-proxy-middleware"

const app = express()

app.use(express.json({limit: '100mb'}))

app.use('/api', createProxyMiddleware({
  target: 'https://api.openai.com/v1',
  changeOrigin: true,
  headers: {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
  }
}))

export const handler = serverless(app)
