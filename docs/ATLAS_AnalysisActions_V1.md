# ATLAS 分析动作集 + 执行过程透明化 方案 V1.0

方案版本：V1.0
起草日期：2026-03-14
状态：待审核

---

## 一、背景与目标

Kimi 的核心优势不只是"读文件"，而是让用户看到 AI 的执行过程（"运行 Python 代码"展开框），从而建立信任感、便于调试。

ATLAS 要做的比 Kimi 更进一步：

- Kimi 展示的是"AI 临场写的 Python 代码"，口径不受控，数字可能算错。
- ATLAS 展示的是"系统执行的确定性动作"，每个动作有固定计算逻辑，AI 只选动作、填参数，数字来自 Pipeline，可信。

本方案目标：在 chat 对话中，每次 AI 调度一个分析动作，前端展示一个"执行卡片"，用户可展开查看动作名称、参数、执行结果、耗时，实现执行过程完全透明。

---

## 二、整体架构

```
用户输入自然语言
       ↓
AI（function calling）
  → 理解意图
  → 选择动作
  → 填写参数
       ↓
后端执行引擎
  → 解析动作调用
  → 调用对应计算函数（Pandas / Node.js）
  → 返回结构化结果
       ↓
AI 解读结果
  → 用自然语言回答用户
       ↓
前端渲染
  → 执行卡片（可折叠）
  → AI 解读文字
```

---

## 三、分析动作集定义

共 9 个动作，分三类。

### 3.1 统计类动作

**动作 1：group_by（分组汇总）**

用途：按某个维度字段对数值字段做聚合，输出排名。

输入参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| groupBy | string | 是 | 分组字段名，如"达人昵称"、"省" |
| metric | string | 是 | 数值字段名，如"订单应付金额" |
| agg | enum | 是 | 聚合方式：sum / count / avg / max / min |
| topN | number | 否 | 只返回前 N 条，默认 10 |
| filter | object | 否 | 前置过滤条件（见 filter 动作） |

输出格式：

```json
{
  "action": "group_by",
  "params": { "groupBy": "达人昵称", "metric": "订单应付金额", "agg": "sum", "topN": 5 },
  "result": [
    { "label": "老王真知灼见", "value": 178182.00, "count": 18603 },
    { "label": "胡说老王",     "value": 156430.00, "count": 15200 }
  ],
  "totalRows": 46906,
  "executedAt": "2026-03-14T09:00:00Z",
  "durationMs": 42
}
```

---

**动作 2：top_n（Top N 排名）**

用途：对某个数值字段取最大/最小的前 N 条原始记录。

输入参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| field | string | 是 | 排序字段名 |
| n | number | 是 | 取前 N 条 |
| order | enum | 否 | desc（默认）/ asc |
| returnFields | string[] | 否 | 返回哪些字段，默认全部 |

输出格式：

```json
{
  "action": "top_n",
  "params": { "field": "商品金额", "n": 5, "order": "desc" },
  "result": [
    { "主订单编号": "695041...", "商品金额": 598.00, "达人昵称": "老王真知灼见" }
  ],
  "totalRows": 46906,
  "durationMs": 18
}
```

---

**动作 3：compare（对比分析）**

用途：对两个分组或两个时间段的同一指标做对比，计算差值和变化率。

输入参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| groupBy | string | 是 | 分组字段名 |
| metric | string | 是 | 数值字段名 |
| agg | enum | 是 | 聚合方式 |
| groupA | string | 是 | 对比组 A 的值 |
| groupB | string | 是 | 对比组 B 的值 |

输出格式：

```json
{
  "action": "compare",
  "params": { "groupBy": "支付方式", "metric": "订单应付金额", "agg": "sum", "groupA": "抖音支付", "groupB": "微信" },
  "result": {
    "groupA": { "label": "抖音支付", "value": 800000.00 },
    "groupB": { "label": "微信",     "value": 340000.00 },
    "diff": 460000.00,
    "changeRate": "+135.3%"
  },
  "durationMs": 25
}
```

---

**动作 4：distribution（分布分析）**

用途：对某个字段做频次分布统计，了解数据分布形态。

输入参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| field | string | 是 | 字段名 |
| type | enum | 是 | categorical（枚举型）/ numeric（数值型，自动分桶） |
| bins | number | 否 | 数值型分桶数，默认 10 |
| topN | number | 否 | 枚举型只返回前 N 个，默认 20 |

输出格式：

```json
{
  "action": "distribution",
  "params": { "field": "支付方式", "type": "categorical" },
  "result": [
    { "label": "抖音支付", "count": 18316, "pct": "39.1%" },
    { "label": "抖音月付", "count": 13834, "pct": "29.5%" }
  ],
  "durationMs": 15
}
```

---

**动作 5：filter（条件筛选）**

用途：按条件筛选数据，返回符合条件的行数和样本。

输入参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| conditions | Condition[] | 是 | 过滤条件列表（AND 关系） |
| returnSample | number | 否 | 返回样本行数，默认 5 |

Condition 结构：

```json
{ "field": "订单状态", "op": "eq", "value": "已完成" }
```

op 支持：eq / ne / gt / gte / lt / lte / contains / in

输出格式：

```json
{
  "action": "filter",
  "params": { "conditions": [{ "field": "订单状态", "op": "eq", "value": "已完成" }] },
  "result": {
    "matchedRows": 42203,
    "totalRows": 46906,
    "matchRate": "90.0%",
    "sample": [ { "主订单编号": "...", "订单状态": "已完成" } ]
  },
  "durationMs": 30
}
```

---

### 3.2 质量类动作

**动作 6：anomaly_scan（异常扫描）**

用途：对数值字段做异常值检测，找出偏离中位数 5 倍以上的记录。

输入参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| field | string | 是 | 数值字段名 |
| threshold | number | 否 | 异常倍数阈值，默认 5 |

输出格式：

```json
{
  "action": "anomaly_scan",
  "params": { "field": "商品金额", "threshold": 5 },
  "result": {
    "median": 29.9,
    "threshold": 149.5,
    "anomalyCount": 12,
    "anomalyRows": [
      { "rowIndex": 1024, "value": 598.0, "ratio": "20x" }
    ]
  },
  "durationMs": 55
}
```

---

### 3.3 导出类动作

**动作 7：trim_columns（精简字段）**

用途：按模板白名单或用户指定，裁剪数据集字段，生成精简版数据集，并记录裁剪决策日志。

输入参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keepFields | string[] | 否 | 保留字段列表（与 templateId 二选一） |
| templateId | string | 否 | 使用预定义模板（运营版/财务版/达人版/投放版） |
| reason | string | 否 | 裁剪原因说明 |

输出格式：

```json
{
  "action": "trim_columns",
  "params": { "templateId": "operations", "reason": "用户请求运营版导出" },
  "result": {
    "keptFields": ["主订单编号", "达人昵称", "商品金额", "订单状态", "省"],
    "removedFields": ["收件人", "收件人手机号", "详细地址", "快递信息"],
    "removedReason": { "收件人": "隐私字段，不在运营版白名单", "详细地址": "隐私字段" },
    "affectsStats": false
  },
  "durationMs": 8
}
```

---

**动作 8：export_dataset（导出数据集）**

用途：将当前数据集（可叠加 filter + trim_columns）导出为 Excel 文件。

输入参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| format | enum | 否 | xlsx（默认）/ csv |
| filterConditions | Condition[] | 否 | 导出前过滤 |
| keepFields | string[] | 否 | 只导出这些字段 |
| templateId | string | 否 | 使用预定义模板 |

输出格式：

```json
{
  "action": "export_dataset",
  "params": { "format": "xlsx", "templateId": "operations" },
  "result": {
    "exportedRows": 42203,
    "exportedFields": 12,
    "downloadUrl": "https://...",
    "filename": "ATLAS_运营版_20260314.xlsx"
  },
  "durationMs": 1200
}
```

---

**动作 9：draw_chart（生成图表）**

用途：基于 group_by 或 distribution 的结果生成可视化图表（内嵌在对话中展示）。

输入参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| chartType | enum | 是 | bar / pie / line / scatter |
| data | object[] | 是 | 来自 group_by 或 distribution 的 result 数组 |
| title | string | 否 | 图表标题 |
| xField | string | 否 | X 轴字段名（bar/line） |
| yField | string | 否 | Y 轴字段名 |

输出格式：

```json
{
  "action": "draw_chart",
  "params": { "chartType": "bar", "title": "达人销售额 Top5" },
  "result": {
    "chartSpec": { ... },
    "renderType": "inline"
  },
  "durationMs": 5
}
```

---

## 四、前端执行卡片设计

每次 AI 调用一个动作，前端渲染一个"执行卡片"，样式参考 Kimi 的"运行 Python 代码"展开框，但内容更易读。

卡片结构（默认折叠）：

```
┌─────────────────────────────────────────────┐
│ ▶ 执行动作：group_by                  42ms  │
└─────────────────────────────────────────────┘
```

展开后：

```
┌─────────────────────────────────────────────┐
│ ▼ 执行动作：group_by                  42ms  │
│                                             │
│ 参数                                        │
│   分组字段：达人昵称                         │
│   统计字段：订单应付金额                      │
│   聚合方式：求和（sum）                       │
│   返回条数：Top 5                            │
│                                             │
│ 结果（共 46,906 行参与计算）                  │
│   老王真知灼见    ¥178,182    18,603 单       │
│   胡说老王        ¥156,430    15,200 单       │
│   ...                                       │
└─────────────────────────────────────────────┘
```

卡片后面紧跟 AI 的自然语言解读：

```
从数据来看，老王真知灼见贡献了最高销售额 ¥178,182，
占总销售额的约 8.9%，是当前最强带货达人。
Top 3 达人合计贡献超过 60% 的销售额，集中度较高。
```

---

## 五、实现路径（三步）

### 第一步：后端动作执行引擎

文件：server/pipeline/actions.ts（新建）

内容：
- 定义 ActionRequest 和 ActionResult 接口
- 实现 9 个动作的执行函数（基于已有的 loadSessionData + Pandas 计算逻辑）
- 导出 executeAction(sessionId, actionRequest) → ActionResult

改动范围：仅新增文件，不修改现有文件。

### 第二步：改造 chat 端点

文件：server/atlas.ts（修改 chat 端点）

改动内容：
- 在 streamText 调用中注入 tools（function calling 工具定义）
- 每次 AI 调用工具时，后端执行 executeAction，把结果注入 stream
- 在 stream 中插入特殊标记 `[ACTION_RESULT]...[/ACTION_RESULT]`，前端解析后渲染执行卡片

改动范围：chat 端点内部，不影响其他端点。

### 第三步：前端渲染执行卡片

文件：client/src/components/ActionCard.tsx（新建）

内容：
- 解析 stream 中的 `[ACTION_RESULT]` 标记
- 渲染可折叠的执行卡片
- 支持 group_by / filter / distribution / anomaly_scan 的结果格式化展示

改动范围：仅新增组件，在 chat 渲染逻辑中调用。

---

## 六、风险点

| 风险 | 说明 | 应对 |
|------|------|------|
| AI 参数填错 | AI 可能填写不存在的字段名 | 执行前校验字段是否存在，不存在返回 error 而非抛异常 |
| 大文件性能 | 10 万行 group_by 可能耗时较长 | 优先用 dfInfo 中已有的 groupedTop5，避免重新全表扫描 |
| stream 格式兼容 | 插入 ACTION_RESULT 标记可能影响现有 Markdown 渲染 | 标记使用特殊前缀，前端优先解析，不影响普通文本 |
| 多轮动作依赖 | draw_chart 依赖 group_by 的结果 | 第一阶段不做跨动作依赖，每个动作独立执行 |

---

## 七、不在本方案范围内

- 多轮分析闭环（AI 主动发起下一轮动作）：留待第二阶段
- 精简导出模板（运营版/财务版/达人版/投放版）的字段白名单定义：需与业务方对齐后单独实施
- draw_chart 的图表渲染：第一阶段只做文字结果卡片，图表留待第三阶段

---

## 八、交付清单

| 文件 | 类型 | 说明 |
|------|------|------|
| server/pipeline/actions.ts | 新增 | 动作执行引擎，9 个动作 |
| server/atlas.ts | 修改 | chat 端点注入 function calling tools |
| client/src/components/ActionCard.tsx | 新增 | 执行卡片前端组件 |
| server/actions.test.ts | 新增 | 动作执行引擎单元测试 |

---

## 九、审核要点

请重点确认以下几点：

1. 动作集范围是否合适？是否有遗漏或多余的动作？
2. 执行卡片的展示格式是否符合预期？
3. 第一阶段是否先只实现 group_by + filter + distribution 三个最常用动作，其余动作后续补充？
4. trim_columns 的模板白名单（运营版/财务版/达人版/投放版）是否现在就要定义，还是留到第二阶段？
5. draw_chart 是否在第一阶段实现，还是先跳过？
