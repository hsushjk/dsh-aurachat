export function register(router, ctx) {
  const { json, readBody, stripDataUrl, requireUser, chatIdOf, displayNameOf, log } = ctx
  const { hub } = ctx.deps

  router.add('GET', 'api/messages', async (req, res) => {
    const me = requireUser(req, res); if (!me) return
    return json(res, { ok: true, messages: hub.messagesOf(chatIdOf(me.subject)) })
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
