// 语音识别接入的回归测试：宿主传 ctx 还是传服务对象都得能用
import { asrReady } from '../src/voice/tts.js'

let bad = 0
const ok = (name, cond, extra) => { if (!cond) bad++; console.log(`${cond ? '✓' : '✗'} ${name}${extra && !cond ? ' ' + extra : ''}`) }

const service = { resolve: () => ({}), transcribe: async () => ({ text: '你好' }), snapshot: () => ({ providers: [{ id: 'sensevoice-local' }] }) }
const fakeCtx = { speechToText: service }

ok('传服务对象本身 → 可用', asrReady({}, service) === true)
ok('传 ctx（ctx.speechToText）→ 可用', asrReady({}, fakeCtx) === true)
ok('没有服务 → 不可用', asrReady({}, null) === false)
ok('服务缺方法 → 不可用', asrReady({}, { speechToText: { snapshot: () => ({}) } }) === false)
ok('传空对象 → 不可用', asrReady({}, {}) === false)

console.log(bad === 0 ? 'ALL PASS' : `${bad} FAILED`)
process.exit(bad === 0 ? 0 : 1)
