# ATLAS Phase 3 技术开发设计文档

**版本：** v1.0  
**日期：** 2026-03-11  
**状态：** 待审核

---

## 一、Phase 1/2 遗留问题修复（紧急，建议本周完成）

### Bug 1：考勤模块格式兼容性缺陷（严重）

**根本原因分析**

当前 `analyzeAttendance()` 函数（`server/hr.ts` 第 215 行）的逻辑是：若 `checkIn` 字段为空且 `statusCol` 也无值，则直接判定为"旷工"（第 283 行：`else if (!checkIn && !rawStatus) { status = "absent"; }`）。

"出勤天数汇总格式"的考勤表（每行代表一个员工的月度汇总，含"实际出勤天数"列，无逐日打卡记录）上传后，`checkInCol` 和 `checkOutCol` 均为空，触发了上述旷工判定，导致所有员工被误判。

**涉及文件**

| 文件 | 位置 | 改动类型 |
|------|------|---------|
| `server/hr.ts` | `detectAttendanceFields()` 第 160 行 | 新增汇总格式识别返回字段 |
| `server/hr.ts` | `analyzeAttendance()` 第 215 行 | 新增汇总格式分支 |
| `server/hr.ts` | `attendance/upload` 接口第 722 行 | 返回 `tableFormat` 字段给前端 |
| `client/src/pages/AttendancePage.tsx` | 字段映射步骤 | 根据 `tableFormat` 展示不同字段配置 UI |

**技术方案**

第一步：在 `detectAttendanceFields()` 中新增 `tableFormat` 字段判断：
```ts
// 如果表头中存在"出勤天数"/"实际出勤"等汇总字段，返回 tableFormat: "summary"
// 否则返回 tableFormat: "timelog"（逐日打卡格式，现有逻辑）
tableFormat: "summary" | "timelog"
```

第二步：新增 `analyzeAttendanceSummary()` 函数，处理汇总格式：
```ts
// 直接读取 presentDaysCol、absentDaysCol、lateDaysCol 等字段
// 跳过打卡时间解析，直接输出 byEmployee 汇总
```

第三步：`attendance/analyze` 接口根据 `tableFormat` 分支调用不同函数，两条路径最终输出相同的 `{ records, summary, byEmployee }` 结构，下游 Excel 生成逻辑无需改动。

**工作量评估：** 0.5 天

---

### Bug 2：字段标准化缺乏用户反馈（体验缺陷）

**根本原因分析**

`normalizeFieldNames()` 返回的 `fieldMapping`（如 `{"月薪":"基本工资","KPI奖金":"绩效工资"}`）目前只打印到服务器日志（第 875 行 `console.log`），未传回前端，用户无感知。

**涉及文件**

| 文件 | 位置 | 改动类型 |
|------|------|---------|
| `server/atlas.ts` | `res.json()` 第 1032 行 | 在响应中新增 `field_mapping` 字段 |
| `server/hr.ts` | `payslip/upload` 响应 | 新增 `field_mapping` 字段 |
| `client/src/pages/MainWorkspace.tsx` | 文件上传完成后的消息渲染 | 展示字段映射提示卡片 |
| `client/src/pages/PayslipPage.tsx` | 字段映射步骤 UI | 在自动识别结果旁显示映射说明 |

**技术方案**

后端：在上传接口的 `res.json()` 中新增一行：
```ts
field_mapping: mappingEntries.length > 0 
  ? mappingEntries.map(([o, c]) => `[${o}] → [${c}]`).join("、") 
  : null
```

前端（MainWorkspace）：在文件上传完成后，若 `field_mapping` 非空，在 AI 分析消息下方插入一个浅色提示块：
```
💡 已自动识别并映射：[月薪] → [基本工资]，[KPI奖金] → [绩效工资]
```

前端（PayslipPage）：在字段映射步骤的自动识别结果旁，用小标签展示"已从 [月薪] 自动识别"。

**工作量评估：** 0.5 天

---

### Bug 3：数据质量预警缺失（智能化不足）

**根本原因分析**

现有 `qualityIssues` 数组（第 862 行）已有缺失值检测和借贷平衡检测，但缺少**异常高值检测**（如"90.6% 员工工资低于均值"这类受极端值影响的情况）。

`computeKeyMetrics()` 函数（第 1267 行）已计算了 `outliers`（>3倍均值的异常值数量），但这个结果没有被加入 `qualityIssues`。

**涉及文件**

| 文件 | 位置 | 改动类型 |
|------|------|---------|
| `server/atlas.ts` | `qualityIssues` 生成区块（第 862 行附近） | 新增异常高值预警逻辑 |

**技术方案**

在 `qualityIssues` 生成区块中，遍历 `computeKeyMetrics()` 的结果，若某字段 `outliers > 0`，追加预警：
```ts
for (const metric of metrics) {
  if (metric.outliers > 0) {
    const pctBelow = Math.round(((metric.count - metric.outliers) / metric.count) * 100);
    qualityIssues.push(
      `⚠️ 异常高值预警：[${metric.name}] 中有 ${metric.outliers} 个值超过均值3倍，` +
      `导致 ${pctBelow}% 的记录低于均值，建议核查异常数据`
    );
  }
}
```

**工作量评估：** 0.25 天

---

## 二、Phase 3 核心业务场景升级

### 需求 1：电商多平台数据智能对齐与汇总（出纳场景）

**现状盘点**

- 多文件上传：前端已支持（`MainWorkspace` 文件列表），后端 `chat` 接口已接受 `session_ids` 数组（第 1057 行）
- 同义词映射：`FIELD_SYNONYM_MAP` 已有基础电商词汇（销售额/GMV/收入等）
- **缺失**：多文件自动字段对齐 + 合并输出《多平台汇总表》的专用接口

**涉及文件**

| 文件 | 位置 | 改动类型 |
|------|------|---------|
| `server/atlas.ts` | `FIELD_SYNONYM_MAP` 第 261 行 | 扩展电商平台专用词汇 |
| `server/atlas.ts` | 新增 `POST /api/atlas/merge` 接口 | 多文件合并专用接口 |
| `client/src/pages/MainWorkspace.tsx` | 多文件上传后的快捷按钮 | 新增"合并多平台数据"按钮 |

**技术方案**

**A. 同义词库扩展（低风险，增量添加）**

在 `FIELD_SYNONYM_MAP` 中新增平台专用字段：
```ts
"总销售额": [...现有词, "实收金额", "订单总额", "销售收入", "成交金额", "实际收款", "实付金额"],
"平台名称": ["渠道来源", "来源平台", "销售渠道", "platform"],
"商品名称": ["品名", "货品名称", "SKU名称", "item_name", "product_name"],
"商品数量": ["数量", "销量", "件数", "qty", "quantity"],
"退款金额": [...现有词, "退款总额", "退货退款", "已退款"],
```

**B. 多文件合并接口（新增，不影响现有逻辑）**

新增 `POST /api/atlas/merge` 接口，接受 `session_ids[]`：
1. 从 S3 拉取各文件数据
2. 对每个文件调用 `normalizeFieldNames()` 统一字段名
3. 纵向合并（`concat`），补充"来源文件"列标识数据来源
4. 生成《多平台销售汇总表》Excel（按平台分 Sheet + 总汇总 Sheet）
5. 上传 S3，返回下载链接

前端：当用户上传 2 个以上文件时，在快捷按钮区显示"合并多平台数据"按钮，点击调用此接口。

**工作量评估：** 1.5 天

---

### 需求 2：财务合规检查与高精度计算（会计场景）

**现状盘点**

- `decimal.js` 已安装，`computeKeyMetrics()` 中的求和已用 Decimal（P2-B 已完成）
- 借贷平衡检查已实现（P2-A 已完成）
- **缺失**：工资条生成（`hr.ts`）中的税后工资计算仍用原生 `Number` 运算

**涉及文件**

| 文件 | 位置 | 改动类型 |
|------|------|---------|
| `server/hr.ts` | `generatePayslipExcel()` 第 323 行 | 税后工资/扣款计算改用 Decimal |
| `server/hr.ts` | `payslip/generate` 接口 | 个税计算改用 Decimal |

**技术方案**

在 `hr.ts` 顶部引入 `decimal.js`，将工资计算中的加减法替换：
```ts
// 改前
const netSalary = baseSalary + bonus - deduction - tax;
// 改后
const netSalary = new Decimal(baseSalary).plus(bonus).minus(deduction).minus(tax).toNumber();
```

借贷平衡检查已完成，无需重复开发。

**工作量评估：** 0.5 天

---

### 需求 3：报表导出 WPS 兼容性保障（通用能力）

**现状盘点**

当前使用 `xlsx@0.18.5`（SheetJS 社区版）。该版本对 WPS 的兼容性存在已知问题：
- 中文字体样式在 WPS 中可能丢失
- 部分公式（如 `SUMIF`）在 WPS 中可能显示为 `#NAME?`
- 合并单元格在某些 WPS 版本中错位

**涉及文件**

| 文件 | 位置 | 改动类型 |
|------|------|---------|
| `server/hr.ts` | `generatePayslipExcel()` / `generateAttendanceExcel()` | 替换为 ExcelJS |
| `server/atlas.ts` | 报表生成相关代码 | 替换为 ExcelJS |
| `package.json` | 依赖 | 新增 `exceljs`，移除或保留 `xlsx` |

**技术方案**

将 `xlsx` 替换为 `exceljs@4.x`（专为 WPS/Excel 兼容性优化）：

优势对比：

| 特性 | xlsx 社区版 | exceljs |
|------|------------|---------|
| WPS 字体样式 | 部分丢失 | 完整保留 |
| 公式兼容 | 有问题 | 标准 OOXML，WPS 完全兼容 |
| 单元格样式 | 基础支持 | 完整支持（边框/颜色/对齐） |
| 流式写入 | 不支持 | 支持（大文件性能更好） |

迁移策略：先迁移 `generatePayslipExcel()`（最常用），验证 WPS 兼容后再迁移考勤报表和 atlas 报表。

**工作量评估：** 1 天（含测试）

---

## 三、工作量汇总与建议排期

| 优先级 | 需求 | 工作量 | 建议完成时间 |
|--------|------|--------|------------|
| P0（紧急修复） | Bug 1：考勤格式兼容 | 0.5 天 | 本周一 |
| P0（紧急修复） | Bug 3：异常高值预警 | 0.25 天 | 本周一 |
| P0（紧急修复） | Bug 2：字段映射 UI 提示 | 0.5 天 | 本周二 |
| P1（高优） | 需求 1A：同义词库扩展 | 0.25 天 | 本周二 |
| P1（高优） | 需求 2：工资计算 Decimal 全覆盖 | 0.5 天 | 本周三 |
| P1（高优） | 需求 1B：多文件合并接口 | 1.5 天 | 本周四~五 |
| P2（次优） | 需求 3：WPS 兼容性（exceljs 迁移） | 1 天 | 下周一~二 |
| **合计** | | **4.5 天** | **约 1.5 周** |

---

## 四、回归测试范围

每个 P0 修复上线前，必须验证以下 6 条核心链路：

1. **考勤打卡格式**：上传逐日打卡表 → 分析 → Excel 下载正常
2. **考勤汇总格式**（新增）：上传含"实际出勤天数"的汇总表 → 无旷工误判 → Excel 正确
3. **工资条标准字段**：上传标准字段工资表 → 生成工资条 → 数据正确
4. **工资条非标字段**：上传含"月薪"/"KPI奖金"的工资表 → 字段映射提示显示 → 工资条正确
5. **销售数据分析**：上传销售表 → AI 分析 → 关键指标正确
6. **多文件合并**（新增）：上传 2 份不同平台报表 → 合并汇总 → 来源标识正确

所有修复上线前必须通过现有 69 个 vitest 单元测试。
