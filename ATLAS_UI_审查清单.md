# ATLAS V3.0 — 现有 UI 板块审查清单

> 审查范围：`client/src/` 下全部页面（pages）、组件（components）、上下文（contexts）、工具库（lib）、样式（index.css）、后端路由与数据库表。
> 判定标准：以 V3.0 最终方案的首发范围为基准——**工作台（对话+右侧分析面板）、模板库、设置、库**四大板块。

---

## 一、页面级组件（pages/）

共 17 个页面文件，逐个判定如下：

| 文件 | 当前功能 | V3.0 判定 | 说明 |
|------|----------|-----------|------|
| `MainWorkspace.tsx` | 核心对话工作台：拖拽上传、AI 对话流、表格预览、下载 | **保留，重构** | V3.0 核心。需拆分为左侧对话 + 右侧分析面板的双栏结构，对话区只做文字解释，图表/指标卡移到右侧面板。流式对话、文件上传、建议动作等逻辑 80% 可复用。 |
| `DashboardPage.tsx` | 数据中枢：多店铺 GMV、趋势图、平台卡片 | **保留，降级为占位** | V3.0 首发不做看板，但保留导航入口。页面改为「即将上线」占位页，现有 Recharts 图表代码留着，V2.5 看板阶段直接复用。 |
| `TemplatesPage.tsx` | 模板库：内置模板浏览、自定义创建、AI 生成、置顶 | **保留，重构** | V3.0 首发核心板块。需要对接后端模板 CRUD（目前内置模板是硬编码的 `BUILTIN_TEMPLATES` 数组），增加 L1/L2 分级标识，模板卡片 UI 可复用。 |
| `SettingsPage.tsx` | 设置：账户、个性化、API Key、平台授权、邮箱、定时任务 | **保留，精简** | 首发只保留「账户」和「个性化」两个 tab。API Key 管理、平台授权、定时任务等 tab 隐藏（代码不删，注释掉或条件渲染），等 V2.5 开放。 |
| `SearchPage.tsx` | 搜索：会话 + 报表全局搜索 | **保留，原样** | 已接入 tRPC，功能完整，V3.0 直接用。 |
| `LibraryPage.tsx` | 库：会话文件管理 + 报表归档，双 tab | **保留，原样** | 已接入 tRPC，功能完整，V3.0 直接用。 |
| `HRCenterPage.tsx` | HR 中心入口：工资条 + 考勤两个卡片 | **保留，原样** | V3.0 首发包含 HR 模板（工资条、考勤），此入口页保留。 |
| `PayslipPage.tsx` | 工资条制作：上传→字段映射→生成→下载 | **保留，原样** | 核心 HR 功能，V3.0 首发范围内。 |
| `AttendancePage.tsx` | 考勤汇总：上传→字段识别→分析→下载 | **保留，原样** | 核心 HR 功能，V3.0 首发范围内。 |
| `InvitePage.tsx` | 邀请好友：生成海报、复制链接、积分奖励 | **砍掉（隐藏）** | V3.0 首发不做邀请/积分体系。从 Sidebar 导航中移除入口，文件保留不删，等后续版本启用。 |
| `IMPage.tsx` | IM 即时通讯：联系人列表、WebSocket 消息 | **砍掉（隐藏）** | V3.0 首发 IM 助手只做预留。当前 IMPage 是完整的 IM 客户端，首发不挂路由，文件保留。 |
| `OpenClawMonitor.tsx` | 小虾米质量监控面板（admin only） | **保留，原样** | admin 专用运维工具，不影响用户侧，保留。 |
| `ReportsPage.tsx` | 报表中心：列表、下载、预览、删除 | **复用到 Library** | 功能与 LibraryPage 的「报表」tab 高度重叠。V3.0 统一用 LibraryPage，ReportsPage 不再单独挂路由，但代码保留备用。 |
| `HistoryPage.tsx` | 历史记录（早期版本） | **砍掉** | 已被 LibraryPage 完全替代，V3.0 不再使用。可安全删除。 |
| `Home.tsx` | 模板默认首页（scaffold 示例） | **砍掉** | 这是脚手架自带的示例页面，从未实际使用（App.tsx 默认走 MainWorkspace）。可安全删除。 |
| `ComponentShowcase.tsx` | 组件展示页（开发调试用） | **砍掉** | 开发阶段调试用，生产环境不需要。可安全删除。 |
| `NotFound.tsx` | 404 页面 | **保留，原样** | 基础设施，保留。 |

---

## 二、组件（components/）

共 11 个组件文件：

| 文件 | 当前功能 | V3.0 判定 | 说明 |
|------|----------|-----------|------|
| `Sidebar.tsx` | 左侧导航栏：导航按钮 + 任务列表 + 搜索/重命名/删除 | **保留，调整导航项** | 核心骨架。需移除 `invite` 导航项，其余（home/dashboard/hr/templates + 底部 library/settings）保留。任务列表逻辑完整可复用。 |
| `TopBar.tsx` | 顶栏：面包屑 + 搜索 + 通知 + 用户菜单 | **保留，原样** | 核心骨架，功能完整。 |
| `LoginModal.tsx` | 登录/注册弹窗 | **保留，原样** | 已接入 tRPC auth，功能完整。 |
| `ErrorBoundary.tsx` | React 错误边界 | **保留，原样** | 基础设施。 |
| `AtlasTableRenderer.tsx` | AI 返回的表格渲染 + 排序 + 导出 Excel | **保留，重构位置** | V3.0 中此组件从对话气泡内移到右侧分析面板中渲染。组件本身的排序、导出、折叠逻辑 100% 复用，只是挂载位置变了。 |
| `Markdown.tsx` | Markdown 渲染（模板预置） | **保留，原样** | 对话区 AI 回复渲染依赖此组件。 |
| `AIChatBox.tsx` | 通用 AI 聊天组件（模板预置） | **不使用** | ATLAS 有自己的 MainWorkspace 对话实现，此模板预置组件未被引用，不需要。 |
| `DashboardLayout.tsx` | 通用仪表板布局（模板预置） | **不使用** | ATLAS 用自己的 Sidebar + TopBar 布局，不使用此模板组件。 |
| `DashboardLayoutSkeleton.tsx` | 仪表板加载骨架（模板预置） | **不使用** | 同上，不使用。 |
| `ManusDialog.tsx` | Manus 风格对话框（模板预置） | **可选复用** | 如果需要弹窗可以用，但目前 ATLAS 自己写了弹窗样式，优先级低。 |
| `Map.tsx` | Google Maps 集成（模板预置） | **不使用** | ATLAS 不需要地图功能。 |

---

## 三、上下文与 Hooks

| 文件 | 当前功能 | V3.0 判定 | 说明 |
|------|----------|-----------|------|
| `contexts/AtlasContext.tsx` | 全局状态：导航、主题、任务列表、消息、文件、用户 | **保留，重构** | 核心状态管理。V3.0 需增加右侧面板状态（当前分析结果、图表数据），移除 `invite` 相关的 NavItem。类型定义（Message、UploadedFile、TableSheet 等）大部分复用。 |
| `contexts/ThemeContext.tsx` | 主题切换 | **保留，原样** | 支持 dark/light 切换，保留。 |
| `hooks/useComposition.ts` | 输入法组合状态 | **保留，原样** | 对话输入框依赖。 |
| `hooks/useFileUpload.ts` | 文件上传 hook（模板预置） | **可选复用** | ATLAS 的文件上传逻辑在 MainWorkspace 内部实现，此 hook 可作为重构时的替代方案。 |
| `hooks/useMobile.tsx` | 移动端检测 | **保留，原样** | 响应式布局依赖。 |
| `hooks/usePersistFn.ts` | 持久化函数引用 | **保留，原样** | 工具函数。 |
| `_core/hooks/useAuth.ts` | 认证状态 hook（模板预置） | **保留，原样** | SearchPage 等已在使用。 |

---

## 四、工具库（lib/）

| 文件 | 当前功能 | V3.0 判定 | 说明 |
|------|----------|-----------|------|
| `lib/api.ts` | REST API 客户端：upload、chat、generate-report、download | **保留，重构** | 核心 API 层。V3.0 需增加右侧面板数据获取接口，chat 流式接口保留。部分接口可能迁移到 tRPC procedure。 |
| `lib/parseFile.ts` | 前端本地 Excel/CSV 解析 + SPU 标准化 + 统计计算 | **保留，重构** | 核心数据处理。SPU_MAPPING 硬编码需要改为可配置（V2.5），但首发先保留现有逻辑。全量统计、分类统计等逻辑 100% 复用。 |
| `lib/trpc.ts` | tRPC 客户端绑定 | **保留，原样** | 基础设施。 |
| `lib/utils.ts` | 通用工具函数 | **保留，原样** | 基础设施。 |

---

## 五、样式系统（index.css）

| 部分 | V3.0 判定 | 说明 |
|------|-----------|------|
| ATLAS 自定义 CSS 变量（`--atlas-*`） | **保留，原样** | dark/light 双主题的完整 token 体系，V3.0 继续使用。 |
| shadcn 兼容变量（`--background` 等 OKLCH） | **保留，原样** | shadcn/ui 组件依赖。 |
| `.atlas-chip`、滚动条、侧栏动画等 | **保留，原样** | 全局样式组件。 |
| 主题过渡动画 | **保留，原样** | 用户体验细节。 |

---

## 六、后端文件（server/）

| 文件 | V3.0 判定 | 说明 |
|------|-----------|------|
| `atlas.ts` | **保留，核心** | 上传、对话、报表生成的主路由，V3.0 全部复用。 |
| `routers.ts` | **保留，核心** | tRPC 路由：auth、session、report、search、invite、feedback。移除 invite 相关 procedure 的前端调用即可。 |
| `db.ts` | **保留，核心** | 数据库查询层，所有 CRUD 操作。 |
| `hr.ts` | **保留** | 工资条 + 考勤后端逻辑。 |
| `openclaw.ts` / `openclawIM.ts` | **保留** | 小虾米集成，V3.0 继续运行。 |
| `im/wsServer.ts` / `im/aiReply.ts` | **保留，降级** | IM WebSocket 服务。首发不暴露 IM 前端入口，但后端保持运行（小虾米依赖）。 |
| `scheduler.ts` | **保留，降级** | 定时任务引擎。首发不暴露前端入口，后端保持运行。 |
| `botRouter.ts` / `routers/bots.ts` | **保留** | 机器人系统，admin 功能。 |
| `routers/admin.ts` | **保留** | 管理后台 API。 |
| `adminApi.ts` | **保留** | 外部 API Key 鉴权。 |
| `xlsxWorker.ts` | **保留** | Excel 生成 Worker 线程。 |

---

## 七、数据库表（drizzle/schema.ts）

共 15 张表，判定如下：

| 表名 | V3.0 判定 | 说明 |
|------|-----------|------|
| `users` | **保留** | 核心用户表。 |
| `sessions` | **保留** | 文件上传会话。 |
| `reports` | **保留** | 报表记录。 |
| `scheduled_tasks` | **保留，首发不用** | 定时任务表，后端保留，前端入口隐藏。 |
| `invite_records` | **保留，首发不用** | 邀请记录，前端入口隐藏。 |
| `report_feedback` | **保留** | 报表评分/自学习。 |
| `message_feedback` | **保留** | 消息级反馈。 |
| `hr_payslip_records` | **保留** | 工资条记录。 |
| `hr_attendance_sessions` | **保留** | 考勤记录。 |
| `openclaw_tasks` | **保留** | 小虾米任务队列。 |
| `admin_api_keys` | **保留** | API Key 管理。 |
| `im_conversations` | **保留，首发不用** | IM 会话。 |
| `im_participants` | **保留，首发不用** | IM 参与者。 |
| `im_messages` | **保留，首发不用** | IM 消息。 |
| `personal_templates` | **保留** | 个人模板。 |
| `chat_conversations` | **保留** | 对话持久化。 |
| `chat_messages` | **保留** | 对话消息持久化。 |
| `bots` / `bot_messages` | **保留** | 机器人系统。 |

---

## 八、UI 组件库（components/ui/）

53 个 shadcn/ui 组件全部**保留，不动**。这是基础 UI 库，V3.0 各页面都会用到。

---

## 九、总结

### 需要动的（4 个重点）

1. **MainWorkspace.tsx** — 最大改动。拆成对话区 + 右侧分析面板双栏，图表/表格从气泡移到右侧。
2. **AtlasContext.tsx** — 增加右侧面板状态，移除 invite 导航项。
3. **Sidebar.tsx** — 移除 invite 导航入口。
4. **TemplatesPage.tsx** — 对接后端模板 CRUD，增加 L1/L2 分级。

### 直接能用的（不用改）

SearchPage、LibraryPage、HRCenterPage、PayslipPage、AttendancePage、TopBar、LoginModal、ErrorBoundary、Markdown、所有 hooks、所有 lib、全部 CSS 变量、全部 shadcn/ui 组件、全部后端路由、全部数据库表。

### 隐藏不删的（3 个）

InvitePage、IMPage、ReportsPage — 从导航中移除入口，代码保留，后续版本启用。

### 可以安全删除的（3 个）

HistoryPage、Home.tsx（scaffold 示例）、ComponentShowcase.tsx — 已被替代或从未使用。
