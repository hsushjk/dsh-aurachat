// 检查前端设置项里出现的配置路径，是否都能在 config.normalize 后存在（防止拼错键）。
import { readFileSync } from 'node:fs'
const s = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')

const keys = new Set()
// 1) rowXxx('标签', 'a.b')
for (const m of s.matchAll(/row(?:Switch|Num|Text|Select|Area|Input)\(\s*'[^']*'\s*,\s*'([^']+)'/g)) keys.add(m[1])
// 2) 手写 data-key="a.b"
const needle = 'data-key="'
let i = 0
while ((i = s.indexOf(needle, i)) >= 0) {
  const start = i + needle.length
  const end = s.indexOf('"', start)
  const v = s.slice(start, end)
  if (/^[a-zA-Z]+(\.[a-zA-Z]+)+$/.test(v)) keys.add(v)
  i = end
}
const uniq = [...keys].sort()
const { normalize } = await import('../src/core/config.js')
const cfg = normalize({})
const missing = uniq.filter((k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), cfg) === undefined)
console.log('设置项引用的键：', uniq.length)
console.log(uniq.join(' '))
console.log(missing.length ? '配置里没有：' + missing.join(', ') : '全部对得上')
