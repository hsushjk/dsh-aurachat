// 接口层冒烟测试：node test/messages-api.mjs
// 覆盖：/api/messages 分页与 limit 夹取、/api/media 用 ?token= 取字节、没 token 401、不存在 404
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'auraroute-'))
process.env.AURACHAT_DATA_DIR = dir

const { createHistory, mediaPath } = await import('../src/chat/history.js')
const { createRouter } = await import('../src/web/router.js')
const chatRoutes = await import('../src/web/routes/chat.js')
const mediaRoutes = await import('../src/web/routes/media.js')

const TOKEN = 'tok-abc'
const me = { subject: 'owner', role: 'owner', name: '主人' }
const ok = (c, label) => { if (!c) { console.error('FAIL ' + label); process.exitCode = 1 } else console.log('ok  ' + label) }

const history = createHistory({ log: console, emit: () => {}, getKeepDays: () => 7 })
const hub = {
  pageOf: (chatId, opts) => history.page(chatId, opts),
  pageFileOf: (chatId, opts) => history.pageFile(chatId, opts),
}

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
for (let i = 1; i <= 250; i++) {
  const p = { who: 'user', uid: 'owner', text: 'msg ' + i, kind: 'text' }
  if (i % 25 === 0) Object.assign(p, { kind: 'image', text: '[图片]', image: png.toString('base64'), imageMime: 'image/png' })
  history.append('owner', p)
}
history.finalize('owner')

function fakeRes() {
  return {
    status: 0, headers: {}, body: null,
    writeHead(s, h) { this.status = s; this.headers = h || {}; return this },
    end(b) { this.body = b },
    setHeader() {}, getHeader() { return null },
  }
}
const ctxBase = {
  json(res, obj) { res.status = res.status || 200; res.body = JSON.stringify(obj) },
  send(res, status, obj) { res.status = status; res.body = typeof obj === 'string' ? obj : JSON.stringify(obj) },
  readBody: async () => ({}),
  stripDataUrl: (s) => s,
  requireUser(req) { const t = String(req.headers?.authorization || '').replace(/^Bearer /, ''); return t === TOKEN ? me : null },
  requireOwner: (req) => (String(req.headers?.authorization || '').replace(/^Bearer /, '') === TOKEN ? me : null),
  getConfig: () => ({ stickers: { steal: true } }),
  setConfig: () => {},
  chatIdOf: (s) => String(s),
  displayNameOf: () => '主人',
  log: console,
  MIME: { '.png': 'image/png', '.wav': 'audio/wav' },
  ROOT: process.cwd(),
  // 和真服务一样：优先 Authorization，其次 oc_s cookie（DSH 在 127.0.0.1 上种的那个）
  tokenOf: (req) => {
    const auth = String(req.headers?.authorization || '').replace(/^Bearer /, '')
    if (auth) return auth
    const m = String(req.headers?.cookie || '').match(/(?:^|;\s*)oc_s=([^;]+)/)
    return m ? m[1] : null
  },
  sessionUser: (t) => (t === TOKEN ? me : null),
  deps: { hub, stickers: { library: () => ({ items: [] }) } },
}

const router = createRouter()
chatRoutes.register(router, ctxBase)
mediaRoutes.register(router, ctxBase)

async function hit(method, path, query = '', headers = {}) {
  const p = path.replace(/^\//, '')
  const r = router.match(method, p)
  if (!r) throw new Error('no route ' + method + ' ' + p)
  const req = { method, headers, url: '/' + p + query }
  const res = fakeRes()
  await r.handler(req, res, new URL('http://x/' + p + query), p)
  return res
}

// 1) 第一页
let res = await hit('GET', 'api/messages', '?limit=100', { authorization: 'Bearer ' + TOKEN })
let body = JSON.parse(res.body)
ok(res.status === 200, '第一页 200')
ok(body.messages.length === 100, '第一页 100 条')
ok(body.hasMore === true, 'hasMore=true')
ok(body.segment.limit === 100, 'segment.limit=100')
ok(!JSON.stringify(body.messages).includes('base64'), '返回里没有 base64 字段')

// 2) 用 oldestAt 往前翻
res = await hit('GET', 'api/messages', '?limit=100&before=' + body.oldestAt, { authorization: 'Bearer ' + TOKEN })
const body2 = JSON.parse(res.body)
ok(body2.messages.length === 100, '第二页 100 条')
ok(body2.messages[body2.messages.length - 1].t <= body.oldestAt, '第二页都比 oldestAt 更早')
ok(body2.hasMore === true, '第二页还有更早的')

// 3) 「一个文件 = 一页」：最新那片只返回它自己的条数（250 条 → 100+100+50，最新是 50）
res = await hit('GET', 'api/messages', '?file=last', { authorization: 'Bearer ' + TOKEN })
const last = JSON.parse(res.body)
ok(last.messages.length === 50, 'file=last 只返回最新那片（50 条）')
ok(last.hasMore === true, 'file=last 还有更早的')
ok(last.file.total === 3, '一共 3 片')
ok(last.file.index === 2, '最新那片 index=2')

// 4) 再往前翻一整片
res = await hit('GET', 'api/messages', '?file=prev&before=' + last.oldestAt, { authorization: 'Bearer ' + TOKEN })
const prev = JSON.parse(res.body)
ok(prev.messages.length === 100, 'file=prev 返回上一整片（100 条）')
ok(prev.messages[prev.messages.length - 1].t < last.oldestAt, '上一片都比最新片更早')
ok(prev.hasMore === true, '上一片之前还有')
res = await hit('GET', 'api/messages', '?file=prev&before=' + prev.oldestAt, { authorization: 'Bearer ' + TOKEN })
const prev2 = JSON.parse(res.body)
ok(prev2.messages.length === 100, '再往前一片 100 条')
ok(prev2.hasMore === false, '最老那片 hasMore=false')

// 5) 分片文件名带序号，目录排序就是时间顺序
const segNames = []
let cursor = 0
for (;;) {
  const f = history.pageFile('owner', { before: cursor })
  if (!f.messages.length) break
  segNames.push(f.id)
  if (!f.hasMore) break
  cursor = f.oldestAt
}
ok(segNames.length === 3, '能从新到旧走完 3 片')
ok(segNames.every((id) => /^seg-\d{3}-/.test(id)), '分片文件名都带序号')
ok(JSON.stringify([...segNames].sort()) === JSON.stringify([...segNames].reverse()), '按文件名排序与时间顺序一致')

// 6) limit 被夹住
res = await hit('GET', 'api/messages', '?limit=999', { authorization: 'Bearer ' + TOKEN })
ok(JSON.parse(res.body).segment.limit === 100, 'limit 超 100 被夹到 100')
res = await hit('GET', 'api/messages', '?limit=abc', { authorization: 'Bearer ' + TOKEN })
ok(JSON.parse(res.body).segment.limit === 100, '非法 limit 回落 100')

// 4) 媒体：带 ?token= 能取（<img> 不能带 header）
const msgWithImg = history.page('owner', { limit: 100 }).messages.find((m) => m.kind === 'image')
ok(!!msgWithImg && !!msgWithImg.mediaId, '找到带 mediaId 的图片消息')
const file = mediaPath('owner', msgWithImg.mediaId)
ok(existsSync(file), '媒体文件在磁盘上')
res = await hit('GET', 'api/media/' + msgWithImg.mediaId, '?token=' + TOKEN)
ok(res.status === 200, '媒体带 token 查询参数返回 200')
ok(String(res.headers['content-type']).startsWith('image/'), 'content-type 是图片')
ok(String(res.headers['cache-control']).includes('immutable'), '强缓存头在')
ok(Buffer.isBuffer(res.body) ? res.body.length > 0 : String(res.body).length > 0, '有内容返回')

// 5) 没 token → 401
res = await hit('GET', 'api/media/' + msgWithImg.mediaId)
ok(res.status === 401, '没 token 返回 401')

// 6) 不存在的 id → 404
res = await hit('GET', 'api/media/nope.png', '?token=' + TOKEN)
ok(res.status === 404, '不存在的媒体 404')

// 7) 回归：浏览器带着 DSH 种的 oc_s cookie（不是本插件的会话）时，
//    URL 里的 ?token= 仍然要能认出来，不能被 cookie 里的假 token 顶掉
res = await hit('GET', 'api/media/' + msgWithImg.mediaId, '?token=' + TOKEN, { cookie: 'oc_s=some-other-app-token' })
ok(res.status === 200, '有干扰 cookie 时 ?token= 依然 200')
res = await hit('GET', 'api/media/' + msgWithImg.mediaId, '?token=bogus', { cookie: 'oc_s=' + TOKEN })
ok(res.status === 200, 'URL token 无效时回退用 cookie token 也能 200')

rmSync(dir, { recursive: true, force: true })
console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASS')
