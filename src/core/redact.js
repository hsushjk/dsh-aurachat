const PATTERNS = [

  [/(Authorization["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[A-Za-z0-9._~+/=-]{8,}/gi, '$1***'],
  [/((?:access[_-]?token|token|password|passwd|pwd|secret|api[_-]?key|cookie|MUSIC_U|p_skey|skey|clientkey|authorization)["']?\s*[:=]\s*["']?)([^\s"',;&]{4,})/gi, '$1***'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, '$1***'],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, 'sk-***'],
  [/([?&](?:token|access_token|key)=)[^&\s]+/gi, '$1***'],
]

const known = new Set()

export function registerSecret(value) {
  const v = String(value || '')
  if (v.length >= 6) known.add(v)
}

export function redact(text) {
  let s = String(text ?? '')
  for (const v of known) if (v && s.includes(v)) s = s.split(v).join('***')
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep)
  return s
}
