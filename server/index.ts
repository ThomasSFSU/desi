import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import compareRouter from './routes/compare.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = Number(process.env.PORT) || 3001

app.use(express.json())

app.use('/api/compare', compareRouter)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

// In production, serve the built SPA from /dist (sibling of dist-server).
const clientDist = path.resolve(__dirname, '../dist')
if (existsSync(clientDist)) {
  app.use(express.static(clientDist))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`)
})
