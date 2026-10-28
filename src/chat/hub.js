import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, appendFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { dataDir, readJson, writeJson } from '../core/store.js'
import { parseReply, bubbleDelay } from './reply.js'
import { levelFor, presetFor, isOwner } from './access.js'
import { fetchImage } from '../core/net.js'
import { mimeOf } from '../core/image.js'
import { createHistory, SEGMENT_LIMIT, DEFAULT_KEEP_DAYS } from './history.js'

const WORKSPACE_DIR = process.env.AURACHAT_WORKSPACE || join(homedir(), 'AuraChat', 'chats')
const WORKSPACE_TITLE = 'AuraChat · Web'
const SOURCE_KIND = 'aurachat'
const BUSY_MAX_MS = 5 * 60 * 1000
const MAX_TYPING_HOLD_MS = 60 * 1000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sessionKey = (id) => String(id || '').replace(/^session-/, '')

export function createHub({
  dsh, getConfig, log, stickers, tts, buildTools, contextProviders,
  onActivity, isMuted, moodEffects, emit,
}) {
  const chatlogDir = () => dataDir('chatlog')
  const sessionsFile = () => dataDir('sessions.json')
  const history = createHistory({
    log,
    emit: (type, payload) => emit?.(type, payload),
    getKeepDays: () => Number((getConfig().history || {}).keepDays) || DEFAULT_KEEP_DAYS,
  })

  const mounted = new WeakMap()
  const sessionToChat = new Map()
  const turnState = new Map()
  const pending = new Map()
  const typingUntil = new Map()
  const busy = new Set()
  const busyTimers = new Map()
  const waiting = new Set()

  let stats = { turns: 0, messages: 0, voice: 0, stickers: 0, images: 0, errors: 0 }
  let lastChatAt = 0
  let lastOwnerChatAt = 0
  let lastBotToOwner = null

  const bump = (k) => { stats[k] = (stats[k] || 0) + 1 }
  const mood = () => (typeof moodEffects === 'function' ? moodEffects() : null) || { sticker: 1, voice: 1, delay: 1, chatty: 1 }

  function map() { return readJson(sessionsFile(), () => ({ chats: {} })) }
  function saveMap(m) { writeJson(sessionsFile(), m) }

  function logChat(chatId, who, text, uid) {
    const day = new Date().toISOString().slice(0, 10)
    const line = JSON.stringify({ t: new Date().toISOString(), chatId, who, text, ...(uid ? { uid } : {}) })
    mkdirSync(chatlogDir(), { recursive: true })
    appendFileSync(join(chatlogDir(), `${day}.jsonl`), line + '\n')
  }

  function chatLogDays() {
    try {
      return readdirSync(chatlogDir())
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
        .map((f) => f.slice(0, 10))
    } catch { return [] }
  }

  function chatLogOf(day) {
    try {
      const raw = readFileSync(join(chatlogDir(), `${day}.jsonl`), 'utf8')
      return raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    } catch { return [] }
  }

  function deleteChatLog(day) {
    try { unlinkSync(join(chatlogDir(), `${day}.jsonl`)) } catch {}
  }

  function appendMessage(chatId, payload) {
    const msg = history.append(chatId, payload)
    emit?.('message', { chatId, message: msg })
    history.touch(chatId)
    return msg
  }

  function messagesOf(chatId) {
    return history.page(chatId, { limit: SEGMENT_LIMIT }).messages
  }

  function pageOf(chatId, opts) {
    return history.page(chatId, opts)
  }

  // 「一个分片文件 = 一页」的取法，网页端翻历史用
  function pageFileOf(chatId, opts) {
    return history.pageFile(chatId, opts)
  }

  function historyStats(chatId) {
    return history.stats(chatId)
  }

  function recentChat(chatId, n = 20) {
    return history.page(chatId, { limit: Math.max(30, n * 3) }).messages
      .filter((m) => m.kind === 'text' || m.kind === 'voice')
      .slice(-n)
      .map((m) => ({ t: m.t, who: m.who, text: m.text, uid: m.uid }))
  }

  async function ensureWorkspace() {
    const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
    if (!reg) throw new Error('宿主没有 workspaceRegistry')
    const norm = (p) => String(p).replace(/[\\/]+$/, '').toLowerCase()
    mkdirSync(WORKSPACE_DIR, { recursive: true })
    let ws = (reg.list() || []).find((w) => norm(w.path) === norm(WORKSPACE_DIR))
    if (!ws) ws = await reg.create(WORKSPACE_DIR, WORKSPACE_TITLE)
    return ws
  }

  function controller() {
    const c = dsh.get('sessionController')
    if (!c) throw new Error('宿主没有 sessionController（需要 DSH 桌面版 / Web 组合）')
    return c
  }

  function titleFor(chat) {
    const cfg = getConfig()
    if (isOwner(cfg, chat.userId)) return `Web · ${cfg.ownerName || '主人'}`
    return `Web · ${chat.nickname || chat.userId || chat.chatId}`
  }

  async function createSession(chat, level) {
    const ws = await ensureWorkspace()
    const preset = presetFor(level)
    const r = await controller().create({ workspaceId: ws.id, agentPreset: preset })
    const sid = String(r.sessionId)
    await controller().rename({ sessionId: sid, title: titleFor(chat) })
    return { sessionId: sid, preset, level, createdAt: Date.now(), title: titleFor(chat) }
  }

  async function resolveAgent(sid) {
    const live = dsh.agents.get(sid) || dsh.agents.get('session-' + sid)
    if (live) return live
    const r = await controller().resolveAgent(sid)
    return r.agent
  }

  function modelKey() {
    const { provider, model, reasoningEffort } = getConfig().model || {}
    return `${provider}::${model}::${reasoningEffort}`
  }

  async function applyModel(agent) {
    const { provider, model, reasoningEffort } = getConfig().model || {}

    let p = provider
    let m = model
    if (!p || !m) {
      try {
        const svc = dsh.get('agentDefaultModel')
        const sel = svc && typeof svc.currentSelection === 'function' ? svc.currentSelection() : null
        if (sel && sel.provider && sel.model) { p = sel.provider; m = sel.model }
      } catch (error) {}
    }
    if (!p || !m) return
    const sel = { provider: p, model: m }
    if (reasoningEffort && reasoningEffort !== 'low') sel.reasoningEffort = reasoningEffort
    const agents = controller().agents
    if (agents && typeof agents.selectForNextRequest === 'function') {
      try { agents.selectForNextRequest(agent, sel); return } catch (e) { log.debug('切模型失败，改用 append：' + e.message) }
    }
    if (agent.session && typeof agent.session.append === 'function') agent.session.append('model/selection', sel)
  }

  function mount(agent, chat, level) {
    const sessionId = agent.session?.id || ''
    const tools = buildTools({ chat, level, sessionId })
    const toolsKey = tools.map((t) => t.name).sort().join('|')
    const prev = mounted.get(agent)
    if (prev && prev.toolsKey === toolsKey) return
    if (prev) for (const d of prev.disposers) { try { d() } catch {} }
    const disposers = []
    for (const tool of tools) {
      try {
        const d = agent.ctx.tools.register(tool)
        if (typeof d === 'function') disposers.push(d)
      } catch (e) { log.warn('挂工具失败 ' + tool.name + '：' + e.message) }
    }
    try {
      const d = agent.ctx.systemPrompt.context({
        name: 'aurachat-context',
        order: 905,
        text: () => (contextProviders || []).map((p) => p({ chat, sessionId })).filter(Boolean).join('\n\n'),
      })
      if (typeof d === 'function') disposers.push(d)
    } catch (e) { log.warn('挂上下文失败：' + e.message) }
    mounted.set(agent, { toolsKey, disposers })
  }

  async function agentFor(chat) {
    const cfg = getConfig()
    const level = chat.system ? 'social' : levelFor(cfg, chat)
    const preset = presetFor(level)
    const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
    const m = map()
    let entry = m.chats[chat.chatId]
    let needNew = !entry || !entry.sessionId || entry.preset !== preset || entry.level !== level
    if (entry && entry.sessionId && (reg?.archivedSessionIds || []).includes(entry.sessionId)) needNew = true
    if (needNew) {
      entry = await createSession(chat, level)
      m.chats[chat.chatId] = entry
      saveMap(m)
    }
    let agent = null
    try { agent = await resolveAgent(entry.sessionId) } catch (e) { agent = null }
    if (!agent) {
      entry = await createSession(chat, level)
      m.chats[chat.chatId] = entry
      saveMap(m)
      agent = await resolveAgent(entry.sessionId)
    }
    const mk = modelKey()
    if (entry.modelKey && entry.modelKey !== mk) await applyModel(agent)
    entry.modelKey = mk
    m.chats[chat.chatId] = entry
    saveMap(m)
    sessionToChat.set(sessionKey(entry.sessionId), chat.chatId)
    mount(agent, chat, level)
    return agent
  }

  async function sendText(chatId, text) {
    appendMessage(chatId, { who: 'bot', text, kind: 'text' })
    bump('messages')
    return true
  }

  async function sendVoice(chatId, text) {
    try {
      const { file, engine } = await tts.speak(text)
      const b64 = readFileSync(file).toString('base64')
      const voiceMime = String(file).endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'
      appendMessage(chatId, { who: 'bot', text, kind: 'voice', voice: b64, voiceMime, engine })
      bump('voice')
      return true
    } catch (e) {
      log.warn('语音没发出去，改发文字：' + e.message)
      await sendText(chatId, text)
      return false
    }
  }

  async function sendSticker(chatId, query) {
    const lib = stickers.library().items
    let item = query && typeof query === 'object' ? query : stickers.match(query)

    if (!item && lib.length) item = lib[Math.floor(Math.random() * lib.length)]
    if (!item) { log.debug('表情库是空的，跳过表情'); return false }

    appendMessage(chatId, { who: 'bot', text: '[表情]', kind: 'sticker', sticker: item.md5, name: item.name || '', caption: item.name || '', mark: 'sticker' })
    stickers.markUsed?.(item.md5)
    bump('stickers')
    return true
  }

  async function sendImage(chatId, src) {
    try {
      const buf = Buffer.isBuffer(src) ? src : await fetchImage(src, { maxBytes: 10 * 1024 * 1024 })
      appendMessage(chatId, { who: 'bot', text: '[图片]', kind: 'image', image: buf.toString('base64'), imageMime: mimeOf(buf) || 'image/png', mark: 'ai-image' })
      bump('images')
      return true
    } catch (e) { log.warn('图片发不出去：' + e.message); return false }
  }

  async function deliver(chatId, text, opts = {}) {
    const cfg = getConfig()
    const r = parseReply(text)
    if (r.silent) { log.info(`${chatId}：她选择不说话`); return }
    let items = r.items
    if (opts.wantVoice && cfg.voice.enabled && !items.some((i) => i.kind === 'voice')) {
      const spoken = items.filter((i) => i.kind === 'text').map((i) => i.value).join('，')
      if (spoken && spoken.length <= 300) items = [{ kind: 'voice', value: spoken }, ...items.filter((i) => i.kind !== 'text')]
    }
    const texts = items.filter((i) => i.kind === 'text')
    if (cfg.voice.enabled && items.length === texts.length && texts.length > 0) {
      const all = texts.map((t) => t.value).join('，')
      if (all.length <= cfg.voice.autoMaxChars && Math.random() < cfg.voice.autoChance * mood().voice) items = [{ kind: 'voice', value: all }]
    }
    if (cfg.stickers.enabled && !items.some((i) => i.kind === 'sticker') && Math.random() < cfg.stickers.autoChance * mood().sticker) {
      const pick = stickers.pickForReply(texts.map((t) => t.value).join(' '))
      if (pick) items.push({ kind: 'sticker', value: pick })
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.kind === 'text') await sendText(chatId, it.value)
      else if (it.kind === 'voice') { if (cfg.voice.enabled) await sendVoice(chatId, it.value); else await sendText(chatId, it.value) }
      else if (it.kind === 'sticker') await sendSticker(chatId, it.value)
      else if (it.kind === 'image') await sendImage(chatId, it.value)
      if (i < items.length - 1) await sleep(bubbleDelay(items[i + 1].kind === 'text' ? items[i + 1].value : '') * mood().delay)
    }
    logChat(chatId, 'bot', items.map((i) => (i.kind === 'text' || i.kind === 'voice' ? i.value : `[${i.kind}]`)).join(' '))
    lastChatAt = Date.now()
    if (isOwner(cfg, chatId)) lastBotToOwner = { at: Date.now(), text: items.filter((i) => i.kind === 'text' || i.kind === 'voice').map((i) => i.value).join('\n') }
    onActivity?.({ kind: 'out', chatId, reply: text, userText: opts.userText || '' })
  }

  async function deliverTo(target, text) {
    const chatId = String(target).replace(/^private:/, '')
    await deliver(chatId, text, {})
    return true
  }

  function textOf(message) {
    if (!message || !Array.isArray(message.content)) return ''
    return message.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim()
  }

  function startTyping(chatId) { emit?.('typing', { chatId, on: true }) }
  function stopTyping(chatId) { emit?.('typing', { chatId, on: false }) }

  function onSessionEvent(session, event) {
    const key = sessionKey(session && session.id)
    const chatId = sessionToChat.get(key)
    if (!chatId || !event) return
    const st = turnState.get(key) || { lastTurn: -1, text: '', senders: new Set() }
    turnState.set(key, st)
    if (event.type === 'assistant/message') {
      const d = event.data || {}
      if (d.interrupted) return
      const t = textOf(d.message)
      if (t) { st.lastTurn = d.turn; st.text = t }
      return
    }
    if (event.type === 'turn/end') {
      stopTyping(chatId)
      const d = event.data || {}
      const completed = d.reason && d.reason.kind === 'completed'
      const text = st.lastTurn === d.turn ? st.text : ''
      const sys = st.system
      const wantVoice = Boolean(st.wantVoice)
      const lastText = st.lastText || ''
      if (st.sysTimer) { clearTimeout(st.sysTimer); st.sysTimer = null }
      st.text = ''
      st.senders = new Set()
      st.system = null
      st.wantVoice = false
      if (sys) {
        if (completed) sys.resolve(text)
        else sys.reject(new Error('这一轮没正常结束：' + (d.reason?.kind || '?')))
        return
      }
      if (!completed) { log.warn(`${chatId} 这一轮没正常结束（${d.reason?.kind || '?'}），不发`); release(chatId); return }
      if (!text) return release(chatId)
      deliver(chatId, text, { wantVoice, userText: lastText }).catch((e) => log.warn('发送出错：' + e.message)).finally(() => release(chatId))
    }
  }

  async function onUserMessage({ chatId, userId, nickname, text = '', images = [], voice = null, sticker = '', level = '' }) {
    const cfg = getConfig()
    typingUntil.delete(chatId)
    let userSticker = null
    const chat = { chatId, userId, nickname: nickname || userId, ...(level ? { level } : {}) }
    if (voice && voice.data) {
      appendMessage(chatId, { who: 'user', uid: userId, text: `[语音 · ${Math.round(voice.dur || 0)}秒]`, kind: 'voice', voice: voice.data, voiceMime: voice.mime || 'audio/webm', dur: Math.round(voice.dur || 0) })
      logChat(chatId, nickname || userId, '[语音]', userId)
      bump('voice')
    } else if (sticker) {
      const item = stickers.library().items.find((i) => i.md5 === sticker) || null
      userSticker = item
      appendMessage(chatId, { who: 'user', uid: userId, text: '[表情]', kind: 'sticker', sticker, name: item?.name || '', mark: 'user-sticker' })
      logChat(chatId, nickname || userId, `[表情${item?.name ? ' ' + item.name : ''}]`, userId)
      bump('sticker')
    } else if (text) {
      appendMessage(chatId, { who: 'user', uid: userId, text, kind: 'text' })
      logChat(chatId, nickname || userId, text, userId)
    }
    lastChatAt = Date.now()
    if (isOwner(cfg, userId)) lastOwnerChatAt = Date.now()
    onActivity?.({ kind: 'in', chatId, text: text || '[语音]', userId, nickname })
    const content = []
    if (voice && voice.data) {

      let heard = ''
      const vopt = getConfig().voice || {}
      const asrOn = Boolean(vopt.asr)
      const ready = Boolean(tts?.transcribe && tts.asrReady?.(vopt, dsh))
      try {
        if (ready) {
          heard = await tts.transcribe(Buffer.from(voice.data, 'base64'), voice.mime || 'audio/wav', vopt, log, dsh)
        } else if (asrOn) {
          let info = ''
          try { info = JSON.stringify(tts?.asrInfo?.()) } catch (error) {}
          log.warn(`开了语音识别，但没拿到识别服务（这条只能当没转成文字）${info ? '：' + info : ''}`)
        }
      } catch (error) {
        log.warn('语音识别没成功：' + error.message)
      }
      if (heard) {
        content.push({ type: 'text', text: `【对方发来一条语音（约 ${Math.round(voice.dur || 0)} 秒），转成文字是：${heard}】` })

        const last = history.last(chatId)
        if (last && last.kind === 'voice' && !last.heard) {
          history.patchLast(chatId, { heard })
          emit?.('message', { chatId, message: { ...last, heard } })
        }
        logChat(chatId, nickname || userId, `[语音] ${heard}`, userId)
      } else {

        content.push({ type: 'text', text: `[对方发来一条 ${Math.round(voice.dur || 0)} 秒的语音，这段没转成文字，只听到声音]` })
      }
    } else if (text) content.push({ type: 'text', text })
    if (userSticker) {

      content.push({ type: 'text', text: `【对方发来一张表情包${userSticker.name ? '：' + userSticker.name : ''}，看着接梗，或者也回一个 <sticker:标签>】` })
    }
    for (const img of images) {
      content.push({ type: 'image', data: img.data, mediaType: img.mediaType || 'image/png', name: img.name || 'image' })
      appendMessage(chatId, { who: 'user', uid: userId, text: '[图片]', kind: 'image', image: img.data, imageMime: img.mediaType || 'image/png', mark: 'user-image' })
      logChat(chatId, nickname || userId, '[图片]', userId)

      if (cfg.stickers?.steal !== false && stickers?.addFromBuffer) {
        try {
          const buf = Buffer.from(String(img.data || ''), 'base64')
          if (buf.length >= 2 * 1024) {
            stickers.addFromBuffer(buf, { from: 'steal', hint: '别人发来的图' })
              .then((r) => { if (r?.ok && !r.existed) log.info('偷了一张表情，收进库了') })
              .catch(() => {})
          }
        } catch (error) {}
      }
    }
    bump('messages')
    if (!cfg.enabled) return
    if (content.length === 0) return
    enqueue(chat, content, userId, false)
  }

  // 语音/图片过期清理：整片过期就删片删媒体，并把新的边界推给客户端。
  // （host.js 每小时调一次；每次追加消息后的空闲定时器也会扫。）
  function cleanupVoice() {
    const changed = history.sweepAll()
    for (const row of changed) {
      emit?.('history', { chatId: row.chatId, oldestAt: row.oldestAt, droppedBefore: row.oldestAt, hasMore: false })
    }
    return changed.length
  }

  function enqueue(chat, content, senderId, wantVoice, mode = 'normal') {
    const chatId = chat.chatId
    const cfg = getConfig()
    let p = pending.get(chatId)
    if (!p) {
      p = { chat, texts: [], images: [], senders: new Set(), wantVoice, timer: null, firstAt: Date.now(), mode, count: 0 }
      pending.set(chatId, p)
    }
    p.count++
    if (senderId) p.senders.add(senderId)
    for (const c of content) {
      if (c.type === 'text' && c.text) p.texts.push(c.text)
      else if (c.type === 'image') p.images.push(c)
    }
    p.wantVoice = p.wantVoice || wantVoice
    const mergeDelay = cfg.merge?.enabled === false ? 0 : Math.min((cfg.merge?.waitSec || 2.5) * 1000, (cfg.merge?.maxSec || 8) * 1000)

    const schedule = () => {
      if (p.timer) clearTimeout(p.timer)
      const hold = typingUntil.get(chatId) || 0
      const left = Math.max(0, hold - Date.now())

      const capped = Date.now() - p.firstAt > MAX_TYPING_HOLD_MS ? 0 : left
      p.timer = setTimeout(() => {
        if (capped && (typingUntil.get(chatId) || 0) > Date.now()) return schedule()
        flush(chatId)
      }, Math.max(mergeDelay, capped))
    }
    schedule()
  }

  function isBusy(chatId) { return busy.has(chatId) }

  function markBusy(chatId) {
    busy.add(chatId)
    const t = setTimeout(() => {
      if (busy.delete(chatId)) { log.warn(`${chatId} 一轮超过 ${BUSY_MAX_MS / 60000} 分钟，强制放开`); release(chatId) }
    }, BUSY_MAX_MS)
    busyTimers.set(chatId, t)
  }

  async function flush(chatId) {
    const p = pending.get(chatId)
    if (!p) return
    if (isBusy(chatId)) { waiting.add(chatId); return }
    pending.delete(chatId)
    if (p.timer) clearTimeout(p.timer)
    const content = [{ type: 'text', text: p.texts.join('\n') }, ...p.images]
    const firstSender = [...p.senders][0] || ''
    markBusy(chatId)
    try {
      await pushToSession(p.chat, content, firstSender, { wantVoice: p.wantVoice, extraSenders: [...p.senders] })
    } catch (e) {
      bump('errors')
      log.warn('pushToSession 出错：' + e.message)
      release(chatId)
    }
  }

  function release(chatId) {
    busy.delete(chatId)
    const t = busyTimers.get(chatId)
    if (t) { clearTimeout(t); busyTimers.delete(chatId) }
    if (waiting.has(chatId)) { waiting.delete(chatId); flush(chatId) }
  }

  async function admit(agent, content) {
    if (!content || content.length <= 1) return content
    const att = dsh.attachments
    if (att && typeof att.admitPromptContent === 'function') {
      try { return await att.admitPromptContent(content) } catch (e) { log.warn('附件准入失败，退化成纯文本：' + e.message) }
    }
    return content.filter((c) => c.type === 'text')
  }

  async function pushToSession(chat, content, senderId, opts = {}) {
    const agent = await agentFor(chat)
    const key = sessionKey(agent.session?.id)
    let st = turnState.get(key)
    if (!st) { st = { lastTurn: -1, text: '', senders: new Set(), lastText: '', prevText: '' }; turnState.set(key, st) }
    if (senderId) st.senders.add(senderId)
    const textPart = (content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
    if (textPart) { st.prevText = st.lastText; st.lastText = textPart }
    if (opts.wantVoice) st.wantVoice = true
    if (opts.extraSenders) for (const u of opts.extraSenders) st.senders.add(u)
    const admitted = await admit(agent, content)
    startTyping(chat.chatId)
    await agent.followup({ id: randomUUID(), role: 'user', content: admitted, source: { kind: SOURCE_KIND } })
    await dsh.sessions.flush(agent.session)
  }

  function runSystemTurn(name, title, prompt, opts = {}) {
    const chat = { chatId: 'system:' + name, system: true, title, userId: '', nickname: '' }
    const timeoutMs = opts.timeoutMs || 180000
    return new Promise(async (resolve, reject) => {
      let timer
      try {
        const agent = await agentFor(chat)
        const key = sessionKey(agent.session?.id)
        let st = turnState.get(key)
        if (!st) { st = { lastTurn: -1, text: '', senders: new Set() }; turnState.set(key, st) }
        st.system = { resolve, reject }
        timer = setTimeout(() => {
          const s = turnState.get(key)
          if (s && s.system) { s.system = null; s.sysTimer = null; reject(new Error('这一轮超时了')) }
        }, timeoutMs)
        st.sysTimer = timer
        await agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: SOURCE_KIND } })
        await dsh.sessions.flush(agent.session)
      } catch (e) {
        if (timer) clearTimeout(timer)
        reject(e)
      }
    })
  }

  function turnHasOwner(sessionId) {
    const st = turnState.get(sessionKey(sessionId))
    return Boolean(st && [...st.senders].some((u) => isOwner(getConfig(), u)))
  }

  function turnSendersAllOwner(sessionId) {
    const st = turnState.get(sessionKey(sessionId))
    if (!st || st.senders.size === 0) return false
    return [...st.senders].every((u) => isOwner(getConfig(), u))
  }

  function chatOfSession(sid) { return sessionToChat.get(sessionKey(sid)) }

  async function resetChat(chatId) {
    const reg = dsh.workspaceRegistry || dsh.get('workspaceRegistry')
    const m = map()
    const entry = m.chats[chatId]
    if (entry) {
      try { await Promise.resolve(reg?.archiveSession?.(entry.sessionId)) } catch (e) {}
      sessionToChat.delete(sessionKey(entry.sessionId))
      turnState.delete(sessionKey(entry.sessionId))
      delete m.chats[chatId]
      saveMap(m)
    }
  }

  async function resetSessions() {
    const m = map()
    for (const chatId of Object.keys(m.chats)) await resetChat(chatId)
  }

  function sessions() { return map().chats }

  function noteTyping(chatId, typing) {
    const hold = Math.max(0, Number(getConfig().merge?.waitTypingSec ?? 5))
    if (!typing || !hold) typingUntil.delete(chatId)
    else typingUntil.set(chatId, Date.now() + hold * 1000)
  }

  return {
    onUserMessage,
    noteTyping,
    onSessionEvent,
    deliver,
    deliverTo,
    sendText,
    sendVoice,
    sendSticker,
    sendImage,
    pushToSession,
    runSystemTurn,
    turnSendersAllOwner,
    turnHasOwner,
    resetChat,
    chatOfSession,
    resetSessions,
    lastTextOf: (sid) => turnState.get(sessionKey(sid))?.lastText || '',
    prevTextOf: (sid) => turnState.get(sessionKey(sid))?.prevText || '',
    speakersOf: (sid) => [...(turnState.get(sessionKey(sid))?.senders || [])],
    logChat,
    ensureWorkspace,
    chatLogOf,
    chatLogDays,
    deleteChatLog,
    recentChat,
    messagesOf,
    pageOf,
    pageFileOf,
    historyStats,
    cleanupVoice,
    sessions,
    stats: () => ({ ...stats }),
    get lastChatAt() { return lastChatAt },
    get lastOwnerChatAt() { return lastOwnerChatAt },
    get lastBotToOwner() { return lastBotToOwner },
  }
}
