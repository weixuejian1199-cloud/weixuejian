# A 阶段任务分析：定规矩

## 方案要求的 A 阶段交付物

1. 字段映射表完整版（30 个标准字段 × 4 个平台）
2. 统计口径定义完整版（10 个口径的精确计算规则）
3. 处理管道 9 个步骤的输入输出数据结构定义
4. ResultSet 数据结构定义（含可审计字段）
5. AI 表达边界规则
6. 模板计算公式（L1 四个模板的完整公式）

## 现有代码盘点

### 已有的能力（可复用）
- `parseFile.ts`：前端解析 Excel/CSV，全量统计 sum/avg/max/min/count，groupedTop5，categoryGroupedTop20
- `atlas.ts`：后端上传/解析/AI对话/报表生成，FieldInfo/DataFrameInfo 接口已定义
- `hr.ts`：工资条生成（个税计算 + exceljs）、考勤汇总
- SPU_MAPPING：商品名标准化映射（硬编码在 parseFile.ts）
- normalizeFieldNames()：字段同义词映射（在 atlas.ts 中）
- detectScenario()：场景识别（销售/工资/考勤/分红/库存）
- computeKeyMetrics()：关键指标提炼
- Decimal.js：金额精确计算

### 缺失的能力（需要新建）
1. **全局字段映射表**：当前 normalizeFieldNames 只做了部分同义词，没有按方案要求的 30 字段 × 4 平台结构化
2. **统计口径定义**：当前口径散落在 AI prompt 和 computeKeyMetrics 中，没有独立的口径定义文件
3. **ResultSet 数据结构**：当前没有统一的 ResultSet 类型，数据分散在 dfInfo/numericStats/groupedTop5 等多个对象中
4. **ResultSet 可审计字段**：job_id/source_files/filters_applied/skipped_rows_count 等 8 个字段完全没有
5. **处理管道 9 步定义**：当前逻辑混在 atlas.ts 和 parseFile.ts 中，没有分层
6. **AI 表达边界规则**：当前 system prompt 有部分约束，但没有独立的规则配置文件
7. **L1 模板计算公式**：工资条和考勤有实现，但多店合并和利润统计没有独立的公式定义
8. **错误分级**：方案定义了四级（致命/严重/警告/信息），当前没有统一的错误分级体系

## A 阶段执行计划

### 任务 A1：字段映射表（fieldAliases.ts）
- 创建 `shared/fieldAliases.ts`
- 定义 30 个标准字段 × 4 平台的映射关系
- 导出 `FIELD_ALIASES` 和 `normalizeFieldName()` 函数
- 复用现有 normalizeFieldNames 的逻辑，但结构化

### 任务 A2：统计口径定义（metrics.ts）
- 创建 `shared/metrics.ts`
- 定义 10 个核心口径的精确计算规则（函数签名 + 精度 + 说明）
- 每个口径有 name/formula/precision/description

### 任务 A3：ResultSet 类型定义（resultSet.ts）
- 创建 `shared/resultSet.ts`
- 定义 ResultSet 接口，包含：
  - 计算结果数据（metrics/rankings/groupedData）
  - 8 个可审计字段（job_id/source_files/filters_applied/skipped_rows_count/skipped_rows_sample/computation_version/template_id/created_at）
  - 元数据（row_count/col_count/source_platform）

### 任务 A4：处理管道数据结构定义（pipeline.ts）
- 创建 `shared/pipeline.ts`
- 定义 9 个步骤的输入输出接口（RawRows/CleanedRows/ResultSet 等）
- 定义错误分级枚举和 PipelineError 类型

### 任务 A5：AI 表达边界规则（aiConstraints.ts）
- 创建 `shared/aiConstraints.ts`
- 定义 AI 可以/不可以做的事情的结构化规则
- 导出 prompt 硬约束语句

### 任务 A6：L1 模板计算公式定义（templates.ts）
- 创建 `shared/templates.ts`
- 定义 4 个 L1 模板的必需字段、可选字段、计算公式
  - 多店合并：字段对齐 + SUM/COUNT 聚合
  - 工资条：底薪 + 绩效 - 扣款 - 个税
  - 考勤：打卡时间 → 迟到/早退/缺勤统计
  - 利润统计：收入 - 成本 - 费用

### 任务 A7：数据库 schema 更新
- 在 drizzle/schema.ts 中新增/修改表结构以支持 ResultSet 存储
- 运行 pnpm db:push

### 任务 A8：单元测试
- 为字段映射、口径计算、ResultSet 验证编写 vitest 测试
