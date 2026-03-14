# ATLAS 分析动作集 + 执行过程透明化 实施稿 V2.0

版本：V2.0（根据审核意见修订）
日期：2026-03-14
状态：待最终确认，确认后开始编码

---

## 一、第一阶段范围

第一阶段只做 3 个动作，目标是打通整条链路：

**用户提问 → AI 选动作 → 后端执行 → 前端卡片展示 → AI 解读**

| 动作 | 类别 | 说明 |
|------|------|------|
| group_by | 分析动作 | 分组汇总，最高频需求（达人排名、省份分布、支付方式占比） |
| filter | 分析动作 | 条件筛选，是 group_by 的前置动作，必须先正式定义 |
| distribution | 分析动作 | 分布分析，枚举型字段的频次统计 |

第二阶段（不在本轮范围）：compare / anomaly_scan / trim_columns / export_dataset / draw_chart

---

## 二、动作分类（三层职责）

| 层 | 动作 | 职责 |
|----|------|------|
| 分析动作 | group_by / filter / distribution / compare / anomaly_scan | 对数据做计算，返回结构化结果 |
| 导出动作 | trim_columns / export_dataset | 裁剪字段并生成文件，牵涉模板治理 |
| 展示动作 | draw_chart | 把分析结果渲染成图表 |

三层之间的调用关系：分析动作 → 展示动作（可选）；分析动作 → 导出动作（可选）。导出动作不依赖展示动作。

---

## 三、数据来源规则（核心约束）

所有分析动作的数据来源必须明确，不允许混用。

**规则：分析动作统一基于 `standardizedRows` 执行计算。**

理由：
- `standardizedRows` 是 Pipeline Governance 层清洗后的标准化数据，已完成去重、空值处理、字段标准化，是系统的"唯一真值源"。
- `rawRows`（前端上传的原始行）未经清洗，不能用于计算。
- ResultSet 中的 `metrics` 是已聚合的标量结果，不适合再做二次 group_by。

**数据加载路径：**

```
sessionId
  → loadSessionData(sessionId)   // 从 S3 加载 atlas-data/{sessionId}-data.json
  → standardizedRows             // 即 loadSessionData 返回的 Record<string, unknown>[]
  → 动作执行函数（group_by / filter / distribution）
```

`loadSessionData` 已在 atlas.ts 中实现，直接复用，不重新实现。

---

## 四、第一阶段动作接口定义

### 4.1 filter（条件筛选）

**输入参数：**

```typescript
interface FilterAction {
  action: "filter";
  conditions: FilterCondition[];  // AND 关系，多个条件同时满足
  limit?: number;                 // 返回样本行数，默认 5，最大 20
  sortBy?: string;                // 排序字段名
  order?: "asc" | "desc";        // 排序方向，默认 desc
}

interface FilterCondition {
  field: string;                  // 字段名，必须是 standardizedRows 中存在的字段
  op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";
  value: string | number | (string | number)[];  // "in" 时为数组
}
```

**输出格式：**

```typescript
interface FilterResult {
  action: "filter";
  params: FilterAction;
  dataSource: "standardizedRows";
  totalRows: number;              // standardizedRows 总行数
  matchedRows: number;            // 符合条件的行数
  matchRate: string;              // 如 "90.0%"
  sample: Record<string, unknown>[];  // 前 limit 条样本
  durationMs: number;
}
```

**执行逻辑：**

1. 从 standardizedRows 中遍历所有行
2. 对每行依次检查所有 conditions（AND 关系）
3. 统计 matchedRows，返回前 limit 条样本
4. 字段不存在时返回 error（不抛异常）

---

### 4.2 group_by（分组汇总）

**输入参数：**

```typescript
interface GroupByAction {
  action: "group_by";
  groupBy: string;                // 分组字段名（维度字段，如"达人昵称"、"省"）
  metric: string;                 // 数值字段名（如"订单应付金额"）
  agg: "sum" | "count" | "avg" | "max" | "min";
  topN?: number;                  // 只返回前 N 条，默认 10，最大 50
  filter?: FilterCondition[];     // 可选前置过滤（与 filter 动作共用 FilterCondition 类型）
}
```

**输出格式：**

```typescript
interface GroupByResult {
  action: "group_by";
  params: GroupByAction;
  dataSource: "standardizedRows";
  totalRows: number;              // 参与计算的总行数（过滤后）
  groupCount: number;             // 分组总数（不截断）
  result: Array<{
    label: string;                // 分组值
    value: number;                // 聚合结果
    count: number;                // 该分组的行数
  }>;
  durationMs: number;
}
```

**执行逻辑：**

1. 如有 filter 条件，先过滤 standardizedRows
2. 按 groupBy 字段分组，对 metric 字段做 agg 聚合
3. 按 value 降序排列，取前 topN 条
4. 字段不存在或 metric 字段非数值时返回 error

**与现有 groupedTop5 的关系：**

现有 dfInfo.groupedTop5 是上传时预计算的静态缓存，只有 sum 聚合、只有 top5。新的 group_by 动作是实时计算，支持任意聚合方式和任意 topN，两者并存，不互相替代。AI 调用 group_by 动作时，后端实时计算，不读 dfInfo 缓存。

---

### 4.3 distribution（分布分析）

**输入参数：**

```typescript
interface DistributionAction {
  action: "distribution";
  field: string;                  // 字段名
  type: "categorical" | "numeric";
  topN?: number;                  // 枚举型：只返回前 N 个，默认 20，最大 50
  bins?: number;                  // 数值型：分桶数，默认 10
  filter?: FilterCondition[];     // 可选前置过滤
}
```

**输出格式：**

```typescript
interface DistributionResult {
  action: "distribution";
  params: DistributionAction;
  dataSource: "standardizedRows";
  totalRows: number;
  result: Array<{
    label: string;                // 枚举值 或 区间描述（如"0-100"）
    count: number;
    pct: string;                  // 如 "39.1%"
    sum?: number;                 // 如果字段有对应金额字段，可附带（可选）
  }>;
  durationMs: number;
}
```

**执行逻辑：**

1. categorical：直接按字段值分组计数，按 count 降序，取前 topN
2. numeric：自动计算 min/max，等分 bins 个区间，统计每个区间的行数
3. 字段不存在时返回 error

---

## 五、后端返回给前端的结构化事件格式

**不靠模型文本拼出执行卡片。** 后端在 stream 中插入结构化事件，前端解析后渲染 ActionCard。

### 5.1 事件类型

```typescript
type ActionEvent =
  | ActionStartEvent
  | ActionResultEvent
  | ActionErrorEvent;

interface ActionStartEvent {
  type: "action_start";
  actionId: string;               // nanoid，用于前端匹配 start 和 result
  action: string;                 // 动作名称，如 "group_by"
  params: Record<string, unknown>;
  timestamp: number;              // UTC 毫秒
}

interface ActionResultEvent {
  type: "action_result";
  actionId: string;               // 与 action_start 对应
  action: string;
  result: GroupByResult | FilterResult | DistributionResult;
  timestamp: number;
}

interface ActionErrorEvent {
  type: "action_error";
  actionId: string;
  action: string;
  error: string;                  // 错误描述，如 "字段 '达人昵称' 不存在"
  timestamp: number;
}
```

### 5.2 在 stream 中的传输格式

在现有 `pipeTextStreamToResponse` 的 text stream 中，插入特殊行：

```
[ATLAS_ACTION]{"type":"action_start","actionId":"abc123","action":"group_by","params":{...},"timestamp":1741939200000}[/ATLAS_ACTION]
[ATLAS_ACTION]{"type":"action_result","actionId":"abc123","action":"group_by","result":{...},"timestamp":1741939200042}[/ATLAS_ACTION]
```

前端识别 `[ATLAS_ACTION]...[/ATLAS_ACTION]` 标记，解析 JSON，渲染 ActionCard，不影响普通文本渲染。

### 5.3 stream 中的顺序

```
[ATLAS_ACTION] action_start [/ATLAS_ACTION]
（后端执行动作，耗时 N ms）
[ATLAS_ACTION] action_result [/ATLAS_ACTION]
（AI 开始输出自然语言解读文字）
```

---

## 六、ActionCard 前端数据结构

```typescript
interface ActionCardProps {
  actionId: string;
  action: string;                 // 动作名称（用于显示标题）
  params: Record<string, unknown>;
  result?: GroupByResult | FilterResult | DistributionResult;
  error?: string;
  durationMs?: number;
  dataSource: string;             // 固定显示 "standardizedRows"
  totalRows?: number;             // 参与计算行数
  filterSummary?: string;         // 过滤条件摘要，如 "订单状态 = 已完成"
  defaultExpanded?: boolean;      // 默认是否展开，默认 false
}
```

**卡片展示内容（展开后）：**

| 字段 | 说明 |
|------|------|
| 动作名称 | group_by / filter / distribution |
| 参数列表 | 人类可读格式（分组字段、统计字段、聚合方式等） |
| 数据来源 | 固定显示 "standardizedRows（清洗后全量数据）" |
| 参与计算行数 | 如 "46,906 行" |
| 过滤条件摘要 | 如 "订单状态 = 已完成（42,203 行匹配）" |
| 执行结果 | 表格形式展示 result 数组 |
| 耗时 | 如 "42ms" |

---

## 七、chat 端点接入主链路（完整改动说明）

### 7.1 改动位置

文件：`server/atlas.ts`，改动范围：chat 端点内部（约第 2513 行的 `streamText` 调用处）

**改动前（当前逻辑）：**

```typescript
const result = streamText({
  model: openai.chat(selectModel(totalRows)),
  system: finalSystemPrompt,
  messages,
});
result.pipeTextStreamToResponse(res);
```

**改动后（新逻辑）：**

```typescript
const result = streamText({
  model: openai.chat(selectModel(totalRows)),
  system: finalSystemPrompt,
  messages,
  tools: buildAtlasTools(perFileProfiles),   // 注入动作工具定义
  maxSteps: 3,                               // 最多 3 轮 function calling
  onStepFinish: async ({ toolResults }) => {
    // 每次工具调用完成后，把结构化事件写入 stream（通过 res.write）
    // 注意：pipeTextStreamToResponse 会接管 res，需要在 pipe 前先处理工具事件
  },
});
result.pipeTextStreamToResponse(res);
```

### 7.2 新增文件

**`server/pipeline/actions.ts`（新增）**

内容：
- 定义 ActionRequest / ActionResult 接口
- 实现 executeGroupBy / executeFilter / executeDistribution 三个函数
- 导出 executeAction(sessionId, actionRequest) → ActionResult
- 每个函数基于 loadSessionData 加载 standardizedRows，不重新实现数据加载

**`server/pipeline/atlasTools.ts`（新增）**

内容：
- 定义 buildAtlasTools(perFileProfiles) 函数
- 返回 AI SDK 格式的 tools 对象（group_by / filter / distribution 三个工具的 schema）
- 工具 schema 中注入当前文件的字段列表，帮助 AI 正确填参数

**`client/src/components/ActionCard.tsx`（新增）**

内容：
- 接收 ActionCardProps，渲染可折叠的执行卡片
- 解析 group_by / filter / distribution 三种结果格式
- 样式参考 Kimi 的代码块展开框，使用现有 shadcn/ui 组件

**`client/src/hooks/useAtlasStream.ts`（修改或新增）**

内容：
- 在现有 stream 解析逻辑中，识别 `[ATLAS_ACTION]...[/ATLAS_ACTION]` 标记
- 解析后触发 ActionCard 渲染
- 不影响现有 atlas-table 解析逻辑

---

## 八、本轮实际修改文件清单

| 文件 | 操作 | 改动说明 |
|------|------|------|
| server/pipeline/actions.ts | 新增 | 动作执行引擎（group_by / filter / distribution） |
| server/pipeline/atlasTools.ts | 新增 | AI SDK tools 定义（buildAtlasTools） |
| server/atlas.ts | 修改 | chat 端点注入 tools + onStepFinish 写入结构化事件 |
| client/src/components/ActionCard.tsx | 新增 | 执行卡片前端组件 |
| client/src/hooks/useAtlasStream.ts | 修改 | stream 解析逻辑识别 ATLAS_ACTION 标记 |
| server/actions.test.ts | 新增 | 动作执行引擎单元测试 |

---

## 九、改动顺序

按以下顺序实施，每步完成后验证再进行下一步：

**Step 1：实现动作执行引擎（后端，无 UI）**

新增 `server/pipeline/actions.ts`，实现 executeGroupBy / executeFilter / executeDistribution。
写单元测试 `server/actions.test.ts`，用 mock 数据验证三个函数的计算结果。
**验收标准：`pnpm test` 全部通过，三个函数计算结果正确。**

**Step 2：定义 AI tools schema（后端，无 UI）**

新增 `server/pipeline/atlasTools.ts`，实现 buildAtlasTools。
在 atlas.ts 的 chat 端点注入 tools，但先不写 onStepFinish（只让 AI 能调用工具，不处理结果）。
**验收标准：发送"帮我看达人排名"，服务器日志出现 `[Atlas] tool_call: group_by`。**

**Step 3：后端写入结构化事件到 stream**

在 atlas.ts 的 onStepFinish 中，把 ActionStartEvent + ActionResultEvent 写入 stream。
**验收标准：curl 请求 chat 端点，stream 输出中出现 `[ATLAS_ACTION]...[/ATLAS_ACTION]` 标记。**

**Step 4：前端渲染 ActionCard**

新增 ActionCard.tsx，修改 useAtlasStream.ts 解析 ATLAS_ACTION 标记。
**验收标准：发送"帮我看达人排名"，前端出现可折叠的执行卡片，展开后显示参数、数据来源、结果、耗时。**

**Step 5：端到端验证**

上传真实电商订单文件，发送以下三条消息验证：
1. "帮我看达人销售额排名 Top10" → 触发 group_by，卡片显示正确
2. "只看已完成的订单" → 触发 filter，卡片显示匹配行数
3. "支付方式分布" → 触发 distribution，卡片显示各支付方式占比

---

## 十、验证步骤与预期结果

| 步骤 | 操作 | 预期结果 |
|------|------|------|
| Step 1 验收 | `pnpm test` | 200 个测试全部通过，新增 actions.test.ts 的测试也通过 |
| Step 2 验收 | 发送"帮我看达人排名"，查看服务器日志 | 日志出现 `[Atlas] tool_call: group_by`，AI 正确填写了 groupBy 和 metric 参数 |
| Step 3 验收 | curl 请求 chat 端点 | stream 输出包含 `[ATLAS_ACTION]{"type":"action_start"...}[/ATLAS_ACTION]` 和 `[ATLAS_ACTION]{"type":"action_result"...}[/ATLAS_ACTION]` |
| Step 4 验收 | 浏览器发送"帮我看达人排名" | 前端出现执行卡片，默认折叠，展开后显示：动作名称、参数、数据来源（standardizedRows）、参与计算行数、结果表格、耗时 |
| Step 5 验收 | 三条端到端消息 | 三个动作均触发卡片，数字与现有 atlas-table 输出一致（误差 < 0.01%） |

---

## 十一、风险点与应对

| 风险 | 说明 | 应对 |
|------|------|------|
| AI 填写不存在的字段名 | 模型可能填写字段别名或拼写错误 | 执行前校验字段是否在 standardizedRows 中存在；不存在时返回 ActionErrorEvent，AI 在解读中说明 |
| stream 格式兼容 | ATLAS_ACTION 标记可能被前端 Markdown 渲染器误处理 | 标记使用特殊前缀，前端在 Markdown 渲染前优先提取并移除 ATLAS_ACTION 块 |
| 大文件性能 | 10 万行 group_by 实时计算可能耗时 2-5 秒 | 第一阶段先接受这个延迟；第二阶段可在 action_start 后立即返回 stream，让 AI 先输出"正在计算..."，结果到了再渲染卡片 |
| tools 与 OpenClaw 通道冲突 | 当前 OpenClaw SSE 通道绕过了 streamText，无法注入 tools | 第一阶段只在 Qwen/Kimi 通道实现 function calling，OpenClaw 通道暂不支持（OpenClaw 有自己的执行能力） |
| 现有 atlas-table 输出不受影响 | 注入 tools 后，AI 可能改变输出格式 | systemPrompt 中保留现有的 atlas-table 输出规则；tools 只是新增能力，不替换现有输出格式 |

---

## 十二、不在本轮范围

- compare / anomaly_scan：留第二阶段
- trim_columns / export_dataset 及模板白名单：留第二阶段（需业务方对齐字段口径）
- draw_chart：留第三阶段
- 多轮分析闭环（AI 主动发起下一轮动作）：留第二阶段
- OpenClaw 通道的 function calling 支持：留第二阶段

---

## 十三、待确认事项

请确认以下内容后，方可开始编码：

1. 数据来源规则（standardizedRows）是否认可？
2. 结构化事件格式（action_start / action_result / action_error）是否认可？
3. stream 中的 `[ATLAS_ACTION]...[/ATLAS_ACTION]` 标记格式是否认可？
4. ActionCard 展示的 5 个字段（动作名称、参数、数据来源、参与计算行数、过滤条件摘要）是否认可？
5. 改动顺序（Step 1 → Step 5）是否认可？
