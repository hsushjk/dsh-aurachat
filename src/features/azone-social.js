import { dataDir, readJson, writeJson } from '../core/store.js'
import { isSilence, stripMarkdown } from '../chat/reply.js'

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const SELF = 'bot'

export function cleanComment(text, max = 60) {
  const t = stripMarkdown(String(text || '')).replace(/\|\|\|/g, ' ').replace(/<[^>]+>/g, '').trim()
  if (!t || isSilence(t)) return ''
  const first = t.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 2).join(' ')
  return first.length > max ? first.slice(0, max) : first
}

export function createAzoneSocial({ getConfig, hub, log, memory, azone, botName }) {
  const herName = () => botName || 'AuraChat'
  const file = () => dataDir('azone-social.json')
  const load = () => readJson(file(), () => ({ day: '', count: 0, lastRun: 0, replied: {}, history: [] }))
  const save = (s) => writeJson(file(), s)
  let busy = false

  async function write(prompt) {
    const out = await hub.runSystemTurn('azone-social', '空间互动', `【空间互动，不是聊天，这一轮不会发到聊天里】\n${prompt}\n\n只输出回复正文本身，一两句、口语、不超过 40 个字，别加引号和前缀；不想评就只回 [沉默]。`, { timeoutMs: 120000 })
    return cleanComment(out)
  }

  function record(s, item) {
    s.history.unshift({ at: Date.now(), ...item })
    s.history = s.history.slice(0, 30)
    s.count++
  }

  async function replyOwn(s, budget) {
    let done = 0
    const entries = azone.state().history
    for (const e of entries) {
      if (done >= budget) break
      for (const c of e.comments || []) {
        if (done >= budget) break
        const thread = [c, ...(c.replies || [])].sort((a, b) => Number(a.at || 0) - Number(b.at || 0))
        let lastMine = -1
        thread.forEach((x, i) => { if (String(x.from) === SELF) lastMine = i })
        const pending = thread.slice(lastMine + 1).filter((x) => String(x.from) !== SELF)
        if (!pending.length) continue
        const key = `${e.id}/${c.id}`
        const handled = new Set(s.replied[key] || [])
        const unhandled = pending.filter((x) => !handled.has(x.id))
        if (!unhandled.length) continue

        for (const x of pending) handled.add(x.id)
        s.replied[key] = [...handled].slice(-100)
        const last = unhandled[unhandled.length - 1]
        const threadText = thread.map((x) => `${x.name || '某人'}：${String(x.text).slice(0, 120)}`).join('\n')
        const text = await write(
          `你在空间发过一条动态：「${String(e.text).slice(0, 200)}」\n` +
          `这条动态下面大家的留言：\n${threadText}\n\n` +
          `${last.name || '某人'} 刚刚说了新的话，结合动态内容和上面的留言，用你的口气接着回 TA 一句。`,
        )
        if (!text) continue
        azone.addReply(e.id, c.id, { from: SELF, name: herName(), text })
        memory?.addEvent({ text: `在空间回复了${last.name || '某人'}的留言：${text}`, about: String(last.from), aboutName: last.name, tags: ['空间'], importance: 0.35 })
        record(s, { kind: 'reply', who: last.name, post: String(e.text).slice(0, 30), text })
        done++
      }
    }

    const keep = new Set()
    for (const e of entries) for (const c of e.comments || []) keep.add(`${e.id}/${c.id}`)
    for (const k of Object.keys(s.replied)) if (!keep.has(k)) delete s.replied[k]
    return done
  }

  async function run({ force = false } = {}) {
    const cfg = getConfig()
    const c = cfg.azoneSocial
    if (busy) return { ok: false, message: '正在逛空间' }
    if (!force && (!cfg.enabled || !c.enabled)) return { ok: false, message: '没打开' }
    busy = true
    const s = load()
    if (s.day !== dayKey()) Object.assign(s, { day: dayKey(), count: 0 })
    s.lastRun = Date.now()
    try {

      const left = force ? Math.min(3, 99) : Math.max(0, c.maxPerDay - s.count)
      if (!left) return { ok: true, message: '今天互动够多了', replies: 0 }
      const replies = c.replyOwn ? await replyOwn(s, Math.min(3, left)) : 0
      return { ok: true, message: `回了 ${replies} 条留言`, replies }
    } catch (error) {
      log.warn('逛空间出错：', error.message)
      return { ok: false, message: error.message }
    } finally {
      save(s)
      busy = false
    }
  }

  async function tick() {
    const cfg = getConfig()
    const c = cfg.azoneSocial
    if (!cfg.enabled || !c.enabled) return
    await run()
  }

  return { run, tick, state: () => { const s = load(); return { count: s.day === dayKey() ? s.count : 0, lastRun: s.lastRun, history: s.history.slice(0, 15) } } }
}
