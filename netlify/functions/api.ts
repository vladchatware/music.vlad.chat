import express from 'express'
import serverless from 'serverless-http'
import { createProxyMiddleware } from "http-proxy-middleware"

const app = express()

app.use(express.json())

app.use('/api', createProxyMiddleware({
  target: 'https://api.openai.com',
  changeOrigin: true,
  pathRewrite: {
    '^/api': '/v1'
  },
  headers: {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
  }
}))

export const handler = serverless(app)
