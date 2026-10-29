# dsh-aurachat

![warn](./test/warn.png)

DeepSeek Harness（DSH）插件，AI 伙伴，该项目仿照(抄袭)[accomplish07zrh-eng/dsh-aurabot-qq](https://github.com/accomplish07zrh-eng/dsh-aurabot-qq)，区别是不依赖QQ，目前已实现：有人格、心情和记忆，能看图、发语音、听语音、发和收表情包、写日记、逛空间回评论、还会主动找你聊天。

[实机截图](./test/1.png)

**客户端(可选)**

- [aurachat-client-android](https://github.com/hsushjk/aurachat-client-android)
- [aurachat-client-win](https://github.com/hsushjk/aurachat-client-win)
**客户端登录意义：后台运行，消息提示，绕过ssl限制**
**不能使用客户端直接连接刚安装的客户端，需要在 Web 界面或 DSH 内走完初始化流程**

**入口**

- 默认绑定`0.0.0.0:2332`可直接通过浏览器访问，ip和端口可在设置修改
- DSH 左侧栏「自动化任务」下面的「AuraChat」，功能基本一致，但无法发送语音

**聊天**

- 主人 + 客人两套身份：主人建号，客人在「设置 → 客人」里创建，不能自助注册。
- 每个客人可选「只聊天日记」或「完全权限」；「只聊天」的客人碰不到电脑上的工具。
- 模型和思考强度从 DSH 的模型列表里选，不直连任何 `/v1`。
- 连发合并：你连着发几条，等你说完一起回；你还在输入框里打字时压着不回。
- 提示音：来消息 / 发消息各自可开可关，各种预设可选，也能填自己的音频地址。
- 语音条：按键录音、松手发送；也能把音频文件当语音发。

**Ta**

- 人设是 markdown 文件（`personas/`），内置两套；向导里能当场写一套，设置里能改、能加、能删。
- 心情是 0~100 的数，偏离平常区间后按半衰期慢慢回去；心情好话多、爱发表情和语音，心情差话少。
- 记忆分四块：人物小档案、相处经验、说话方式、全部记忆，都能在面板里改、加、删。
- 表情库：上传（支持动图、可多选）、改名、删除；聊天里别人发的图看懂了会自己起名收进库。
- 「空间」：按计划自己写动态，你和客人能评论，每小时回访新评论。
- 闲置搭话：闲够时间开口，带免打扰时段和每日上限。
- 自驱：照一张共享便签（markdown）想事、做事，做完跟你说一声。

**多模态支持**

- 朗读（TTS）七种后端：自动、微软 edge-tts、本地 CosyVoice、本地 GPT-SoVITS、OpenAI 兼容 `/audio/speech`、任意 HTTP 接口、Windows 自带语音。edge-tts 有 16 个中文音色，可一键装进插件自己的 Python 环境。
- 听写（STT）：用 DSH 自带的 SenseVoice，本地推理、不用联网、不用填地址（好像只在 DSH 桌面版里可用）。
- 生图四种后端：OpenAI 兼容 `/images/generations`、SD WebUI、ComfyUI，或让自己写代码画。

**外观**

- 跟随 DSH 明暗自动切换；主题四选一：浅色 / 深色 / 亚克力 / 毛玻璃，后两种透背景图。
- 背景图、头像都能换；没传头像时，页内头像和浏览器图标用同一张 `public/icon.svg`。
- 网页名称、浏览器标题都能自己在设置里改，不跟着名字自动变。

## 安装

需要 **DeepSeek Harness 桌面版(官方)**（当然也最好是官方桌面版）。

1. 把整个目录放到你放插件的位置，比如 `D:\dsh-aurachat`。
2. 在 DSH 的 profile 里登记成依赖（路径换成你自己的）：

   ```json
   {
     "dependencies": {
       "dsh-aurachat": "file:D:/dsh-aurachat"
     }
   }
   ```

3. 重启 DSH。侧栏会出现入口，或者用浏览器打开 `http://127.0.0.1:2332/`。
4. 也有更轮椅的方法，把该项目丢给DSH帮你安装

> 想让Ta在 DSH 里用工具（改文件、跑命令），需要在 DSH 那边给完全权限；只想聊天不需要。

## 首次配置

第一次打开是初始化向导：起名字 → 怎么称呼你 → 挑人设和头像（也可以现场写一个）→ 选模型和思考强度 → 设主人账号。

设完自动登录。之后在「设置」里可以追加修改，右上角「保存设置」立即生效。

## 端口与反代

- 自行记住监听地址和端口反代即可
- nginx 反代示例：

  ```nginx
  location / {
      proxy_pass http://127.0.0.1:2332;
      proxy_buffering off;
      proxy_read_timeout 3600s;
      proxy_set_header Host $host;
      client_max_body_size 32m;
  }
  ```

  `proxy_pass` 末尾不要带 `/`；必须`proxy_buffering off`

- 嵌在 DSH 侧栏的那份走 DSH 自己的 web 服务（`/aurachat/` 前缀），和固定入口互不影响。

**麦克风、剪贴板功能需要SSL**：`127.0.0.1` 和 `localhost` 除外；从别的设备打开就需要https
**DSH 桌面版侧边栏访问无法使用麦克风功能**：DSH 桌面版的内嵌页拿不到麦克风权限

## 数据

`~/.dsh/plugins-data/aurachat/`（例如Windows 是 `C:\Users\<用户名>\.dsh\plugins-data\aurachat\`）：

| 文件 | 内容 |
| --- | --- |
| `config.json` | 设置（密钥单独存，不回传前端） |
| `users.json` | 主人和客人账号（密码 scrypt 哈希） |
| `chats/<会话>/index.json` | 这个会话的分片目录（每片多少条、起止时间） |
| `chats/<会话>/seg-*.json` | 消息分片，一片最多 100 条，只存文字和媒体 id |
| `media/<会话>/<mediaId>` | 图片/语音文件本体（不再塞进 JSON） |
| `sessions.json` | 会话和人设/权限的对应 |
| `memories.json` | 记忆四块 |
| `diary.json` | 空间动态和评论 |
| `selfdrive.md` | 共享便签 |
| `chatlog/` | 按天归档的对话原文，记忆整理用 |
| `personas/` | 人设文件 |

### 聊天记录怎么存、怎么过期

- **文字和媒体分开存**：`image` / `voice` 落成 `media/<会话>/<mediaId>`，分片里只留 `{ mediaId, mediaMime }`。
  一条媒体的 base64 约 300KB，而一条文字消息只有 150 字节左右，分开之后分片文件基本是 KB 级。
- **一片 = 界面一页**：文件名带序号（`seg-001-…`、`seg-002-…`），目录按文件名排就是时间顺序。
  网页首屏只渲染**最新那一片**（刚切完就是几条，看起来干净），往上翻才整片加载上一片，
  所以文件边界和你眼睛看到的页边界永远一致。
- **聊天途中不切片**：消息一直追加到当前片，聊 200 条也还是一个文件，不会突然把前面的藏起来。
- **空闲 2 分钟后自动切**：把当前片按 100 条一份切开（250 条 → 100+100+50），最后一份留作新的当前片。
- **保留天数**（设置 → 聊天记录，`history.keepDays`，1–365 天，默认 7）：
  聊天记录和媒体一起过期；过期的片整片删，跨过期线的片把过期的那几条掐掉再重写（所以"保留 7 天"就是 7 天，
  不会因为凑不满一片而多留十几天）；媒体文件跟着一起删。
- **往上翻**：网页里翻到顶会出现「查看更早的记录 · 第 N/M 片」，点一下按
  `GET /api/messages?file=prev&before=<本片最早消息时间>` 取上一整片，滚动位置保持不动。
  老接口 `?limit=&before=` 还在（按 100 条跨片分页），App 暂时用那个。
- 客户端（网页/App）也把取过的媒体缓存在本地，下次只看不重下；服务端对 `GET /api/media/<id>` 发
  `cache-control: private, immutable` + ETag，客户端拿到 304 就不再下字节。

**日志不落盘**：只在内存里留最近几百条（上限可调），重启即丢失

## 客户端预留接口

http 接口，客户端需要 base URL + token：

- 固定入口的根路径就是 API 根，`GET /api/state` 免登录，可用来探活和取站点信息。
- 登录：`POST /api/login` 拿 token，之后带 `Authorization: Bearer <token>`；也支持 `?token=` 深链。
- 收发：`GET /api/messages`（`?file=last` 取最新一整片、`?file=prev&before=<t>` 取再往前一整片；
  老参数 `?before=<时间戳>&limit=<1-100>` 仍按条数跨片分页）、
  `POST /api/messages`、`POST /api/voice`、`POST /api/typing`。
- 媒体：`GET /api/media/<mediaId>`（图片/语音本体，支持 `?token=`；带 ETag 和强缓存）。
- 实时：`GET /api/stream`（SSE，`message` / `typing` / `history` 事件，25s 心跳）。
  `history` 表示有分片过期被删，客户端按 `droppedBefore` 丢掉更早的气泡。
- 其余：`/api/config`、`/api/mood`、`/api/diary*`、`/api/memory*`、`/api/stickers*`、`/api/logs`、`/api/status`。

客户端不需要知道 DSH 的路径，也不依赖 cookie。

## 升级

暂无打算，写完这一版我快上班了，如果这个项目真的对大家有用，可以fork之后自行迭代

## 常见问题

**Ta听不见我说话？** 首先确认宿主是是 DSH 桌面版，然后进入设置-插件-实验性插件-「语音输入」已开且在运行；从浏览器进入时，麦克风需要 https 或 localhost/127.0.0.1。

**模型不回话？** 看「日志」页有没有报错；确认 DSH 那边模型可用、插件有权限起会话。

**客人能看到别人的聊天吗？** 不能。每个账号只有自己的会话，空间动态按可见性过滤。

**会偷偷联网吗？** edge-tts、OpenAI 兼容 TTS/生图、以及你自己填的地址会联网，其余全本地；语音听写是本地模型。

**项目存在的意义？** 首先是规避QQ风控。其次是我职业很特殊，一年有大半时间没有网，这个项目搭配本地部署大模型可以实现全程不联网。

## 目录结构

```text
dsh-aurachat/
├── src/                    插件本体（在 DSH 里跑的 Node 侧代码）
│   ├── host.js             入口：注册插件、注入宿主能力、拼系统提示词、挂定时器与网页
│   ├── chat/               会话层
│   │   ├── access.js       权限分级：主人 / 客人
│   │   ├── hub.js          消息落库、连发合并、投递回复、发语音表情图
│   │   └── reply.js        把模型一轮回复拆成多条，过滤旁白与占位文
│   ├── core/               基础设施
│   │   ├── config.js       配置默认值与逐字段校验
│   │   ├── logger.js       内存日志（环形缓冲，超上限丢最旧）
│   │   ├── store.js        JSON 文件读写
│   │   ├── net.js          HTTP 请求 / 下载
│   │   ├── redact.js       密钥脱敏（日志里不出现明文）
│   │   ├── image.js        图片尺寸、格式、动图判定
│   │   ├── time.js         时间格式化
│   │   ├── version.js      版本号（唯一来源是 package.json）
│   │   └── llm.js          给内部小任务（判断、抽取）的单次调用
│   ├── features/           功能模块
│   │   ├── azone.js        空间：写日记、评论、回访
│   │   ├── azone-social.js 串门：看客人的空间并留言
│   │   ├── memory.js       记忆：全部记忆、相处经验、说话方式、人物档案、整理
│   │   ├── stickers.js     表情库：收集、打标签、按情绪挑图
│   │   ├── imagegen.js     生图
│   │   ├── companion.js    闲置搭话
│   │   └── selfdrive.js    共享便签（自主写点东西）
│   ├── persona/
│   │   └── personas.js     人设的读取、新建、编辑、删除
│   ├── voice/
│   │   ├── tts.js          七种语音后端 + SenseVoice 语音识别
│   │   └── wav.js          PCM/WAV 转换（识别只吃 16k 单声道 WAV）
│   ├── tools/
│   │   └── tools.js        给模型调用的工具（改便签、加表情等）
│   ├── local/
│   │   ├── local.js        本地模型服务的探测与调用
│   │   └── templates/      CosyVoice、GPT-SoVITS 等本地服务的脚手架
│   └── web/
│       ├── auth.js         账号、登录、密码、客人管理
│       ├── server.js       组合层：静态文件、SSE、固定端口入口、把请求交给路由表
│       ├── router.js       极简路由表（按注册顺序匹配，先精确后前缀）
│       └── routes/         按领域拆开的接口
│           ├── session.js  状态、初始化、人设、登录、改密码、客人
│           ├── chat.js     消息、语音、打字状态
│           ├── azone.js    空间动态、评论、回访
│           ├── media.js    表情、图标、头像、背景图
│           ├── memory.js   记忆、心情
│           ├── voice.js    语音安装与试听
│           └── settings.js 配置、日志、状态、试用、便签
├── public/                 浏览器前端（单页）
│   ├── index.html          页面骨架与首次向导
│   ├── app.js              视图层：聊天、空间、记忆、设置、向导、导航
│   ├── app.css             样式与主题
│   ├── icon.svg            图标，同时用作浏览器图标和默认头像
│   └── js/                 前端公共模块
│       ├── format.js       转义、时间、时长、问候语
│       ├── theme.js        主题与壁纸（跟随 DSH 深浅色）
│       ├── sound.js        提示音（内置音色或自定义音频）
│       ├── audio.js        WAV 编码（录音上传用）
│       └── views/          单独的页面
│           ├── mood.js     心情
│           ├── overview.js 概览
│           └── logs.js     日志
├── client/
│   └── client.js           DSH 客户端侧：侧栏入口与面板
├── personas/               内置人设
│   ├── dafeiyu.md          默认人设（大肥鱼）
│   └── aurachat.md         正式人设（助手风格）
├── test/                   开发自测（纯 Node，不参与运行）
│   ├── smoke.mjs           主冒烟：注册、配置、鉴权、各接口、固定端口
│   ├── ui.mjs              真浏览器端到端：向导 → 登录 → 各页面 + 截图
│   ├── ids.mjs             前端引用的元素 id 是否都存在
│   ├── calls.mjs           前端调用的函数是否都定义过
│   ├── keys.mjs            设置项配置键是否都在 config 里
│   ├── reply-filter.mjs    回复拆分与旁白过滤
│   └── asr-wiring.mjs      语音识别接入的参数形状
├── cordis.patch.yml        给 DSH 的声明：两个 preset（主人全工具 / 客人无工具）
├── package.json            包信息，`version` 是版本号唯一来源
├── README.md               给人看的说明与部署
└── dshreadme.md            给 AI 看的安装说明
```

## 致谢

仿照(抄袭)了项目 [accomplish07zrh-eng/dsh-aurabot-qq](https://github.com/accomplish07zrh-eng/dsh-aurabot-qq)，没有该项目就没有本项目，衷心感谢。没有复制该仓库的代码。
