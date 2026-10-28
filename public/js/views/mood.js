import { esc, fmtDay } from '../format.js'

export function createMoodView(ctx) {
  function renderMood(main) {
    ctx.paneShell(main, '心情')
    loadMood()
  }

  function applyKeys(el, patch, key) {
    const parts = key.split('.')
    let o = patch
    for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]] }
    o[parts[parts.length - 1]] = el.type === 'checkbox' ? el.checked : Number(el.value)
  }

  async function loadMood() {
    const body = ctx.$('#pane-body')
    if (!body) return
    const r = await ctx.api('/api/mood')
    if (!r.ok) { body.innerHTML = '<div class="empty">' + esc(r.reason || '读不到') + '</div>'; return }
    const cfg = ctx.getCfg()
    const s = r.state || {}
    const band = s.band || { high: 60, low: 50 }
    const pct = Math.max(0, Math.min(100, s.value))
    const lo = Math.max(0, Math.min(100, band.low))
    const hi = Math.max(0, Math.min(100, band.high))
    const hist = r.history || []
    body.innerHTML =
      '<div class="entry"><div class="mood-big">' + esc(pct) + ' <span style="font-size:14px;font-weight:400" class="muted">/ 100 · ' + esc(s.label || '') + '</span></div>' +
      '<div class="mood-bar"><i style="left:0;width:' + pct + '%"></i><span class="mood-range" style="left:' + lo + '%;width:' + Math.max(0, hi - lo) + '%"></span></div>' +
      '<div class="muted" style="font-size:12px">平常区间 ' + lo + '–' + hi + '：高于区间慢慢往回落、低于区间慢慢往回涨。半衰期 ' + esc(cfg?.mood?.halfLifeHours ?? 3) + ' 小时——离平常差多少，过这么久就减半。</div>' +
      (s.reason ? '<div class="muted" style="font-size:12px;margin-top:6px">最近一次变化：' + esc(s.reason) + '</div>' : '') +
      '</div>' +
      (ctx.isOwner() ? '<div class="section"><h3>心情怎么算</h3><div class="body">' +
        '<div class="row"><label>半衰期（小时）</label><div class="ctl"><input type="number" step="0.5" min="0.5" max="72" data-mkey="mood.halfLifeHours" />' +
        '<span class="muted" style="font-size:12px">心情偏离平常后，几小时落回去一半</span></div></div>' +
        '<div class="row"><label>平常区间</label><div class="ctl">' +
        '<input type="number" min="0" max="100" data-mkey="mood.neutralLow" style="width:80px" />' +
        '<span class="muted">到</span>' +
        '<input type="number" min="0" max="100" data-mkey="mood.neutralHigh" style="width:80px" />' +
        '<span class="muted" style="font-size:12px">低了往上升回下限，高了往下降回上限</span></div></div>' +
        '<div class="row"><label>判断情绪</label><div class="ctl"><label class="switch"><input type="checkbox" data-mkey="mood.judge" /><span class="slider"></span></label>' +
        '<span class="muted" style="font-size:12px">让模型判断情绪</span></div></div>' +
        '<div class="row"><div class="ctl"><button class="primary small" id="mood-save">保存</button>' +
        '<button class="ghost small" data-mood-reset>重置到平常</button></div></div>' +
        '</div></div>' : '') +
      '<div class="section"><h3>心情变化记录</h3><div class="body">' +
      (hist.length ? hist.map((h) => '<div class="mem-row"><div class="mem-text">' + esc(h.reason || '') + '<div class="mem-meta">' + esc(fmtDay(h.at)) + ' · ' + esc(h.from) + ' → ' + esc(h.to) + '</div></div></div>').join('') : '<div class="muted">还没有记录。</div>') +
      '</div></div>'
    if (ctx.isOwner() && cfg) {
      ctx.$$('#pane-body [data-mkey]').forEach((el) => {
        const v = el.dataset.mkey.split('.').reduce((o, k) => (o == null ? o : o[k]), cfg)
        if (el.type === 'checkbox') el.checked = Boolean(v)
        else if (v != null) el.value = v
      })
    }
    body.onclick = async (e) => {
      if (e.target.closest('#mood-save')) {
        const patch = {}
        ctx.$$('#pane-body [data-mkey]').forEach((el) => applyKeys(el, patch, el.dataset.mkey))
        const r2 = await ctx.api('/api/config', { method: 'PATCH', body: patch })
        ctx.toast(r2.ok ? '存好了' : (r2.reason || '没存上'), r2.ok ? '' : 'err')
        if (r2.ok) { ctx.setCfg(r2.config); loadMood() }
        return
      }
      if (e.target.closest('[data-mood-reset]')) {
        await ctx.api('/api/mood', { method: 'POST', body: { reset: true } })
        loadMood()
        ctx.refreshMoodPill()
      }
    }
  }

  return { renderMood, loadMood }
}
