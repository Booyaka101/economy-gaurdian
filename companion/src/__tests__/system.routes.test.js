import { describe, it, expect } from 'vitest'
import express from 'express'
import registerSystemRoutes from '../routes/system.js'

function makeApp(deps = {}) {
  const app = express()
  registerSystemRoutes(app, deps)
  return app
}

async function withServer(app, fn) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address()
        const base = `http://127.0.0.1:${addr.port}`
        const res = await fn(base)
        server.close(() => resolve(res))
      } catch (e) {
        try { server.close(() => reject(e)) } catch {}
        reject(e)
      }
    })
  })
}

describe('system routes', () => {
  it('GET /health returns ok: true with a timestamp', async () => {
    const app = makeApp()
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/health`)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('ok', true)
      expect(typeof data.ts).toBe('number')
      expect(data.ts).toBeGreaterThan(0)
    })
  })

  it('GET /metrics returns provided metrics payload', async () => {
    const payload = { status: 'green', counters: { a: 1 } }
    const app = makeApp({ getMetricsPayload: () => payload })
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/metrics`)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual(payload)
    })
  })

  it('GET /metrics returns 500 on error', async () => {
    const app = makeApp({ getMetricsPayload: () => { throw new Error('boom') } })
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/metrics`)
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data).toHaveProperty('error', 'metrics_failed')
    })
  })
})
