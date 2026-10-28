export function register(router, ctx) {
  const { json, readBody, requireOwner, getConfig, setConfig, publicConfig, ownerInfo, log, VERSION, deps } = ctx
  const { hub, azone, mood, speakUp, selfDrive, azoneSocial, memory, logger, asrInfo, listModels } = deps

  router.add('GET', 'api/config', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    return json(res, { ok: true, config: publicConfig(getConfig()), owner: ownerInfo() })
  })

  router.add('PATCH', 'api/config', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    const b = await readBody(req)
    const pid = b?.persona?.current
    if (pid && b.botName === undefined) {
      const hit = ctx.listPersonas().find((x) => x.id === pid)
      if (hit?.name) b.botName = hit.name
    }
    setConfig(b)
    try { deps?.rebindPort?.() } catch {}
    return json(res, { ok: true, config: publicConfig(getConfig()) })
  })

  router.add('GET', 'api/logs', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    return json(res, { ok: true, version: VERSION, logs: logger.recent(300), stats: logger.stats ? logger.stats() : null, maxMB: getConfig().logs?.maxMB || 2 })
  })

  router.add('POST', 'api/logs/clear', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    const n = logger.clear ? logger.clear() : 0
    log.info(`日志已清空（${n} 条）`)
    return json(res, { ok: true, cleared: n })
  })

  router.add('GET', 'api/status', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    return json(res, {
      ok: true,
      stats: hub.stats(),
      mood: mood.state(),
      diary: azone.state(),
      diaryStats: azone.stats(),
      speakUp: speakUp.state(),
      selfDrive: selfDrive.state(),
      memory: memory.stats(),
      sessions: hub.sessions(),
      asr: (() => { try { return asrInfo ? asrInfo() : null } catch { return null } })(),
      models: (await listModels().catch(() => null)) || null,
    })
  })

  router.add('POST', 'api/test', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    const b = await readBody(req)
    const what = String(b.what || '')
    try {
      if (what === 'speakup') { await speakUp.fire('手动'); return json(res, { ok: true, message: '叫她了' }) }
      if (what === 'diary') { const r = await azone.writeDiary({ force: true }); return json(res, { ok: true, ...r }) }
      if (what === 'selfdrive') { const r = await selfDrive.fire(); return json(res, { ok: true, ...(r || {}) }) }
      if (what === 'social') { const r = await azoneSocial.run({ force: true }); return json(res, { ok: true, ...r }) }
      return json(res, { ok: false, reason: '不认识：' + what })
    } catch (error) {
      return json(res, { ok: false, reason: error.message })
    }
  })

  router.add('GET', 'api/selfdrive', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    return json(res, { ok: true, text: selfDrive.readMemo(), state: selfDrive.state() })
  })

  router.add('POST', 'api/selfdrive', async (req, res) => {
    const me = requireOwner(req, res); if (!me) return
    const b = await readBody(req)
    return json(res, selfDrive.writeMemo(b.text))
  })
}
