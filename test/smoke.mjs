// 临时冒烟测试：把 server.js 挂到真 http 上，用假依赖跑一遍主要接口。跑完就删。
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.AURACHAT_DATA_DIR = mkdtempSync(join(tmpdir(), 'aurachat-test-'))

const { createWebServer } = await import('../src/web/server.js')

let handler = null
const ctx = {
  effect: (fn) => { fn(); return () => {} },
  webServer: { register: ({ path, handler: h }) => { handler = h; return () => { handler = null } } },
}

const config = {
  enabled: true, setupDone: false, ownerName: '主人', botName: '大肥鱼', botTag: '',
  theme: { mode: 'follow', background: '' },
  model: { provider: '', model: '', reasoningEffort: 'low' },
  mood: { enabled: true, halfLifeHours: 3, neutralHigh: 60, neutralLow: 50, judge: true, decay: true },
  selfDrive: { enabled: false, intervalMinutes: 60, maxPerDay: 4, quietFrom: 1, quietTo: 8 },
  speakUp: { enabled: true, idleMinutes: 60, minGapMinutes: 120, maxPerDay: 4, quietFrom: 23, quietTo: 8 },
  diary: {}, voice: {}, imageGen: {}, stickers: {}, memory: {}, persona: { current: 'dafeiyu' },
  web: { host: '127.0.0.1', port: 2332 },
}
const cfg = () => config
const calls = []
const web = createWebServer({
  dsh: /** @type {any} */ ({}),
  getConfig: cfg,
  setConfig: (patch) => { const b = patch.body || patch; Object.assign(config, b); calls.push(['setConfig', b]) },
  publicConfig: (c) => JSON.parse(JSON.stringify(c)),
  log: { info() {}, warn() {}, error() {}, debug() {} },
})

const mails = []
const deps = {
  hub: { stats: () => ({ turns: 1, messages: 2, voice: 0, stickers: 0, images: 0 }), sessions: () => ({}), messagesOf: () => [], recentChat: () => [], cleanupVoice() {}, onUserMessage() {} },
  azone: { visibleEntries: () => [], state: () => ({ plan: { times: [] }, history: [] }), stats: () => ({ today: 0, total: 0, planned: 0, next: null }), writeDiary: async () => ({ ok: true }), remove: () => ({ ok: true }), addComment: () => ({ ok: true }), addReply: () => ({ ok: true }), deleteComment: () => ({ ok: true }), deleteReply: () => ({ ok: true }) },  stickers: { library: () => ({ items: [] }), addFromBuffer: async () => ({ ok: true }), remove: () => ({ ok: true }), rename: () => ({ ok: true }) },
  memory: { stats: () => ({ count: 0 }), list: () => [], insights: () => [], styles: () => ({}), profiles: () => [], recalls: () => [], lastConsolidate: () => null, add: () => ({ ok: true }), remove: () => ({ ok: true }), setProfile: (...a) => { mails.push(a); return { ok: true } }, setStyle: () => ({ ok: true }) },
  mood: { state: () => ({ value: 63, label: '心情不错', band: { high: 60, low: 50 } }), history: () => [], nudge: () => {}, reset: () => {} },
  speakUp: { state: () => ({ count: 0 }), fire: async () => true },
  selfDrive: { state: () => ({ count: 0 }), readMemo: () => 'x', writeMemo: () => ({ ok: true }), fire: async () => true },
  imageGen: { enabled: () => false },
  listModels: async () => [{ provider: 'p', model: 'm' }],
  azoneSocial: { run: async () => ({ ok: true, replies: 0 }) },
  logger: { recent: () => [{ t: Date.now(), level: 'info', area: 'core', text: 'hi' }] },
}

web.register(ctx, deps)

const http = createServer((req, res) => {
  if (handler) return handler(req, res)
  res.statusCode = 404; res.end('no handler')
})
await new Promise((r) => http.listen(0, '127.0.0.1', r))
const port = http.address().port
const B = `http://127.0.0.1:${port}/aurachat`

const j = async (path, opts = {}) => {
  const r = await fetch(B + path, opts)
  const t = await r.text()
  try { return { status: r.status, body: JSON.parse(t) } } catch { return { status: r.status, body: t } }
}
const post = (p, body, token) => j(p, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) })
const patch = (p, body, token) => j(p, { method: 'PATCH', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) })
const get = (p, token) => j(p, { headers: token ? { authorization: 'Bearer ' + token } : {} })

const log = []
const ok = (name, cond) => log.push((cond ? '✓ ' : '✗ ') + name + (cond ? '' : ' <<<FAIL'))

const s0 = await get('/api/state')
ok('state needSetup', s0.status === 200 && s0.body.needSetup === true && s0.body.theme)
ok('state botName', s0.body.botName === '大肥鱼')

const short = await post('/api/setup', { username: 'u', password: '123' })
ok('setup rejects short password', short.body.ok === false)
const su = await post('/api/setup', { username: 'u', password: '123456', persona: 'dafeiyu' })
ok('setup ok', su.body.ok === true)
ok('setup prefilled botName from persona', config.botName === '大肥鱼')

const bad = await post('/api/login', { username: 'u', password: 'nope' })
ok('login rejects wrong pw', bad.body.ok === false)
const li = await post('/api/login', { username: 'u', password: '123456' })
ok('login ok', li.body.ok === true && li.body.token)
const tk = li.body.token

ok('config get', (await get('/api/config', tk)).body.config)
const patched = await patch('/api/config', { theme: { mode: 'acrylic', background: 'local' }, voice: { provider: 'openai', ttsBaseUrl: 'http://127.0.0.1:9880/v1' } }, tk)
ok('config patch theme', patched.body.ok === true && patched.body.config.theme.mode === 'acrylic')

ok('mood get', (await get('/api/mood', tk)).body.state.value === 63)
ok('mood post', (await post('/api/mood', { delta: 5 }, tk)).body.ok === true)
ok('memory get', (await get('/api/memory', tk)).body.ok === true)
ok('memory profile', (await post('/api/memory/profile', { about: 'owner', text: '喜欢猫' }, tk)).body.ok === true)
ok('logs', (await get('/api/logs', tk)).body.logs.length === 1)
ok('test speakup', (await post('/api/test', { what: 'speakup' }, tk)).body.ok === true)
ok('test diary', (await post('/api/test', { what: 'diary' }, tk)).body.ok === true)
ok('test selfdrive', (await post('/api/test', { what: 'selfdrive' }, tk)).body.ok === true)
ok('test social', (await post('/api/test', { what: 'social' }, tk)).body.ok === true)
ok('selfdrive get', (await get('/api/selfdrive', tk)).body.ok === true)
// 试听接口：读当前语音配置念一句（Windows 自带语音兜底，所以总有结果或明确原因）
const ttsT = await post('/api/voice/test', { text: '你好' }, tk)
ok('tts test route', !!ttsT.body && (ttsT.body.ok === true || typeof ttsT.body.reason === 'string'), JSON.stringify(ttsT.body).slice(0, 120))
ok('status', (await get('/api/status', tk)).body.diaryStats)
ok('guests create', (await post('/api/guests', { username: 'g1', displayName: '小明', level: 'social' }, tk)).body.ok === true)
const gl = await get('/api/guests', tk)
ok('guests list', gl.body.guests && gl.body.guests.length === 1)
ok('static index', (await fetch(B + '/')).status === 200)
ok('static app.js', (await fetch(B + '/app.js')).status === 200)
ok('static app.css', (await fetch(B + '/app.css')).status === 200)
ok('unauth config blocked', (await get('/api/config')).body.ok === false)

// 固定端口：http://127.0.0.1:PORT/ 不带 /aurachat 后缀也能直接进
const OWN_PORT = 23399
const listened = web.listenPort(OWN_PORT)
ok('own port listening', listened.ok === true)
await new Promise((r) => setTimeout(r, 400))
const root = `http://127.0.0.1:${OWN_PORT}`
ok('root path serves index', (await fetch(root + '/')).status === 200)
ok('root path serves app.js', (await fetch(root + '/app.js')).status === 200)
const rootState = await (await fetch(root + '/api/state')).json()
ok('root path serves api', rootState.needSetup !== undefined && rootState.botName === '大肥鱼')
ok('prefixed path is gone on own port', (await fetch(root + '/aurachat/app.css')).status === 404)

// 改端口 + 改监听地址后重绑（设置里保存走的就是这条路）
config.web = { host: '127.0.0.1', port: 23401 }
const rebound = web.listenPort()
ok('rebind to new port', rebound.ok === true && rebound.port === 23401 && rebound.host === '127.0.0.1')
await new Promise((r) => setTimeout(r, 400))
ok('new port serves index', (await fetch('http://127.0.0.1:23401/')).status === 200)
ok('old port is closed', await fetch(root + '/').then(() => false, () => true))
web.closePort()

console.log(log.join('\n'))
console.log(log.some((l) => l.startsWith('✗')) ? 'HAS FAILURE' : 'ALL PASS')
http.close()
process.exit(0)
