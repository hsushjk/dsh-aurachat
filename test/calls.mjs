// 粗查 app.js / js/ 里调用了但没定义的函数名（抓拼写错、漏 import）。
import { readFileSync, readdirSync } from 'node:fs'

const files = ['../public/app.js']
function walk(rel) {
  for (const e of readdirSync(new URL(rel, import.meta.url), { withFileTypes: true })) {
    const p = rel + '/' + e.name
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.js')) files.push(p)
  }
}
walk('../public/js')
const src = files.map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n')

const defined = new Set()
for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1])
for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1])
for (const m of src.matchAll(/import\s*\{([^}]*)\}/g)) m[1].split(',').forEach((s) => defined.add(s.trim().split(/\s+as\s+/).pop()))
for (const m of src.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) m[1].split(',').forEach((s) => defined.add(s.trim().split('=')[0].trim()))
for (const m of src.matchAll(/\(\s*([A-Za-z_$][\w$]*)\s*(?:,[^)]*)?\)\s*=>/g)) defined.add(m[1])

const builtins = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'await', 'function', 'Math', 'JSON', 'Object', 'Array',
  'String', 'Number', 'Boolean', 'Date', 'Promise', 'Set', 'Map', 'RegExp', 'Error', 'fetch', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent', 'decodeURIComponent', 'URLSearchParams',
  'EventSource', 'FileReader', 'Image', 'MediaRecorder', 'navigator', 'localStorage', 'console', 'alert', 'confirm', 'prompt',
  'requestAnimationFrame', 'URL', 'Blob', 'FormData', 'structuredClone', 'queueMicrotask', 'getComputedStyle', 'Notification',
  'Audio', 'AudioContext', 'webkitAudioContext', 'Float32Array', 'AudioContext2', 'Int16Array', 'MediaStreamAudioSourceNode',
  'ArrayBuffer', 'DataView', 'async', 'http', 'https', 'ws', 'wss',
])

const calls = new Set()
for (const m of src.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) calls.add(m[1])

const unknown = [...calls].filter((n) => !defined.has(n) && !builtins.has(n) && !n.startsWith('on'))
if (unknown.length) {
  console.log('可疑未定义：' + unknown.join(', '))
  process.exitCode = 1
} else {
  console.log('没有可疑的未定义调用')
}
