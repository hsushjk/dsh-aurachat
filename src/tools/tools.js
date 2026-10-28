import { fetchImage } from '../core/net.js'
import { memoryLine } from '../features/memory.js'
import { OWNER_ID } from '../chat/access.js'

export function defineTool({ name, description, properties = {}, required = [], execute }) {
  const parameters = { type: 'object', properties, required, additionalProperties: false }
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: value && value.ok === false ? '✗ ' + (value.message || '没成功') : (value && value.message) || '✓' }],
    },
    async execute(args, exec) {
      try {
        const r = await execute(args || {}, exec)
        return JSON.parse(JSON.stringify(r ?? { ok: true }))
      } catch (error) {
        return { ok: false, message: String(error && error.message ? error.message : error) }
      }
    },
  }
}

const str = (description) => ({ type: 'string', description })
const int = (description) => ({ type: 'integer', description })

export function buildTools(deps, { chat, level, sessionId }) {
  const { hub, getConfig, stickers, azone, memory, imageGen, selfDrive } = deps
  const current = chat.chatId
  const isSystem = Boolean(chat.system)
  const isOwner = chat.userId === OWNER_ID
  const tools = []

  if (!isSystem) {
    tools.push(defineTool({
      name: 'web_send_sticker',
      description: '在当前聊天里发一张表情包。name 写表情的名字或情绪（如「委屈」「开心」「早晚安」），会在表情库里模糊匹配。一般直接在回复里写 <sticker:名字> 就行，这个工具用于回复之外单独补发。',
      properties: { name: str('表情名字或情绪关键词') },
      required: ['name'],
      execute: async ({ name }) => {
        const ok = await hub.sendSticker(current, String(name || ''))
        return ok ? { ok: true, message: '发了' } : { ok: false, message: '表情库里没找到合适的' }
      },
    }))

    tools.push(defineTool({
      name: 'web_list_stickers',
      description: '看看表情库里有哪些表情（名字和标签），挑表情前可以先看。',
      properties: { query: str('可选，按名字/标签筛选') },
      execute: async ({ query }) => {
        const items = stickers.library().items
        const q = String(query || '').trim()
        const hit = (q ? items.filter((i) => (i.name || '').includes(q) || (i.tags || []).some((t) => t.includes(q))) : items).slice(-60)
        return { ok: true, count: items.length, message: hit.length ? hit.map((i) => `${i.name || '未命名'}${i.tags?.length ? '（' + i.tags.join('/') + '）' : ''}`).join('、') : '没有符合的表情', items: hit.map((i) => ({ name: i.name, tags: i.tags })) }
      },
    }))

    tools.push(defineTool({
      name: 'web_edit_sticker',
      description: '整理表情库：给一张表情改名字、改标签，或者删掉。名字不贴切、别人建议改名、标签不对的时候用；不喜欢、重复的表情可以删。sticker 写现在的名字或标签（模糊匹配）。',
      properties: {
        sticker: str('要改的那张表情现在的名字或标签'),
        new_name: str('新名字（12 字以内，不改就不填）'),
        tags: { type: 'array', items: { type: 'string' }, description: '新标签（情绪 / 用途，比如 开心、委屈、嘲讽；不改就不填）' },
        delete: { type: 'boolean', description: 'true = 删掉这张表情' },
      },
      required: ['sticker'],
      execute: async ({ sticker, new_name, tags, delete: del }) => {
        const item = stickers.match(String(sticker || ''))
        if (!item) return { ok: false, message: '表情库里没找到这张' }
        const label = item.name || item.md5.slice(0, 8)
        if (del) {

          if ((item.from === 'manual' || item.from === 'panel') && !isOwner && !hub.turnHasOwner(sessionId)) return { ok: false, message: '这张是主人加的，主人说删才删' }
          const r = await stickers.remove(item.md5)
          return r.ok ? { ok: true, message: `删掉了「${label}」` } : { ok: false, message: r.reason || '没删成' }
        }
        if (!new_name && !(Array.isArray(tags) && tags.length)) return { ok: false, message: '要说改成什么' }
        const r = stickers.rename(item.md5, new_name ? String(new_name).trim().slice(0, 12) : undefined, Array.isArray(tags) && tags.length ? tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 5) : undefined)
        return r.ok ? { ok: true, message: `改好了：「${label}」→「${r.item.name}」${r.item.tags?.length ? '（' + r.item.tags.join('/') + '）' : ''}` } : { ok: false, message: '没改成' }
      },
    }))

    tools.push(defineTool({
      name: 'web_chat_history',
      description: '翻翻当前这个聊天之前的聊天记录（只读，最多 50 条）。想不起前面聊过什么、别人问「刚才谁说的」、要回顾一段对话时用。',
      properties: { count: int('要翻多少条，默认 20，最多 50') },
      execute: async ({ count }) => {
        const n = Math.max(1, Math.min(50, Number(count) || 20))
        const rows = hub.recentChat(current, n)
        if (!rows.length) return { ok: true, message: '没翻到聊天记录' }
        const lines = rows.map((m) => `${new Date(m.t).toTimeString().slice(0, 5)} ${m.who === 'bot' ? '你' : m.who}：${String(m.text).slice(0, 150)}`)
        return { ok: true, message: lines.join('\n') }
      },
    }))
  }

  if (level === 'full') {
    tools.push(defineTool({
      name: 'web_send_message',
      description: '主动给某个网页用户发一条消息（不是回复当前聊天时用）。target 写 owner（主人）或 guest-<账号>（某个客人）；只能发给主人和已经存在的客人账号。',
      properties: { target: str('owner 或 guest-<账号>'), text: str('要发的话，可以用 ||| 分多条、<voice>…</voice> 发语音、<sticker:名字> 发表情') },
      required: ['target', 'text'],
      execute: async ({ target, text }) => {
        const t = String(target || '').trim()
        const ok = await hub.deliverTo(t, String(text || ''))
        return ok ? { ok: true, message: '发出去了' } : { ok: false, message: '这个用户不存在，不能发' }
      },
    }))

    tools.push(defineTool({
      name: 'web_add_sticker',
      description: '把一张图片收进表情库。看到好玩的图就自己收，不用对方开口说「偷走」——这是你的癖好，看到合眼缘的顺手就存。source 是本地图片路径或图片网址；name 是不超过 12 个字的备注。',
      properties: { source: str('本地路径或 http(s) 地址'), name: str('备注（≤12 字）'), tags: { type: 'array', items: { type: 'string' }, description: '标签，如 开心/委屈' } },
      required: ['source'],
      execute: async ({ source, name, tags }) => {
        const buf = await fetchImage(String(source), { maxBytes: 5 * 1024 * 1024 })
        const r = await stickers.addFromBuffer(buf, { name: name || '', tags: Array.isArray(tags) ? tags.slice(0, 3) : [], from: 'tool' })
        return r.ok ? { ok: true, message: r.existed ? '库里已经有这张了' : `收好了「${r.item.name || '未命名'}」` } : { ok: false, message: r.reason }
      },
    }))

    tools.push(defineTool({
      name: 'web_write_diary',
      description: '写一条空间动态（日记）。content 是正文（第一人称，口语，像随手发的动态）；visibility 可选 all（大家都能看）或 self（只有自己和主人能看）。',
      properties: {
        content: str('动态正文'),
        visibility: { type: 'string', enum: ['all', 'self'], description: '谁能看：all 大家都能看，self 仅自己（和主人）' },
      },
      required: ['content'],
      execute: async ({ content, visibility }) => {
        const r = await azone.post(String(content || ''), { visibility: visibility === 'self' ? 'self' : 'all' })
        return r.ok ? { ok: true, message: '发好了', id: r.id } : { ok: false, message: r.message }
      },
    }))

    if (selfDrive) {
      tools.push(defineTool({
        name: 'web_edit_memo',
        description: '看一眼或改一改你和主人共享的那张便签（markdown，随手记的便签，不是待办清单）。action=read 读便签；append 往下添一句；replace 整篇重写。',
        properties: {
          action: { type: 'string', enum: ['read', 'append', 'replace'], description: 'read=读便签，append=添一句，replace=整篇重写' },
          text: str('要写进便签的内容（append / replace 时给）'),
        },
        required: ['action'],
        execute: async ({ action, text }) => {
          const a = String(action || 'read')
          const body = String(text || '').trim()
          if (a === 'read') {
            const t = selfDrive.readMemo()
            return { ok: true, message: t || '便签还是空的' }
          }
          if (a === 'append') {
            if (!body) return { ok: false, message: '要说添什么' }
            const cur = selfDrive.readMemo()
            return selfDrive.writeMemo(cur ? `${cur}\n- ${body}` : `# 便签\n\n- ${body}`)
          }
          if (a === 'replace') {
            if (!body) return { ok: false, message: '要说换成什么' }
            return selfDrive.writeMemo(body)
          }
          return { ok: false, message: 'action 只有 read / append / replace' }
        },
      }))
    }
  }

  if (memory && getConfig().memory.enabled && !isSystem) {
    tools.push(defineTool({
      name: 'remember',
      description: '把一件值得长期记住的事记下来（对方的名字、喜好、约定、重要的事）。一条只记一件事；日常琐事不用记；记的时候安静地记，别在回复里说「我记住了」。',
      properties: {
        text: str('要记住的事，一句话，主语写清楚'),
        about: str('这件事是关于谁的（名字），可选'),
        importance: { type: 'number', description: '0~1，约定、关系、核心喜好写高一点，随口一提写低一点，不确定写 0.5' },
      },
      required: ['text'],
      execute: async ({ text, about, importance }) => memory.add({ text, aboutName: about || '', about: isOwner ? 'owner' : chat.userId, importance: importance ?? 0.5, source: 'tool', chatId: current }),
    }))
    tools.push(defineTool({
      name: 'recall_memory',
      description: '翻一翻记忆库：想不起对方以前说过什么、喜欢什么、约过什么时用。query 写关键词或一句话。',
      properties: { query: str('想找什么') },
      required: ['query'],
      execute: async ({ query }) => {
        const hits = memory.recall(String(query || ''), { about: isOwner ? 'owner' : chat.userId, limit: 8, where: current + '（翻记忆）' })
        return hits.length ? { ok: true, message: hits.map((h) => memoryLine(h.it)).join('；') } : { ok: true, message: '没想起相关的事' }
      },
    }))
  }

  if (imageGen && imageGen.enabled() && !isSystem) {
    tools.push(defineTool({
      name: 'web_draw_image',
      description: '画一张图并发到当前聊天里。prompt 用中文或英文详细描述画面（主体、动作、场景、风格）。画好会直接发出去，回复里简单说一句就行。',
      properties: { prompt: str('画面描述') },
      required: ['prompt'],
      execute: async ({ prompt }) => {
        if (getConfig().imageGen.ownerOnly && !isOwner) return { ok: false, message: '画图只给主人画哦' }
        const buf = await imageGen.generate(String(prompt || ''))
        await hub.sendImage(current, buf, `[生图] ${String(prompt).slice(0, 30)}`)
        memory?.addEvent?.({ text: `画了一张图：${String(prompt).slice(0, 40)}`, about: isOwner ? 'owner' : chat.userId, tags: ['画画'], importance: 0.4 })
        return { ok: true, message: '画好发出去了' }
      },
    }))
  }

  if (level === 'full' && !isSystem) {
    tools.push(defineTool({
      name: 'web_send_image',
      description: '把本机上已经存在的一张图片文件发到当前聊天里（比如你自己用代码画的图）。path 是图片的完整路径。',
      properties: { path: str('图片文件路径'), note: str('一句话说明') },
      required: ['path'],
      execute: async ({ path, note }) => {
        const fs = await import('node:fs')
        const p = String(path || '').trim()
        if (!p || !fs.existsSync(p)) return { ok: false, message: '这个文件不存在' }
        const buf = fs.readFileSync(p)
        if (!buf.length) return { ok: false, message: '文件是空的' }
        await hub.sendImage(current, buf, String(note || '').slice(0, 60))
        return { ok: true, message: '发出去了' }
      },
    }))
  }

  return tools
}
