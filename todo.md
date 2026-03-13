# ATLAS TODO

## 已完成
- [x] 前端 V5.0 升级：Settings API Key 管理、Dashboard 时间选择器
- [x] 前端 V5.2 重构：全宽单栏对话区、多文件上传、模板横排居中
- [x] V6.0 全栈升级：后端 + 数据库（sessions/reports/scheduled_tasks/users）
- [x] tRPC API 路由：session/report/scheduledTask CRUD
- [x] S3 文件存储接入
- [x] 无长期数据策略：报表 24h 过期、会话文件即删
- [x] 10 个单元测试全部通过

## 进行中
- [ ] 邀请好友积分系统
  - [ ] users 表加 inviteCode/credits 字段
  - [ ] 新增 inviteRecords 表
  - [ ] 后端 API：生成邀请码、查询积分、注册时识别邀请码并发放积分
  - [ ] 前端分享页面：复制链接、生成微信分享海报（带二维码）、积分余额显示

## 待做
- [x] 前端对接真实 API（替换 mock）
- [ ] 定时报表配置 UI
- [ ] 定时任务 + 邮件发送

## 新增需求
- [ ] 侧栏底部只显示图标，去掉文字标签（类 Manus 风格）
- [ ] 主题切换（深色/浅色）移入设置页，侧栏不再单独显示
- [ ] 邀请好友分享页面（积分余额、复制链接、微信海报、邀请码兑换）
- [ ] 侧栏底部始终只显示图标（展开/收起状态都不显示文字）
- [ ] 主题切换移入设置页，侧栏底部移除主题切换按钮
- [ ] 任务卡片操作按钮：重新运行 / 下载报表 / 定时 / 更多（收藏/共享/删除）
- [x] 前端对接真实 API：文件上传到 S3（替换 mock）
- [x] 前端对接真实 API：AI 对话流式响应（替换 mock）
- [x] 前端对接真实 API：报表下载真实 S3 链接

## P1 核心功能（Week 2）
- [x] 定时任务配置 UI：设置页新增入口、填写任务名/模板/时间/邮符1、调用 scheduledTask.create- [x] Dashboard 真实数据：替换假数据，从 tRPC API 获取真实 session/report 统计
- [x] 多文件真正合并：前端多选、后端数据合并、AI 跨文件分析
- [x] 错误处理完善：上传失败提示、AI 失败重试、保留用户输入

## 继续推进（V7.1）
- [x] 任务卡片操作按钮：历史报表列表添加重新运行/下载/定时/更多
- [x] 微信分享海报：canvas 生成带二维码的邀请图片
- [x] 会话持久化：sessionDataStore 迁移到数据库（AI 对话上下文）

## V7.2 进行中
- [x] 端到端测试：验证上传/AI分析/报表生成/S3下载完整链路
- [x] 定时任务执行引擎：node-cron 按时触发报表生成
- [x] 邮件发送集成：定时任务完成后自动发送报表到配置邮箱

## V7.3 优化
- [x] 定时任务创建表单：添加「选择已上传文件」下拉菜单，绑定 sessionId
- [x] 报表历史页面：添加日期筛选和搜索功能

## V7.4 夜间优化
- [x] 侧栏图标模式：底部只显示图标，去掉文字标签（类 Manus 风格）
- [x] 主题切换移入设置页，侧栏底部移除主题切换按鈕
- [x] 报表有效期提示：卡片显示「还有 X 小时过期」
- [x] 会话管理页面：查看/删除已上传的文件列表

## V7.4 夜间打磨（100分目标）
- [x] 报表有效期提示：卡片显示「还有 X 小时过期」，过期后标红
- [x] 会话管理页面：查看/删除已上传的文件列表，显示文件名/行数/上传时间
- [x] 系统自我学习：用户对报表打分，好报表存为 few-shot 示例，AI 生成时自动检索参考
- [x] 全面视觉打磨：空状态插画、加载骨架屏、动效细节
- [x] 移动端响应式适配：主要页面在手机上可用
- [x] 错误边界：全局 ErrorBoundary，防止白屏

## V9.0 HR/行政模块 + 系统加分（全部完成）

### 后端
- [x] 数据库扩展：hr_payslip_records 和 hr_attendance_sessions 两张表
- [x] 工资条生成 API（个税计算 2024 税率表 + 三 Sheet Excel + S3 存储）
- [x] 考勤汇总 API（迟到/旷工/早退识别 + 三 Sheet Excel + S3 存储）
- [x] HR 路由注册到 Express 服务器

### 前端 HR 模块
- [x] HR 中心入口页面（工资条 + 考勤两大模块导航）
- [x] 工资条制作页面（上传→字段映射→预览→下载）
- [x] 考勤汇总页面（上传→分析→异常明细→下载）
- [x] 侧栏添加 HR 中心导航入口
- [x] 模板库新增 HR 分类（工资条/考勤/薪资分析/入离职分析 4 个模板）

### 系统加分项
- [x] 搜索页接入真实 tRPC API（防抖搜索、骨架屏加载）
- [x] Dashboard 添加 ATLAS 报表生成趋势折线图（真实数据）
- [x] 报表历史页面添加在线预览弹窗（点击眼睛图标查看报表详情）
- [x] 定时任务页面添加实时倒计时（秒级更新，显示距下次执行时间）
- [x] 首页引导优化（三步流程 + 能力标签）
- [x] 文件就绪状态优化（绿色勾选状态 + 友好提示）
- [x] 全部 28 个单元测试通过

## V10.0 对话式交付体验重构
- [x] 拖入文件后 AI 主动问候
- [ ] 界面常驻显示当前文件列表
- [ ] 对话框内直接渲染可视化表格
- [ ] 表格底部下载 Excel 和查看库按钮
- [ ] 多任务切换修复
- [ ] 任务列表显示友好名称

## Bug 修复（V10.1）
- [ ] 表格文件无法上传（用户反馈）
- [x] 网页闪退：大数据查询时崩溃，错误边界 + 分页加载 + 内存优化
- [x] 智能查询：支持字段别名映射（会员=用户=昵称）+ 语义理解（业绩=销售额=GMV）+ 模糊匹配
- [x] AI 主动分析：用户说「综合分析」时，AI 分析字段给出 3-5 个建议选项按鈕，点击后再生成
- [x] AI 智能化升级：上传后主动分析字段规律/异常/洞察，前端渲染【①】格式为可点击按鈕

## V10.2 AI 智能助手全面升级（当前进行中）
- [x] 后端：完整数据（最多500行）传给 AI，替代只传前10行样本
- [x] 后端：generate-report 也传完整数据（替代前20行）
- [x] 后端：system prompt 升级 - 系统自我认知（ATLAS功能、报表下载位置）
- [x] 后端：system prompt 升级 - 业务场景知识库（工资条/考勤/分红所需数据）
- [x] 后端：system prompt 升级 - 深度分析模式（用户分层诊断、头部集中度、规则漏洞）
- [x] 后端：统计数据升级 - 前5名用户名字+数字传给 AI
- [x] 前端：isReport 正则修复 - 移除「汇总」「统计」等分析词，避免直接导出
- [x] 后端：历史报表查询 API（/api/atlas/recent-reports）
- [ ] 前端：历史报表内联卡片（AI 回复中嵌入最近报表列表）
- [ ] 前端：用户偏好记忆（localStorage 存储常用分析类型）
- [x] 后端：无数据时的通用 AI 对话（用户问「怎么用」时不需要先上传文件）
- [x] 前端：无数据时允许聊天（系统使用咋询）

## V10.3 AI 专业能力注入（已完成）
- [x] P0 财务计算：毛利率、净利率、ROI、客单价、复购率、退货率公式和计算逻辑
- [x] P0 电商规则：天猫/抖音/拼多多/京东 费率、保证金、结算周期知识库
- [x] P0 税法知识：增値税（一般纳税人/小规模）、企业所得税、个税计算（2024税率表）
- [x] P1 意图识别：报表生成、对比分析、趋势分析、排名、异常检测的智能路由
- [x] P1 报表生成：标准化输出格式（封面+明细+汇总三Sheet）、优秀案例参考
- [x] 无文件时允许聊天（用户问「怎么用」「毛利率怎么算」不需要先上传文件）
- [x] 聊天界面全宽自适应（对标 Manus 风格，不固定 max-w-2xl）
- [x] 拖入文件后立即切换到聊天界面（无缝体验）
- [ ] 历史报表内联查询（AI 回复中嵌入最近报表列表）

## V10.4 报表分析师能力（已完成）
- [x] 数据洞察：自动发现关键趋势（环比增长、集中度、分布规律）
- [x] 异常检测：自动识别异常数据（离群値、规则漏洞、数据矛盾）
- [x] 趋势预测：基于历史数据预测下期走势（线性趋势、季节性）
- [x] 行动建议：具体到人的优化建议（P0/P1/P2 优先级，点名道姓）

## V10.5 数据质量检测 + 自然语言查询（已完成）
- [x] 数据质量检测：缺失値识别和处理建议（哪些字段缺失率高）
- [x] 异常値检测：自动识别突变数据（销售额暴涨10倍、负値、超出合理范围）
- [x] 数据清洗建议：告诉用户哪些数据需要修正，如何修正
- [x] 自然语言查询：「查销售额前10名的商品」→ 直接从数据中计算返回结果
- [x] 自然语言查询：「找出退货率最高的店铺」→ 智能字段匹配 + 计算
- [x] 自然语言查询：「哪个员工业绩最好」→ 识别姓名字段 + 业绩字段 + 排名

## V10.6 多表汇总（财务核心能力）
- [x] 多文件上传后，AI 自动识别关联字段（如「姓名」字段跨表匹配）
- [x] 跨表 JOIN：工资表 + 考勤表 + 绩效表 → 自动合并成完整工资条
- [x] AI 主动提示：「我发现这两个表可以通过「姓名」字段关联，要合并吗？」
- [x] 多表汇总报表生成：把所有上传文件的数据整合到一个 Excel 的多个 Sheet
- [x] 字段冲突处理：同名字段来自不同表时，AI 询问用户保留哪个

## V10.7 多店铺汇总 + 模板汇总
- [x] 多文件上传后，AI 自动识别「店铺名称」「销售额」「订单数」等字段并跨表合并
- [x] 生成店铺排名汇总表：店铺名称、总销售额、订单数、客单价、环比增长、排名
- [x] 支持自定义汇总维度：用户可以说「我只要店铺名称和销售额」
- [x] 模板汇总：用户上传一个「目标模板」 Excel，AI 按模板格式把数据填入
- [x] AI 主动识别模板：「我发现这个文件是模板格式，要按这个格式汇总其他数据吗？」

## V10.8 阿里百炼接入（已完成）
- [x] 配置阿里百炼 API Key（DASHSCOPE_API_KEY）到环境变量
- [x] 切换后端模型为 qwen3-max-2026-01-23（主）+ kimi-k2.5（大文件，自动切换）
- [x] 双模型策略：<10000行用 qwen3-max，≥ 10000行自动切换 kimi-k2.5
- [x] 修复 isReport 正则（「怎么算工资条」不应触发报表生成）
- [x] 修复所有 vitest 测试通过（45/45）
## V10.9 OpenClaw 接入（已完成）

- [x] 配置 OPENCLAW_API_KEY 和 OPENCLAW_ENDPOINT 到环境变量
- [x] 后端新建 openclaw.ts：转发用户消息 + 文件路径到 OpenClaw API
- [x] 后端：OpenClaw 返回的 output_file 自动上传到 S3 并保存报表记录
- [x] 前端设置页面：添加 OpenClaw API Key 配置入口（AI 引擎页）
- [x] 双通道路由：/chat 路由已实现 isOpenClawEnabled() 判断，自动切换

## V11.0 OpenClaw 轮询架构（已完成）

- [x] 数据库新增 openclaw_tasks 表（id/userId/message/fileUrls/fileNames/reply/outputFiles/status/pickedUpAt/completedAt）
- [x] GET /api/openclaw/tasks/pending — 返回待处理任务，自动标记为 processing
- [x] POST /api/openclaw/tasks/result — 接收结果，base64 解码上传 S3，更新任务状态
- [x] Bearer Token 鉴权（OPENCLAW_SESSION_KEY 环境变量）
- [x] 9 个单元测试全部通过（54 tests total）
- [x] 环境变量 OPENCLAW_SESSION_KEY=atlas_session_shrimp_20260308 已配置

## V11.1 停止生成功能

- [x] 后端：AbortController 支持，客户端断开连接时立即终止 AI 请求
- [x] 前端：生成过程中显示「停止」按钮，点击立即中断流式输出
- [x] 前端：停止后保留已生成的部分内容，不清空

## V11.2 UI 优化

- [x] 对话框空状态：提示卡片缩小，降低视觉权重
- [x] 对话框空状态：突出 ATLAS 品牌标志和标语，作为视觉焦点
- [x] 停止生成：生成过程中显示「停止」按钮，点击立即中断

## V11.3 模版预览功能

- [x] 每个模版卡片添加「预览」按钮
- [x] 点击弹出预览弹窗：展示字段结构、示例数据表格、适用场景说明
- [x] 弹窗底部有「使用此模板」按钮，确认后再进入使用流程

## V11.4 任务标题自动生成

- [x] 用户第一条消息发送后，根据消息内容自动生成简短标题（如「统计店铺销售额」）
- [x] 标题实时更新到左侧任务列表，不再显示「新建任务」
- [ ] 左侧任务列表支持双击标题进行重命名

## V11.5 企业微信双向通信

- [ ] 配置企业微信环境变量（WECOM_CORP_ID、WECOM_AGENT_ID、WECOM_SECRET）
- [ ] 实现发消息：任务创建时推送任务详情到企业微信应用
- [ ] 实现回调接收：用户在企业微信回复后自动更新任务结果
- [ ] 测试端到端流程：ATLAS 发任务 → 企业微信收到 → 回复 → ATLAS 更新

## V11.6 Telegram 双向通信

- [ ] 配置 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID 环境变量
- [ ] 创建 telegramNotify.ts：发消息、轮询回复
- [ ] openclawPolling.ts 集成：任务创建时推送到 Telegram
- [ ] 定时轮询 Telegram 回复，自动更新任务结果

## V11.6 Telegram 双向通信

- [ ] 配置 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID 环境变量
- [ ] 创建 telegramNotify.ts：发消息、轮询回复
- [ ] openclawPolling.ts 集成：任务创建时推送到 Telegram
- [ ] 定时轮询 Telegram 回复，自动更新任务结果

## V11.7 AI 上传引导优化

- [ ] 修改 system prompt：AI 分析字段后主动问用户需要什么分析（销售排名/环比趋势/异常检测）
- [ ] 修改 system prompt：AI 主动提示「如果有报表模版可以直接拖进来，我会按你的格式输出」

## Bug 修复（V11.8）

- [x] Bug 1：任务中文件标签添加 X 删除按钮（hover 显示，点击调用 removeUploadedFile）
- [x] Bug 2：上传文件名乱码修复（后端 latin1→utf8 转换，自动识别中文文件名）
- [x] Bug 3：数据中枢店铺排行/平台占比保持演示数据（用户确认无需改动）

## V11.9 Telegram 集成 + 文件标签增强

- [ ] 配置 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID 环境变量
- [ ] atlas.ts OpenClaw 路径改为异步：创建 openclaw_tasks 记录 + 调用 notifyTelegramNewTask
- [ ] 彻底修复文件标签 X 删除按钮（当前仍无效）
- [ ] 文件标签 hover 展开字段预览（显示列名、行数、数据类型）
- [ ] 多文件拖拽排序（决定 AI 分析优先级）
- [ ] 文件删除后若对话中已有分析，提示「该文件已移除，相关分析可能失效」

## V12.0 HR 中心智能字段识别（严重 Bug）

- [ ] 工资条页面：上传文件后 AI 自动识别字段（姓名/基本工资/绩效等），不再让用户手动填写
- [ ] 考勤页面：上传文件后 AI 自动识别字段（姓名/日期/打卡时间等），不再让用户手动填写
- [ ] 识别结果以卡片形式展示，用户可一键确认或微调后生成

## V12.1 独立登录系统（最高优先级）

- [x] 移除所有 Manus OAuth 依赖和字眼
- [x] 后端：独立注册/登录接口（用户名+密码，bcrypt+JWT）
- [x] 前端：独立注册/登录表单，移除所有 Manus 相关 UI
- [x] 更新 useAuth hook 适配新登录系统
- [x] 数据库：users 表添加 username/passwordHash 字段，迁移完成
- [x] Sidebar：退出按钮调用真实 logout 接口
- [x] 移除 LoginModal 中所有 Manus 字眼
- [x] 全局移除前端界面 Manus/OpenClaw 字眼

## V12.3 文件操作菜单优化

- [ ] 修复文件删除按钮向上跳动问题（最顶部文件删不了）
- [ ] 改为三点下拉菜单：重命名、移动到库、删除
- [ ] 菜单向下弹出，不遮挡顶部内容

## V12.4 演示文件下载 + 文件菜单修复

- [x] 生成真实演示 Excel 文件（销售数据500行、工资条30人、考勤20人）并上传 CDN
- [x] 模板页面卡片添加「示例」下载按钮（仅有 downloadUrl 的模板显示）
- [x] 模板预览弹窗底部添加「下载演示文件」按钮
- [x] 文件标签 X 删除按钮改为 ⋮ 下拉菜单（重命名 / 删除），修复点击跳动问题
- [x] 修复 openclawPolling.ts 中 Unicode 装饰线字符导致的 esbuild 编译错误

## V12.5 管理后台

- [ ] 后端：adminRouter - 用户列表、禁用/启用、提权为管理员
- [ ] 后端：adminRouter - 报表列表（所有用户）、删除报表
- [ ] 后端：adminRouter - 系统统计（用户总数、报表总数、会话总数）
- [ ] 前端：AdminPage 管理后台页面（用户管理 + 报表管理 + 系统概览三个 Tab）
- [ ] 前端：侧栏添加「管理后台」入口（仅 admin 角色可见）
- [ ] 前端：App.tsx 注册 admin 路由

## V12.6 Bug修复 + 反馈界面 + 问题分析

- [ ] 修复任务菜单向上弹出 → 改为向下弹出
- [ ] 修复删除任务只 toast 不真实删除的问题
- [ ] AI 回复消息底部加 👍/👎 反馈按钮，点击后可补充描述提交
- [ ] 侧栏底部加「反馈建议」入口
- [ ] 分析今天用户问题，优化 AI 系统提示词（奖金计算规则、引导上传文件）

## V12.7 交付体验优化

- [ ] 修改 AI 系统提示词：直接给结果，一句话确认需求，不做长篇分析
- [ ] 消息渲染支持内联交互式表格（排名高亮、列排序）
- [ ] 消息底部操作栏：自动显示「导出 Excel」「导出 PDF」「我要调整」按钮
- [ ] 用户无文件时 AI 只问一句「请上传 Excel」不做其他分析

## V12.8 直接给表格（核心体验升级）

- [ ] AI 提示词：有文件+有需求 → 输出 ATLAS_TABLE JSON 格式数据
- [ ] AI 提示词：无文件 → 只说「请上传 Excel」；无需求 → 只问「你想看什么？」
- [ ] 前端：识别 ATLAS_TABLE JSON，渲染成内联可视化表格（带排序、高亮第一名）
- [ ] 前端：表格下方自动出现「导出 Excel」「导出 PDF」「调整一下」三个按钮

## V12.9 OpenClaw 后台接入

- [x] schema 添加 admin_api_keys 表，迁移数据库
- [x] 生成管理员 API Key 并写入数据库
- [x] GET /api/admin/users — 查用户列表（分页）
- [x] GET /api/admin/tasks — 查任务列表（分页）
- [x] GET /api/admin/feedback — 查反馈列表（分页）
- [x] GET /api/admin/stats — 查系统统计
- [x] PATCH /api/admin/users/:id/role — 修改用户角色
- [x] POST /api/admin/notify — 推送系统通知
- [x] 新反馈写入时自动推送到 OpenClaw Webhook（预留 OPENCLAW_WEBHOOK_URL 配置）
- [x] 生成 OPENCLAW_API_DOC.md 对接文档

## V12.10 紧急修复：任务卡 pending（用户等 2 小时无结果）

- [x] 找到 Telegram 路由判断（atlas.ts 第 821 行），改为 if (false && ...) 禁用
- [x] 修复 TypeScript 编译错误（db 非空断言）
- [x] 重启服务器应用修改，所有任务现在直接走 AI 流式处理

## V13.8 机器人管理 tRPC 迁移（已完成）

- [x] server/routers/bots.ts — tRPC 路由（list/create/update/delete/regenerateToken/sendMessage/getMessages）
- [x] server/botRouter.ts — 保留 /api/bots/:id/reply Express 接口（Token 鉴权，供外部服务回调）
- [x] SettingsPage IntegrationsSection — 从 fetch 改为 tRPC
- [x] IMPage — 机器人列表加载和发消息从 fetch 改为 tRPC
- [x] atlas.test.ts — 修复 getEffectiveUserId mock 和路由名称

## V12.11 手机端白屏修复

- [ ] 排查 iOS Safari 白屏原因（JS 兼容性 / 字体加载 / 渲染错误）
- [ ] 添加 vite build target 兼容旧版 Safari
- [ ] 添加 fallback 字体防止 Google Fonts 加载失败导致阻塞

## V12.12 登录状态优化

- [ ] 顶部导航栏：已登录时显示用户头像+昵称，未登录时显示"登录"按钮，状态一目了然
- [ ] 已登录状态下，头像点击展开下拉菜单（显示昵称、退出登录）
- [ ] 退出登录后显示明确的提示 Toast

## V12.13 库页面历史文件修复

- [ ] 修复库页面历史生成文件无法下载/打不开的问题
- [ ] 确认 S3 文件 URL 是否过期，改为永久可访问链接
- [ ] 历史对话被清空后，库里的文件仍然保留可下载
- [x] 修复库页面/任务列表删除按钮：鼠标移向弹出菜单时按钮消失（hover 间隙问题），改为点击触发下拉菜单

## V12.14 速度优化 + 7天数据保留

- [x] 报告保留期改为7天（expiresAt = now + 7d），替代永久存储
- [x] 对话框数据汇总速度优化：dataTable 行数从 500 → 50，history 从 6 → 4 条，节省约 18,000 tokens
- [x] 统计数据（sum/avg/max/top5）改为基于全量 data 计算，保证准确性
- [x] 侧边栏任务卡片操作按钮：改为 JS 状态控制 opacity，菜单打开时始终保持可见

## V12.15 下载修复 + 修改密码 + HR 优化

- [x] 修复下载跳转"申请访问"问题：atlas/工资条/考勤三个下载路由改为后端代理下载
- [x] 增加修改密码功能：设置页"账号安全"→"修改密码"弹窗，验证旧密码后更新
- [x] HR 工资条：上传后直接生成，跳过字段映射确认步骤，失败时再回退到手动调整
- [x] HR 考勤：上传后直接分析，跳过字段映射确认步骤，失败时再回退到手动调整

## Backlog（待后续迭代）

- [ ] 后端数据引擎（DuckDB）：支持对话阶段精确跨文件查询（多条件筛选、环比计算、异常检测）
- [ ] 对话阶段跨文件预计算：扩展 topPerformers 为全量排名，覆盖 80% 查询场景
- [ ] 库页面 vs 新项目区分：左侧导航区分"任务（7天）"和"报表库（持久）"
- [ ] 两步验证、登录记录功能

## V12.16 用户体验优化（用户反馈）

- [ ] 对话框首屏快捷指令卡片：帮用户知道能做什么（汇总/工资/图表/多门店对比）
- [ ] 上传文件后 AI 主动解读文件内容并给出快捷操作按钮
- [ ] 任务超时机制：10分钟未完成自动标记失败并在对话里主动回复
- [ ] 修复侧边栏任务卡片删除按钮：hover 时按钮稳定可见，不依赖 CSS opacity 消失
- [ ] 底部"更多"按钮：点击弹出分类引导面板（报表/HR薪资/考勤/数据分析/文件处理）
- [ ] 输入框上方动态提示词一行：根据对话上下文变化（上传文件后/AI回答后/生成报表后）

## V12.17 空状态改版 + 推荐追问 + 打分 + 忘记密码

- [x] 空状态：删掉6个快捷问题卡片、虚线上传区、品牌区三步引导条
- [x] 空状态：替换为AI欢迎气泡（版本2文字 + 三步引导在气泡内）
- [x] 推荐追问：System Prompt加指令，AI每次回复末尾输出<suggestions>标签
- [x] 推荐追问：前端流式解析剥离<suggestions>，渲染成可点击按钮
- [x] 任务完成打分：报表完成时显示✅任务已完成 + ⭐打分组件
- [x] 任务完成打分：打分结果存数据库
- [x] 忘记密码：登录页添加“忘记密码”入口
- [x] 忘记密码：重置密码流程（用户名验证直接重置，测试阶段）

## V12.18 Bug 修复（V12.17 引入）

- [x] Bug 1：无文件时输入框被禁用（排查为视觉引导问题，代码层没有禁用）
- [x] Bug 2：文件删除改为直接显示 X 按钮，修复 parseSuggestions 闭包问题（移到 useCallback 外部）
- [x] Bug 3：AI 变笨变啰嗦（suggestions 改为可选，强调正文质量优先）

## V12.19 P0 修复：errorMsg + Worker 根因排查

- [x] 数据库 openclaw_tasks 表加 errorMsg 字段（已存在）
- [x] 任务失败时写入 errorMsg（超时自动标记 failed + errorMsg）
- [x] 前端任务失败时显示错误原因（❌ + errorMsg + 重试提示）
- [x] 排查 Worker 卡住根因：无超时机制，任务卡在 processing
- [x] 修复：加 checkStuckTasks（每2分钟，超10分钟自动标记 failed）
- [x] 修复：前端轮询从 20 次增加到 60 次（200s→600s 对齐10分钟超时）

## V12.20 OpenClaw 集成

- [x] 配置 OPENCLAW_API_KEY 和 OPENCLAW_API_URL 环境变量
- [x] 实现双通道路由：有Key走OpenClaw SSE流式，无Key走千问（自动降级）
- [x] 添加 callOpenClawStream 函数（SSE代理，将输出文件存到S3）
- [x] env.ts 支持 OPENCLAW_API_URL 和 OPENCLAW_ENDPOINT 双变量名

## V12.21 紧急修复：千问 API Key

- [x] 发现 DASHSCOPE_API_KEY 未配置（环境变量为空，导致两个 AI 通道都不通）
- [x] 配置阿里百炼套餐专属 Key（sk-sp-de13f1c47cec44c48c42a4ed182c7a01）
- [x] 配置套餐专属 Base URL（coding.dashscope.aliyuncs.com/v1）
- [x] 验证 qwen3-max-2026-01-23 模型可正常调用（3 tests passed）

## V13.0 OpenClaw WebSocket 聊天渠道（即时通讯集成）

### 后端
- [ ] 数据库新增 chat_sessions 表（id/userId/title/createdAt/updatedAt）
- [ ] 数据库新增 chat_messages 表（id/sessionId/role/content/createdAt）
- [ ] pnpm db:push 迁移数据库
- [ ] WebSocket 服务端（/ws/chat）：用户认证（JWT）、消息收发、会话管理
- [ ] WebSocket 服务端：OpenClaw 插件专用连接通道（Bearer Token 鉴权）
- [ ] tRPC 路由：chat.getSessions（获取会话列表）
- [ ] tRPC 路由：chat.getMessages（获取历史消息）
- [ ] tRPC 路由：chat.createSession（新建会话）
- [ ] tRPC 路由：chat.deleteSession（删除会话）

### 前端
- [ ] 新建 Chat.tsx 聊天页面（侧栏会话列表 + 消息区 + 输入框）
- [ ] 接入 WebSocket，支持实时收发消息
- [ ] 支持流式显示（OpenClaw 逐字推送）
- [ ] 历史会话切换
- [ ] 侧栏添加「AI 助手」导航入口
- [ ] App.tsx 注册 /chat 路由

### OpenClaw 插件
- [ ] 新建 openclaw-atlas-channel 插件目录
- [ ] 实现 ChannelPlugin 接口（参考飞书插件）
- [ ] 通过 WebSocket 连接 ATLAS（Bearer Token 鉴权）
- [ ] 收消息：监听 ATLAS 推送的用户消息
- [ ] 发消息：把 OpenClaw 回复推给 ATLAS
- [ ] openclaw.plugin.json manifest 文件
- [ ] 打包为 npm 包（可本地安装）
- [ ] 输出安装说明文档

## V13.0 企业 IM 一期（AI 助手 + 1v1 私聊）

### 数据库
- [ ] 新增 im_conversations 表（id/type/createdAt）
- [ ] 新增 im_participants 表（conversationId/userId）
- [ ] 新增 im_messages 表（id/conversationId/senderId/content/type/createdAt）
- [ ] pnpm db:push 迁移数据库

### 后端 WebSocket
- [ ] server/im/wsServer.ts：WebSocket 服务端，JWT 鉴权，管理在线用户连接
- [ ] 支持消息类型：text / file / ai_reply
- [ ] AI 助手频道：senderId=0 表示 AI，消息转发给千问处理后推回
- [ ] OpenClaw 插件专用连接通道（Bearer Token = OPENCLAW_SESSION_KEY）
- [ ] 注册到 Express server

### 后端 tRPC 路由
- [ ] im.getContacts：获取用户通讯录（所有注册用户）
- [ ] im.getConversations：获取我的会话列表（含最后一条消息）
- [ ] im.getMessages：获取指定会话的历史消息（分页）
- [ ] im.createConversation：创建 1v1 会话
- [ ] im.getOrCreateAiConversation：获取或创建与 AI 助手的会话

### 前端
- [ ] client/src/pages/IM.tsx：主页面（左侧联系人/会话列表 + 右侧消息区）
- [ ] 左侧：AI 助手置顶 + 联系人列表（头像/名字/最后消息预览）
- [ ] 右侧：消息气泡（自己右对齐/对方左对齐）+ 输入框 + 发送按钮
- [ ] WebSocket 实时收发消息
- [ ] AI 助手对话支持流式输出（逐字显示）
- [ ] 侧栏添加「消息」导航入口
- [ ] App.tsx 注册 /im 路由

### OpenClaw 插件
- [ ] 新建 /home/ubuntu/openclaw-atlas-plugin/ 目录
- [ ] index.ts：实现 ChannelPlugin 接口
- [ ] WebSocket 连接 ATLAS wss://atlascore.cn/ws/im/openclaw
- [ ] 收消息：监听用户发给 AI 助手的消息
- [ ] 发消息：把 OpenClaw 回复推给 ATLAS
- [ ] openclaw.plugin.json manifest
- [ ] package.json（可本地 npm install 安装）
- [ ] README.md 安装说明

## V13.1 IM 入口位置调整
- [x] 将侧边栏「消息」导航入口移到「工作台」上方（最顶部）

## V13.2 主题调整
- [x] 将默认主题改为浅色模式（light），更新 ThemeProvider defaultTheme 和 index.css CSS 变量
- [x] 修复 AtlasContext 主题初始化：旧用户 localStorage 中的深色偏好不再覆盖默认浅色
- [x] 修复 sonner.tsx 使用 AtlasContext 主题而不是 next-themes
- [ ] 去掉强制登录要求：所有用户无需登录即可使用全部功能，登录仅为可选（后期付费版单独处理）

## V13.3 修复 OpenClaw WebSocket 连接
- [x] 将后端 WebSocket 路径从 /ws/im 改为 /api/ws/im（绕过 Cloudflare 静态文件拦截）
- [x] 更新 openclaw-atlas-plugin 插件连接 URL
- [x] 重新安装插件并验证连接成功（连接已成功，修复旧连接未关闭导致的重连循环）

## V13.4 修复线上深色主题问题
- [x] 定位主题没有生效的根本原因（旧版本 localStorage 写入的 atlas_theme: dark 被读取）
- [x] 强制覆盖为浅色，确保新用户/无 localStorage 用户看到浅色（添加 atlas_theme_version v2 机制）
- [x] 保存检查点并发布

## V13.5 修复 Cloudflare 缓冲导致的发消息延迟/失败问题
- [x] 排查根因：Cloudflare 缓冲了流式响应，导致 AI 全部生成完才一次性发送，用户感知为"卡死"或"无回复"
- [x] 修复：在 /api/atlas/chat 路由中添加 X-Accel-Buffering: no 和 Cache-Control: no-cache 响应头，禁止 Cloudflare 缓冲
- [x] 保存检查点并发布

## V13.6 Manus 风格思考状态 UI
- [x] 发送消息后立即显示“ATLAS 正在思考 ···”动画（带品牌 logo + 呼吸动效）
- [x] AI 开始输出第一个字符时，“正在思考”变为“思考过程”可折叠面板
- [x] 思考过程面板：显示当前处理步骤（解析文件/分析数据/生成回复），默认折叠
- [x] 点击“思考过程 ^”可展开/折叠，展开显示步骤详情
- [x] 保存检查点并发布

## V13.7 个人模板库增强

- [x] 数据库新增 personal_templates 表（id/userId/name/description/systemPrompt/inputFields/useCount/createdAt）
- [x] pnpm db:push 迁移数据库（表已存在于数据库，schema 已同步）
- [x] 后端 POST /api/atlas/personal-templates — 保存模板（需登录）
- [x] 后端 GET /api/atlas/personal-templates — 获取我的模板列表
- [x] 后端 DELETE /api/atlas/personal-templates/:id — 删除模板
- [x] 前端 TemplatesPage：点击「使用」后弹出参数输入弹窗（读取 inputFields）
- [x] 前端 TemplatesPage：用户填入参数后调用 templateStream 流式计算
- [x] 前端 api.ts：新增 templateStream 函数
- [x] 单元测试：V13.7 PersonalTemplates schema 3 项全部通过

## V13.9 对话持久化 + 小虾米监控接口

- [x] 数据库新增 chat_conversations 表（id/userId/title/messageCount/sessionIds/createdAt/updatedAt）
- [x] 数据库新增 chat_messages 表（id/conversationId/role/content/fileNames/createdAt）
- [x] pnpm db:push 迁移数据库（migration 0014 已应用）
- [x] 后端 atlas.ts：/api/atlas/chat 路由中自动创建/更新 conversation，保存每条用户消息和 AI 回复
- [x] 后端 adminApi.ts：GET /api/admin/conversations — 查询对话列表（分页 + userId 过滤）
- [x] 后端 adminApi.ts：GET /api/admin/conversations/:id/messages — 查询单个对话的消息
- [x] 单元测试：V13.9 ChatConversations schema 3 项 + ChatMessages schema 3 项 + 对话持久化逻辑 4 项 + Admin API 2 项，共 12 项全部通过
- [ ] WebSocket：AI 回复完成后推送完整消息给小虾米（待后续实现）

## V13.10 ATLAS ↔ 小虾米双向对话

- [x] 后端：/api/atlas/chat 路由中，用户消息发送后通过 WS 推送给小虾米（含 conversationId/sessionId/content/fileNames）
- [x] 后端：wsServer.ts 新增 atlas_reply case，小虾米发回后存入 chat_messages 表
- [x] 后端：GET /api/atlas/chat-replies?conversationId=&after= 接口，前端轮询获取小虾米回复
- [x] 后端：/api/atlas/chat 返回 X-Conversation-Id 响应头，前端跟踪对话 ID
- [x] 前端：MainWorkspace 保存 conversationId，AI 回复完成后启动 5s 轮询，小虾米回复显示在对话框
- [x] 保存检查点并发布

## V14 小虾米接入框架

- [x] IM 前端：联系人列表置顶「小虾米」系统账号（区别于 AI 助手，显示在线/离线状态）—— 仅 admin 可见
- [x] IM 前端：小虾米对话窗口（发消息通过 WS 推送给小虾米，小虾米离线时显示「暂时离线」）
- [x] 后端：千问回复完成后也推送给小虾米（Level 1 监控，有文件/无文件两路均已覆盖）
- [x] 小虾米监控面板（OpenClawMonitor.tsx）：连接状态 + 实时 Qwen 回复日志 + 对话质量统计
- [x] 侧栏添加「小虾米监控」导航入口（仅 admin 可见，橙色 Zap 图标）
- [ ] 小虾米监控面板：可对每条对话打标记「有问题」并填写反馈
- [ ] 保存 checkpoint 并发布

## V14.1 Bug 修复

- [x] Bug 1：小虾米入口对 admin 不显示 —— 已将 weixuejian 账号提升为 admin
- [x] Bug 2：小虾米对话窗口发消息现已通过 WS 推送给小虾米（send_to_openclaw），小虾米回复通过 openclaw_direct_reply 返回

## V14.2 连接稳定性修复

- [x] Bug 3：小虾米连接不稳定 —— 服务器端加入主动心跳（每 30s ping），防止 Cloudflare 100s 超时断连
- [x] Bug 4：消息丢失排查 —— 服务器端推送逻辑正确，问题在小虾米客户端未处理 im_admin_message 消息类型
- [x] 飞书集成方案评估 —— 建议保留 WebSocket，同时开发飞书机器人作为备用通道

## V14.3 消息推送修复 + 对话记录持久化

- [x] Bug 5：前端 WS 路径错误（/ws/im 应为 /api/ws/im）—— 已修复，消息现在能正确推送给小虾米
- [x] Bug 6：小虾米对话记录切换页面后消失 —— 消息已持久化到数据库，页面加载时自动恢复历史记录
- [x] 后端新增 trpc.im.getOpenClawMessages 接口，从数据库加载最近 100 条对话记录

## V14.3 机器人点击 Bug 修复

- [x] Bug：IMPage 点击机器人列表项时打开了错误的对话窗口（显示同事头像）—— 修复 isBotActive 判断条件，点击其他联系人时清空 activeBotId

## Bug 修复清单（2026-03-10 全面修复）

### P0 - 必须立刻修复
- [ ] 移除 Telegram 后台轮询进程和所有相关代码
- [ ] 修复机器人 ngrok 临时地址依赖（改为从数据库动态读取 webhook URL）

### P1 - 尽快修复
- [ ] 修复 checkStuckTasks 报错（Cannot read properties of undefined (reading 'from')）
- [ ] 加 rate limiting（/api/atlas/chat 每用户每分钟20次）
- [ ] 补全管理员接口全局鉴权

### P2 - 影响体验
- [x] 对话历史加分页（每次加载20条，滚动加载更多）
- [x] 文件上传加进度条反馈（XMLHttpRequest 进度条 + 百分比显示）
- [ ] AI 分析选项精准度提升（非标准字段名时的模糊匹配）
- [x] 错误提示优化（HTTP 401/413/429/500 对应中文提示）

### P3 - 代码质量
- [ ] 拆分 atlas.ts（>1500行）为 upload.ts / chat.ts / report.ts
- [ ] 清理 Telegram 相关依赖包

## 2026-03-10 用户体验修复

- [x] 对话框切换时瞬间跳到底部（IMPage + OpenClawPanel，instant vs smooth）
- [x] 修复 __EMPTY 字段名：parseExcelBuffer 自动检测真正表头行（最多向下扫描6行）
- [x] 上传即分析：文件上传完成后自动触发 chatStream，直接输出数据摘要+预览+洞察
- [x] Message 接口添加 suggestedActions 和 isHidden 字段
- [x] 隐藏自动触发的用户消息（isHidden: true），对话框只显示 AI 分析结果

## 2026-03-10 核心智能功能升级（上传即分析）

- [x] 上传即分析：文件上传完成后，AI 自动输出关键指标表（atlas-table 格式），无需用户手动输入
- [x] 后端场景识别：自动识别销售/工资/考勤/分红/库存等业务场景（detectScenario 函数）
- [x] 后端关键指标提炼：纯代码计算 5-8 个关键指标（总计/均值/最大/最小/Top3），AI 失败时纯代码兜底（computeKeyMetrics 函数）
- [x] Excel 表头识别优化：自动跳过合并单元格/空行，找到真正的表头行，解决 __EMPTY 字段名问题
- [x] 对话框切换时瞬间跳到底部（不再从顶部慢慢滚动）
- [x] 错误提示优化：HTTP 401/413/429/500 对应中文友好提示
- [x] 文件上传进度条（XMLHttpRequest 真实进度）
- [x] 前端：上传完成后直接用后端 ai_analysis 作为 AI 消息（不再触发二次 chatStream，更快更稳定）

## V12.11 手机端白屏修复（进行中）

- [x] 配置 Vite build target 兼容 iOS Safari 14+（解决 ES2022+ 语法不支持问题）
- [x] 加固错误边界：白屏时显示中文友好错误信息，添加 componentDidCatch 日志
- [x] HTTP → HTTPS 重定向脚本（index.html 中自动跳转，等 SSL 证书配置后生效）

## V12.12 分析进度动画（上传即分析等待体验）

- [x] 上传完成后到分析结果出来之前，显示醒目的模拟进度条（15%→30%→50%→70%→85%→92%→完成）
- [x] 进度条显示分析阶段文字（"正在读取数据..."、"识别业务场景..."、"提炼关键指标..."、"生成分析报告..."）
- [x] 分析完成后进度条自动替换为真实分析结果，平滑过渡（shimmer-sweep 动画 + 阶段文字切换）

## V12.13 进度条时机修复 + 已知 Bug 批量修复

- [x] 进度条时机：文件拖入/选择即显示分析进度条（5%），不等上传完成；修复 createNewTask 后 activeTaskId 异步问题（explicitTaskId 传递）
- [x] P0: 修复 checkStuckTasks 报错（DrizzleQueryError cause 链检测，ECONNRESET/ETIMEDOUT 自动重连）
- [ ] P1: 补全管理员接口鉴权
- [ ] P2: 去掉强制登录要求（所有用户无需登录即可使用全部功能）

## V14.4 P0+P1 全面修复

### P0 - 稳定性
- [x] 移除 Telegram 后台轮询进程（telegramPolling.ts / telegramNotify.ts 已无独立文件，env.ts 变量已清理）
- [x] 清理 Telegram 相关依赖包（无 npm 依赖，已确认）
- [x] 机器人 webhook URL 改为从 ENV.appBaseUrl 动态读取（不再硬编码 atlascore.cn）

### P1 - 安全/体验
- [x] /api/atlas/chat 加 rate limiting（每用户每分钟20次，超限返回429；_core/index.ts 已有 express-rate-limit，atlas.ts 内存 limiter 已合并）
- [x] /api/admin/* 补全 role 鉴权（adminProcedure + requireAdminApiKey 双重鉴权已就位）
- [x] 去掉强制登录要求（回滚后版本本就无强制登录，已确认）
- [ ] 任务列表支持双击标题进行重命名

## V14.5 OpenClaw SSE 稳定性修复

- [x] 第一步：删除 openclawPolling.ts 和轮询路由（/api/openclaw/tasks/pending、/api/openclaw/tasks/result）
- [x] 第二步：callOpenClawStream 加 15 秒心跳保活，防止 Nginx/CDN 60 秒断连
- [x] 第三步：降级时机改为"连接失败立即降级，30 秒无数据才降级"
- [x] 第四步：SSE 连接建立后立即发状态消息给前端
- [x] 前端清理 onTelegramTask 轮询代码，消息格式与千问降级格式完全一致
- [x] 删除 openclawPolling.test.ts（对应文件已删除），全部 69 个测试通过

## V14.6 OpenClaw 超时自动重试

- [x] 后端超时提示加入机器可读标识（__OPENCLAW_TIMEOUT_RETRY__ 标记）
- [x] 前端检测到超时标识后自动用千问重发同一条消息
- [x] 重试时显示"⚡ 正在切换备用引擎，自动重试中..."提示
- [x] 重试成功后替换掉超时提示消息，用户无感知，TypeScript 0 错误，69 个测试通过

## V14.7 System Prompt 专项训练（财务/统计/行政）

- [x] 修复"核心数据"误解：明确区分"核心字段（列）"vs"前N行（用户）"
- [x] 修复"所有用户"截断：用户明确要全量时展示全量，或说明总行数+提示导出
- [x] 财务专项训练：利润/费用/应收/资金回款/成本分摆/现金流分析 6 个场景
- [x] 统计专项训练：多维汇总/环比/占比/排名/交叉分析/数据核对 6 个场景
- [x] 行政专项训练：工资条/考勤汇总/入离职/平均工资/绩效排名 5 个场景
- [x] 数量词歧义消除规则：包含 7 条词义映射规则 + 3 个示例辨析，TypeScript 0 错误，69 个测试通过

## V14.8 左侧栏优化

- [ ] 双击任务标题进入编辑状态，Enter/失焦保存，Esc 取消
- [ ] 左侧栏宽度从 20% 调整为 30%
- [ ] 任务列表字体大小统一为 14px（与 Manus 一致）

## V14.9 左侧栏导航重构

- [x] 删除"小虾米监控"导航项（admin 仍可通过 /admin 路由访问）
- [x] 合并"消息"和"工作台"为"对话"（路由 /，首页即对话）
- [x] 删除底部退出登录按钮（顶部右上角已有）
- [x] 搜索图标移到顶部右上角（替换"新建任务"按钮位置）
- [x] "库"图标移到底部，紧靠设置图标右边
- [x] "新建任务"按钮移到"所有任务"标题下方
- [x] 左侧栏宽度从 240px 改为 360px（30%）
- [x] 双击任务标题进入编辑状态，Enter/失焦保存，Esc 取消
- [x] 字体大小统一为 14px（与 Manus 一致）

## AI 能力升级 v2.0（审核通过）

### Phase 1（本周）
- [x] P1-A：atlas.ts 新增 normalizeFieldNames() 字段标准化函数（同义词映射 + 缺失字段补 0）
- [x] P1-A：缺失字段容错后在 qualityIssues 中明确告知用户
- [x] P1-B：工资条快捷按钮在对话框内完成（不跳转 HR 页面）
- [x] P1-B：考勤快捷按钮在对话框内完成（不跳转 HR 页面）
- [x] P1-B：从文件名自动提取工资期间（2026年3月/202603/2026-03 等格式）

### Phase 2（下周）
- [x] P2-A：atlas.ts 新增 finance 场景，代码级借贷平衡校验
- [x] P2-B：引入 decimal.js 替换金额相关 Number 运算（消除浮点误差）
- [x] P2-C：hr.ts detectPayslipFields 扩展同义词（固定工资/月薪/KPI奖金等）
- [x] P2-D：hr.ts 考勤加班时长 + 加班费计算（可配置倍率）
- [x] P2-E：MainWorkspace 对话框上方常驻 HR 快捷按钮区（工资条/考勤入口）

## Phase 3 开发任务（审核通过）

### P0 紧急修复
- [ ] P0-A：考勤汇总格式兼容（detectAttendanceFields 新增 tableFormat + analyzeAttendanceSummary 函数）
- [ ] P0-B：异常高值预警（atlas.ts qualityIssues 接入 outliers 检测结果）
- [ ] P0-C：字段映射 UI 提示（后端返回 field_mapping，前端 MainWorkspace 展示提示块）

### P1 高优
- [ ] P1-A：同义词库扩展（电商平台专用字段词汇）
- [ ] P1-B：工资计算 Decimal 全覆盖（hr.ts generatePayslipExcel 税后工资/扣款）
- [x] P1-C：多文件合并接口（/api/atlas/merge）+ 前端文件名识别平台 + 确认弹框

### P2 次优
- [ ] P2：exceljs 迁移（工资条 → 验证 → 考勤 → atlas 报表，WPS 兼容）

## Phase 3 补充项（审核意见 2026-03-11）

### 回归测试边界数据场景（新增 vitest 用例）
- [x] 边界用例 1：上传含极端大数值的文件（工资字段值 99999999），验证 Decimal 计算不溢出、qualityIssues 正确触发异常高值预警
- [x] 边界用例 2：上传空文件或仅有表头无数据的文件，验证后端返回友好错误提示（非 500）、前端不崩溃
- [x] 边界用例 3：上传文件名含特殊字符的文件（如 淡宝#流水&2026.xlsx），验证文件名解析不抛异常、来源平台识别正常
- [x] 边界用例 4：上传文件名无明显平台关键词的文件（如 1月数据.xlsx），验证来源平台降级处理（回退为文件名去扩展名），弹框中可正常编辑

### Bug 3 异常高值预警 UI 优化（P0-B 迭代项）
- [x] 将 AI 回复中 qualityIssues 异常高值预警信息改为可点击的交互元素（带下划线 + 警告图标）
- [x] 点击后在对话框内展开「异常数据详情」视图：展示异常字段名、异常值、所在行号、建议阈值
- [x] 详情视图底部提供「忽略」和「查看完整数据」两个快捷操作按鈕

## Bug 排查（2026-03-11）

- [x] 排查：后端 outlier_details 字段是否正确包含在 /api/atlas/upload 响应 JSON 中
- [x] 排查：前端预警组件渲染条件是否正确读取 outlierDetails 字段
- [x] 修复：异常高值预警 UI 未显示问题（根因：进度定时器竞态覆盖，已添加 resultShown 标志修复）
- [x] 验证：用含极端值测试数据确认预警条和「查看详情」功能正常显示

## Phase 3 收尾开发（2026-03-11 测试反馈）

### 任务 1：修复多文件合并前端 Bug（最高优先级）
- [x] 1.1 修复多文件并发分析卡死（第二个文件进度卡在 30%，AI 响应内容丢失）
- [x] 1.2 修复快捷按鈕未显示（多文件上传后“多门店数据合并”按鈕不渲染）
- [x] 1.3 修复合并弹框未触发（合并意图未被拦截，直接交由 AI 处理）

### 任务 2：考勤汇总格式兼容（P0-A）
- [x] 补充 analyzeAttendanceSummary 完整处理分支（识别为 summary 格式后的后续逻辑）

### 任务 3：字段映射 UI 提示
- [x] 前端展示字段映射提示块（如“销售金额 → 总销售额”），消除黑盒感

### 任务 4：WPS 兼容性迁移（P2，工资条模块先行）
- [x] 安装 exceljs，迁移 generatePayslipExcel 使用 exceljs 生成工资条
- [x] 验证 WPS 打开格式正常（列宽、字体、边框）

## 异步处理模式（解决大文件超时）

- [x] 🔴 server/atlas.ts：upload 接收文件后立即返回 session_id（status=uploading），后台 setImmediate 异步执行解析+S3+AI
- [x] 🔴 server/atlas.ts：新增 GET /api/atlas/status/:sessionId 接口，返回处理状态和完整结果
- [x] 🔴 client/src/lib/api.ts：新增 pollUploadStatus 轮询函数（每2秒，超时5分钟）
- [x] 🔴 client/src/pages/MainWorkspace.tsx：processFile 改为上传后轮询，进度条显示"处理中"

## 分块上传（解决 Cloudflare 30s 传输超时）

- [x] 后端新增 POST /api/atlas/upload-chunk：接收 1MB 分块，收齐后触发后台处理
- [x] 前端 api.ts：新增 chunkedUpload（文件>5MB 切块上传）和 smartUpload（自动选择策略）
- [x] 前端 MainWorkspace.tsx：改用 smartUpload，大文件自动分块，小文件走原流程

## 前端解析方案（彻底解决大文件超时）

- [x] 前端 client/src/lib/parseFile.ts：浏览器本地解析 Excel/CSV（全量扫描统计 + 仅保留前500行预览）
- [x] 后端 server/atlas.ts：新增 POST /api/atlas/upload-parsed 端点（接收前端预解析 JSON，跳过服务端 XLSX 解析）
- [x] 前端 client/src/lib/api.ts：新增 uploadParsed 函数（POST JSON 到 /upload-parsed）
- [x] 前端 client/src/pages/MainWorkspace.tsx：processFile 改为先本地解析再发 JSON，移除 progressTimers/uploadPhaseTimer 残留引用
- [x] tsc 0 errors，vitest 104/104 全通过

## Bug 修复：前端解析方案数据不准确

- [x] 修复 /upload-parsed 端点：computeKeyMetrics 使用预览数据（500行）而非全量统计，导致“数据总行数”显示 500 而非真实 46906
- [x] 修复 AI 关键指标表：sum/avg/max/min 应来自前端传来的全量 fields 统计，而非 workingData 计算

## Bug 修复：AI 对话仍基于样本行求和（而非全量统计）

- [x] /upload-parsed 端点 AI prompt：全量统计摘要改为结构化键値输出（字段名: 数値，每行一条）
- [x] /upload-parsed 端点 AI prompt：样本行段前加说明“仅用于理解字段含义，禁止对样本求和得出总量”
- [x] /upload-parsed 端点 AI prompt：system prompt 补充规则“询问总量/合计/均値/最大/最小时，优先直接引用全量统计値，不得基于样本重新推算”
- [x] chat 端点 numericStats：改为优先使用 dfInfo.fields 中的全量统计（sum/avg/max/min），而非对 500 行 data 重新计算

## ATLAS V1.1 规范实现

### 第一批 P0+P1
- [x] 前端 parseFile：新增全量 top5 计算（每个数値字段取値最大的前5行，含行索引和値），存入 parsed.fields[].top5
- [x] 服务端 /upload-parsed：dfInfo.fields 持久化 top5 数据
- [x] 服务端 chat 端点：topPerformers 改用 dfInfo.fields 中的全量 top5，无全量 top5 时不展示排名
- [x] 金额类指标统一双单位格式：computeKeyMetrics 返回値改为 "202.50 万 (2,024,968 元)" 格式
- [x] 指标卡渲染：AtlasTableRenderer 支持 source 字段，底部显示数据来源提示
- [x] 指标卡新增数据来源提示：fallbackTable 和 AI 生成的 atlas-table 均包含 source 字段
- [x] AI prompt 中的数値格式也改为双单位（dataset_profile 中的金额字段）

### 第二批 P2
- [x] chat 端点 prompt：统计摘要段命名改为 dataset_profile，样本行段命名改为 sample_rows
- [x] /upload-parsed 端点 prompt：同步命名规范

## TopN 聚合排名（方案 C）

- [x] 前端 parseFile：识别分组字段（关键词：达人/昵称/姓名/店铺/商品/SKU/品牌），计算 groupedTop5（GROUP BY + SUM，含来源文件名）
- [x] 服务端 /upload-parsed：FrontendParsedField/FieldInfo 接口新增 groupedTop5/groupByField 字段，持久化到 dfInfo
- [x] 服务端 chat 端点：单文件使用 dfInfo 中的 groupedTop5；多文件时 UNION 各文件 groupedTop5 后重新聚合取 TOP5
- [x] 无可靠分组字段时不展示排名（空数组），不返回错误排名
- [x] 多文件 UNION 重新聚合（同名 label 跨文件累加）， statsContext 显示分组维度字段名

## 多文件统计链路修复（执行指令 2026-03-11）

- [x] 任务 A：chat 端进入多文件统计前打印每个文件的 fileId/fileName/rowCount/字段存在性/groupedTop5字段/preview.length
- [x] 任务 B：chat 端硬校验，请求多文件但实际有效 session < 2 时直接报错，禁止降级
- [x] 任务 C：每个文件独立构建 perFileProfile（独立加载 dfInfo + S3 data + numericStats + groupedTop5Map），禁止复用第一个文件数据
- [x] 任务 D：多文件时断言 fileIds 互不相同，不满足则返回 500 错误
- [x] 任务 E：多文件时 system prompt 为每个文件独立输出 dataset_profile[序号] 段，包含 source_file_id/source_file_name/source_row_count/全量统计摘要/sample_rows，并输出跨文件汇总段

## 口径 B 统一（全链路保留原始精确值，2位小数展示）

- [x] chat 端点 numericStats：去掉 Math.round(sum) 和 Math.round(avg)，保留原始浮点値
- [x] statsContext 中 sum/avg/max/min 展示改为 toFixed(2)
- [x] 多文件 statsLines 和跨文件汇总 total 展示改为 toFixed(2)
- [x] computeKeyMetrics 中 fmtAmount 的 yuanStr 去掉 Math.round(n)，改为 n.toFixed(2) 保留 2 位小数

## Bug 修复（V14.1）

- [x] 修复首次打开页面发送消息失败：handleSend 在 activeTaskId 为 null 时自动调用 createNewTask() 并延迟 50ms 重试，确保消息有任务可挂载

## 数据准确性修复（V14.2）

- [x] 强规则：服务端检查所有文件字段，只有真实存在"达人昵称/昵称/主播/达人"字段时才允许按达人分组；否则直接返回"当前文件不包含达人相关字段，无法按达人昵称分组统计"，禁止从商品名/店铺名推断
- [x] 修复 parseFile.ts 字段识别优先级（达人 > 昵称 > 姓名 > 店铺 > 商品）
- [x] 修复 groupedTopN 从 5 改为 20，支持 Top10/Top20

## 数据准确性修复（V14.2）

- [x] 修复 detectGroupByField：先过滤（类型为 text + 名称不含金额关键词）再排序再返回，禁止回退到店铺/商品名，无合格达人字段时返回 null

## 页面表现优化（数据核查后续）

- [x] P0: 榜单真正过滤无效值（前端 computeGroupedTopN + 服务端 serverComputeGroupedTopN + chat unionMap 三处同步修复）
- [x] P1: 修复排名序号乱序（system prompt 强制连续编号规则）
- [x] P2: 修正 AI 文案（system prompt 禁止描述已被过滤的无效值）

## 多文件达人排名修复

- [ ] P0: 多文件 Top10 真正合并所有文件达人数据（修复 UNION 逻辑）
- [ ] P1: 消除店铺名/文件名冒充达人昵称入榜（空值率极高的文件跳过达人分组）

## V14.4 分类字段全量预计算（P0 修复）

- [x] parseFile.ts：添加 computeCategoryStats 函数，对所有分类字段（省份/支付方式/城市/状态等）做全量预计算（count + sum + avg），结果存入 ParsedFileData.categoryGroupedTop20
- [x] atlas.ts FieldInfo/DataFrameInfo 接口：添加 categoryGroupedTop20 字段定义
- [x] atlas.ts upload-parsed 端点：透传前端 categoryGroupedTop20 到 dfInfo JSON 列
- [x] atlas.ts 多文件字段列表注入修复：从 slice(0,8) 改为全量字段（修复多文件场景字段截断问题）
- [x] atlas.ts 单文件 prompt 注入：添加 categoryStatsContext，基于全量数据注入分类字段统计
- [x] atlas.ts 多文件 prompt 注入：每个 dataset_profile[N] 段注入 pfpCategoryStatsContext
- [x] atlas.ts 多文件跨文件合并：添加 crossFileCategorySection，UNION 所有文件的分类字段统计

## V14.5 全链路修复（P0+P1）

- [x] 修复A+B：prompt 注入从 top10 改为全量50条，增加总计校验行约束（单文件+多文件+跨文件）
- [x] 修复C：前端展示层支持展开全部，AI 输出规则允许分类统计全量行（最多50行）
- [x] 修复D：系统预计算 fullRows 注入前端状态，导出从真实数据源取数（不从 AI 返回结果导出）
- [x] 修复E：单文件+多文件达人 Top 只保留一个核心金额字段，禁止双列金额
- [x] TypeScript 编译 0 errors 验证通过

## V3.0 方案落地 — A 阶段（定规矩）

- [x] A1：字段映射表（shared/fieldAliases.ts）— 30 标准字段 × 4 平台
- [x] A2：统计口径定义（shared/metrics.ts）— 10 个核心口径精确计算规则
- [x] A3：ResultSet 类型定义（shared/resultSet.ts）— 含 8 个可审计字段
- [x] A4：处理管道数据结构定义（shared/pipeline.ts）— 9 步输入输出接口 + 错误分级
- [x] A5：AI 表达边界规则（shared/aiConstraints.ts）— 结构化规则 + prompt 硬约束
- [x] A6：L1 模板计算公式定义（shared/templates.ts）— 多店合并/工资条/考勤/利润
- [x] A7：数据库 schema 更新 — ResultSet 存储表 + pnpm db:push
- [x] A8：单元测试 — 字段映射/口径计算/ResultSet 验证
