# 牵牛花平台 DOM 规格文档

> v0.1 · 林深 · 2026-04-03
> 基于 dry-run 截图 + 页面分析制定，韩铭据此实现 doCollect()

---

## 平台基本信息

| 项目 | 值 |
|------|-----|
| 登录入口 | `https://qnh.meituan.com/login.html` |
| 登录 SDK | `https://qnh-epassport.meituan.com/portal/login?feconfig=qianniuhua-admin-support-phone-account...` |
| 主 Shell | `https://qnh.meituan.com/home.html` |
| 路由模式 | SPA Hash 路由（`#/模块/页面`），**禁止直接 goto 带 # 的 URL** |
| 反检测 | YODA 滑块（登录时），登录后正常浏览无额外检测 |
| Cookie 有效期 | 估计 7-14 天，`.enc.json` 存档 |

---

## 导航规则（重要）

```typescript
// ✅ 正确：先 goto shell，再 evaluate 改 hash
await page.goto('https://qnh.meituan.com/home.html', { waitUntil: 'load' });
await page.evaluate((hash) => { location.hash = hash; }, '#/data/home/new');
await page.waitForTimeout(3000); // SPA 渲染等待

// ❌ 错误：直接 goto 带 # 的 URL 会触发 ERR_ABORTED
await page.goto('https://qnh.meituan.com/home.html#/data/home/new'); // 禁止
```

---

## 页面一：首页数据总览（已验证）

**Hash**: `#/data/home/new?fromSource=loginPage`

**截图确认可见字段**：

### 核心指标区（KPI Cards）

| 字段名 | 示例值 | 备注 |
|--------|--------|------|
| 有效订单金额 | 32,706.87 | 含周比/环比 |
| 有效订单数 | 868 | |
| 客单价 | 37.68 | |
| 净利润 | （需线上/线下展开） | |
| 实付金额 | 20,730.86 | |
| 实付客单价 | 23.88 | |
| 商品销售额 | 29,614.58 | |
| 包装费 | 882.00 | |
| 配送费 | 2,288.30 | |
| 顾客数 | 871 | |
| 商品动销率 | — | 无今日数据 |
| 整单超时率 | 5.85% | |
| 缺货退款率 | — | |

**DOM 选择器思路**（待韩铭 inspect 确认）：
```
KPI 卡片容器: [class*="index-card"] 或 [class*="kpi-item"]
指标数值: [class*="value"] 或 [class*="amount"]
指标标题: [class*="title"] 或 [class*="label"]
```

### 门店明细表

**表头字段**（首页截图确认）：

| 序号 | 门店 | 有效订单金额 | 有效订单数 | 客单价 | 实付金额 | 实付客单价 | 商品销售额 | 包装费 | 配送费 | 顾客数 | 整单超时率 |
|------|------|-------------|-----------|--------|---------|-----------|-----------|--------|--------|--------|-----------|

**示例数据行**：
```
1 | 京东便利店(连美总店) | 7,559.91 | 175 | 43.20 | 4,253.79 | 24.31 | 6,417.91 | 173.00 | 969.00 | 173 | 0%
2 | 京东便利店(回溪换新店) | 5,383.01 | 153 | 35.18 | 3,960.21 | 25.88 | 5,032.55 | 153.00 | 245.80 | 155 | 12.58%
```

**DOM 选择器**：
```
表格: table 或 [class*="store-table"]
表头: thead th 或 [class*="el-table__header"] th
数据行: tbody tr 或 [class*="el-table__row"]
导出按钮: button:has-text("导出") 或 [class*="export"]
```

**当前门店数**: 14 家（含「模板门店」和「京东便利店(软件园三期店)」）

### 渠道分布

| 渠道 | 已知渠道 |
|------|---------|
| 美团闪购 | ✅（主渠道，黄色） |
| 饿了么 | ✅（蓝色） |
| 京东到家 | ✅（绿色） |

---

## 页面二：库存管理

**Hash**: `#/inventory/list`（待确认，也可能是 `#/store/inventory`）

**需要采集的字段**：
- 商品名称 / SKU
- 当前库存数量
- 库存预警阈值
- 所属门店
- 商品分类
- 进价 / 售价

**导出**：待韩铭确认是否有导出按钮

---

## 页面三：采购管理

**Hash**: `#/purchase/list`（待确认）

**需要采集的字段**：
- 采购单号
- 供应商名称
- 商品名称 / SKU / 数量
- 采购单价 / 总价
- 下单时间 / 到货时间
- 采购状态

---

## 页面四：财务-结算

**Hash**: `#/finance/settlement` 或 `#/finance/bill`

**需要采集的字段**：
- 结算周期
- 各渠道（美团/饿了么/京东到家）结算金额
- 平台佣金
- 实际到账金额
- 结算状态

---

## 待韩铭补全的部分

韩铭，请运行以下命令截图并补全上面各页面的 DOM 选择器：

```bash
cd packages/backend
npx tsx src/adapters/rpa/run-qianniuhua-explore.ts
```

或者直接在 `doDryRun()` 里加多页面截图，然后：

1. 用 Chrome DevTools inspect 确认 KPI 卡片的实际 CSS class
2. 确认表格用的是 Element UI / Ant Design / 自研组件
3. 确认分页选择器（每页条数 / 翻页按钮）
4. 确认导出按钮是否存在及其选择器

**完成后更新本文档，我来写接入方案，再指导你实现 `doCollect()`。**

---

## UnifiedInventorySignal 字段映射草稿

```typescript
// 首页聚合数据 → UnifiedDailyMetrics
{
  date: '2026-04-03',
  channel: 'qianniuhua_aggregate',
  gmv: 32706.87,           // 有效订单金额
  orderCount: 868,          // 有效订单数
  avgOrderValue: 37.68,     // 客单价
  actualPaid: 20730.86,     // 实付金额
  productSales: 29614.58,   // 商品销售额
  deliveryFee: 2288.30,     // 配送费
  packagingFee: 882.00,     // 包装费
  customerCount: 871,       // 顾客数
  timeoutRate: 0.0585,      // 整单超时率
}

// 门店明细 → UnifiedStoreMetrics（新 Schema，方晓待设计）
{
  storeId: '京东便利店(连美总店)',
  channel: 'meituan_flash' | 'eleme' | 'jddj' | 'aggregate',
  gmv: 7559.91,
  orderCount: 175,
  avgOrderValue: 43.20,
  // ...
}
```

---

## 技术风险

| 风险 | 等级 | 应对 |
|------|------|------|
| SPA 路由 hash 导航 | 低 | 已有 navigateToDataHome 模板 |
| 页面渲染等待 | 低 | waitForSelector + humanDelay |
| Cookie 过期 | 中 | 检测登录状态，触发重新登录 |
| 滑块验证（重新登录时） | 高 | 预留人工介入窗口，或手机验证码 |
| 分页数据采集 | 中 | 循环翻页，限制最大页数（≤10页） |
| 多门店数据量 | 低 | 14家，一次全量即可 |
