export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const pad2 = (n) => String(n).padStart(2, '0')

export function fmtClock(t) {
  const d = new Date(t || Date.now())
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

export function fmtDay(t) {
  const d = new Date(t || Date.now())
  const now = new Date()
  const same = d.toDateString() === now.toDateString()
  return (same ? '今天 ' : (d.getMonth() + 1) + '月' + d.getDate() + '日 ') + fmtClock(t)
}

export const BARS = Array.from({ length: 16 }, (_, i) => '<i style="height:' + (5 + ((i * 7) % 11)) + 'px"></i>').join('')

export function fmtDur(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  return Math.floor(s / 60) + ':' + pad2(s % 60)
}

export function greet() {
  const h = new Date().getHours()
  return h < 5 ? '夜深了' : h < 11 ? '上午好' : h < 13 ? '中午好' : h < 18 ? '下午好' : h < 23 ? '晚上好' : '夜深了'
}
