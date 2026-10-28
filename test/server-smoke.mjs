// 起一个真 HTTP 服务做冒烟：node test/server-smoke.mjs
// 覆盖：静态页、登录态下的 /api/messages 分页、/api/media?token=、SSE 连上
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { get } from 'node:http'

const dir = mkdtempSync(join(tmpdir(), 'aurasrv-'))
process.env.AURACHAT_DATA_DIR = dir

const auth = await import('../src/web/auth.js')
const { createHistory } = await import('../src/chat/history.js')
const { createWebServer } = await import('../src/web/server.js')

const PORT = 28311
const ok = (c, label) => { if (!c) { console.error('FAIL ' + label); process.exitCode = 1 } else console.log('ok  ' + label) }

auth.setupOwner({ username: 'tester', password: 'secret123' })
const token = auth.issueSession({ subject: 'owner', role: 'owner' })
ok(!!token, '签发了 token')

const history = createHistory({ log: console, emit: () => {}, getKeepDays: () => 7 })
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64')
for (let i = 1; i <= 240; i++) {
  const p = { who: i % 2 ? 'user' : 'bot', uid: i % 2 ? 'owner' : '', text: 'msg ' + i, kind: 'text' }
  if (i % 20 === 0) Object.assign(p, { kind: 'image', text: '[图片]', image: png, imageMime: 'image/png' })
  history.append('owner', p)
}
history.finalize('owner')

const hub = {
  pageOf: (chatId, opts) => history.page(chatId, opts),
  pageFileOf: (chatId, opts) => history.pageFile(chatId, opts),
  recentChat: () => [],
  onUserMessage: async () => {},
  noteTyping: () => {},
  messagesOf: (chatId) => history.page(chatId, { limit: 100 }).messages,
  historyStats: (chatId) => history.stats(chatId),
}
const deps = { hub, stickers: { library: () => ({ items: [], pickForReply: () => null }), markUsed: () => {} }, tts: {}, dsh: {} }

const conf = {
  web: { host: '127.0.0.1', port: PORT },
  stickers: { enabled: true, steal: true, autoChance: 0.5 },
  voice: { enabled: false },
  history: { keepDays: 7 },
  model: {},
  memory: {},
}
const server = createWebServer({
  dsh: {},
  getConfig: () => conf,
  setConfig: () => {},
  publicConfig: () => ({}),
  log: console,
  getConfigForRoutes: () => conf,
})
const fakeCtx = { effect: (fn) => { fn(); return () => {} }, webServer: { register: () => {} } }
server.register(fakeCtx, deps)
server.listenPort(PORT)
await new Promise((r) => setTimeout(r, 500))

const base = 'http://127.0.0.1:' + PORT

async function jget(path, headers = {}) {
  const res = await fetch(base + path, { headers })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text.slice(0, 120) }
  return { status: res.status, headers: res.headers, body }
}

// 1) 静态页
let r = await fetch(base + '/')
ok(r.status === 200 && (await r.text()).includes('<'), '静态页能打开')

// 2) 没登录
let j = await jget('/api/messages')
ok(j.status === 200 && j.body && j.body.ok === false, '没登录拉消息被拒')

// 3) 带 token 拉第一页
j = await jget('/api/messages?limit=100', { authorization: 'Bearer ' + token })
ok(j.status === 200 && j.body.ok, '登录后拉消息 200')
ok(j.body.messages.length === 100, '第一页 100 条')
ok(j.body.hasMore === true, '还有更早的')
const img = j.body.messages.find((m) => m.kind === 'image')
ok(!!img && !!img.mediaId, '图片带 mediaId')

// 4) 往前翻
j = await jget('/api/messages?limit=100&before=' + j.body.oldestAt, { authorization: 'Bearer ' + token })
ok(j.body.messages.length === 100, '第二页 100 条')

// 4b) 「一个文件 = 一页」：240 条 → 100+100+40，首屏只给最新 40 条
j = await jget('/api/messages?file=last', { authorization: 'Bearer ' + token })
ok(j.body.messages.length === 40, 'file=last 只给最新那片（40 条）')
ok(j.body.file.total === 3 && j.body.file.index === 2, 'file=last 分片信息正确')
const lastFileOldest = j.body.oldestAt
j = await jget('/api/messages?file=prev&before=' + lastFileOldest, { authorization: 'Bearer ' + token })
ok(j.body.messages.length === 100, 'file=prev 给上一整片（100 条）')

// 5) 媒体（浏览器 <img> 那种只用 ?token=）
r = await fetch(base + '/api/media/' + img.mediaId + '?token=' + token)
ok(r.status === 200, '媒体 200')
ok(String(r.headers.get('content-type')).startsWith('image/'), '媒体 content-type 正确')
ok(r.headers.get('etag'), '带 ETag')

// 6) 没有 token 的媒体
r = await fetch(base + '/api/media/' + img.mediaId)
ok(r.status === 401, '媒体没 token 401')

// 7) SSE 能连上
const streamOk = await new Promise((resolve) => {
  const req = get(base + '/api/stream?token=' + token, (res) => {
    resolve(res.statusCode === 200)
    req.destroy()
  })
  req.on('error', () => resolve(false))
  setTimeout(() => resolve(false), 2000)
})
ok(streamOk, 'SSE 连上 200')

server.closePort()
rmSync(dir, { recursive: true, force: true })
console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASS')
// 不调 process.exit：让 undici 的 keep-alive 连接自己回收，否则 libuv 会断言失败
