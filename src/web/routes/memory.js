export function register(router, ctx) {
  const { json, readBody, requireUser, requireOwner, listGuests } = ctx
  const { memory, mood } = ctx.deps

  router.add('GET', 'api/memory', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    return json(res, {
      ok: true,
      stats: memory.stats(),
      items: memory.list(),
      insights: memory.insights(),
      styles: memory.styles(),
      profiles: memory.profiles(),
      recalls: memory.recalls(),
      lastConsolidate: memory.lastConsolidate(),
    })
  })

  router.add('POST', 'api/memory', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    const b = await readBody(req)
    return json(res, memory.add({ text: String(b.text || '').trim(), importance: Number(b.importance) || 0.6, tags: Array.isArray(b.tags) ? b.tags : [], source: b.source || 'manual' }))
  })

  router.add('POST', 'api/memory/delete', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    const b = await readBody(req)
    return json(res, memory.remove(b.id))
  })

  router.add('POST', 'api/memory/profile', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    const b = await readBody(req)
    let about = String(b.about || '').trim()
    if (about && about !== 'owner' && !/^guest-/.test(about)) {
      const hit = listGuests().find((g) => String(g.username) === about)
      if (hit) about = hit.subject
    }
    return json(res, memory.setProfile(about, String(b.text || ''), String(b.name || '')))
  })

  router.add('POST', 'api/memory/style', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    const b = await readBody(req)
    return json(res, memory.setStyle(String(b.who || 'self'), b.lines))
  })

  router.add('POST', 'api/memory/insight', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    const b = await readBody(req)
    const key = String(b.key || b.who || '').trim()
    if (!key) return json(res, { ok: false, message: '没说是谁' })
    return json(res, memory.setInsights(key, Array.isArray(b.lines) ? b.lines : [], String(b.name || '')))
  })

  router.add('POST', 'api/memory/update', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    const b = await readBody(req)
    return json(res, memory.update(String(b.id || ''), { text: b.text, importance: b.importance, tags: b.tags }))
  })

  router.add('POST', 'api/memory/consolidate', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    try {
      const r = await memory.consolidate({ includeToday: true, force: true })
      return json(res, { ok: true, ...(r || {}) })
    } catch (error) {
      return json(res, { ok: false, reason: error.message })
    }
  })

  router.add('GET', 'api/mood', async (req, res) => {
    const me = requireUser(req, res); if (!me) return
    return json(res, { ok: true, state: mood.state(), history: mood.history() })
  })

  router.add('POST', 'api/mood', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    const b = await readBody(req)
    if (b.reset) { mood.reset(); return json(res, { ok: true, state: mood.state() }) }
    const d = Math.max(-50, Math.min(50, Number(b.delta) || 0))
    if (d) mood.nudge(d, String(b.reason || '手动调整').slice(0, 40))
    return json(res, { ok: true, state: mood.state() })
  })
}
