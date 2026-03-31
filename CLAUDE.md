# 企业 AI 工作站 · Claude Code 项目指引

> 本文件是 Claude Code 每次新会话的自动入口。启动时先读这个文件，再按指引操作。
> v2.7 · 2026-03-31
> 设计理念参考：Anthropic "Effective Harnesses for Long-Running Agents" — 把规则变成门禁，把清单变成脚本

## 项目概述

企业级 AI 操作系统（SaaS），用对话替代所有操作。核心价值不是替代单个系统的功能深度，而是用 AI 把多个系统串起来——老板一句话完成原来需要打开 5 个系统才能干的事。

关键架构决策：
- 时皙Life商城与工作站深度合并（ADR-022），同一个后端、同一个数据库
- Phase 1 数据来源：ztdy-open 商城 API（真实数据）为主 + 用户上传为辅（ADR-024）
- ACI 客服中枢：决策中枢定位，Phase 1 只验证退货审核判断能力（ADR-025）
- 9人团队全面审查10项优化（ADR-030）：双飞书提前/多租户简化/技术Spike/AI幻觉防护/供应商对账删除
- v2.4全面审查补强（US-P1a-010）：安全中间件套件/Schema 21张表/35测试/文档充血5份
- v2.5安全基线重构（US-P1a-011）：fail-secure原则/错误码注册表/env完整覆盖/Schema对齐brain.json
- v2.6系统审计（CTO审计）：3个P0 bug修复/sendError自动查表/175→201测试/文档全量同步/Memory清理/团队Agent升级
- v2.7会话门禁系统（Anthropic Harness）：session-guard.ts门禁脚本/启动-提交-结束三道门/RULE-21~24/纠错机制从清单升级为脚本

## 新会话启动协议（门禁，非清单）

**核心原则：读 brain.json 的 projectBrief 就能理解全貌，不需要打开其他文档。**
**设计原则：参照 Anthropic Harness — 不是"你应该做"，而是"不做就不能继续"。**

```
1. 读 docs/brain.json 的 projectBrief 段落     # 理解项目全貌（必读）
2. 读 docs/brain.json 的 activeTasks           # 确认当前任务
3. 读 docs/claude-progress.txt（如果存在）       # 上一个会话做到哪了
4. git log --oneline -10                        # 看最近提交
5. 运行 npx tsx scripts/session-guard.ts start  # ⛔ 门禁：测试+编译必须全绿
6. 开始工作（每个会话只做一个US）
```

**⛔ 第 5 步是门禁不是建议。session-guard.ts 会自动验证：**
- brain.json 结构完整
- 测试基线全绿（一个失败就不允许开工）
- TypeScript 编译零错误
- 工作目录干净（如不干净会警告）

**按需深读（遇到对应任务时才读）：**
- 数据模型问题 → `docs/01-企业AI工作站-主文档.md` 第六节
- 架构/Agent 设计 → `docs/05-全局能力架构.md`
- Agent 编排细节 → `docs/02-企业AI工作站-Agent编排.md`
- ERP/商城适配器 → `docs/03-企业AI工作站-ERP统一接口.md`
- 团队协作/规则 → `docs/04-企业工作站-研发有机体Agent团队.md`
- 部署/运维 → `docs/06-环境与部署规划.md`
- UI/前端设计 → `docs/07-UI设计规范.md`
- 前后端接口契约 → `docs/08-前后端接口契约.md`

## 会话结束协议（门禁，非清单）

```
1. git add + git commit（每个AC完成就提交）
2. 更新 docs/claude-progress.txt（完成了什么/遗留什么/下一步）
3. 更新 brain.json 的 AC 状态（status: "done"）
4. 运行 npx tsx scripts/session-guard.ts end   # ⛔ 门禁：验证三源一致
```

**⛔ 第 4 步是门禁。session-guard.ts 会自动验证：**
- progress.txt 是否更新
- brain.json 是否有遗留 in-progress 任务
- 测试是否仍然全绿
- 是否有未提交的修改

## 提交前检查（自动门禁）

每次 git commit 前运行 `npx tsx scripts/session-guard.ts commit`：
- **RULE-21**: 禁止删除测试文件（测试只增不减）
- **RULE-22**: 禁止 `as unknown as Record` 类型绕过（用正确类型）
- **RULE-23**: 禁止直接 `process.env[`（走 env.ts Zod schema）
- **ADR 影响扩散**: 删除/变更功能时运行 `session-guard.ts adr-impact <关键词>` 扫描全文档

## 关键规则

- **RULE-14**: 每个会话只处理一个 US，不跨 US 工作
- **RULE-15**: 每完成一个 AC 就 git commit
- **RULE-17**: 砍功能比加功能重要——不在当前 Phase scope 内的需求，记入 Backlog
- **RULE-02**: 最小改动原则，只改必需的
- **RULE-03**: 双重 Critic 审查，方案+代码都要审
- 所有数据库查询必须带 tenantId
- 错误码使用 brain.json 中的 errorCodes 注册表
- API 响应遵循统一格式 `{ success, data, error?, requestId }`
- **RULE-18**: P0 Hotfix 例外——生产事故可跨 US 紧急修复，事后补 AC 记录
- **RULE-19**: fail-secure 原则——外部依赖不可用（Redis/DB等）= 拒绝请求（503），绝不降级放行。安全问题Critic只能REJECT不可CONDITIONAL
- **RULE-20**: 项目初期不接受补丁，发现问题必须重构，补丁=技术债累积=系统不可维护
- **RULE-21**: 测试只增不减——禁止删除测试文件，修改测试必须有正当理由（session-guard 自动拦截）
- **RULE-22**: 禁止类型绕过——不允许 `as unknown as Record`，用正确的类型定义（session-guard 自动拦截）
- **RULE-23**: 环境变量集中管理——禁止直接 `process.env[`，必须走 lib/env.ts 的 Zod schema（session-guard 警告）
- **RULE-24**: ADR 影响扩散——任何架构决策（增删功能/改部署/改策略）必须 grep 全文档扫描影响范围，不清理不提交
- 方案先行——宁慢勿糙，方案不清晰不开工

## 技术栈

Node.js 20+ / TypeScript strict / Express 4 / Prisma 6 / PostgreSQL 15 / Redis 7 / Taro 4 / Vitest / pnpm 10 / Docker

## 双引擎双飞书（系统最核心能力）

- **飞书号1「启元」→ Claude Code**（最强大脑）：Mac本地Bridge，通过飞书WebSocket长连接可达。开发迭代、架构决策、复杂分析、一切。创始人不需要守电脑。
- **飞书号2 → AI对话引擎**（日常大脑）：通义千问驱动，已验证飞书集成。查数据、管运营、客服判断、报表。处理90%日常操作。
- 两者并列缺一不可。Claude Code > AI对话引擎（能力层面），简单的事走AI对话引擎（低成本），重要的事走Claude Code。

## Phase 1 数据策略

- **主数据源**：MallAdapter（ztdy-open API）— 146万用户/95万订单/8466商品的真实数据
- **辅数据源**：Excel/CSV 上传 — 覆盖无 API 权限的租户/岗位
- Phase 1 商品/订单数据从 API 实时读取，不落本地库
- 聚合查询使用预计算缓存（每小时增量/每日全量），避免实时遍历API
- Phase 2 自建商城后 MallAdapter 退役，切换为同库直查

## 完整文档目录

```
docs/
├── brain.json                    # 项目大脑 v2.6（projectBrief/任务/ADR/错误码/会话协议）
├── claude-progress.txt           # 进度接力（开发后才有）
├── 01-企业AI工作站-主文档.md      # 数据模型、权限、安全（数据模型权威源）
├── 02-企业AI工作站-Agent编排.md   # AI Agent 架构 + ACI客服中枢
├── 03-企业AI工作站-ERP统一接口.md # ERP/商城适配层（含MallAdapter）
├── 04-企业工作站-研发有机体Agent团队.md  # 9人团队、会话协议、17条规则
├── 05-全局能力架构.md             # 全局蓝图、产品能力（能力权威源）
├── 06-环境与部署规划.md           # 阿里云资源、Docker、CI/CD
├── 07-UI设计规范.md              # 视觉语言、组件、页面设计
└── 08-前后端接口契约.md          # 12种AI消息类型 + 17个API端点 + 41错误码
```
