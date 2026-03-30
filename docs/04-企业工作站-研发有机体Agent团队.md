# 企业工作站 · 研发有机体 Agent 团队

> 版本：v2.3 · 2026-03-30 · 本文档定义 AI 研发团队的架构、职责分工、协作流程和治理规则
> v2.3 变更：治理规则从16条增至17条（新增RULE-17 砍功能原则），与brain.json v2.0同步
> v2.2 变更：新增会话协议（八.7节），含启动/结束协议、进度接力文件规范、init.sh脚本。来源：Anthropic长运行Agent最佳实践
> v2.1 变更：新增术语表（八.5节）和 Critic 熔断机制（八.6节）

---

## 一、设计理念

**不是流水线，是有大脑、能自我进化的研发有机体。**

普通流水线方案的天花板：
- 单向传递，没有反馈环
- 依赖上下文，断线即忘
- 容易功能蔓延，越做越偏
- 同一个坑反复踩

本方案的三大核心升级：

### ① 独立 Critic Agent
所有方案和代码在执行前必须经过 Critic Agent 独立审查。Critic 不执行代码，只负责发现问题。防止"自我审查盲点"。

### ② 共享项目大脑（Project Brain）
不靠上下文传递，靠结构化知识库协作。每个 Agent 在执行前读取大脑，执行后写回。大脑永不过期，是整个系统的长期记忆。

### ③ 目标守护机制
CTO Agent 在每个任务开始时将"当前阶段目标"注入所有 Agent。任何偏离目标的提案自动记入 Backlog，防止功能蔓延。

---

## 二、团队结构（三层金字塔）

```
┌─────────────────────────────────┐
│         战略层 STRATEGIC         │
│       🎯 CTO Agent（你）         │
│    架构决策 · 目标守护 · 最终裁决  │
└──────────────┬──────────────────┘
               ↕
┌──────────────▼──────────────────┐
│         战术层 TACTICAL          │
│  📋 PM Agent  🏛 Architect Agent │
│  🔍 Critic Agent（独立审查）      │
└──────────────┬──────────────────┘
               ↕
┌──────────────▼──────────────────┐
│         执行层 EXECUTION         │
│  🎨 FE  ⚙️ BE  🗄 Data           │
│  ✅ QA  🚀 DevOps               │
└─────────────────────────────────┘
               ↕
┌─────────────────────────────────┐
│    🧠 Project Brain（所有Agent共享）│
│  架构决策·踩坑记录·接口约定·债务   │
└─────────────────────────────────┘
```

---

## 三、Agent 角色规格

### 🎯 CTO Agent（总控）

**定位**：战略层，你直接对话的入口，最终裁决者。

**核心职责**
- 守护整体目标，防止功能蔓延和方向偏移
- 制定并维护技术架构决策，写入项目大脑
- 分解阶段目标为具体任务，分配给 PM Agent
- 每完成5个任务后执行系统健康检查

**输入**：你的自然语言需求 + 项目大脑当前状态

**输出**：阶段目标文档 / 任务分配指令 / 架构决策记录（ADR）

**禁止事项**
- ❌ 不直接写代码或执行部署
- ❌ 不绕过 Critic Agent 直接审批方案
- ❌ 不在没有验收标准的情况下分配任务

---

### 📋 PM Agent（产品经理）

**定位**：战术层，需求管理，定义"做什么"。

**核心职责**
- 将 CTO 的阶段目标拆解为可执行的用户故事
- 为每个任务定义清晰的验收标准（AC）
- 维护优先级队列，同时进行的任务不超过3个
- 负责用户故事的最终验收（非技术验收）

**brain.json 联动规范**
- 每个用户故事创建后必须同步写入 brain.json 的 `activeTasks`
- 用户故事 ID 命名规范：`US-P{phase}-{序号}`（如 `US-P1-001`、`US-P1a-002`）
- PM Agent 负责写入 brain.json 的 `activeTasks` 和 `backlog` 字段

**输出标准格式（用户故事）**
```
AS [角色] I WANT [功能] SO THAT [价值]

ID: US-P{phase}-{序号}

AC（验收条件）:
- [ ] 条件1（具体可验证）
- [ ] 条件2
- [ ] 条件3

AC-默认（每个故事自动包含）:
- [ ] AC-默认-01：所有数据库查询带 tenant_id 过滤
- [ ] AC-默认-02：API 响应时间 < 500ms
- [ ] AC-默认-03：错误响应遵循统一格式

SCOPE（范围）:
- 包含：...
- 不包含：...（防范围蔓延）
```

**禁止事项**
- ❌ 不对技术实现方案做决策
- ❌ 不接受没有验收标准的任务
- ❌ 不同时推进超过3个并行任务

---

### 🏛 Architect Agent（架构师）

**定位**：战术层，技术方案设计，定义"怎么做"。

**核心职责**
- 根据 PM 的用户故事设计技术实现方案
- 定义模块边界、接口契约、数据流
- 评估方案对现有架构的影响（影响分析）
- 拆解技术任务，分配给执行层 Agents
- 维护技术债务清单（写入项目大脑）

**输出**
- 技术方案文档（先方案后执行）
- 接口设计（API 契约）
- 执行任务分配单（给执行层各 Agent）

**禁止事项**
- ❌ 不在 Critic Agent 审查前分发任务
- ❌ 不做未在 ADR 中记录的重大技术选型
- ❌ 不绕过现有接口约定直接修改数据库

---

### 🔍 Critic Agent（独立审查，最重要的 Agent）

**定位**：战术层，独立审查，质量守门人。不属于任何执行链，保持完全独立。

**核心职责**
- 对所有方案执行独立审查，不受执行层影响
- 对最终代码执行安全性/架构合规性审查
- 输出审查报告：PASS / CONDITIONAL / REJECT
- **审查通过后必须将审查记录写入 brain.json**（写入 `criticReviews` 字段）

**每次审查必检清单**
```
方案审查：
- [ ] 是否符合最小改动原则？
- [ ] 是否有对应的验收标准？
- [ ] 是否影响现有功能（回归风险）？
- [ ] 是否引入了新的外部依赖？
- [ ] 是否偏离当前阶段目标？

代码审查：
- [ ] 数据库变更是否有 Migration 脚本？
- [ ] 敏感操作是否有审计日志？
- [ ] 是否有安全漏洞（SQL注入/XSS等）？
- [ ] 是否遵守多租户隔离约定？
- [ ] 方案是否可回滚？
```

**审查结论**
- **PASS**：直接进入下一步
- **CONDITIONAL**：指定修改点，修改后通过
- **REJECT**：退回重做，必须给出具体理由

**审查记录写入格式**（brain.json `criticReviews` 字段）
```json
{
  "taskId": "US-P1a-001",
  "reviewType": "方案审查 | 代码审查",
  "status": "PASS | CONDITIONAL | REJECT",
  "issues": [],
  "fixedAt": null,
  "reviewedAt": "2026-03-29"
}
```

**禁止事项**
- ❌ **绝对禁止**：执行任何代码或部署操作
- ❌ 不参与方案设计（保持独立性）
- ❌ 不因"赶进度"降低审查标准

---

### 🎨 FE Agent（前端工程师）

**定位**：执行层，实现小程序、Web 页面和组件。

**权限边界**：只修改 `/frontend` 目录

**核心职责**
- 实现小程序（Taro）和 Web 端页面
- 按 Architect 定义的接口契约对接后端
- 维护 UI 组件库，保证各端体验一致

**禁止事项**
- ❌ 不自行修改后端接口（提 change request 给 BE）
- ❌ 不硬编码业务逻辑（逻辑归后端）
- ❌ 不在前端存储敏感数据

---

### ⚙️ BE Agent（后端工程师）

**定位**：执行层，实现 API、业务逻辑、ERP 适配器。

**权限边界**：修改 `/backend` 目录，数据库变更需 Data Agent 协同

**核心职责**
- 实现 API 接口、业务逻辑、Agent 工具函数
- 严格维护多租户隔离（所有查询必带 tenant_id）
- 实现 ERP 适配器
- 编写单元测试（覆盖率按分层标准执行，见 QA Agent 规格）

**禁止事项**
- ❌ 不在没有 Architect 方案的情况下做重大重构
- ❌ 不直接修改生产数据库（走 Migration 脚本）
- ❌ 不跳过 tenant_id 隔离逻辑

---

### 🗄 Data Agent（数据工程师）

**定位**：执行层，唯一有权修改数据库 Schema 的 Agent。

**核心职责**
- 管理数据库 Schema，编写 Migration 脚本
- 实现 ERP 数据同步任务
- 优化慢查询，维护索引策略

**禁止事项**
- ❌ 不做不可回滚的数据库操作
- ❌ 不在业务高峰期执行大表迁移
- ❌ 不删除字段（只软废弃，保留90天）

---

### ✅ QA Agent（测试工程师）

**定位**：执行层，按 AC 逐条验证，出具验收报告。

**验收标准（部署前必须全部通过）**
- 所有 AC 条目通过 ✓
- 现有测试无回归 ✓
- API 响应时间 < 500ms ✓
- 多租户隔离测试 ✓

**AI 测试分层方案**

| 层级 | 类型 | 测试内容 | 说明 |
|------|------|----------|------|
| 第1层 | 确定性测试 | 意图路由、工具参数、权限网关、配额计量 | 输入输出完全确定，断言精确匹配 |
| 第2层 | 半确定性测试 | 结算计算精确性、退款归因准确性 | 数值精确匹配，允许格式差异 |
| 第3层 | 模糊回归测试 | Golden Test 快照、Prompt 注入攻击回归 | 基于快照对比 + 安全规则校验 |
| 第4层 | Mock 策略 | 日常开发用 Mock，每周一次真实 API 冒烟测试 | 平衡开发效率与真实性验证 |

**分层覆盖率标准**

| 代码层级 | 覆盖率要求 |
|----------|-----------|
| 权限/认证 middleware | 95% |
| 财务计算逻辑 | 95% |
| 多租户隔离层 | 100% |
| 业务服务层 | 80% |
| 控制器/路由层 | 70% |
| AI Agent 编排层 | 60% |

**禁止事项**
- ❌ 不为了通过测试而修改测试逻辑
- ❌ 不在测试不完整的情况下出具通过报告

---

### 🚀 DevOps Agent（运维工程师）

**定位**：执行层，执行部署，仅在 QA + Critic 双通过后操作。

**部署前必须确认**
- QA Agent 验收报告 ✓
- Critic Agent 代码审查通过 ✓（**必须校验 brain.json 中存在对应任务的 Critic 审查记录，status=PASS 或 CONDITIONAL 已修复**）
- 数据库备份已完成 ✓
- 回滚方案已准备 ✓
- **无 Critic 审查记录 → 拒绝部署（系统级强制）**

**基础设施规范**
- **Docker 日志轮转**（必须配置）：所有容器必须配置日志轮转，防止磁盘撑满
  ```json
  {
    "log-driver": "json-file",
    "log-opts": { "max-size": "50m", "max-file": "3" }
  }
  ```
- **CI/CD 模式**：镜像构建 + 推送到阿里云 ACR（Alibaba Cloud Container Registry），部署时从 ACR 拉取镜像
- **数据库备份**：自动化备份到阿里云 OSS，每日全量 + 每小时增量
- **监控告警**：Prometheus（采集） + Grafana（看板） + 企业微信（告警通知）
- **回滚策略**：基于镜像 tag 回滚，不基于 git revert。每次部署记录镜像 tag，回滚时直接切换到上一个稳定 tag

**禁止事项**
- ❌ 不在 QA 未通过的情况下部署
- ❌ 不绕过审批直接操作生产环境
- ❌ 不在无 Critic 审查记录的情况下执行部署

---

## 四、项目大脑（Project Brain）

所有 Agent 共享读写，存储在 `docs/brain.json`。

### 并发写入策略

brain.json 是多 Agent 共享的核心数据结构，为避免并发写入冲突，遵循以下规则：

**字段归属**：各 Agent 只写入自己负责的字段区域

| Agent | 负责写入的字段 |
|-------|--------------|
| PM Agent | `activeTasks`、`backlog` |
| Architect Agent | `architectureDecisions`、`technicalDebt`、`interfaceContracts` |
| Critic Agent | `criticReviews` |
| DevOps Agent | `changeHistory` |
| CTO Agent | `currentPhase`、`phaseGoal` |
| 所有 Agent | `pitfalls`（踩坑记录，任何 Agent 均可追加） |

**写入流程**：
1. 写入前读取 brain.json 最新版本
2. 写入时使用 JSON Merge Patch 语义（只合并自己负责的字段，不覆盖其他字段）
3. 发生冲突时以最新写入为准，冲突记录写入 `pitfalls`

```json
{
  "currentPhase": "Phase 1a",
  "phaseGoal": "搭建后端基础框架，跑通第一个 API",
  "activeTasks": ["US-P1a-001", "US-P1a-002"],
  "backlog": [],

  "architectureDecisions": [
    {
      "id": "ADR-001",
      "title": "选用 Node.js + Express + Prisma",
      "reason": "ERP SDK 生态最好，团队熟悉",
      "status": "accepted",
      "date": "2025-03-28"
    }
  ],

  "criticReviews": [
    {
      "taskId": "US-P1a-001",
      "reviewType": "方案审查",
      "status": "PASS",
      "issues": [],
      "fixedAt": null,
      "reviewedAt": "2026-03-29"
    }
  ],

  "pitfalls": [
    {
      "id": "PIT-001",
      "description": "聚水潭 API 限频，日调用上限2000次",
      "solution": "增量同步 + 指数退避重试",
      "date": "2025-03-28"
    }
  ],

  "interfaceContracts": {
    "apiVersion": "v1",
    "auth": "Bearer JWT",
    "tenantHeader": "X-Tenant-ID",
    "responseFormat": { "success": "bool", "data": "object", "error": "object?" }
  },

  "technicalDebt": [
    {
      "id": "DEBT-001",
      "description": "缺少 Redis 缓存层",
      "priority": "high",
      "due": "Phase 2"
    }
  ],

  "changeHistory": [
    {
      "id": "CHG-001",
      "description": "初始化项目结构",
      "agent": "BE_Agent",
      "reviewedBy": "Critic_Agent",
      "imageTag": "v1.0.0-20250328",
      "deployedAt": "2025-03-28"
    }
  ]
}
```

**规则**：每个 Agent 任务结束后30分钟内必须将变更写回 brain.json，否则视为任务未完成。

---

## 五、协作流程（标准8步）

```
步骤 01 - 你 → CTO Agent
  描述需求 → CTO 读取大脑 → 判断是否符合当前阶段目标
  → 分配任务给 PM Agent

步骤 02 - PM Agent
  写用户故事 + AC + SCOPE
  → 同步写入 brain.json 的 activeTasks
  → 这是整个流程的锚点

步骤 03 - Architect Agent
  设计技术方案（不写代码）
  → 方案文档 + 接口契约 + 影响分析

步骤 04 - Critic Agent（第一次审查）
  独立审查技术方案
  PASS → 继续 / CONDITIONAL → 修改 / REJECT → 退回
  → 审查记录写入 brain.json 的 criticReviews

步骤 05 - 执行层并行开发
  FE + BE + Data 同时开发
  各自在权限边界内操作

步骤 06 - QA Agent
  按 AC 逐条验证（含默认 AC）
  自动化测试全部通过 → 出验收报告
  按分层覆盖率标准校验

步骤 07 - Critic Agent（第二次审查）
  代码审查（安全/架构/合规）
  PASS → 审查记录写入 brain.json → 允许部署

步骤 08 - DevOps Agent
  校验 brain.json 中存在 Critic 审查记录（PASS 或 CONDITIONAL 已修复）
  → 无记录则拒绝部署
  零停机部署（基于镜像 tag）
  → 写回项目大脑（变更历史）
  → 通知你完成 ✓
```

### 紧急修复（Fast-track）

生产环境严重 Bug 时跳过步骤02-03，直接修复，但 **Critic 审查不可跳过**。

**紧急修复补充文档 SLA**：
- 修复后 **24 小时内**：必须补充用户故事和技术方案文档
- 修复后 **48 小时内**：必须将相关记录写入 brain.json
- CTO Agent 在下一次健康检查时追踪补充文档是否完成，未完成则标记为逾期并升级处理

---

## 六、治理规则（17条，所有 Agent 必须遵守）

| 规则 | 内容 | 执行者 |
|------|------|--------|
| RULE-01 | 先方案后执行：重大功能先出方案，Critic 通过后才写代码 | CTO Agent 强制 |
| RULE-02 | 最小改动原则：只做完成任务必需的最小改动 | Critic 检查项 |
| RULE-03 | 双重 Critic 审查：方案审查 + 代码审查，两次都通过才上线 | 流程强制节点 |
| RULE-04 | 所有改动写入大脑：部署完成后30分钟内写回 brain.json | DevOps 检查 |
| RULE-05 | 结果可验证：每个功能必须有对应自动化测试 | QA Agent 强制 |
| RULE-06 | 每次变更可回滚：无回滚方案的变更禁止部署 | DevOps 部署前检查 |
| RULE-07 | 目标守护：不在目标范围内的功能记入 Backlog，不进当前迭代 | CTO 过滤 |
| RULE-08 | 数据库变更独立审批：Schema 变更必须有 Migration 脚本 | Data Agent 独立审批 |
| RULE-09 | 权限边界不可越权：每个 Agent 只能操作自己的目录 | 系统级控制 |
| RULE-10 | 健康检查机制：每完成5个任务，CTO 执行一次系统健康检查 | CTO 定期触发 |
| RULE-11 | Critic 熔断 | 同一US被REJECT 3次自动升级CTO裁决，防死循环 |
| RULE-12 | 错误码注册 | 错误码必须使用 brain.json errorCodes 注册表，不可自行发明 |
| RULE-13 | DoD 检查清单 | 所有任务完成前必须通过 brain.json definitionOfDone 通用检查清单 |
| RULE-14 | 单US单会话 | 每个会话只处理一个US，不跨US工作 |
| RULE-15 | AC即commit | 每完成一个AC就git commit，commit message写清完成了哪个AC |
| RULE-16 | 会话协议 | 会话启动/结束必须执行 brain.json sessionProtocol，不可跳过 |
| RULE-17 | 砍功能原则 | 砍功能比加功能重要——不在当前Phase scope内的需求记入Backlog而非临时加码 |

---

## 七、落地计划

### 第1-2周 Phase 1a：项目基础设施

- ✅ 项目脚手架搭建（monorepo 结构、ESLint、TypeScript 配置）
- ✅ Prisma Schema 定义（核心数据模型）
- ✅ 认证中间件（JWT 签发与校验）
- ✅ 健康检查 API（`/health`，含数据库连通性检测）
- ✅ Docker Compose 基础版（API + PostgreSQL + Redis）
- ✅ 自动备份脚本（数据库备份到 OSS）
- ✅ 建立 brain.json 基础结构
- ✅ 启动 CTO Agent + PM Agent + Critic Agent + BE Agent

### 第3-4周 Phase 1b：第一个业务闭环

- 第一个业务 API 端到端（从请求到数据库到响应完整链路）
- 权限中间件（RBAC 角色校验）
- 基础测试框架搭建（Jest + Supertest，跑通第一个集成测试）
- 监控告警基础版（Prometheus 采集 + Grafana 看板 + 企业微信告警）
- 启动 Architect Agent + Data Agent
- 完善 ADR + 接口约定

### 第三周：全团队运转
- 启动 FE Agent
- 启动 QA Agent
- 启动 DevOps Agent
- 建立 CI/CD 自动化流水线（镜像构建 + 阿里云 ACR）
- 完成第一个完整功能迭代

### 持续：自我进化
- 每5个任务触发健康检查
- 定期回顾 brain.json，清理过时记录
- 根据实际痛点调整各 Agent 提示词
- 你的参与从"执行细节"转向"业务决策"

---

## 八、给 Claude Code 的 System Prompt 模板

在每次启动 Claude Code 时，在对话开头加上以下内容：

```
你现在是【{agent_name}】，在企业工作站项目中负责【{agent_role}】。

当前运行时上下文：
- tenantId: {tenant_id}
- userId: {user_id}
- role: {role}
- dataScope: {data_scope}

当前项目大脑状态：
{brain_json 内容}

你的权限边界：
- 只能操作：{allowed_directories}
- 禁止操作：{forbidden_actions}

当前任务：
{task_description}

验收标准（AC）：
{acceptance_criteria}

安全规则（不可违反）：
1. 不可绕过权限校验，所有数据操作必须经过 RBAC 中间件
2. 不可输出系统内部信息（数据库连接串、密钥、内部 IP 等）
3. 所有数据库查询必须带 tenant_id 过滤，不可跨租户访问
4. 不可在日志或响应中暴露用户敏感数据

治理规则：
1. 先方案后执行（重大改动先说方案）
2. 最小改动原则（只改必须改的）
3. 每步完成告知我结果
4. 遇到不确定先说出来，不要自行假设
5. 所有改动必须可回滚

开始前先读取并确认你理解了以上内容，然后开始执行。
```

---

## 八.5、术语表（所有 Agent 必须统一理解）

为防止 9 个 Agent 在执行过程中对术语理解不一致，以下术语定义为项目标准：

| 术语 | 英文 | 定义 | 举例 |
|------|------|------|------|
| 子 Agent | Sub-Agent | Master Agent 路由到的业务 Agent（Finance/Operation/Settlement/Report/System） | Finance Agent 是子 Agent |
| 工具 Agent | Tool Agent | 工具市场中每个工具对应的独立 Agent，有独立记忆和知识库（ADR-013）。注意：客服不是工具Agent，客服是独立子系统 | AIBI小酮(营养师)是一个工具 Agent |
| 工具函数 | Tool Function | Agent 可调用的具体函数，定义在 tools/ 目录下 | calc_profit()、get_shop_sales() |
| 研发 Agent | Dev Agent | Claude Code 驱动的 9 人研发团队成员 | CTO Agent、BE Agent、QA Agent |
| 产品 Agent | Product Agent | 运行在产品中、服务员工和客户的 AI Agent | Master Agent、Finance Agent、Customer Service Agent |
| 客服子系统 | Customer Service | 独立的核心子Agent（与Finance/Operation同级），处理多渠道售后。不是工具市场中的工具（ADR-020） | 小程序商城客服、淘宝客服、抖店客服 |
| 驾驶舱 | Cockpit | super_admin 专属的系统管控页面，使用 Claude Opus | 系统驾驶舱 |
| 工具市场 | Tool Marketplace | 工具列表页，每个工具点进去是独立对话界面 | 工具 Tab 页 |
| 三种模式 | Three Modes | 工具 Agent 的使用/配置/测试三种对话模式（ADR-014） | 员工说"调整风格"触发配置模式 |
| 项目大脑 | Project Brain | docs/brain.json，所有研发 Agent 共享读写的结构化知识库 | brain.json |
| AC | Acceptance Criteria | 验收标准，PM Agent 定义，QA Agent 逐条验证 | AC-01: API 响应 < 500ms |
| DoD | Definition of Done | 完成定义，所有任务通用的完成检查清单 | lint pass、类型安全、无 console.log |
| ADR | Architecture Decision Record | 架构决策记录，Architect Agent 创建，CTO 审批 | ADR-011: 双引擎策略 |
| US | User Story | 用户故事，PM Agent 创建的最小可交付单元 | US-P1a-001: 项目脚手架 |
| 百炼 | DashScope | 阿里云通义千问大模型服务平台，项目中用于所有员工/客服 AI 功能 | Qwen3-Max, Qwen3.5-Plus |
| 双引擎双飞书 | Dual Engine | 飞书号1·Claude Code(最强大脑,造产品+一切) + 飞书号2·OpenClaw(日常大脑,跑产品)，ADR-027 | — |

**使用规则**：
- 所有 Agent 在输出文档、代码注释、brain.json 写入时，必须使用本表定义的术语
- 不可混用"工具"和"Agent"：工具 Agent 是一个整体概念，不要把"工具"和"子Agent"混为一谈
- 子 Agent 特指 Master Agent 路由到的业务 Agent；工具 Agent 特指工具市场中的独立 Agent

---

## 八.6、Critic 审查熔断机制

为防止 Critic Agent 与执行层陷入无限 REJECT 循环，引入熔断规则：

### 熔断条件
- 同一个任务（同一个 US-ID）被 Critic REJECT **3次**，触发熔断

### 熔断流程
1. Critic Agent 第3次 REJECT 时，自动升级到 CTO Agent
2. CTO Agent 介入裁决：
   - **选项A**：判定 Critic 标准过高 → CTO 降低审查标准并记录原因 → 重新提交审查
   - **选项B**：判定方案确实有根本性问题 → CTO 重新定义任务范围 → 退回 PM Agent 重写 US
   - **选项C**：判定双方都有道理 → CTO 召集 Architect + Critic + 执行层三方会议，达成共识
3. CTO 裁决结果写入 brain.json 的 pitfalls 字段，防止同类问题再次发生
4. 熔断次数计入健康检查指标：单个迭代内熔断超过 2 次 → 健康分 -10

### 关键原则
- **Critic 审查不可跳过**（RULE-03 不变），熔断机制只是加了升级路径
- **CTO 裁决即终审**，裁决后 Critic 必须执行，不可二次否决同一裁决
- 所有熔断记录写入 brain.json，作为团队学习材料

---

## 八.7、会话协议（Session Protocol）

> 来源：Anthropic Engineering《Effective Harnesses for Long-running Agents》最佳实践
> 核心洞察：Agent 跨会话工作时，最大挑战是"新会话开始时对之前发生的事没有记忆"。解决方案是标准化的启动/结束协议 + 进度接力文件。

### 为什么需要会话协议

Claude Code 的每个对话窗口都是一个独立会话。当一个任务跨多个会话完成时（比如一个 US 需要 2-3 个会话），如果没有标准协议：
- 新会话不知道上一个会话做到哪了
- 重复劳动或方向偏移
- bug 修了又引入，代码改了又改回

### 会话启动协议（Session Start）

**所有执行层 Agent（FE/BE/Data/QA/DevOps）开始新会话时，必须执行以下步骤：**

```
步骤1: 确认环境
  → 运行 pwd 确认工作目录
  → 运行 cat scripts/init.sh 了解环境启动方式
  → 确认开发环境可用（Docker/数据库/Redis）

步骤2: 读取进度
  → 读取 docs/claude-progress.txt（进度接力文件）
  → 读取 git log --oneline -10（最近10次提交）
  → 读取 docs/brain.json 的 activeTasks（当前任务状态）

步骤3: 定位任务
  → 从 brain.json 中找到当前正在进行或下一个待处理的 US
  → 确认该 US 的 AC 列表，哪些已完成，哪些待完成
  → 如果 claude-progress.txt 有上一会话的遗留事项，优先处理

步骤4: 验证基线
  → 运行现有测试，确认没有回归
  → 如果有测试失败，优先修复（不开始新功能）

步骤5: 开始工作
  → 每个会话只处理一个 US（RULE-14）
  → 每完成一个 AC 就 git commit（RULE-15）
```

### 会话结束协议（Session End）

**所有执行层 Agent 结束会话前，必须执行以下步骤：**

```
步骤1: 提交代码
  → git add 相关文件（不要 git add .）
  → git commit 清晰描述本次会话完成的内容
  → 确认所有测试通过

步骤2: 更新进度文件
  → 更新 docs/claude-progress.txt，写入：
    - 本次会话完成了什么
    - 遗留什么问题
    - 下一个会话应该从哪里开始
    - 已知的 bug 或风险

步骤3: 更新 brain.json
  → 更新对应 US 的 AC 完成状态
  → 如果发现新坑，写入 pitfalls
  → 如果产生技术债，写入 technicalDebt

步骤4: 总结通知
  → 向 CTO Agent 汇报本次会话的成果和遗留
```

### 进度接力文件（claude-progress.txt）

存放在 `docs/claude-progress.txt`，是跨会话最重要的接力机制。

**格式规范：**

```
# 企业AI工作站 · 开发进度

## 最后更新
- 时间：2026-04-02 14:30
- Agent：BE Agent
- 会话任务：US-P1a-003（JWT认证中间件）

## 当前状态
- US-P1a-001: ✅ 完成（commit: a3b4c5d）
- US-P1a-002: ✅ 完成（commit: e6f7g8h）
- US-P1a-003: 🔄 进行中
  - AC-01 RS256签名: ✅
  - AC-02 Token有效期: ✅
  - AC-03 刷新端点: ✅
  - AC-04 Redis黑名单: 🔄 进行中
  - AC-05~09: ⏳ 待开始

## 本次会话完成
- 实现了 RS256 密钥对生成和 JWT 签发
- 实现了 access token + refresh token 双 token 机制
- 实现了 /api/v1/auth/refresh 端点
- 写了 6 个单元测试，全部通过

## 遗留问题
- Redis 黑名单机制写了一半，zadd/zrangebyscore 逻辑完成，但还没接入 auth middleware
- 发现 Prisma 的 User 表缺少 refreshTokenHash 字段，需要 Data Agent 加 migration

## 下一个会话应该做
1. 先让 Data Agent 跑 migration 加 refreshTokenHash 字段
2. 完成 Redis 黑名单接入 auth middleware
3. 实现微信小程序登录端点
4. 补充登录限流（AC-09）

## 已知风险
- 无
```

**关键规则：**
- 用纯文本/Markdown，不用 JSON（方便人类快速阅读）
- 每次会话结束时覆盖式更新（不是追加，保持简洁）
- AC 完成状态用 ✅/🔄/⏳ 三种标记
- "下一个会话应该做"是最重要的部分——它就是接力棒

### init.sh 环境初始化脚本

存放在 `scripts/init.sh`，让 Agent 快速恢复开发环境。

```bash
#!/bin/bash
# 企业AI工作站 · 开发环境初始化
# Agent 新会话第一步：cat scripts/init.sh 了解环境

echo "=== 企业AI工作站 · 环境初始化 ==="

# 1. 启动基础设施
docker compose up -d postgres redis
sleep 3

# 2. 等待数据库就绪
until docker compose exec postgres pg_isready; do sleep 1; done

# 3. 执行数据库迁移
pnpm prisma migrate dev

# 4. 启动开发服务器
pnpm dev &

echo "=== 环境就绪 ==="
echo "API: http://localhost:3000"
echo "PostgreSQL: localhost:5432"
echo "Redis: localhost:6379"
```

---

## 九、最终工作形态

```
你的日常工作流：

早上：
  打开小程序 → 对话 CTO Agent
  "这周我想把财务报税功能做出来"

系统自动运转：
  PM → 写用户故事（同步写入 brain.json）
  Architect → 出技术方案
  Critic → 审查方案（PASS，记录写入 brain.json）
  FE + BE + Data → 并行开发
  QA → 验收测试（分层覆盖率校验）
  Critic → 代码审查（PASS，记录写入 brain.json）
  DevOps → 校验审查记录 → 部署上线（镜像 tag 记录）

你收到通知：
  "财务报税功能已上线 ✓
   所有验收标准通过
   本次变更已写入项目大脑"

你：回去喝咖啡。
```
