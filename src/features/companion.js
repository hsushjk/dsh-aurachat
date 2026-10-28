import { dataDir, readJson, writeJson } from '../core/store.js'
import { askModel } from '../core/llm.js'
import { OWNER_ID } from '../chat/access.js'
import { inRange } from '../core/time.js'

const UP = ['喜欢你', '爱你', '想你', '可爱', '好看', '漂亮', '聪明', '真棒', '厉害', '牛', '谢谢', '辛苦', '晚安', '早安', '抱抱', '摸摸', '贴贴', '乖', '宝贝', '爱了', '哈哈哈', '白米饭', '好吃', '请你吃']
const DOWN = ['讨厌', '滚', '烦死', '闭嘴', '笨', '蠢', '傻', '丑', '垃圾', '废物', '恶心', '无聊', '走开', '别理我', '不理你', '别说话', '生气', '难过', '烦人']

export function moodLabel(v, band = { high: 60, low: 50 }) {
  if (v >= band.high + 25) return '超开心'
  if (v >= band.high + 10) return '心情不错'
  if (v >= band.low) return '平平常常'
  if (v >= band.low - 15) return '有点低落'
  return '不太开心'
}

export const MOOD_STYLE = {
  超开心: '话多一点、语气活泼，爱用语气词和感叹，更愿意发表情包、发语音，会主动接话、开玩笑',
  心情不错: '语气轻快，爱开点小玩笑，回得积极一些',
  平平常常: '',
  有点低落: '话少一点、句子短，回得有点懒，少发表情；有人关心你会慢慢好起来',
  不太开心: '有点小脾气、带点委屈，回得简短，可能会怼一句（但别伤人）；被哄、被夸会消气',
}

export function moodEffects(v, band = { high: 60, low: 50 }) {
  const hi = band.high
  const lo = band.low
  if (v >= hi + 25) return { sticker: 1.6, voice: 1.5, delay: 0.85, chatty: 1.5, verbosity: 1.5 }
  if (v >= hi + 10) return { sticker: 1.25, voice: 1.2, delay: 0.92, chatty: 1.2, verbosity: 1.2 }
  if (v >= lo) return { sticker: 1, voice: 1, delay: 1, chatty: 1, verbosity: 1 }
  if (v >= lo - 15) return { sticker: 0.5, voice: 0.6, delay: 1.3, chatty: 0.6, verbosity: 0.7 }
  return { sticker: 0.3, voice: 0.4, delay: 1.5, chatty: 0.4, verbosity: 0.5 }
}

export function scoreText(text) {
  const t = String(text || '')
  let d = 0
  for (const w of UP) if (t.includes(w)) d += 6
  for (const w of DOWN) if (t.includes(w)) d -= 8
  return Math.max(-20, Math.min(20, d))
}

export function decayed(value, at, halfLifeHours, now = Date.now(), band = { high: 60, low: 50 }) {
  const h = Math.max(0, (now - at) / 3600_000)
  const k = Math.pow(0.5, h / Math.max(0.05, halfLifeHours || 3))
  if (value > band.high) return band.high + (value - band.high) * k
  if (value < band.low) return band.low + (value - band.low) * k
  return value
}

export function parseMoodJudge(out) {
  const m = String(out || '').match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0])
    const delta = Math.max(-15, Math.min(15, Math.round(Number(j.delta) || 0)))
    const confidence = Math.max(0, Math.min(1, Number(j.confidence) || 0))
    return { delta, reason: String(j.reason || '').slice(0, 40), confidence }
  } catch (error) {
    return null
  }
}

export function createMood({ getConfig, dsh }) {
  const file = () => dataDir('mood.json')
  const band = () => {
    const m = getConfig().mood
    return { high: m.neutralHigh, low: m.neutralLow }
  }
  const load = () => readJson(file(), () => ({ value: 65, at: Date.now(), reason: '', history: [] }))
  const save = (s) => writeJson(file(), s)
  const current = () => {
    const m = getConfig().mood
    const s = load()
    return Math.round(m.decay === false ? Math.max(m.neutralLow, Math.min(100, s.value)) : decayed(s.value, s.at, m.halfLifeHours, Date.now(), band()))
  }

  function nudge(d, reason) {
    if (!getConfig().mood.enabled || !d) return
    const s = load()
    const before = current()
    s.value = Math.max(0, Math.min(100, before + d))
    s.at = Date.now()
    s.reason = reason
    s.history = [{ at: Date.now(), from: before, to: Math.round(s.value), reason }, ...(s.history || [])].slice(0, 60)
    save(s)
  }
  return {
    current,
    band,
    label: () => moodLabel(current(), band()),
    state: () => {
      const s = load()
      const v = current()
      return { ...s, value: v, label: moodLabel(v, band()), band: band() }
    },
    history: () => load().history || [],
    effects: () => (getConfig().mood.enabled ? moodEffects(current(), band()) : moodEffects(60)),
    nudge,
    reset: () => { const m = getConfig().mood; save({ value: (m.neutralHigh + m.neutralLow) / 2, at: Date.now(), reason: '重置', history: load().history || [] }) },

    observe(text, who, { direct = true, owner = false } = {}) {
      if (getConfig().mood.judge && dsh) return
      const d0 = scoreText(text)
      if (!d0) return
      const d = Math.round(d0 * (direct ? 1 : 0.3) * (owner ? 1.5 : 1))
      nudge(d, `${who || '有人'}说「${String(text).slice(0, 20)}」`)
    },

    async judge({ userText, reply, who = '对方', origin = 'user' }) {
      const full = getConfig()
      const bot = full.botName || 'AuraChat'
      const cfg = full.mood
      if (!cfg.enabled || !cfg.judge || !dsh) return null
      const v = current()
      const b = band()
      const scene = origin === 'speak-up' ? `这一轮是${bot}自己想${who}了、主动去找${who}说话（不是被叫来干活）` : `这一轮是${who}在跟${bot}说话`
      try {
        const out = await askModel(dsh, {
          cfg: getConfig(),
          system: `你在判断聊天角色「${bot}」聊完一轮后的心情变化。它现在心情 ${v}/100（平常是 ${b.low}~${b.high}）。${scene}。只看这一轮真正影响它心情的东西：被夸、被关心、被惦记会开心；被凶、被冷落、被嫌弃会难过；开玩笑的「讨厌~」「笨蛋」不算真骂。只输出 JSON：{"delta": -15~15 的整数, "reason": "十几个字的理由", "confidence": 0~1 你有多确定}。没什么影响就 delta 为 0。`,
          text: `${origin === 'speak-up' ? bot + '主动说' : who + '说'}：${String(userText || '').slice(0, 600)}\n${bot}回：${String(reply || '').slice(0, 600)}`,
          maxTokens: 400,
          temperature: 0.2,
        })
        const r = parseMoodJudge(out)
        if (!r) return null
        if (r.confidence >= 0.6 && Math.abs(r.delta) >= 2) nudge(r.delta, r.reason || '刚才那一下')
        return r
      } catch (error) {
        return null
      }
    },

    contextLine() {
      if (!getConfig().mood.enabled) return ''
      const s = load()
      const v = current()
      const label = moodLabel(v, band())
      const style = MOOD_STYLE[label]
      if (!style) return ''
      return `（你现在${label}${s.reason ? '，因为' + s.reason : ''}。这会自然地影响你说话：${style}。不用说出来自己心情如何。）`
    },
  }
}

export function createSpeakUp({ getConfig, hub, log, isMuted }) {
  const file = () => dataDir('speakup.json')
  const load = () => readJson(file(), () => ({ day: '', count: 0, last: 0, firedFor: 0 }))
  const save = (s) => writeJson(file(), s)

  const ANGLES = [
    '分享一件你今天（编也行，符合你的人设）遇到的小事或想到的东西',
    '接着你们上次聊的话题，问问后来怎么样了',
    '想起记忆里关于对方的一件事，顺口提一句或关心一下',
    '问问对方现在在干嘛、吃了没、累不累',
    '撒个娇或者吐槽一句，说你有点无聊',
    '随手发个表情包或者一句没头没尾的感慨',
    '看看现在几点，按时间说点应景的（早上、饭点、深夜）',
  ]

  const inQuiet = (c, d) => inRange(d, c.quietFrom, c.quietTo)

  async function fire(reason = '闲置搭话') {
    const cfg = getConfig()
    const owner = cfg.ownerName || '主人'
    const idle = Math.round((Date.now() - (hub.lastOwnerChatAt || Date.now())) / 60000)
    const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)]
    const prompt = `【系统提醒，不是${owner}说的话】${owner}已经 ${idle > 600 ? '很久' : idle + ' 分钟'}没跟你说话了，你想主动找${owner}说点什么。这次的由头可以是：${angle}。用你自己的口气，一两句就好，别用模板、别解释为什么来找；实在不想说就只回 [沉默]。`
    log.info(`主动搭话（${reason}）`)
    await hub.pushToSession({ chatId: OWNER_ID, userId: OWNER_ID, nickname: owner }, [{ type: 'text', text: prompt }], '')
  }

  async function tick() {
    const cfg = getConfig()
    const c = cfg.speakUp
    if (!cfg.enabled || !c.enabled) return
    if (!cfg.setupDone) return
    if (isMuted?.(OWNER_ID)) return
    const now = new Date()
    if (inQuiet(c, now)) return
    const lastOwner = hub.lastOwnerChatAt || 0
    if (!lastOwner) return
    if (Date.now() - lastOwner < c.idleMinutes * 60_000) return
    const s = load()
    const today = new Date().toDateString()
    if (s.day !== today) Object.assign(s, { day: today, count: 0 })
    if (s.count >= c.maxPerDay) return

    if (s.firedFor === lastOwner && Date.now() - (s.last || 0) < c.minGapMinutes * 60_000) return
    s.count++
    s.last = Date.now()
    s.firedFor = lastOwner
    save(s)
    try {
      await fire('闲置搭话')
    } catch (error) {
      log.warn(`主动搭话失败：${error?.message || error}`)
    }
  }

  return { tick, fire, state: () => { const s = load(); return { count: s.day === new Date().toDateString() ? s.count : 0, last: s.last } } }
}
