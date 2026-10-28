import { dataDir, readJson, writeJson } from '../core/store.js'

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const newId = (p = 'd') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function planDiaryTimes({ timesPerDay, windowStart, windowEnd, minGapMinutes }, rand = Math.random) {
  const a = toMin(windowStart)
  const b = toMin(windowEnd)
  const n = Math.max(0, Math.round(timesPerDay))
  if (n === 0 || b <= a) return []
  const span = b - a
  const gap = Math.min(minGapMinutes, Math.floor(span / Math.max(n, 1)))
  for (let attempt = 0; attempt < 200; attempt++) {
    const pts = Array.from({ length: n }, () => a + Math.floor(rand() * span)).sort((x, y) => x - y)
    if (pts.every((p, i) => i === 0 || p - pts[i - 1] >= gap)) return pts
  }

  return Array.from({ length: n }, (_, i) => a + Math.floor((span / n) * (i + 0.5)))
}

export function createAzone({ getConfig, hub, log, onDiary }) {
  const file = () => dataDir('diary.json')
  const state = () => readJson(file(), () => ({ plan: { day: '', times: [], done: [] }, history: [] }))
  const save = (s) => writeJson(file(), s)
  let busy = false
  let lastFailAt = 0

  async function post(content, { visibility } = {}) {
    const cfg = getConfig()
    const text = String(content || '').trim()
    if (!text) return { ok: false, message: '动态是空的' }
    if (!cfg.enabled) return { ok: false, message: '总开关关着' }
    const s = state()
    const entry = {
      id: newId(),
      at: Date.now(),
      text,
      visibility: visibility || cfg.diary.visibility,
      comments: [],
    }
    s.history.unshift(entry)
    s.history = s.history.slice(0, 200)
    save(s)
    log.info(`发了一条动态（id ${entry.id}）`)
    return { ok: true, id: entry.id }
  }

  async function remove(id) {
    const s = state()
    const before = s.history.length
    s.history = s.history.filter((e) => e.id !== id)
    save(s)
    return { ok: s.history.length < before }
  }

  function todayExcerpt(maxLines = 60) {
    const cfg = getConfig()
    const owner = cfg.ownerName || '主人'
    const lines = hub.chatLogOf(dayKey())
      .filter((l) => !String(l.chatId).startsWith('system:'))
      .slice(-maxLines)
      .map((l) => {
        const time = new Date(l.t).toTimeString().slice(0, 5)
        if (l.who === 'bot') return `${time} 我：${l.text}`
        const who = l.uid === 'owner' ? owner : (l.uid ? `客人${String(l.uid).replace(/^guest-/, '')}` : '对方')
        return `${time} ${who}：${l.text}`
      })
    return lines.join('\n')
  }

  async function writeDiary({ visibility } = {}) {
    if (busy) return { ok: false, message: '上一篇还在写' }
    busy = true
    try {
      const cfg = getConfig().diary
      const now = new Date()
      const excerpt = todayExcerpt()
      const prompt = [
        `【写空间日记】现在是 ${now.getMonth() + 1} 月 ${now.getDate()} 日 ${now.toTimeString().slice(0, 5)}。`,
        excerpt ? `今天你在网页上的聊天片段（「我」是你自己）：\n${excerpt}` : '今天还没怎么聊天。',
        `请用你自己的口吻写一条动态（空间日记），第一人称，${cfg.minChars}~${cfg.maxChars} 个字，像真人随手发的动态：写今天真实发生的小事、此刻的心情或想法。`,
        '不要分条、不要 |||、不要 <voice>/<sticker> 标记、不要 Markdown、不要加引号，只输出动态正文本身。',
      ].join('\n\n')
      let text = await hub.runSystemTurn('diary', '空间日记', prompt)
      text = String(text || '').replace(/\|\|\|/g, ' ').replace(/<[^>]+>/g, '').replace(/^["「“]|["」”]$/g, '').trim()
      if (text.length > cfg.maxChars + 20) text = text.slice(0, cfg.maxChars + 20)
      if (!text || text === '[沉默]') return { ok: false, message: '她这次没写出来' }
      const r = await post(text, { visibility })
      if (r.ok) {
        try { onDiary?.(text) } catch (error) {}
      }
      return { ...r, text }
    } catch (error) {
      log.warn('写日记失败：', error.message)
      return { ok: false, message: error.message }
    } finally {
      busy = false
    }
  }

  async function tick() {
    const cfg = getConfig()
    if (!cfg.enabled || !cfg.diary.enabled) return
    const s = state()
    const today = dayKey()

    const sig = JSON.stringify({
      timesPerDay: cfg.diary.timesPerDay,
      windowStart: cfg.diary.windowStart,
      windowEnd: cfg.diary.windowEnd,
      minGapMinutes: cfg.diary.minGapMinutes,
    })
    if (s.plan.day !== today || s.plan.sig !== sig) {
      s.plan = { day: today, times: planDiaryTimes(cfg.diary), done: [], sig }
      save(s)
      log.info(`今天的日记时间：${s.plan.times.map((m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`).join('、') || '（不写）'}`)
    }
    const now = new Date()
    const nowMin = now.getHours() * 60 + now.getMinutes()
    const due = s.plan.times.find((m) => m <= nowMin && !s.plan.done.includes(m))
    if (due === undefined) return

    if (Date.now() - lastFailAt < 5 * 60_000) return
    log.info('到点了，写一篇空间日记')
    const r = await writeDiary()

    if (r?.ok) {
      const s2 = state()
      if (!s2.plan.done.includes(due)) { s2.plan.done.push(due); save(s2) }
    } else {
      lastFailAt = Date.now()
    }
  }

  function nextTime() {
    const s = state()
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
    const m = s.plan.day === dayKey() ? s.plan.times.find((x) => !s.plan.done.includes(x) && x >= nowMin) : undefined
    return m === undefined ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  }

  function visibleEntries(role) {
    const s = state()
    return s.history.filter((e) => role === 'owner' || e.visibility === 'all')
  }

  function entryById(id) {
    return state().history.find((e) => e.id === id)
  }

  function addComment(entryId, { from, name, text }) {
    const s = state()
    const e = s.history.find((x) => x.id === entryId)
    if (!e) return { ok: false, message: '这条动态没了' }
    const c = { id: newId('c'), from, name, text: String(text || '').trim(), at: Date.now(), replies: [] }
    e.comments.push(c)
    save(s)
    return { ok: true, id: c.id, at: c.at }
  }

  function addReply(entryId, commentId, { from, name, text }) {
    const s = state()
    const e = s.history.find((x) => x.id === entryId)
    const c = e?.comments.find((x) => x.id === commentId)
    if (!c) return { ok: false, message: '这条留言没了' }
    const r = { id: newId('r'), from, name, text: String(text || '').trim(), at: Date.now() }
    c.replies.push(r)
    save(s)
    return { ok: true, id: r.id, at: r.at }
  }

  function deleteComment(entryId, commentId) {
    const s = state()
    const e = s.history.find((x) => x.id === entryId)
    if (!e) return { ok: false, message: '这条动态没了' }
    const before = e.comments.length
    e.comments = e.comments.filter((c) => c.id !== commentId)
    save(s)
    return { ok: e.comments.length < before }
  }

  function deleteReply(entryId, commentId, replyId) {
    const s = state()
    const e = s.history.find((x) => x.id === entryId)
    const c = e?.comments.find((x) => x.id === commentId)
    if (!c) return { ok: false, message: '这条留言没了' }
    const before = c.replies.length
    c.replies = c.replies.filter((r) => r.id !== replyId)
    save(s)
    return { ok: c.replies.length < before }
  }

  function stats() {
    const s = state()
    const today = dayKey()
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const todayCount = s.history.filter((e) => e.at >= startOfToday.getTime()).length
    const planned = s.plan.day === today ? s.plan.times.length : 0
    return { today: todayCount, total: s.history.length, planned, next: nextTime() }
  }

  return {
    post,
    remove,
    writeDiary,
    tick,
    history: () => state().history,
    nextTime,
    visibleEntries,
    entryById,
    addComment,
    addReply,
    deleteComment,
    deleteReply,
    stats,
    state,
  }
}
