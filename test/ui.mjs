// 真浏览器冒烟：Chrome headless + CDP，逐个视图渲染，抓 DOM 内容与控制台错误。
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.AURACHAT_DATA_DIR = mkdtempSync(join(tmpdir(), 'aurachat-ui-'))
const { createWebServer } = await import('../src/web/server.js')

let handler = null
const ctx = {
  effect: (fn) => { fn(); return () => {} },
  webServer: { register: ({ handler: h }) => { handler = h; return () => { handler = null } } },
}

const config = {
  enabled: true, setupDone: true, ownerName: '主人', botName: '大肥鱼', botTag: '每天吃点白米饭', ownerQQ: 'owner',
  theme: { mode: 'follow', background: '' }, model: { provider: '', model: '', reasoningEffort: 'low' },
  mood: { enabled: true, halfLifeHours: 3, neutralHigh: 60, neutralLow: 50, judge: true, decay: true },
  selfDrive: { enabled: false, intervalMinutes: 60, maxPerDay: 4, quietFrom: 1, quietTo: 8 },
  speakUp: { enabled: true, idleMinutes: 60, minGapMinutes: 120, maxPerDay: 4, quietFrom: 23, quietTo: 8 },
  diary: { enabled: true, timesPerDay: 2, windowStart: '10:00', windowEnd: '23:30', minGapMinutes: 180, minChars: 60, maxChars: 140, visibility: 'all' },
  voice: { enabled: false, provider: 'auto', autoChance: 0.15, autoMaxChars: 80, asr: false, ttsBaseUrl: '', ttsModel: 'tts-1', ttsVoice: 'alloy', asrLanguage: 'zh' },
  imageGen: { enabled: false, provider: 'openai', baseUrl: '', apiKey: '', model: '', size: '1024x1024', stylePrompt: '' },
  stickers: { enabled: true, autoChance: 0.35, maxPerHour: 20, maxLibrary: 300, caption: true },
  merge: { enabled: true, waitSec: 2.5, maxSec: 8, waitTypingSec: 5 },
  sound: { onIncoming: true, onSend: false, incoming: 'ding', outgoing: 'bubble', incomingUrl: '', outgoingUrl: '', inVolume: 0.5, outVolume: 0.5 },
  logs: { maxMB: 2 },
  web: { host: '0.0.0.0', port: 2332 },
  memory: { enabled: true, recallCount: 6, dailyConsolidate: true, consolidateTimes: ['04:00', '16:00'] },
  persona: { current: 'dafeiyu' },
}
const web = createWebServer({
  dsh: {},
  getConfig: () => config,
  setConfig: (patch) => { Object.assign(config, (patch && patch.body) || patch) },
  publicConfig: (c) => JSON.parse(JSON.stringify(c)),
  log: { info() {}, warn() {}, error() {}, debug() {} },
})

const entry = {
  id: 'd1', at: Date.now() - 3600e3, text: '今天吃了一碗白米饭，很好吃。', visibility: 'all',
  comments: [{ id: 'c1', from: 'owner', name: '主人', text: '真的假的', at: Date.now() - 3000e3, replies: [{ id: 'r1', from: 'bot', name: '大肥鱼', text: '真的！', at: Date.now() - 2000e3 }] }],
}
const messages = [
  { id: 'm1', t: Date.now() - 600e3, who: 'user', kind: 'text', text: '在吗', name: '主人' },
  { id: 'm2', t: Date.now() - 580e3, who: 'bot', kind: 'text', text: '在呢 ||| 你怎么才来' },
  { id: 'm3', t: Date.now() - 560e3, who: 'bot', kind: 'voice', voice: 'AAAA', voiceMime: 'audio/mpeg', dur: 3, heard: '' },
]

web.register(ctx, {
  hub: { stats: () => ({ turns: 3, messages: 12, voice: 1, stickers: 2, images: 0 }), sessions: () => ({ 'owner': { sessionId: 's1' } }), messagesOf: () => messages, recentChat: () => [], cleanupVoice() {}, onUserMessage() {} },
  azone: { visibleEntries: () => [entry], state: () => ({ plan: { times: [600, 900] }, history: [entry] }), stats: () => ({ today: 1, total: 1, planned: 2, next: '15:00' }), writeDiary: async () => ({ ok: true }), remove: () => ({ ok: true }), addComment: () => ({ ok: true }), addReply: () => ({ ok: true }), deleteComment: () => ({ ok: true }), deleteReply: () => ({ ok: true }) },
  stickers: { library: () => ({ items: [{ md5: 'abc', name: '开心', tags: ['开心'] }] }), addFromBuffer: async () => ({ ok: true }), remove: () => ({ ok: true }), rename: () => ({ ok: true }) },
  memory: {
    stats: () => ({ count: 12, auto: 9, events: 3, outdated: 0 }),
    list: () => [{ id: 'a1', text: '主人喜欢猫', about: 'owner', aboutName: '主人', tags: ['喜好'], importance: 0.7, source: 'auto', at: Date.now() }],
    insights: () => [{ key: 'owner', name: '主人', list: [{ id: 'i1', text: '他不喜欢被催', at: Date.now() }] }],
    styles: () => ({ owner: ['说话短'], self: ['爱用哈哈'] }),
    profiles: () => [{ qq: 'owner', text: '主人，养猫，最近在忙插件。', name: '主人', at: Date.now() }],
    recalls: () => [], lastConsolidate: () => Date.now(), add: () => ({ ok: true }), remove: () => ({ ok: true }), setProfile: () => ({ ok: true }), setStyle: () => ({ ok: true }), setInsights: () => ({ ok: true }), update: () => ({ ok: true }),
  },
  mood: { state: () => ({ value: 63, label: '心情不错', band: { high: 60, low: 50 } }), history: () => [{ at: Date.now() - 1000e3, from: 60, to: 63, reason: '被夸' }], nudge: () => {}, reset: () => {} },
  speakUp: { state: () => ({ count: 1 }), fire: async () => true },
  selfDrive: { state: () => ({ count: 0 }), readMemo: () => '# 备忘录\n\n- [ ] 想想主人在忙什么', writeMemo: () => ({ ok: true }), fire: async () => true },
  imageGen: { enabled: () => false },
  listModels: async () => [{ provider: 'deepseek', model: 'deepseek-v4' }],
  azoneSocial: { run: async () => ({ ok: true, replies: 1 }) },
  logger: { recent: () => [{ t: Date.now(), level: 'info', area: 'core', text: '启动好了' }] },
})

const http = createServer((req, res) => (handler ? handler(req, res) : (res.statusCode = 404, res.end())))
await new Promise((r) => http.listen(0, '127.0.0.1', r))
const PORT = http.address().port
const BASE = `http://127.0.0.1:${PORT}/aurachat`
const post = async (p, body) => (await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
let TOKEN = ''
async function doSetup() {
  await post('/api/setup', { username: 'u', password: '123456' })
  TOKEN = (await post('/api/login', { username: 'u', password: '123456' })).token
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CPORT = 9455
const profile = mkdtempSync(join(tmpdir(), 'aurachat-chrome-'))
const child = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--window-size=1280,900', `--remote-debugging-port=${CPORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' })

let version = null
for (let i = 0; i < 60; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${CPORT}/json/version`)).json(); break } catch { await sleep(250) }
}
if (!version) { console.log('✗ Chrome 起不来'); child.kill(); http.close(); process.exit(1) }

const list = await (await fetch(`http://127.0.0.1:${CPORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let seq = 0
const pending = new Map()
const errors = []
let loadFired = false
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Page.loadEventFired') loadFired = true
  if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || ''))
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console: ' + m.params.args.map((a) => a.value ?? a.description).join(' '))
}
const cmd = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const evalJs = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) errors.push('eval: ' + (r.result.exceptionDetails.exception?.description || ''))
  return r.result?.result?.value
}

await cmd('Runtime.enable')
await cmd('Page.enable')
await cmd('Log.enable')
await cmd('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__errs=[];addEventListener('error',(e)=>window.__errs.push(String(e.message)));addEventListener('unhandledrejection',(e)=>window.__errs.push('rejection:'+String(e.reason&&e.reason.message||e.reason)));`,
})

const report = []
const ok = (name, cond, extra = '') => report.push((cond ? '✓ ' : '✗ ') + name + (cond ? '' : ' <<<FAIL ' + String(extra).slice(0, 300)))
const SHOTS = process.env.SHOTS === '1'
async function shot(name) {
  if (!SHOTS) return
  // Chrome headless 有时返回上一帧，先抖一下强迫重绘
  await cmd('Page.bringToFront')
  await evalJs('window.scrollTo(0,1);window.scrollTo(0,0);document.body.style.transform="translateZ(0)";1')
  await sleep(250)
  await evalJs('document.body.style.transform="";1')
  await sleep(150)
  const r = await cmd('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  if (r.result?.data) writeFileSync(join(process.cwd(), 'test', name + '.png'), Buffer.from(r.result.data, 'base64'))
}

async function open(view) {
  loadFired = false
  await cmd('Page.navigate', { url: `${BASE}/?nosse=1&token=${TOKEN}${view ? '&view=' + view : ''}` })
  for (let i = 0; i < 60 && !loadFired; i++) await sleep(100)
  await sleep(1200)
  return evalJs('({errs: window.__errs || [], text: document.body.innerText, html: document.body.innerHTML.length})')
}

// —— 先看首次向导（还没有主人账号时的真实首屏）——
await cmd('Page.navigate', { url: `${BASE}/?nosse=1` })
await sleep(2500)
const wiz = await evalJs(`({
  steps: document.querySelectorAll('#wizard .w-step').length,
  step: [...document.querySelectorAll('#wizard .w-step')].findIndex(s=>!s.classList.contains('hidden'))+1,
  title: (document.querySelector('#wizard')||{}).innerText ? document.querySelector('#wizard').innerText.slice(0,40) : '',
  hasLogo: !!document.querySelector('#gate-logo img'),
})`)
ok('首次向导 5 步', wiz?.steps === 5 && wiz?.step === 1, JSON.stringify(wiz))
ok('向导首屏不是「大」字头像', wiz?.hasLogo === true, JSON.stringify({ hasLogo: wiz?.hasLogo }))
await shot('shot-wizard')
// 翻到第 3 步（人设+头像）、第 4 步（模型）
const step3 = await evalJs(`(async()=>{
  document.querySelector('#wizard [data-next]').click(); await new Promise(r=>setTimeout(r,120));
  document.querySelector('#wizard [data-next]').click(); await new Promise(r=>setTimeout(r,400));
  return {step: [...document.querySelectorAll('#wizard .w-step')].findIndex(s=>!s.classList.contains('hidden'))+1, personas: document.querySelectorAll('#w-persona-list .persona-opt').length, avatar: !!document.querySelector('#w-avatar-preview img')}
})()`)
ok('第 3 步有人设卡和头像', step3?.step === 3 && step3?.personas >= 2 && step3?.avatar === true, JSON.stringify(step3))
// 「自己写一个」点开要有名字/标签/正文三个输入框
const custom = await evalJs(`(async()=>{
  const b = document.querySelector('#w-persona-list [data-pid="__new"]')
  if (!b) return {missing:true}
  b.click(); await new Promise(r=>setTimeout(r,120))
  const panel = document.querySelector('#w-persona-new')
  return {hidden: panel ? panel.classList.contains('hidden') : null, name: !!document.querySelector('#w-pn-name'), tags: !!document.querySelector('#w-pn-tags'), body: !!document.querySelector('#w-pn-body')}
})()`)
ok('向导能现场自己写人设', custom?.missing !== true && custom?.hidden === false && custom?.name && custom?.tags && custom?.body, JSON.stringify(custom))
await shot('shot-wizard-persona')
await evalJs(`(async()=>{const b=document.querySelector('#w-persona-list [data-pid="dafeiyu"]');if(b)b.click();await new Promise(r=>setTimeout(r,80));return 1})()`)
const step4 = await evalJs(`(async()=>{
  document.querySelector('#wizard [data-next]').click(); await new Promise(r=>setTimeout(r,600));
  const sel = document.querySelector('#w-model');
  const lab = [...document.querySelectorAll('#wizard .w-field .w-label')].map(x=>x.textContent.trim()).join('|');
  return {step: [...document.querySelectorAll('#wizard .w-step')].findIndex(s=>!s.classList.contains('hidden'))+1, opts: sel?sel.options.length:0, labels: lab}
})()`)
ok('第 4 步模型排版有标签', step4?.step === 4 && step4?.opts >= 2 && (step4?.labels || '').includes('思考强度'), JSON.stringify(step4))
await shot('shot-wizard-model')

// —— 建号，进入主界面 ——
await doSetup()

const home = await open('')
await sleep(700)
await shot('shot-chat')
const homeWide = await open('') // 第二次拿 html 细节
ok('页面渲染出主界面', /id="nav"/.test(await evalJs('document.body.innerHTML')) && home.html > 2000, home.html)
const info = await evalJs(`({
  nav: [...document.querySelectorAll('#nav button')].map(b=>b.dataset.view+':'+b.textContent.trim()).join(' '),
  msgs: document.querySelectorAll('.msg').length,
  meta: !!document.querySelector('.bubble .meta'),
  head: (document.querySelector('.chat-head')||{}).innerText||'',
  pill: !!document.querySelector('.mood-pill'),
  cfgKeys: Object.keys((window.__aura && window.__aura.cfg) || {}).length
})`)
ok('导航 7 项', ['chat', 'diary', 'mood', 'overview', 'memory', 'settings', 'logs'].every((v) => (info?.nav || '').includes(v + ':')), info?.nav)
ok('聊天气泡 2 条', info?.msgs === 3, String(info?.msgs))
ok('时间在气泡里', info?.meta === true)
ok('聊天头有名字和签名', (info?.head || '').includes('大肥鱼') && (info?.head || '').includes('白米饭'), info?.head)
ok('聊天头有心情数值', info?.pill === true)

for (const [view, expr, label] of [
  ['diary', `(document.querySelectorAll('.entry').length*100 + (document.querySelector('.pane-head')?.innerText.includes('共')?1:0))*10 + (document.querySelectorAll('[data-del-comment]').length?1:0)`, '空间'],
  ['mood', `document.querySelectorAll('.mood-big').length*100 + document.querySelectorAll('.mood-range').length`, '心情'],
  ['overview', `document.querySelectorAll('.ov-card').length*100 + document.querySelectorAll('[data-test]').length`, '概览'],
  ['memory', `document.querySelectorAll('[data-tab]').length*100 + (document.body.innerText.includes('养猫')?1:0)`, '记忆'],
  ['settings', `document.querySelectorAll('.section').length*100 + document.querySelectorAll('.switch').length`, '设置'],
  ['logs', `document.querySelectorAll('.log-line').length*100`, '日志'],
]) {
  const r = await open(view)
  const v = await evalJs(expr)
  await shot('shot-' + view)
  ok(label + ' 页渲染', Number(v) > 0, String(v))
  const txt = await evalJs('document.querySelector("#pane-body")?.innerText||""')
  ok(label + ' 页无报错', (r?.errs || []).length === 0, (r?.errs || []).join(' | '))
  if (view === 'settings') {
    const st = await evalJs('document.querySelector("#pane-body").innerText')
    ok('设置总开关在最前', st.indexOf('总开关') >= 0 && st.indexOf('总开关') < st.indexOf('身份'), st.slice(0, 80))
    ok('没有试运行/发号', !st.includes('试运行') && !st.includes('发号'), st.slice(0, 200))
    ok('有创建客人', st.includes('创建客人'))
    ok('有语音/生图/日志入口项', st.includes('TTS') && st.includes('生图') && st.includes('自驱'))
    ok('有提示音/回复节奏/偷表情', st.includes('提示音') && st.includes('回复节奏') && st.includes('偷'))
    ok('设置里不再重复记忆设置', !st.includes('每次翻几条相关的') && !st.includes('每天整理记忆'))
    // 提示音：值要从 config 回填（勾选状态、下拉选中项、音量数字）
    const snd = await evalJs(`(()=>{
      const on = document.querySelector('#cfg-body [data-key="sound.onIncoming"]')
      const sel = document.querySelector('#cfg-body [data-key="sound.outgoing"]')
      const vol = document.querySelector('#cfg-body [data-key="sound.outVolume"]')
      return { on: on ? on.checked : null, out: sel ? sel.value : null, vol: vol ? vol.value : null }
    })()`)
    ok('提示音回填了开关/下拉/音量', snd.on === true && snd.out === 'bubble' && String(snd.vol) === '0.5', JSON.stringify(snd))
    // 网页入口：固定端口那块要能填能改
    const webIn = await evalJs(`(()=>{
      const h = document.querySelector('#cfg-body [data-key="web.host"]')
      const p = document.querySelector('#cfg-body [data-key="web.port"]')
      return { host: h ? h.value : null, port: p ? p.value : null }
    })()`)
    ok('网页入口回填了监听地址和端口', webIn.host === '0.0.0.0' && String(webIn.port) === '2332', JSON.stringify(webIn))
    // 网页名称 / 网页标题：可改，且标题真的换到浏览器标签上
    const naming = await evalJs(`(()=>{
      const n = document.querySelector('#cfg-body [data-key="siteName"]')
      const t = document.querySelector('#cfg-body [data-key="pageTitle"]')
      if (n) { n.value = '小鱼的窝'; n.dispatchEvent(new Event('input', { bubbles: true })) }
      if (t) { t.value = '小鱼在这儿'; t.dispatchEvent(new Event('input', { bubbles: true })) }
      return { name: n ? n.value : null, title: t ? t.value : null, has: !!n && !!t }
    })()`)
    ok('设置里能改网页名称和网页标题', naming.has === true && naming.name === '小鱼的窝' && naming.title === '小鱼在这儿', JSON.stringify(naming))
    const iconOk = await evalJs(`(()=>{
      const fav = document.querySelector('#favicon')
      const logo = document.querySelector('#gate-logo img')
      return { fav: fav ? fav.getAttribute('href') : null, logo: logo ? logo.getAttribute('src') : null }
    })()`)
    ok('图标和默认头像用同一个 svg', (iconOk.fav || '').includes('icon.svg') && (iconOk.logo || '').includes('icon.svg'), JSON.stringify(iconOk))
    // 语音后端卡片：7 张，默认选中「自动」，点 CosyVoice 后选中态跟着换
    const cards = await evalJs(`(async()=>{
      const list = [...document.querySelectorAll('#cfg-body [data-tts]')]
      const onId = () => (list.find(b=>b.classList.contains('on'))||{}).dataset?.tts || null
      const before = {n: list.length, on: onId()}
      const cv = list.find(b=>b.dataset.tts==='cosyvoice')
      if (cv) { cv.click(); await new Promise(r=>setTimeout(r,120)) }
      const after = onId()
      const hidden = document.querySelector('#cfg-body [data-key="voice.provider"]')
      const urlShown = (() => { const i = document.querySelector('#cfg-body [data-key="voice.cosyvoice.url"]'); const w = i && i.closest('.when-wrap'); return w ? getComputedStyle(w).display : 'missing' })()
      if (list.find(b=>b.dataset.tts==='auto')) { list.find(b=>b.dataset.tts==='auto').click(); await new Promise(r=>setTimeout(r,120)) }
      return {before, after, hidden: hidden ? hidden.value : null, urlShown}
    })()`)
    ok('语音有 7 张后端卡片', cards?.before?.n === 7, JSON.stringify(cards))
    ok('点卡片能换后端', cards?.after === 'cosyvoice' && cards?.urlShown !== 'none', JSON.stringify(cards))
    // 滑杆：概率显示百分比，字数显示「字」
    const sl = await evalJs(`(()=>{
      const p = document.querySelector('#cfg-body [data-key="voice.autoChance"]')
      const c = document.querySelector('#cfg-body [data-key="voice.autoMaxChars"]')
      const out = (k) => { const s = document.querySelector('#cfg-body [data-out="'+k+'"]'); return s ? s.textContent : null }
      return {p: out('voice.autoChance'), c: out('voice.autoMaxChars'), hasRange: !!p && !!c}
    })()`)
    ok('语音概率/长度是滑杆并显示数值', sl?.hasRange === true && /%$/.test(sl.p || '') && /字$/.test(sl.c || ''), JSON.stringify(sl))
    // 听语音那块会去问 /api/status，宿主没给服务时要明确写出来（不是空白）
    const asr = await evalJs(`(()=>{ const el = document.querySelector('#asr-state'); return el ? el.textContent : null })()`)
    ok('听语音显示了识别服务状态', typeof asr === 'string' && asr.length > 2 && asr !== '正在查…', String(asr))
    // 下拉联动：选 Windows 自带语音时，TTS 地址/模型/音色/密钥应整行收起
    const cond = await evalJs(`(async()=>{
      const sel = document.querySelector('#cfg-body [data-key="voice.provider"]')
      if (!sel) return {skip:true}
      const wrap = (id) => {
        const els = [...document.querySelectorAll('#cfg-body [data-key="'+id+'"]')]
        if (!els.length) return 'missing'
        const shown = els.map((i) => { const w = i.closest('.when-wrap'); return w ? getComputedStyle(w).display : 'block' })
        return shown.find((d) => d !== 'none') || 'none'
      }
      sel.value = 'windows'; sel.dispatchEvent(new Event('change', {bubbles:true}))
      await new Promise(r=>setTimeout(r,150))
      const off = {base: wrap('voice.ttsBaseUrl'), model: wrap('voice.ttsModel'), voice: wrap('voice.ttsVoice')}
      const sys = wrap('voice.voice')
      sel.value = 'openai'; sel.dispatchEvent(new Event('change', {bubbles:true}))
      await new Promise(r=>setTimeout(r,150))
      const on = wrap('voice.ttsBaseUrl')
      const sysOff = wrap('voice.voice')
      return {off, on, sys, sysOff}
    })()`)
    if (!cond?.skip) {
      const allOff = Object.values(cond.off).every((d) => d === 'none')
      ok('选 Windows 语音时收起 TTS 地址/模型/音色', allOff, JSON.stringify(cond))
      ok('选 Windows 语音时显示系统音色', cond.sys !== 'none', JSON.stringify(cond.sys))
      ok('换回在线语音又显示 TTS 地址', cond.on !== 'none' && cond.sysOff === 'none', JSON.stringify({ on: cond.on, sysOff: cond.sysOff }))
    }
    // 页面底部也要能看一眼
    if (SHOTS) {
      const sc = `(()=>{const p=document.querySelector('#pane-body');const q=document.querySelector('.pane');const t=document.scrollingElement;if(p&&p.scrollHeight>p.clientHeight)p.scrollTop=%d;if(q&&q.scrollHeight>q.clientHeight)q.scrollTop=%d;if(t)t.scrollTop=%d;return 1})()`
      // 语音那一块单独拍一张（卡片多，要看清）
      await evalJs(`(()=>{const hs=[...document.querySelectorAll('#cfg-body h3')];const h=hs.find(x=>x.textContent.includes('语音'));if(h)h.scrollIntoView({block:'start'});return 1})()`)
      await sleep(400)
      await shot('shot-settings-voice')
      await evalJs(sc.replace(/%d/g, '0'))
      await evalJs(sc.replace(/%d/g, '1080'))
      await sleep(400)
      await shot('shot-settings-mid')
      await evalJs(sc.replace(/%d/g, '99999'))
      await sleep(400)
      await shot('shot-settings-bottom')
      await evalJs(sc.replace(/%d/g, '0'))
    }
  }
  if (view === 'memory') {
    const mt = await evalJs(`(async()=>{
      const b = document.querySelector('#mem-tabs [data-mtab="settings"]')
      if (!b) return ''
      b.click(); await new Promise(r=>setTimeout(r,300))
      return document.querySelector('#pane-body').innerText
    })()`)
    ok('记忆页有整理时间与手动整理', (mt || '').includes('整理时间') && (mt || '').includes('现在整理一次'), (mt || '').slice(0, 160))
  }
  if (view === 'overview') {
    const ov = await evalJs('document.querySelector("#pane-body").innerText')
    ok('概览无英文分母', !/\d+\s*\/\s*\d+/.test(ov), (ov.match(/\d+\s*\/\s*\d+/) || [''])[0])
  }
}

// 主题联动
await open('')
const theme = await evalJs(`(async()=>{ const a = window.__aura; a.cfg.theme.mode='acrylic'; a.cfg.theme.background='local'; a.applyTheme(); await new Promise(r=>setTimeout(r,120)); return {wall: document.body.dataset.wall||'', bg: getComputedStyle(document.body).getPropertyValue('--bg-image').trim().slice(0,24)} })()`)
ok('亚克力挂壁纸层', theme?.wall === 'acrylic' && (theme?.bg || '').includes('url('), JSON.stringify(theme))
const plain = await evalJs(`(async()=>{ const a = window.__aura; a.cfg.theme.mode='light'; a.applyTheme(); await new Promise(r=>setTimeout(r,80)); return {wall: document.body.dataset.wall||'', bg: getComputedStyle(document.body).getPropertyValue('--bg-image').trim()} })()`)
ok('浅色不铺壁纸', plain?.wall === '' && plain?.bg === 'none', JSON.stringify(plain))

ok('全程没有运行时错误', errors.length === 0, errors.slice(0, 5).join(' | '))

// 最后再拍一张聊天页（前面的首帧有时是旧的）
await cmd('Page.navigate', { url: `${BASE}/?nosse=1&token=${TOKEN}` })
await sleep(2500)
await shot('shot-chat')

console.log(report.join('\n'))
console.log(errors.length ? '[errors]\n' + errors.slice(0, 12).join('\n') : '')
console.log(report.some((l) => l.startsWith('✗')) ? 'HAS FAILURE' : 'ALL PASS')
try { ws.close() } catch {}
child.kill()
http.close()
setTimeout(() => process.exit(0), 300)
