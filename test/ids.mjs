// 检查 app.js 里 $('#id') 引用的元素：要么在 index.html 里，要么在 app.js 的模板字符串里生成了。
import { readFileSync } from 'node:fs'
const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const staticIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))
const dynIds = new Set([...js.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))
const refs = new Set([...js.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1]))
const missing = [...refs].filter((i) => !staticIds.has(i) && !dynIds.has(i))
console.log('静态 id', staticIds.size, '动态 id', dynIds.size, '引用', refs.size)
console.log(missing.length ? '缺失：' + missing.join(', ') : '全部能找到')
