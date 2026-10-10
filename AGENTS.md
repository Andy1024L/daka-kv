# Codex 项目约定

## 项目背景

- 这是一个个人打卡 PWA 应用，主要功能是记录“锻炼”和“拉伸”，并在首页、统计页、数据页查看和管理记录。
- 本仓库 `1.daka-edgeone-kv`（GitHub `Andy1024L/daka-kv`）是 `https://6668080.xyz` 当前生产源码；旁边的 `1.daka` 是旧 Supabase 版本，不能直接用于生产部署。
- 应用走“本地优先 + 云端同步”思路：界面和历史记录应尽量先从本地缓存读取，EdgeOne KV 云端同步可以慢一点，但不能阻塞基础操作手感。
- 用户主要在手机端使用，尤其关注 iPhone 大屏上的一屏利用率、点击跟手程度和离线/弱网体验。

## 长期规则沉淀

- 如果后续对话中出现可以长期复用的项目约定、个人偏好、固定操作流程或避坑经验，agent 应该主动更新本文件。
- 只沉淀以后会复用的规则，不记录一次性需求、临时试验或已经废弃的方案。
- 新增规则要尽量具体到文件名、命令、文案、交互行为或操作步骤，避免写空泛原则。
- 如果某条规则只是根据历史行为推断出来的，需要标注“建议”。
- 更新本文件后，提交信息应明确说明是项目约定更新，例如 `Update project agent guidelines`。

## 版本更新

- 每次做了用户能感知到的应用改动后，都要同步更新：
  - `lib/app-version.ts`
  - `public/version.json`
- `APP_VERSION`、`APP_UPDATED_AT`、`version`、`updatedAt` 必须保持一致。
- 时间使用中国本地时间，固定格式为：`YYYY-MM-DD HH:mm`，例如 `2026-07-02 21:39`。
- 首页底部的“检查更新”默认保持轻量，不要强提醒版本号。
- 版本号/最近更新时间只在用户点击“检查更新”后展示。
- 检查更新时，如果发现新版，提示文案应表达自动更新过程，例如：
  - `发现新版，正在准备更新...`
  - `正在下载更新...`
  - `正在应用更新...`
  - `更新完成，正在重启...`
- 不要出现“发现新版，点击更新”但又自动更新的矛盾文案。
- 更新状态不要一闪而过后立刻回到默认状态；需要让用户能看清楚当前结果。
- 涉及 PWA 缓存更新时，同步检查：
  - `components/app-update-control.tsx`
  - `public/sw.js`
  - `public/version.json`

## 数据同步

- 打卡操作必须本地优先：用户点击后应立即在界面显示成功，不要等待 EdgeOne KV 返回。
- 云端上传失败时，记录要保留在本地 pending 队列，之后自动同步。
- 弱网或刚打开应用时，不能因为云端数据还没拉完而覆盖刚刚本地新增的记录。
- 修改数据同步逻辑时重点检查：
  - `lib/storage.ts`
  - `lib/workouts-api.ts`
  - `lib/db/workout-store.ts`
  - `app/page.tsx`
  - `app/data/page.tsx`
  - `app/api/records/route.ts`
  - `app/api/records/[id]/route.ts`
- 云端数据和本地数据合并时，以 `id` 去重，不要产生重复记录。
- EdgeOne KV 绑定变量默认使用 `WORKOUT_KV`，如需改名，在部署环境设置 `EDGEONE_KV_BINDING_NAME`。
- `.env.example` 只保留示例变量名，不放真实密钥。
- 页面组件不要直接操作 KV；前端统一调用 `lib/workouts-api.ts` 的 `getWorkouts`、`createWorkout`、`updateWorkout`、`deleteWorkout` 等方法，服务端统一由 `lib/db/workout-store.ts` 访问 KV。
- EdgeOne KV key 只能使用数字、字母和下划线；打卡数据存储在 `workouts_all`，删除标记存储在 `workouts_deleted`，不得通过清除删除标记来恢复旧客户端缓存。
- EdgeOne KV 是最终一致，其他边缘节点可能最多约 60 秒读到旧缓存；本地优先和 pending 队列不能移除。
- 前端只上传明确的待同步操作，不要将本地缓存中缺失于云端的所有记录重新上传；读取云端成功后，以云端记录加待同步操作刷新本地，不能再用已同步的旧本地记录覆盖云端。
- `check-in-records-pending-operations` 持久保存新增、修改、删除和清空操作；确认上传时按 `operationId` 标记，不能按记录 ID 清掉同一记录后续的修改。旧 `check-in-records-pending-sync` 必须迁移后再删除。
- 已确认的操作保留最长 65 秒用于抵消 KV 读取延迟；手机恢复联网、切回前台和前台每 30 秒自动同步。
- 新前端的写入使用绑定正常的 `edge-functions/api/records/index.js`；Next.js 的 `/api/records/[id]` 只转发旧客户端操作到该静态接口，不能直接假定 Next.js 路由拥有 KV 全局绑定。
- iPhone 桌面 PWA 和 Safari 的本地数据、登录状态独立。排查差异时分别备份，以用户明确指定的端为准；更新应用壳不能清除 localStorage 中的记录或待同步操作。

## UI 与交互

- 用户非常在意“像本地 App 一样跟手”，页面切换和按钮反馈要优先保证即时响应。
- 首页、统计、数据目前倾向于同一页面内的三个 tab，而不是三个独立路由，减少切页等待和首次进入卡顿。
- 首页需要同时承担打卡和近期记录查看：
  - 每个项目显示近期多周记录。
  - 日期在格子上方或格子内部清晰展示。
  - 不要让日历喧宾夺主，打卡按钮仍然要容易点。
- 首页在手机上必须充分利用一屏空间，尤其是 iPhone 15 Pro Max，不要所有内容挤在上方，也不要底部大量空白。
- 首页底部“检查更新”不能被内容挤到点不到；底部导航和安全区要留出可操作空间。
- 日历格子视觉语言要统一：
  - 当天格子使用和统计页一致的样式逻辑。
  - 不要同一个状态在首页和统计页使用两套设计语言。
  - 有记录的格子数字尽量使用白色，保持统一。
- 格子尺寸和间距要按比例设计：
  - 单个单元格可以缩小，但整体网格仍应铺满可用宽度。
  - 避免左右两边出现明显空白缩进。
  - 避免上下间距和左右间距差异过大导致版式别扭。
- 标题和图标应作为一组居中显示，不要图标和标题分散到两端。
- “拉伸 x1”这类按钮不要显示多余单位，例如不要出现 `x1 次`。
- UI 调整后优先本地打开给用户看，不要直接推送。

## 本地验证

- 修改代码后至少运行 `npm run lint`。
- 修改同步逻辑时运行 `npm test`，覆盖离线重试、跨设备删除、KV 延迟和旧响应晚返回。
- 修改影响构建、缓存、路由、Next 配置或 PWA 更新逻辑时，提交前运行 `npm run build`。
- 需要本地预览时运行 `npm run dev`。
- 如果端口被占用，可以换端口启动，例如 `npm run dev -- -p 3034`。
- 如果需要无登录/无云配置预览，不要泄露 `.env.local` 内容。
- 建议：本地预览时如果遇到 `.next/dev` 异常，可以在确认路径是当前项目下的 `.next/dev` 后再清理该目录。

## 提交与部署

- 用户偏好直接推送到 GitHub 的 `main` 分支，不需要创建 PR。
- EdgeOne Makers 项目 `daka-kv` 绑定 GitHub `Andy1024L/daka-kv`；推送 `main` 后等待 EdgeOne 自动构建，并读取线上 `/version.json` 和 API 验证部署完成。该项目为 `Github` 类型，不能用 `edgeone makers deploy` 直接上传目录或 ZIP。
- `6668080.xyz` 的 HTTPS 使用 EdgeOne「申请免费证书 + 自动验证」，依赖 CNAME 持续正确指向 EdgeOne，由平台自动续签和部署。所有端同时同步失败时，先检查 TLS 证书有效期及浏览器 `ERR_CERT_DATE_INVALID`，不要清缓存、忽略证书错误或把各端缓存强行互相覆盖。
- 不要无故创建长期分支；临时分支用完要保持仓库干净。
- 推送前检查：
  - `git status -sb`
  - 确认没有误提交 `.env.local`、日志文件、临时文件。
- 标准提交流程：
  - `git status -sb`
  - `npm run lint`
  - 必要时 `npm run build`
  - `git add <changed-files>`
  - `git commit -m "<简短英文提交信息>"`
  - `git push origin main`
- 提交信息用简短英文，描述本次真实变更，例如：
  - `Refine homepage calendar layout`
  - `Fix local record sync`
  - `Update app version metadata`

## 文件与实现习惯

- 手动改文件优先使用 patch，不要顺手大范围重写无关代码。
- 保持改动聚焦：只改和当前需求相关的文件。
- 不要重构用户没要求的模块。
- 不要删除或回滚用户已有改动，除非用户明确要求。
- 搜索文件或文本优先使用 `rg` 或 `rg --files`。
- 项目使用 Next.js、React、Tailwind、lucide-react、EdgeOne KV。
- 图标优先使用 `lucide-react`，不要手写重复 SVG。
- 中文文案要自然、短、直接，避免技术味太重。
- PowerShell 里中文可能显示乱码，但浏览器正常时不要误判为源码编码问题。

## 安全与隐私

- 这是个人项目，默认不应暴露私密数据。
- EdgeOne KV 只能在 Edge Functions / API Routes 内访问：
  - `lib/db/workout-store.ts`
  - `app/api/**`
- 前端不要直接持有或操作 KV 绑定。
- 如果部署到群晖、软路由或国内服务器，仍要确认：
  - `.env.local` 不进 Git
  - 服务端环境变量只在部署平台配置
  - API 不允许未授权批量泄露数据
- 建议：如果未来开放公网访问，应补充访问控制或登录校验，避免别人通过 API 读取/写入记录。
