import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { dataDir, readJson, writeJson } from '../core/store.js'
import { OWNER_ID } from '../chat/access.js'
import { inRange } from '../core/time.js'

function memoFile() {
  return join(dataDir(), 'selfdrive.md')
}

export function createSelfDrive({ getConfig, hub, log }) {
  const file = () => dataDir('selfdrive.json')
  const load = () => readJson(file(), () => ({ day: '', count: 0, nextAt: 0, last: 0 }))
  const save = (s) => writeJson(file(), s)

  const DEFAULT_MEMO = [
    '# 便签',
    '',
    '- 看看用户正在干什么',
    '- 想找个由头夸夸用户',
  ].join('\n')

  function readMemo() {
    try {
      const p = memoFile()
      if (!existsSync(p)) {
        mkdirSync(dirname(p), { recursive: true })
        writeFileSync(p, DEFAULT_MEMO + '\n', 'utf8')
        return DEFAULT_MEMO
      }
      return String(readFileSync(p, 'utf8') || '').trim().slice(0, 8000)
    } catch (error) {
      log.warn(`读便签失败：${error?.message || error}`)
      return ''
    }
  }

  function writeMemo(text) {
    try {
      const p = memoFile()
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, String(text || '').slice(0, 20000), 'utf8')
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error?.message || String(error) }
    }
  }

  async function fire() {
    const cfg = getConfig()
    const owner = cfg.ownerName || '主人'
    const memo = readMemo()
    if (!memo) return false
    const prompt = [
      `【系统提醒，不是${owner}说的话】没人喊你，是你自己在往下过。`,
      `你和${owner}的共享便签：\n${memo}`,
      '看着便签自己找点由头：关心一下、接着说上次没说完的、或者忽然想起件小事。便签不是待办清单，不用逐条打勾，也别汇报你「做了什么」。',
      '用一两句话开口就好，别解释这是系统提醒；实在没什么想说的就只回 [沉默]。',
    ].join('\n')
    log.info('自驱：翻了翻便签')
    await hub.pushToSession({ chatId: OWNER_ID, userId: OWNER_ID, nickname: owner }, [{ type: 'text', text: prompt }], '')
    return true
  }

  async function tick() {
    const cfg = getConfig()
    if (!cfg.enabled) return
    const c = cfg.selfDrive || {}
    if (!c.enabled) return
    if (!readMemo()) return
    const s = load()
    const today = new Date().toDateString()
    if (s.day !== today) Object.assign(s, { day: today, count: 0, nextAt: 0 })
    const now = new Date()
    if (inRange(now, c.quietFrom, c.quietTo)) return
    if (!s.nextAt) s.nextAt = Date.now() + c.intervalMinutes * 60_000
    if (s.count >= c.maxPerDay || Date.now() < s.nextAt) {
      save(s)
      return
    }
    s.count++
    s.last = Date.now()
    s.nextAt = Date.now() + c.intervalMinutes * 60_000
    save(s)
    try {
      await fire()
    } catch (error) {
      log.warn(`自驱失败：${error?.message || error}`)
    }
  }

  return { tick, fire, state: load, readMemo, writeMemo }
}
