import { existsSync } from 'node:fs'
import { createLogger } from './core/logger.js'
import { loadConfig, saveConfig, publicConfig, mergeFromPanel } from './core/config.js'
import { createStickerStore } from './features/stickers.js'
import { createMood, createSpeakUp } from './features/companion.js'
import { createMemoryStore } from './features/memory.js'
import { createAzone } from './features/azone.js'
import { createAzoneSocial } from './features/azone-social.js'
import { createSelfDrive } from './features/selfdrive.js'
import { createImageGen } from './features/imagegen.js'
import { createLocal, fileOf } from './local/local.js'
import { textToSpeech, transcribe, asrReady } from './voice/tts.js'
import { buildTools } from './tools/tools.js'
import { createHub } from './chat/hub.js'
import { OWNER_ID } from './chat/access.js'
import { seedPersonas, currentPersonaText, rulesText, listPersonas, readPersona, savePersona, deletePersona } from './persona/personas.js'
import { createWebServer } from './web/server.js'

export const name = 'aurachat'

// speechToText 不写进 inject：老版本 DSH 没这个服务，写进去插件会一直等它。用 ctx.get 懒取。
export const inject = ['agents', 'sessions', 'webServer', 'timer', 'workspaceRegistry', 'attachments', 'systemPrompt', 'llm']

export function apply(ctx) {

  let maxLogMB = Number(loadConfig().logs?.maxMB) || 2
  const logger = createLogger({ dsh: ctx, getMaxBytes: () => maxLogMB * 1024 * 1024 })
  const log = logger.child('core')
  let cfg = loadConfig()
  const getConfig = () => cfg
  const setConfig = (patch) => {
    cfg = saveConfig(mergeFromPanel(cfg, patch))
    maxLogMB = Number(cfg.logs?.maxMB) || 2
  }
  seedPersonas()

  const variable = (n, fn) => ctx.effect(() => ctx.systemPrompt.variable(n, fn), 'aurachat: 变量 ' + n)
  variable('aurachat_persona', () => currentPersonaText(cfg.persona.current))
  variable('aurachat_rules_owner', () => rulesText('private', cfg))
  variable('aurachat_rules_social', () => rulesText('social', cfg))

  const stickers = createStickerStore({ dsh: ctx, getConfig, log: logger.child('stickers') })
  const mood = createMood({ getConfig, dsh: ctx })
  const local = createLocal({ getConfig, log: logger })
  const imageGen = createImageGen({ getConfig, log: logger.child('imagegen'), local })

  const dshVoice = () => {
    try { const s = ctx.speechToText; if (s) return s } catch (error) {}
    try { const s = ctx.get?.('speechToText'); if (s) return s } catch (error) {}
    try { const s = ctx.reflect?.get?.('speechToText', false); if (s) return s } catch (error) {}
    return null
  }

  const tts = {
    speak: async (text) => {
      if (local.active('tts')) {
        try {
          const file = fileOf(await local.call('tts', { text }))
          if (file && existsSync(file)) return { file, engine: 'local' }
        } catch (error) {}
      }
      return textToSpeech(text, cfg.voice, logger.child('voice'))
    },

    transcribe: async (buf, mime) => transcribe(buf, mime, cfg.voice, logger.child('voice'), dshVoice()),
    asrReady: () => Boolean(cfg.voice.asr) && asrReady(cfg.voice, dshVoice()),

    asrInfo: () => {
      const stt = dshVoice()
      let providers = null
      try {
        const snap = stt?.snapshot ? stt.snapshot() : null
        providers = Array.isArray(snap?.providers) ? snap.providers.map((x) => x.id || x.providerId || x.name) : null
      } catch (error) {}
      return { enabled: Boolean(cfg.voice.asr), host: Boolean(stt), providers }
    },
  }

  ctx.effect(() => {
    const t = setTimeout(() => {
      try {
        const info = tts.asrInfo()
        log.info(`语音识别：${info.host ? '宿主有 speechToText' : '宿主没有 speechToText'}${info.providers ? '，识别器 ' + (info.providers.join('、') || '（还没注册）') : ''}`)
      } catch (error) {}
    }, 5000)
    return () => clearTimeout(t)
  }, 'aurachat: 语音识别诊断')

  async function listModels() {
    const llm = ctx.llm || ctx.get('llm')
    const out = []
    for (const p of llm.listProviders() || []) {
      const provider = typeof p === 'string' ? p : p.provider || p.id || p.name
      try {
        for (const m of (await llm.listModels(provider)) || []) out.push({ provider, model: m.id || m.model, name: m.name || m.id || m.model })
      } catch (error) {}
    }
    return out
  }

  const web = createWebServer({ dsh: ctx, getConfig, setConfig, publicConfig, log })

  log.info('聊天存储 v2 已加载：一文件=一页（seg-001-…），媒体外置，保留天数可配')

  let memory = null
  let azone = null
  let selfDrive = null

  const hub = createHub({
    dsh: ctx,
    getConfig,
    log: logger.child('chat'),
    stickers,
    tts,
    buildTools: (where) => buildTools({ hub, getConfig, stickers, azone, memory, imageGen, selfDrive }, where),
    contextProviders: [
      ({ chat }) => (chat.system ? '' : mood.contextLine()),
      ({ chat, sessionId }) => (chat.system ? '' : memory.contextFor(chat, sessionId)),
    ],
    onActivity: (a) => {
      if (a.kind === 'in' && a.text) mood.observe(a.text, a.nickname || a.userId, { direct: true, owner: a.userId === OWNER_ID })

      if (a.kind === 'out' && a.reply && !String(a.chatId).startsWith('system:')) {
        const speakUp = String(a.userText || '').startsWith('【系统提醒')
        mood.judge({ userText: a.userText, reply: a.reply, who: a.userId === OWNER_ID ? (cfg.ownerName || '主人') : '对方', origin: speakUp ? 'speak-up' : 'user' }).catch(() => {})
      }
    },
    isMuted: () => false,
    moodEffects: () => mood.effects(),
    emit: (type, payload) => web.emit(type, payload),
  })

  memory = createMemoryStore({ dsh: ctx, getConfig, hub, log: logger.child('memory') })
  azone = createAzone({
    getConfig, hub, log: logger.child('azone'),

    onDiary: (text) => memory.extractDiary(text),
  })
  const azoneSocial = createAzoneSocial({ getConfig, hub, log: logger.child('azone'), memory, azone, botName: cfg.botName || 'AuraChat' })
  const speakUp = createSpeakUp({ getConfig, hub, log: logger.child('speakup'), isMuted: () => false })
  selfDrive = createSelfDrive({ getConfig, hub, log: logger.child('selfdrive') })

  ctx.effect(() => {
    const off = ctx.on('session/event', (session, event) => {
      try {
        hub.onSessionEvent(session, event)
      } catch (error) {
        log.warn('会话事件处理出错：', error.message)
      }
    })
    return () => { try { if (typeof off === 'function') off() } catch (error) {} }
  }, 'aurachat: 盯会话')

  const safe = (fn, label) => () => { Promise.resolve().then(fn).catch((e) => log.warn(label + '出错：', e.message)) }

  const whenReady = (fn) => () => { if (!cfg.setupDone) return; return fn() }
  ctx.effect(() => ctx.interval(safe(() => azone.tick(), '空间日记'), 60_000), 'aurachat: 空间日记')
  ctx.effect(() => ctx.interval(safe(whenReady(() => speakUp.tick()), '主动搭话'), 60_000), 'aurachat: 主动搭话')
  ctx.effect(() => ctx.interval(safe(whenReady(() => selfDrive.tick()), '自驱'), 60_000), 'aurachat: 自驱')
  ctx.effect(() => ctx.interval(safe(() => azoneSocial.tick(), '空间互动'), 60_000), 'aurachat: 空间互动')
  ctx.effect(() => ctx.interval(safe(() => memory.tick(), '记忆巩固'), 60_000), 'aurachat: 记忆巩固')
  ctx.effect(() => ctx.interval(safe(() => hub.cleanupVoice(), '语音条清理'), 60 * 60_000), 'aurachat: 语音条清理')

  web.register(ctx, { hub, azone, stickers, memory, mood, speakUp, selfDrive, imageGen, listModels, azoneSocial, logger, asrInfo: tts.asrInfo, rebindPort: () => web.listenPort() })

  ctx.effect(() => {
    web.listenPort()
    return () => { try { web.closePort() } catch (error) {} }
  }, 'aurachat: 固定入口')

  return { hub, stickers, azone, mood, memory, getConfig, setConfig, logger }
}
