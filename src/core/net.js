import { readFileSync, statSync } from 'node:fs'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { fileURLToPath } from 'node:url'

function isPrivateIp(ip) {
  if (!ip) return true
  if (ip.includes(':')) {
    const s = ip.toLowerCase()
    return s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80') || s === '::' || s.startsWith('::ffff:127.') || s.startsWith('::ffff:10.') || s.startsWith('::ffff:192.168.')
  }
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
}

export async function assertPublicUrl(url) {
  const u = new URL(url)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('只允许 http / https')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost') throw new Error('不允许访问本机地址')
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((x) => x.address)
  if (!ips.length || ips.some(isPrivateIp)) throw new Error('不允许访问内网地址')
}

export async function fetchImage(src, o = {}) {
  const maxBytes = o.maxBytes ?? 10 * 1024 * 1024
  const s = String(src || '').trim()
  if (!s) throw new Error('没有地址')
  if (s.startsWith('base64://')) {
    const buf = Buffer.from(s.slice(9), 'base64')
    if (buf.length > maxBytes) throw new Error('太大了')
    return buf
  }
  if (/^https?:\/\//.test(s)) {
    await assertPublicUrl(s)
    const r = await fetch(s, { signal: AbortSignal.timeout(o.timeoutMs ?? 20000), redirect: 'follow' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const len = Number(r.headers.get('content-length') || 0)
    if (len > maxBytes) throw new Error('太大了')
    const reader = r.body.getReader()
    const chunks = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > maxBytes) {
        try { reader.cancel() } catch (e) {}
        throw new Error('太大了')
      }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks)
  }
  if (o.allowLocal !== false) {
    const p = s.startsWith('file://') ? fileURLToPath(s) : s
    if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/')) {
      if (statSync(p).size > maxBytes) throw new Error('太大了')
      return readFileSync(p)
    }
  }
  throw new Error('不认识的地址')
}
