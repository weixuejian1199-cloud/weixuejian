# 企业 AI 工作站 · Claude Code 项目指引

> 本文件是 Claude Code 每次新会话的自动入口。启动时先读这个文件，再按指引操作。
> v2.3 · 2026-03-30

## 项目概述

企业级 AI 操作系统（SaaS），用对话替代所有操作。核心价值不是替代单个系统的功能深度，而是用 AI 把多个系统串起来——老板一句话完成原来需要打开 5 个系统才能干的事。

关键架构决策：
- 时皙Life商城与工作站深度合并（ADR-022），同一个后端、同一个数据库
- Phase 1 数据来源：ztdy-open 商城 API（真实数据）为主 + 用户上传为辅（ADR-024）
- ACI 客服中枢：决策中枢定位，Phase 1 只验证退货审核判断能力（ADR-025）
- 9人团队全面审查10项优化（ADR-030）：双飞书提前/多租户简化/技术Spike/AI幻觉防护/供应商对账删除

## 新会话启动协议（必须执行）

**核心原则：读 brain.json 的 projectBrief 就能理解全貌，不需要打开其他文档。**

```
1. 读 docs/brain.json 的 projectBrief 段落     # 理解项目全貌（必读）
2. 读 docs/brain.json 的 activeTasks           # 确认当前任务
3. 读 docs/claude-progress.txt（如果存在）       # 上一个会话做到哪了
4. git log --oneline -10                        # 看最近提交
5. 运行现有测试                                  # 确认基线无回归
6. 开始工作（每个会话只做一个US）
```

**按需深读（遇到对应任务时才读）：**
- 数据模型问题 → `docs/01-企业AI工作站-主文档.md` 第六节
- 架构/Agent 设计 → `docs/05-全局能力架构.md`
- Agent 编排细节 → `docs/02-企业AI工作站-Agent编排.md`
- ERP/商城适配器 → `docs/03-企业AI工作站-ERP统一接口.md`
- 团队协作/规则 → `docs/04-企业工作站-研发有机体Agent团队.md`
- 部署/运维 → `docs/06-环境与部署规划.md`
- UI/前端设计 → `docs/07-UI设计规范.md`

## 会话结束协议（必须执行）

```
1. git add + git commit（每个AC完成就提交）
2. 更新 docs/claude-progress.txt（完成了什么/遗留什么/下一步）
3. 更新 brain.json 的 AC 状态
```

## 关键规则

- **RULE-14**: 每个会话只处理一个 US，不跨 US 工作
- **RULE-15**: 每完成一个 AC 就 git commit
- **RULE-17**: 砍功能比加功能重要——不在当前 Phase scope 内的需求，记入 Backlog
- **RULE-02**: 最小改动原则，只改必需的
- **RULE-03**: 双重 Critic 审查，方案+代码都要审
- 所有数据库查询必须带 tenantId
- 错误码使用 brain.json 中的 errorCodes 注册表
- API 响应遵循统一格式 `{ success, data, error?, requestId }`
- 方案先行——宁慢勿糙，方案不清晰不开工

## 技术栈

Node.js 20+ / TypeScript strict / Express 4 / Prisma 6 / PostgreSQL 15 / Redis 7 / Taro 4 / Vitest / pnpm 10 / Docker

## 双引擎双飞书（系统最核心能力）

- **飞书号1 → Claude Code**（最强大脑）：部署在阿里云服务器tmux，通过Bridge API飞书可达。开发迭代、架构决策、复杂分析、一切。创始人不需要守电脑。
- **飞书号2 → OpenClaw**（日常大脑）：百炼Qwen驱动，已在Qiyao跑通飞书。查数据、管运营、客服判断、报表。处理90%日常操作。
- 两者并列缺一不可。Claude Code > OpenClaw（能力层面），简单的事走OpenClaw（低成本），重要的事走Claude Code。

## Phase 1 数据策略

- **主数据源**：MallAdapter（ztdy-open API）— 146万用户/95万订单/8466商品的真实数据
- **辅数据源**：Excel/CSV 上传 — 覆盖无 API 权限的租户/岗位
- Phase 1 商品/订单数据从 API 实时读取，不落本地库
- Phase 2 自建商城后 MallAdapter 退役，切换为同库直查

## 完整文档目录

```
docs/
├── brain.json                    # 项目大脑 v2.3（projectBrief/任务/ADR/错误码/会话协议）
├── claude-progress.txt           # 进度接力（开发后才有）
├── 01-企业AI工作站-主文档.md      # 数据模型、权限、安全（数据模型权威源）
├── 02-企业AI工作站-Agent编排.md   # AI Agent 架构 + ACI客服中枢
├── 03-企业AI工作站-ERP统一接口.md # ERP/商城适配层（含MallAdapter）
├── 04-企业工作站-研发有机体Agent团队.md  # 9人团队、会话协议、17条规则
├── 05-全局能力架构.md             # 全局蓝图、产品能力（能力权威源）
├── 06-环境与部署规划.md           # 阿里云资源、Docker、CI/CD
└── 07-UI设计规范.md              # 视觉语言、组件、页面设计
```
