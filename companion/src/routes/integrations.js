// Integrations routes
// Provides: /integrations/status

export default function registerIntegrationsRoutes(app, deps) {
  const { getTSMStatus, getTUJStatus, getNexusHubStatus } = deps

  const unwrap = (r) => r.status === 'fulfilled' ? r.value : { error: r.reason?.message || String(r.reason || 'failed') }

  app.get('/integrations/status', async (_req, res) => {
    try {
      const [tsm, tuj, nexus] = await Promise.allSettled([
        getTSMStatus?.(),
        getTUJStatus?.(),
        getNexusHubStatus?.(),
      ])
      res.json({
        tsm: unwrap(tsm),
        tuj: unwrap(tuj),
        nexushub: unwrap(nexus),
        features: { DISABLE_NEXUSHUB: process.env.DISABLE_NEXUSHUB === '1' },
      })
    } catch (e) {
      res.status(500).json({ error: 'status_failed', message: e?.message || String(e) })
    }
  })
}
