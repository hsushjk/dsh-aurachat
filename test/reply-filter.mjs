// reply.js 的模型旁白过滤：跑完可以删
import { parseReply } from '../src/chat/reply.js'

const cases = [
  ['喂 我真听不见啊', 1],
  ['又一条，可以发语音回一句，表示自己实在听不见（撒娇/生气）？我觉得可以用语音：\n喂 你再说我真听不见了', 1],
  ['回复：\n在呢', 1],
  ['在呢|||你怎么才来', 2],
  ['。然后加一个委屈表情。不过要注意别每句都如此。这里第三次了，可以稍微急一点。回复：\n嗯 你再说我真听不见了', 1],
  // 模型把系统占位旁白原样念出来（截图里的那个 bug）
  ['[对方发来一条语音（约 3 秒），你听不清具体内容，自然地接话即可]', 0],
  ['[对方发来一条 3 秒的语音，这段没转成文字，只听到声音]\n喂 你是不是没按到', 1],
  ['（笑）|||你又来了', 1],
]

let bad = 0
for (const [input, want] of cases) {
  const r = parseReply(input)
  const got = r.items.filter((i) => i.kind === 'text').map((i) => i.value)
  const ok = got.length === want
  if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} want ${want} got ${got.length} :: ${JSON.stringify(got)}`)
}
console.log(bad === 0 ? 'ALL PASS' : `${bad} FAILED`)
process.exit(bad === 0 ? 0 : 1)
