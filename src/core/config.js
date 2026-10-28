import { dataDir, readJson, writeJson } from './store.js'

export const DEFAULTS = {
  enabled: true,
  setupDone: false,
  ownerName: '主人',
  botName: '大肥鱼',
  botTag: '',
  siteName: '',
  pageTitle: '',
  web: { host: '0.0.0.0', port: 2332 },
  model: { provider: '', model: '', reasoningEffort: 'low' },

  merge: { enabled: true, waitSec: 2.5, maxSec: 8, waitTypingSec: 5 },

  sound: {
    onIncoming: true, onSend: true,
    incoming: 'chime', outgoing: 'bubble',
    incomingUrl: '', outgoingUrl: '',
    inVolume: 0.5, outVolume: 0.5,
  },

  logs: { maxMB: 2 },

  theme: { mode: 'follow', background: '' },
  imageGen: {
    enabled: false,

    provider: 'openai',
    baseUrl: '',
    apiKey: '',
    model: '',
    size: '1024x1024',
    stylePrompt: '',
    steps: 25,
    cfgScale: 7,
    sampler: 'DPM++ 2M Karras',
    negativePrompt: '',
    ownerOnly: true,
  },

  persona: { current: 'dafeiyu' },
  voice: {
    enabled: false,
    provider: 'auto',
    ttsBaseUrl: '',
    ttsApiKey: '',
    ttsModel: 'tts-1',
    ttsVoice: 'alloy',
    engine: 'auto',
    cosyvoice: { url: 'http://127.0.0.1:50000', mode: 'sft', spkId: '中文女', instruct: '', sampleRate: 22050 },
    gptsovits: { url: 'http://127.0.0.1:9880', refAudio: '', promptText: '', promptLang: 'zh', textLang: 'zh' },
    http: { urlTemplate: '' },
    voice: 'zh-CN-XiaoyiNeural',
    rate: '+0%',
    pitch: '+0Hz',
    autoChance: 0.15,
    autoMaxChars: 80,
    asr: false,

    asrLanguage: 'zh',
  },
  stickers: {
    enabled: true,
    autoChance: 0.35,
    maxPerHour: 20,
    maxLibrary: 300,
    caption: true,
    steal: true,
  },
  diary: {
    enabled: true,
    timesPerDay: 2,
    windowStart: '10:00',
    windowEnd: '23:30',
    minGapMinutes: 180,
    minChars: 60,
    maxChars: 140,
    visibility: 'all',
  },
  local: { tts: false, image: false, song: false, asr: false },

  azoneSocial: {
    enabled: true,
    replyOwn: true,
    maxPerDay: 8,
  },

  speakUp: {
    enabled: true,
    idleMinutes: 60,
    minGapMinutes: 120,
    maxPerDay: 4,
    quietFrom: '23:00',
    quietTo: '08:00',
  },

  mood: {
    enabled: true,
    halfLifeHours: 3,
    neutralHigh: 60,
    neutralLow: 50,
    judge: true,
    decay: true,
  },
  memory: { enabled: true, recallCount: 6, dailyConsolidate: true, consolidateTimes: ['04:00', '16:00'] },

  selfDrive: {
    enabled: false,
    intervalMinutes: 60,
    maxPerDay: 4,
    quietFrom: '01:00',
    quietTo: '08:00',
  },
  tabs: {},
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)

function deepMerge(base, over) {
  if (!isObj(over)) return structuredClone(base)
  const out = structuredClone(base)
  for (const [k, v] of Object.entries(over)) {
    if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v)
    else if (v !== undefined) out[k] = v
  }
  return out
}

const num = (v, d, lo, hi) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}
const bool = (v, d) => (typeof v === 'boolean' ? v : d)
const hhmm = (v, d) => (/^\d{1,2}:\d{2}$/.test(String(v)) ? String(v) : d)

export function normalize(raw) {
  const c = deepMerge(DEFAULTS, raw)
  c.enabled = bool(c.enabled, true)
  c.setupDone = bool(c.setupDone, false)
  c.ownerName = String(c.ownerName || '主人')
  c.botName = String(c.botName || '大肥鱼')
  c.botTag = String(c.botTag || '')
  c.siteName = String(c.siteName || '').slice(0, 40)
  c.pageTitle = String(c.pageTitle || '').slice(0, 60)

  c.web.port = Math.round(num(c.web.port, 2332, 1, 65535))
  c.web.host = String(c.web.host || '0.0.0.0')
  if (!['off', 'low', 'medium', 'high'].includes(c.model.reasoningEffort)) c.model.reasoningEffort = 'low'
  if (!['follow', 'light', 'dark', 'acrylic', 'frosted'].includes(c.theme.mode)) c.theme.mode = 'follow'
  c.theme.background = String(c.theme.background || '')
  c.merge.enabled = bool(c.merge.enabled, true)
  c.merge.waitSec = num(c.merge.waitSec, 2.5, 0, 30)
  c.merge.maxSec = Math.max(c.merge.waitSec, num(c.merge.maxSec, 8, 0, 60))
  c.merge.waitTypingSec = num(c.merge.waitTypingSec, 5, 0, 60)
  const snd = c.sound
  snd.onIncoming = bool(snd.onIncoming, true)
  snd.onSend = bool(snd.onSend, false)
  snd.inVolume = num(snd.inVolume ?? snd.volume, 0.5, 0, 1)
  snd.outVolume = num(snd.outVolume ?? snd.volume, 0.5, 0, 1)
  delete snd.volume
  const TONES = ['ding', 'pop', 'bubble', 'chime', 'custom', 'none']
  if (!TONES.includes(snd.incoming)) snd.incoming = 'ding'
  if (!TONES.includes(snd.outgoing)) snd.outgoing = 'pop'
  snd.incomingUrl = String(snd.incomingUrl || '').slice(0, 500)
  snd.outgoingUrl = String(snd.outgoingUrl || '').slice(0, 500)
  if (!c.logs || typeof c.logs !== 'object') c.logs = { maxMB: 2 }
  c.logs.maxMB = num(c.logs.maxMB, 2, 0.2, 50)
  c.voice.enabled = bool(c.voice.enabled, false)
  c.voice.asr = bool(c.voice.asr, false)

  if (!['auto', 'openai', 'edge', 'windows', 'local', 'cosyvoice', 'gptsovits', 'http'].includes(c.voice.provider)) c.voice.provider = 'auto'
  c.voice.ttsBaseUrl = String(c.voice.ttsBaseUrl || '')
  c.voice.ttsModel = String(c.voice.ttsModel || 'tts-1')
  c.voice.ttsVoice = String(c.voice.ttsVoice || 'alloy')

  delete c.voice.asrProvider
  delete c.voice.asrBaseUrl
  delete c.voice.asrApiKey
  delete c.voice.asrModel
  c.voice.autoChance = num(c.voice.autoChance, 0.15, 0, 1)
  c.voice.autoMaxChars = num(c.voice.autoMaxChars, 80, 20, 300)
  if (!['auto', 'edge', 'windows', 'cosyvoice', 'gptsovits', 'http'].includes(c.voice.engine)) c.voice.engine = 'auto'
  c.voice.cosyvoice.sampleRate = num(c.voice.cosyvoice.sampleRate, 22050, 8000, 48000)
  if (!['sft', 'instruct'].includes(c.voice.cosyvoice.mode)) c.voice.cosyvoice.mode = 'sft'
  c.stickers.autoChance = num(c.stickers.autoChance, 0.35, 0.1, 1)
  c.stickers.maxPerHour = num(c.stickers.maxPerHour, 20, 0, 200)
  c.stickers.maxLibrary = num(c.stickers.maxLibrary, 300, 20, 2000)
  c.stickers.steal = bool(c.stickers.steal, true)
  c.diary.timesPerDay = num(c.diary.timesPerDay, 2, 0, 6)
  c.diary.windowStart = hhmm(c.diary.windowStart, '10:00')
  c.diary.windowEnd = hhmm(c.diary.windowEnd, '23:30')
  c.diary.minGapMinutes = num(c.diary.minGapMinutes, 180, 0, 1440)
  c.diary.minChars = num(c.diary.minChars, 60, 10, 500)
  c.diary.maxChars = num(c.diary.maxChars, 140, 20, 3000)
  c.diary.visibility = c.diary.visibility === 'self' ? 'self' : 'all'
  for (const k of ['tts', 'image', 'song', 'asr']) c.local[k] = bool(c.local[k], false)
  const q = c.azoneSocial
  q.enabled = bool(q.enabled, true)
  q.replyOwn = bool(q.replyOwn, true)
  q.maxPerDay = num(q.maxPerDay, 8, 0, 50)

  const su = c.speakUp
  su.enabled = bool(su.enabled, true)
  su.idleMinutes = num(su.idleMinutes, 60, 1, 1440)
  su.minGapMinutes = num(su.minGapMinutes, 120, 0, 2880)
  su.maxPerDay = num(su.maxPerDay, 4, 0, 20)
  su.quietFrom = hhmm(su.quietFrom, '23:00')
  su.quietTo = hhmm(su.quietTo, '08:00')
  delete su.mode
  delete su.intervalMinutes
  delete su.timesPerDay
  delete su.nudge
  delete su.minIntervalMinutes
  delete su.maxIntervalMinutes
  delete su.awakeFrom
  delete su.awakeTo
  const mo = c.mood
  mo.enabled = bool(mo.enabled, true)
  mo.halfLifeHours = num(mo.halfLifeHours, 3, 0.25, 72)
  mo.neutralHigh = num(mo.neutralHigh, 60, 1, 100)
  mo.neutralLow = num(mo.neutralLow, 50, 0, 100)
  if (mo.neutralLow > mo.neutralHigh) mo.neutralLow = mo.neutralHigh
  mo.judge = bool(mo.judge, true)
  mo.decay = bool(mo.decay, true)
  const sd = c.selfDrive
  sd.enabled = bool(sd.enabled, false)
  sd.intervalMinutes = num(sd.intervalMinutes, 60, 5, 1440)
  sd.maxPerDay = num(sd.maxPerDay, 4, 0, 50)
  sd.quietFrom = hhmm(sd.quietFrom, '01:00')
  sd.quietTo = hhmm(sd.quietTo, '08:00')
  c.memory.consolidateTimes = [...new Set((Array.isArray(c.memory.consolidateTimes) ? c.memory.consolidateTimes : String(c.memory.consolidateTimes || '').split(/[\s,，]+/)).map((t) => hhmm(t, '')).filter(Boolean).map((t) => t.padStart(5, '0')))].sort().slice(0, 4)
  if (!c.memory.consolidateTimes.length) c.memory.consolidateTimes = ['04:00', '16:00']
  c.memory.recallCount = num(c.memory.recallCount, 6, 0, 20)
  c.imageGen.enabled = bool(c.imageGen.enabled, false)
  c.imageGen.ownerOnly = bool(c.imageGen.ownerOnly, true)
  if (!['openai', 'sdwebui', 'comfyui', 'local', 'code'].includes(c.imageGen.provider)) c.imageGen.provider = 'openai'
  if (!/^\d{3,4}x\d{3,4}$/.test(String(c.imageGen.size))) c.imageGen.size = '1024x1024'
  c.imageGen.steps = num(c.imageGen.steps, 25, 1, 150)
  c.imageGen.cfgScale = num(c.imageGen.cfgScale, 7, 0, 30)
  c.imageGen.negativePrompt = String(c.imageGen.negativePrompt || '')
  return c
}

const SECRETS = [['imageGen', 'apiKey'], ['voice', 'ttsApiKey']]

export function loadConfig() {
  const raw = readJson(FILE(), {})
  return normalize(raw)
}

export function saveConfig(cfg) {
  const c = normalize(cfg)
  writeJson(FILE(), c)
  return c
}

export function publicConfig(cfg) {
  const c = structuredClone(cfg)
  for (const [g, k] of SECRETS) {
    c[g][`${k}Set`] = Boolean(c[g][k])
    c[g][k] = ''
  }
  return c
}

export function mergeFromPanel(current, incoming) {
  const next = deepMerge(current, incoming || {})
  for (const [g, k] of SECRETS) {
    const v = incoming?.[g]?.[k]
    if (v === null) next[g][k] = ''
    else if (v === undefined || v === '') next[g][k] = current[g][k]
    delete next[g][`${k}Set`]
  }
  return normalize(next)
}

const FILE = () => dataDir('config.json')
