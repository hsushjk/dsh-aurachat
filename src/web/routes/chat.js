export function register(router, ctx) {
  const { json, readBody, stripDataUrl, requireUser, chatIdOf, displayNameOf, log } = ctx
  const { hub } = ctx.deps

  // 分页拉聊天记录：
  //   /api/messages                    → 最新 100 条（老客户端兼容用）
  //   /api/messages?before=<t>         → 取出比 t 更早的 100 条
  //   /api/messages?file=last          → 最新那一整片（网页端首屏，一文件=一页）
  //   /api/messages?file=prev&before=t → t 之前的那一整片（"查看更早的记录"）
  router.add('GET', 'api/messages', async (req, res, url) => {
    const me = requireUser(req, res); if (!me) return
    const chatId = chatIdOf(me.subject)
    const q = url?.searchParams || new URLSearchParams()
    const before = Math.max(0, Math.round(Number(q.get('before')) || 0))
    const file = String(q.get('file') || '')
    if (file === 'last' || file === 'prev') {
      const page = hub.pageFileOf(chatId, { before: file === 'prev' ? before : 0 })
      return json(res, {
        ok: true,
        messages: page.messages,
        oldestAt: page.oldestAt,
        hasMore: page.hasMore,
        file: { index: page.index, total: page.total, id: page.id || '' },
      })
    }
    const limit = Math.min(100, Math.max(1, Math.round(Number(q.get('limit')) || 100)))
    const page = hub.pageOf(chatId, { before, limit })
    return json(res, {
      ok: true,
      messages: page.messages,
      oldestAt: page.oldestAt,
      hasMore: page.hasMore,
      segment: { limit },
    })
  })

  router.add('POST', 'api/messages', async (req, res) => {
    const me = requireUser(req, res); if (!me) return
    const b = await readBody(req)
    const text = String(b.text || '').trim()
    const images = (Array.isArray(b.images) ? b.images : []).map((i) => ({
      data: stripDataUrl(i.data),
      mediaType: i.mediaType || 'image/png',
      name: i.name || 'image',
    })).filter((i) => i.data)
    const voice = b.voice && b.voice.data ? { data: stripDataUrl(b.voice.data), mime: b.voice.mime || 'audio/webm', dur: Math.min(60, Math.max(1, Number(b.voice.dur) || 1)) } : null
    const sticker = String(b.sticker || '').trim()
    if (!text && images.length === 0 && !voice && !sticker) return json(res, { ok: false, reason: '没说啥' })
    hub.onUserMessage({ chatId: chatIdOf(me.subject), userId: me.subject, nickname: displayNameOf(me.subject), text, images, voice, sticker, level: me.level }).catch((e) => log.warn('收消息出错：' + e.message))
    return json(res, { ok: true })
  })

  router.add('POST', 'api/voice', async (req, res) => {
    const me = requireUser(req, res); if (!me) return
    const b = await readBody(req)
    const data = stripDataUrl(b.data)
    const dur = Number(b.dur) || 0
    if (!data) return json(res, { ok: false, reason: '没有音频数据' })
    if (dur < 1 || dur > 60) return json(res, { ok: false, reason: '语音条要 1 到 60 秒' })
    hub.onUserMessage({ chatId: chatIdOf(me.subject), userId: me.subject, nickname: displayNameOf(me.subject), text: '', voice: { data, mime: b.mime || 'audio/webm', dur }, level: me.level }).catch((e) => log.warn('收语音出错：' + e.message))
    return json(res, { ok: true })
  })

  router.add('POST', 'api/typing', async (req, res) => {
    const me = requireUser(req, res); if (!me) return
    const b = await readBody(req)
    hub.noteTyping?.(chatIdOf(me.subject), Boolean(b.typing))
    return json(res, { ok: true })
  })
}
