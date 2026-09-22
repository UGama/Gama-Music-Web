# Gama Music Web 模块重构说明

基于 UGama/Gama-Music-Web 提交 `dc4378b28defe1c881fa21655ece26546422b8c1`。本次交付为本地重构副本，未推送或部署。

`app.js` 从 13,280 行缩至 1,062 行（减少约 92%）。保留原有 UI 模板、业务流程、API 路径、存储键、IndexedDB 数据库及数据格式，无须迁移音乐库。现有七个共享模块直接复用，没有覆盖为旧对话中的示例版本。

## 目录与职责

```text
Gama-Music-Web/
├── index.html                 页面入口，app.js?v=77
├── app.js                     初始化、依赖接线、歌曲卡片与页面事件分发
├── state.js                   共享状态和 localStorage 键（原文件）
├── storage.js                 IndexedDB 音频、封面和音乐库（原文件）
├── library.js                 歌曲排序与搜索过滤（原文件）
├── library-service.js         本地库加载/保存、离线状态、服务连接监测
├── player.js                  播放队列、播放控制、Media Session（原文件）
├── playlists.js               播放列表数据操作（原文件）
├── playlist-view.js           播放列表界面与手机滚动标题（原文件）
├── utils.js                   时间、字节数和 HTML 转义（原文件）
├── download-store.js          下载失败/历史/队列/暂停状态持久化
├── mobile-downloads.js        手机下载、暂停/恢复/重试、下载管理界面
├── transfer.js                Blob 流式下载与进度回调
├── bilibili.js                视频预览、下载轮询、收藏夹导入与失败详情
├── sync.js                    同步会话、上传/接收、心跳、确认与取消
├── qr-scanner.js              摄像头扫码与流/动画帧清理
├── settings.js                设置界面与操作入口
├── sleep-timer.js             睡眠定时器界面、持久化和到时暂停
├── backup.js                  Gama 备份导入导出、本地 MP3 导入
├── api.js                     服务地址、认证、API 请求、媒体 URL
├── ui.js                      DOM 引用、图标、提示、弹窗和视图切换
├── pwa.js                     Service Worker 注册及更新检测
├── service-worker.js          外壳预缓存与原有网络/离线策略
├── styles.css                 原样保留
├── manifest.webmanifest       原样保留
├── assets/                    原样保留
├── vendor/                    原样保留的二维码库
├── scripts/
│   ├── check.cjs              语法、作用域、依赖和预缓存检查
│   └── smoke.cjs              桌面/PWA 模拟回归测试
├── package.json               仅开发检查依赖，不引入网站构建步骤
├── package-lock.json          锁定检查工具版本
└── REFACTOR.md                本说明
```

原有共享模块共七个：state、storage、library、player、playlists、playlist-view、utils；另保留原 Service Worker 文件并仅做下面列明的修改。

## 模块边界

所有模块均使用原生 ES module，不依赖打包工具。没有模块反向 import `app.js`，没有循环 import。

`app.js` 在 DOMContentLoaded 中先注入生命周期回调，再初始化 DOM、播放器和播放列表界面，之后维持原启动顺序：事件绑定、模式恢复、PWA 注册、定时器、离线状态、音乐库、下载恢复和同步邀请处理。

少量交叉调用通过显式初始化接口连接：

- `initUi({ stopQrScanner })`：关闭弹窗仍释放摄像头。
- `initLibraryService({ render, resumeMobileDownloads })`：保存/载入后刷新界面，重连后恢复任务。
- `initMobileDownloads({ render, stopIncomingSync })`：下载后刷新页面，下载管理器可停止同步。
- `initBilibili({ render })`、`initBackup({ render })`：导入后刷新页面。

这些接口仅注入明确的回调，没有新增全局函数、隐藏事件总线或动态 import。下载队列、任务恢复、重试和下载管理 UI 暂时留在同一个下载功能模块中，减少高耦合流程的改动风险。

## 改动清单

修改已有文件：

- `app.js`：迁移函数与模块私有状态，更新 import 和初始化接线。
- `index.html`：保留 type="module"，入口版本由 76 更新为 77。
- `service-worker.js`：缓存版本改为 `gama-music-shell-v77`；添加 13 个新模块及两个二维码 vendor 脚本；删除重复的非 HTTP(S) 协议判断。原有 API、音频、封面、页面和更新接管策略不变。
- `.gitignore`：忽略用于本地验证的 node_modules。

新增 13 个功能模块：api、ui、library-service、download-store、mobile-downloads、transfer、bilibili、backup、sleep-timer、qr-scanner、sync、settings、pwa。

新增验证脚本、package.json、package-lock.json 和本说明。其余原文件内容未改。

删除已确认无调用方的旧函数：`clearStatus`、`mergeOfflineTracks`、`renderEmptyConnection`、`getMobileDownloadFailures`、`waitIncomingSyncPreparation`。所有被引用函数保留；原公共模块的导出接口保留。主文件的 import 按真实引用重新生成，检查结果无未使用 import。

下载历史清空操作改由 `download-store.js` 的 `clearStoredMobileDownloadHistory()` 执行，界面刷新仍由下载功能模块完成。

## 已完成的验证

1. 对项目所有 24 个 .js 文件（含 vendor）以及两个 .cjs 检查脚本执行 Node 语法检查，全部通过。
2. 对 22 个顶层 JS 文件检查未解析标识符、未使用 import、路径、命名导出和循环依赖，全部通过。二维码库提供的 jsQR/QRCode 明确列为外部全局。
3. 检查全部预缓存路径存在、所有模块及两个二维码 vendor 脚本均在预缓存中、入口和缓存版本一致，全部通过。
4. 对照重构前源码：121 个保留函数内容逐字一致；另一个保留函数仅改为调用存储层清空历史；删除 5 个无引用函数。
5. 在 JSDOM + fake-indexeddb 模拟环境分别启动原版和重构版，覆盖桌面及独立手机 PWA 条件，确认初始化页面及设置、睡眠、下载管理弹窗 HTML 完全相同。
6. 验证音乐库恢复、旧目录清理、失败任务恢复、播放列表创建/改名/增删歌曲/删除、队列去重、暂停持久化、历史 30 条上限和损坏 JSON 的回退行为。
7. 对原版和重构版均模拟下载：音频成功而封面失败时音频保留；重试只补封面；完整下载不再请求；等待连接时保留队列；暂停不恢复；恢复后记录失败；失败重试完成后移出队列；取消保留已完成音频。

可重复运行的当前版本检查：Node 20.19+（或满足 jsdom 要求的更新版本），执行 `npm ci`，然后执行 `npm test`。VM Modules 的 experimental 提示属于 Node 测试环境，不影响浏览器部署。

如果手头另存有本次基线的原始 app.js，可通过 `BASELINE_APP=/absolute/path/to/original-app.js npm test` 重跑 HTML 对照测试；默认 npm test 检查重构后的版本，不需要原始文件。

这里的浏览器/网络/IndexedDB 为模拟环境，不能替代真实 Safari/PWA、实际媒体解码、Mac 后端协议和摄像头测试。没有对真实用户音乐库进行写入，也未连接真实同步会话。

## 建议实机回归顺序

1. **已有数据与基础播放**：升级前后歌曲数和播放列表一致；播放、上一首/下一首、随机/循环、搜索排序、锁屏控制正常；手机播放列表进入/返回及滚动标题正常。
2. **手机下载**：单曲/整列表、进度显示、暂停、继续、取消；关闭再打开 PWA 后恢复；断网/断开 Mac 后重连；音频成功但封面失败后的重试；检查已有音频不重复下载。
3. **下载历史**：失败任务跨刷新保留、失败详情、删除失败任务、清空历史；取消后已下载歌曲仍能播放。
4. **Bilibili**：视频预览、单视频导入、收藏夹批量导入、重复歌曲、部分失败及重试；任务进行时刷新后继续轮询。
5. **同步与扫码**：电脑生成二维码、手机扫码/邀请链接、缺失音频与封面上传/接收、确认与心跳、取消、刷新/离开；关闭扫码弹窗后摄像头指示灯熄灭。
6. **设置与备份**：保存服务地址和认证信息、重新连接、本地 MP3 导入、备份导出/导入、睡眠定时器设置/取消/到时暂停。
7. **PWA 更新和离线**：旧 v76 页面升级到 v77 后无模块 404；成功打开并缓存后断网重开、播放本地歌曲；确认二维码脚本离线可加载。真实摄像头授权与手机系统后台行为需单独确认。

## 使用交付包

ZIP 包包含完整静态站点与验证脚本，解压后的 Gama-Music-Web 内容可用于替换对应项目文件。网站仍可按原 GitHub Pages 静态部署方式使用，不需要 npm build；npm 仅用于开发检查。

本次没有删除或重建 IndexedDB，也没有改变 localStorage 键。部署时应让 index.html、全部 JS 和 service-worker.js 同批上线，避免模块版本混用。不要为了更新代码而清空手机网站数据；那会删除本地歌曲。
