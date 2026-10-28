// 分片存储冒烟测试：node test/history.mjs
// 覆盖：写满 100 条自动滚动 / 单片体积有界 / 分页 / mediaId 抽取 / patchLast /
//       过期清理 / 孤儿媒体清理 / 同毫秒边界翻页
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'aurahist-'))
process.env.AURACHAT_DATA_DIR = dir

const { createHistory } = await import('../src/chat/history.js')
const events = []
const h = createHistory({ log: console, emit: (t, p) => events.push([t, p]), getKeepDays: () => 7 })

const ok = (cond, label) => { if (!cond) { console.error('FAIL ' + label); process.exitCode = 1 } else console.log('ok  ' + label) }

// 1) 写 250 条：每 25 条带一张图、每 40 条带一条语音
const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
let lastAppended = null
for (let i = 1; i <= 250; i++) {
  const payload = { who: i % 2 ? 'user' : 'bot', uid: i % 2 ? 'owner' : '', text: 'msg ' + i, kind: 'text' }
  if (i % 25 === 0) Object.assign(payload, { kind: 'image', text: '[图片]', image: png, imageMime: 'image/png' })
  if (i % 40 === 0) Object.assign(payload, { kind: 'voice', text: '[语音 · 2秒]', voice: png, voiceMime: 'audio/wav', dur: 2 })
  lastAppended = h.append('owner', payload)
}

const st0 = h.stats('owner')
ok(st0.segments === 3, '写满 100 条自动滚动，250 条 = 3 个片，实际 ' + st0.segments)
ok(st0.messages === 250, '总条数 250')
ok(lastAppended && lastAppended.id && lastAppended.t > 0, 'append 返回带 id/t 的消息')

// 1b) 单片体积有界：任何一片都不超过 100 条（append 代价是常数级，不随聊天变长）
const ownerSegFiles = readdirSync(join(dir, 'chats', 'owner')).filter((f) => f.endsWith('.json') && f !== 'index.json')
const segSizes = ownerSegFiles.map((f) => JSON.parse(readFileSync(join(dir, 'chats', 'owner', f), 'utf8')).messages.length)
ok(Math.max(...segSizes) <= 100, '每片 ≤100 条，实际 ' + segSizes.join('+'))
ok(segSizes.reduce((a, b) => a + b, 0) === 250, '分片条数加起来 250')

// 2) 空闲 finalize：已经没有超长片可切，也不该发 history 事件
const fin = h.finalize('owner')
ok(fin.split === null, '空闲时没有超长片可切，实际 ' + JSON.stringify(fin.split))
const st = h.stats('owner')
ok(st.segments === 3, '空闲后仍是 3 片，实际 ' + st.segments)
ok(!events.some((e) => e[0] === 'history'), '只滚动没删东西，不发 history 事件')

const segFiles = readdirSync(join(dir, 'chats', 'owner')).filter((f) => f.endsWith('.json') && f !== 'index.json')
ok(segFiles.length === 3, '磁盘上 3 个分片文件')

const media = readdirSync(join(dir, 'media', 'owner'))
ok(media.length === 10 + 6, '媒体落盘 16 个，实际 ' + media.length)
ok(st.textBytes < 300 * 1024, '文字分片总体积很小：' + st.textBytes + 'B')

// 3) 第一页：最新 100 条
const p1 = h.page('owner', { limit: 100 })
ok(p1.messages.length === 100, '第一页 100 条')
ok(p1.messages[0].text === 'msg 151', '第一页从 151 开始，实际 ' + p1.messages[0].text)
ok(p1.hasMore === true, '第一页还有更早的')
ok(!p1.messages.some((m) => m.image || m.voice), '返回里没有内联 base64')
ok(p1.messages.some((m) => m.mediaId), '有 mediaId 引用')

// 4) 一直往前翻到最早（边界那条会重复返回一次，客户端按 id 去重，这里照做）
let before = p1.oldestAt
let all = p1.messages.slice()
const ids = new Set(all.map((m) => m.id))
let pages = 1
while (true) {
  const p = h.page('owner', { before, limit: 100 })
  if (!p.messages.length) break
  pages += 1
  for (const m of p.messages) if (!ids.has(m.id)) { ids.add(m.id); all.push(m) }
  before = p.oldestAt
  if (!p.hasMore) break
}
all.sort((a, b) => a.t - b.t)
ok(pages === 3, '翻页 3 次拿全，实际 ' + pages)
ok(all.length === 250, '拿全 250 条，实际 ' + all.length)
ok(all[0].text === 'msg 1', '第一条是 msg 1，实际 ' + all[0].text)
ok(all[all.length - 1].id && all[all.length - 1].t > all[0].t, '最后一条时间更大（顺序没乱）')

// 5) heard 回填
h.append('owner', { who: 'user', uid: 'owner', text: '[语音 · 2秒]', kind: 'voice', voice: png, voiceMime: 'audio/wav', dur: 2 })
h.patchLast('owner', { heard: '测试转写' })
ok(h.last('owner').heard === '测试转写', 'patchLast 回填 heard')

// 6) 过期清理：另开一个会话塞 10 天前的消息，keepDays=7 应该整片删掉
const old = Date.now() - 10 * 86400_000
for (let i = 1; i <= 5; i++) h.append('old', { who: 'user', text: 'old ' + i, kind: 'text', t: old + i })
for (let i = 1; i <= 3; i++) h.append('old', { who: 'user', text: '[图片]', kind: 'image', image: png, imageMime: 'image/png', t: old + 100 + i })
ok(h.stats('old').messages === 8, '旧会话 8 条')
const r = h.sweep('old')
ok(r.changed === true, '过期清理删了片')
ok(h.stats('old').messages === 0, '清完后 0 条，实际 ' + h.stats('old').messages)
ok(readdirSync(join(dir, 'media', 'old')).length === 0, '旧会话媒体文件也清干净')

// 7) 跨过期线的片：只掐掉过期那几条，留新的（不然「保留 7 天」会变成多留十几天）
const older = Date.now() - 8 * 86400_000
const newer = Date.now() - 2 * 86400_000
for (let i = 1; i <= 5; i++) h.append('mix', { who: 'user', text: 'mix-old ' + i, kind: 'text', t: older + i })
h.append('mix', { who: 'user', text: '[图片]', kind: 'image', image: png, imageMime: 'image/png', t: older + 50 })
for (let i = 1; i <= 5; i++) h.append('mix', { who: 'user', text: 'mix-new ' + i, kind: 'text', t: newer + i })
ok(h.stats('mix').messages === 11, '跨线会话 11 条')
const r2 = h.sweep('mix')
ok(r2.changed === true && r2.dropped === 6, '掐掉更早的 6 条，实际 ' + r2.dropped)
ok(h.stats('mix').messages === 5, '留下 5 条新的，实际 ' + h.stats('mix').messages)
ok(readdirSync(join(dir, 'media', 'mix')).length === 0, '被掐掉的图片文件也删了')

// 8) 同一毫秒的消息卡在分页边界上：翻完所有页不能丢消息
const base2 = Date.now() - 60_000
for (let i = 1; i <= 120; i++) {
  h.append('dup', { who: 'user', text: 'd' + i, kind: 'text', t: base2 + Math.floor(i / 2) })
}
const seen2 = new Set()
let cursor2 = 0
for (let guard = 0; guard < 10; guard++) {
  const p = h.page('dup', { limit: 100, before: cursor2 })
  for (const m of p.messages) seen2.add(m.text)
  if (!p.hasMore) break
  cursor2 = p.oldestAt
}
ok(seen2.size === 120, '同毫秒边界翻页没丢消息，拿到 ' + seen2.size)

// 9) 孤儿媒体：没被任何消息引用的文件，超过 grace 才删；刚写进去的要留着
const mediaDirOwner = join(dir, 'media', 'owner')
const beforeOrphan = readdirSync(mediaDirOwner).length
writeFileSync(join(mediaDirOwner, 'orphan-old.bin'), 'x')
const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000
utimesSync(join(mediaDirOwner, 'orphan-old.bin'), twoHoursAgo, twoHoursAgo)
writeFileSync(join(mediaDirOwner, 'orphan-new.bin'), 'x')
const r3 = h.sweep('owner')
ok(r3.orphans === 1, '孤儿媒体删掉 1 个，实际 ' + r3.orphans)
ok(!readdirSync(mediaDirOwner).includes('orphan-old.bin'), '两小时前的孤儿被清掉')
ok(readdirSync(mediaDirOwner).includes('orphan-new.bin'), '刚写的孤儿还在（grace 保护）')
ok(readdirSync(mediaDirOwner).length === beforeOrphan + 1, '有消息引用的媒体一个没少')

rmSync(dir, { recursive: true, force: true })
console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASS')
