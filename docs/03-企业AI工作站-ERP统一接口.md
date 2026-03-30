# 企业 AI 工作站 · ERP/商城 统一接口规范

> 版本：v2.1 · 2026-03-30 · 本文档定义 ERP 和商城适配层的统一接口契约，所有适配器必须严格遵守
> v2.1 变更：新增 MallAdapter（ztdy-open 商城 API），Phase 1 主数据源（ADR-024）

---

## 一、设计原则

**核心原则：上层业务只调用标准接口，完全不感知底层是哪家 ERP。**

- 新增一家 ERP 只需实现适配器，零改动业务代码
- 每个适配器把各家 ERP 的私有格式转换为统一数据结构
- 适配器层统一处理认证、限频、重试、错误转换
- Agent 工具函数优先查询本地数据库，仅"强制刷新"时触发适配器调用

```
业务层（Agent 工具函数）
    ↕ 统一接口
缓存层（Redis TTL=5min）
    ↕
适配层（AdapterFactory 按 type 分发）
    ├── MallAdapter（ztdy-open 商城）  ← Phase 1 主数据源（ADR-024）
    ├── JSTAdapter（聚水潭）
    ├── WDTAdapter（旺店通）
    ├── GYYAdapter（管易云）
    └── CSVAdapter（CSV/Excel导入 + 用户上传分析）
    ↕
各家 ERP/商城 API
```

### MallAdapter（Phase 1 主数据源）

> ztdy-open 是现有运营中的商城系统（极速订货），Phase 1 通过 API 读取真实数据验证 AI 能力。
> Phase 2 自建商城上线后，MallAdapter 退役，切换为同库直查。适配器模式让过渡零痛感。

| 端点 | 内部方法 | 数据量 | 说明 |
|------|---------|--------|------|
| GET /api/Open/UserPageList | getUsers() | 146万 | 用户/会员数据 |
| GET /api/Open/OrderPageList | getOrders() | 95万 | 订单数据（含供应商/状态） |
| GET /api/Open/ItemPageList | getItems() | 8466 | 商品数据（含上下架状态） |
| GET /api/Open/SupplierPageList | getSuppliers() | 1142 | 供应商数据 |
| GET /api/Open/SupplierWithdrawPageList | getSupplierWithdraws() | 8454 | 供应商提现记录 |
| GET /api/Open/UserWithdrawPageList | getUserWithdraws() | 28730 | 用户提现/佣金记录 |

**认证方式**：Header `api-key`，密钥通过环境变量注入
**响应格式**：`{ Data: { PageIndex, PageSize, TotalCount, PageData: [...] }, Status, Message, Code }`
**写操作**：Phase 1 全部只读。Phase 2 规划让第三方配合开放写 API（BL-018）

**注意**：TeamBonusPageList 和 ItemStockPageList 两个端点未通（返回 HTML），需联系第三方确认（PIT-016）

---

## 二、接入优先级

### ERP 系统

| 优先级 | ERP | 主要用户群 | 状态 |
|--------|-----|----------|------|
| P0 | 聚水潭 | 中小电商主流 | 第一批实现 |
| P0 | 旺店通 | 中大型商家 | 第一批实现 |
| P1 | 管易云 | 天猫京东商家 | 第二批 |
| P1 | 旺店通奇门 | 多仓管理 | 第二批 |
| P2 | 金蝶云 | 财务向企业 | 第三批 |
| P2 | 用友畅捷通 | 中小企业财务 | 第三批 |
| 已有 | CSV 手工导入 | 兜底方案 | 已实现 |

### 电商平台

| 优先级 | 平台 | 说明 |
|--------|------|------|
| P0 | 抖店 | 直播电商 |
| P0 | 天猫 | 综合电商 |
| P0 | 美团闪购 | 即时零售 |
| P1 | 京东 | 综合电商 |
| P1 | 拼多多 | 综合电商 |
| P2 | 饿了么 | 即时零售 |

---

## 三、适配器基类

基类同时承担两项职责：**定义抽象接口**（子类必须实现）和**提供通用能力**（HTTP 请求、重试、限频、健康检查等）。

### 3.1 基类定义

```javascript
// backend/src/adapters/base.js

class ERPAdapterBase {
  constructor(connection) {
    this.tenantId = connection.tenantId
    this.credentials = this.decrypt(connection.credentials)
    this.config = connection.config
    this.erpType = connection.erpType
  }

  // =============================================
  // 通用能力（基类已实现，子类直接继承）
  // =============================================

  /**
   * 封装 HTTP 请求，统一处理重试、限频、超时
   * - 超时：10秒，超时后降级返回缓存数据
   * - 限频：检测 429 响应，暂停 60 秒后重试
   * - 重试：指数退避 1min → 5min → 15min，最多 3 次
   */
  async _request(url, params = {}) {
    const maxRetries = 3
    const retryDelays = [60_000, 300_000, 900_000] // 1min, 5min, 15min

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...params,
          signal: AbortSignal.timeout(10_000), // 10秒超时
        })

        if (response.status === 429) {
          // 限频：暂停 60 秒后进入下一轮重试
          await this._sleep(60_000)
          continue
        }

        if (!response.ok) {
          throw new ERPRequestError(response.status, await response.text())
        }

        return await response.json()
      } catch (err) {
        if (err.name === 'TimeoutError') {
          // 超时降级：返回缓存数据
          return this._fallbackToCache(url, params)
        }
        if (attempt < maxRetries) {
          await this._sleep(retryDelays[attempt])
          continue
        }
        throw err
      }
    }
  }

  /**
   * 健康检查：检测 ERP 连接凭证有效性和 API 可用性
   * @returns {{ ok: boolean, latencyMs: number, error?: string }}
   */
  async healthCheck() {
    throw new Error('Not implemented — 子类必须实现健康检查逻辑')
  }

  /**
   * Webhook 签名验证
   * @param {object} payload  Webhook 请求体
   * @param {string} signature  请求头中的签名
   * @returns {boolean}
   */
  verifyWebhook(payload, signature) {
    throw new Error('Not implemented — 子类必须实现 Webhook 验签')
  }

  // =============================================
  // 抽象转换方法（子类必须实现）
  // 将 ERP 私有数据格式映射为统一结构
  // =============================================

  _transformOrder(rawOrder) { throw new Error('Not implemented') }
  _transformProduct(rawProduct) { throw new Error('Not implemented') }
  _transformAfterSale(rawAfterSale) { throw new Error('Not implemented') }
  _transformSupplier(rawSupplier) { throw new Error('Not implemented') }

  // =============================================
  // 业务抽象方法（子类必须实现）
  // =============================================

  // ========== 订单模块 ==========
  async getOrders(filters) { throw new Error('Not implemented') }
  async getOrderDetail(orderId) { throw new Error('Not implemented') }
  async getOrdersByShop(shopId, period) { throw new Error('Not implemented') }

  // ========== 商品库存模块 ==========
  async getProducts(shopId, filters) { throw new Error('Not implemented') }
  async getInventory(skuIds) { throw new Error('Not implemented') }
  async getLowStockItems(shopId, threshold) { throw new Error('Not implemented') }

  // ========== 供应商模块 ==========
  async getSuppliers(filters) { throw new Error('Not implemented') }
  async getSupplierOrders(supplierId, period) { throw new Error('Not implemented') }

  // ========== 财务模块 ==========
  async getCashflow(period) { throw new Error('Not implemented') }
  async getPlatformFees(shopId, period) { throw new Error('Not implemented') }
  async getPaymentRecords(period) { throw new Error('Not implemented') }

  // ========== 售后模块 ==========
  async getAfterSales(filters) { throw new Error('Not implemented') }
  async getRefundDetail(refundId) { throw new Error('Not implemented') }
  async getRefundStats(period) { throw new Error('Not implemented') }

  // =============================================
  // 内部辅助
  // =============================================

  async _fallbackToCache(url, params) {
    // 从 Redis 缓存读取并标注 stale
    const cached = await redis.get(this._cacheKey(url, params))
    if (cached) {
      return { ...JSON.parse(cached), _stale: true, _cachedAt: cached._cachedAt }
    }
    throw new ERPTimeoutError('ERP 超时且无可用缓存')
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
```

### 3.2 缓存层设计

在适配器之上引入 Redis 缓存层，减少对 ERP API 的直接调用：

| 策略 | 说明 |
|------|------|
| **缓存热数据** | 最近查询过的订单、商品数据写入 Redis，TTL = 5 分钟（与增量同步频率对齐） |
| **优先读本地** | Agent 工具函数优先查询本地数据库（Prisma），只有用户明确"强制刷新"时才触发适配器实时调用 |
| **超时降级** | ERP_TIMEOUT 时降级返回缓存数据，响应中标注 `_stale: true` 和 `_cachedAt` 时间戳，界面需向用户提示数据时效 |
| **缓存键规则** | `v1:erp:{tenantId}:{erpType}:{method}:{paramsHash}`，带版本前缀，数据模型升级时更新版本号使旧缓存自动失效，避免跨租户数据泄漏 |

```
请求流程：

Agent 工具函数
  → 查询本地数据库（Prisma）
  → 命中 → 返回（标注 syncedAt）
  → 未命中 / 强制刷新
      → 查询 Redis 缓存
      → 命中 → 返回（标注 _cachedAt）
      → 未命中 → 调用适配器 → 写入 Redis + 写入数据库 → 返回
```

### 3.3 适配器工厂与注册机制

通过工厂模式按 `erpType` 自动创建对应适配器实例，新增 ERP 只需注册即可：

```javascript
// backend/src/adapters/factory.js

class AdapterFactory {
  static adapters = new Map()

  /**
   * 注册适配器类型
   * @param {string} erpType   如 'jushuitang', 'wangdiantong', 'guanyiyun', 'csv'
   * @param {typeof ERPAdapterBase} AdapterClass
   */
  static register(erpType, AdapterClass) {
    this.adapters.set(erpType, AdapterClass)
  }

  /**
   * 根据连接配置创建适配器实例
   * @param {object} connection  ERPConnection 记录（含 erpType / credentials / config）
   * @returns {ERPAdapterBase}
   */
  static create(connection) {
    const AdapterClass = this.adapters.get(connection.erpType)
    if (!AdapterClass) {
      throw new Error(`未注册的 ERP 类型: ${connection.erpType}`)
    }
    return new AdapterClass(connection)
  }
}

// 注册已实现的适配器
AdapterFactory.register('jushuitang', JSTAdapter)
AdapterFactory.register('wangdiantong', WDTAdapter)
AdapterFactory.register('guanyiyun', GYYAdapter)
AdapterFactory.register('csv', CSVAdapter)
```

---

## 四、统一响应格式

### 成功响应
```json
{
  "success": true,
  "data": { },
  "meta": {
    "total": 1248,
    "page": 1,
    "pageSize": 100,
    "syncedAt": "2025-03-28T10:00:00Z",
    "source": "jushuitang"
  }
}
```

### 失败响应
```json
{
  "success": false,
  "error": {
    "code": "ERP_RATE_LIMITED",
    "message": "聚水潭API限频，请稍后重试",
    "retryAfter": 60
  }
}
```

### 分页参数说明

统一接口对外承诺 `pageSize` 最大 200 条。各 ERP 底层的分页上限不同（如聚水潭单次最多 100 条），适配层内部自动拆分请求并合并结果，上层业务无需感知。

| ERP | 单次最大条数 | 适配层处理 |
|-----|------------|-----------|
| 聚水潭 | 100 | 请求 200 条时自动拆为 2 次请求，合并后返回 |
| 旺店通 | 200 | 直接透传 |
| 管易云 | 50 | 请求 200 条时自动拆为 4 次请求，合并后返回 |
| CSV | 不限 | 内存分页 |

---

## 五、订单接口

### getOrders(filters)

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| tenantId | string | 必填 | 租户ID（自动注入） |
| shopId | string | 可选 | 不传查全部店铺 |
| platform | enum | 可选 | douyin/tmall/meituan/jd |
| startDate | date | 必填 | 开始日期 YYYY-MM-DD |
| endDate | date | 必填 | 结束日期 YYYY-MM-DD |
| status | enum | 可选 | paid/shipped/completed/refunded |
| page | int | 可选 | 默认 1 |
| pageSize | int | 可选 | 最大 200（适配层内部自动拆分） |

**返回结构**
```json
{
  "orders": [
    {
      "id": "ord_abc123",
      "platformOrderId": "DY20250328001",
      "shopId": "shop_001",
      "platform": "douyin",
      "status": "completed",
      "totalAmount": 299.00,
      "actualAmount": 269.10,
      "refundAmount": 0,
      "buyerName": "张**",
      "supplierId": "sup_001",
      "items": [],
      "paidAt": "2025-03-28T09:00:00Z",
      "shippedAt": "2025-03-28T14:00:00Z",
      "completedAt": "2025-03-30T10:00:00Z"
    }
  ]
}
```

### getOrderDetail(orderId)

**返回 items 明细结构**
```json
{
  "items": [
    {
      "skuCode": "SKU-001",
      "productName": "生酮代餐棒 原味 30条",
      "quantity": 2,
      "unitPrice": 149.50,
      "costPrice": 68.00,
      "subtotal": 299.00
    }
  ],
  "logistics": {
    "company": "顺丰",
    "trackingNo": "SF1234567890",
    "shippedAt": "2025-03-28T14:00:00Z"
  }
}
```

### 各 ERP 订单状态映射

| 标准状态 | 聚水潭 | 旺店通 | 管易云 |
|---------|--------|--------|--------|
| paid | WaitDeliver | WAIT_SEND_GOODS | PAYED |
| shipped | Delivering | DELIVERING | SHIPPED |
| completed | Signed | TRADE_FINISHED | COMPLETED |
| refunded | Refund | TRADE_CLOSED | REFUNDED |
| cancelled | Cancel | TRADE_CLOSED | CANCELLED |

---

## 六、商品库存接口

### getProducts(shopId, filters?)

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| shopId | string | 必填 | 店铺ID |
| category | string | 可选 | 商品分类 |
| status | enum | 可选 | on_sale/off_sale/all |
| supplierId | string | 可选 | 按供应商过滤 |

**返回结构**
```json
{
  "products": [
    {
      "id": "prod_001",
      "skuCode": "SKU-KT-001",
      "name": "生酮代餐棒 原味 30条",
      "category": "健康食品",
      "salePrice": 149.50,
      "costPrice": 68.00,
      "supplierId": "sup_001",
      "status": "on_sale",
      "inventory": {
        "available": 342,
        "locked": 58,
        "warningQty": 50
      },
      "salesLast30d": 186,
      "updatedAt": "2025-03-28T08:00:00Z"
    }
  ]
}
```

### getLowStockItems(shopId?, threshold?, daysOfSales?)

**返回结构**
```json
{
  "lowStockItems": [
    {
      "skuCode": "SKU-KT-001",
      "name": "生酮代餐棒 原味",
      "available": 18,
      "dailySalesAvg": 12.5,
      "daysRemaining": 1.4,
      "urgency": "critical",
      "supplierId": "sup_001"
    }
  ]
}
```

urgency 等级：`critical`（<3天）/ `warning`（3-7天）/ `normal`（>7天）

---

## 七、供应商接口

### getSuppliers(filters)

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| tenantId | string | 必填 | 租户ID（自动注入） |
| status | enum | 可选 | active/inactive/all，默认 active |
| keyword | string | 可选 | 按供应商名称模糊搜索 |
| page | int | 可选 | 默认 1 |
| pageSize | int | 可选 | 最大 200 |

**返回结构**
```json
{
  "suppliers": [
    {
      "id": "sup_001",
      "name": "XX健康食品有限公司",
      "contactName": "王经理",
      "contactPhone": "138****5678",
      "status": "active",
      "productCount": 12,
      "orderCountLast30d": 86,
      "afterSaleRateLast30d": 0.034,
      "createdAt": "2024-06-15T00:00:00Z"
    }
  ]
}
```

### getSupplierOrders(supplierId, period)

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| supplierId | string | 必填 | 供应商ID |
| startDate | date | 必填 | 开始日期 |
| endDate | date | 必填 | 结束日期 |
| status | enum | 可选 | 订单状态过滤 |
| page | int | 可选 | 默认 1 |
| pageSize | int | 可选 | 最大 200 |

**返回结构**
```json
{
  "orders": [
    {
      "id": "ord_abc123",
      "platformOrderId": "DY20250328001",
      "shopId": "shop_001",
      "platform": "douyin",
      "status": "completed",
      "totalAmount": 299.00,
      "actualAmount": 269.10,
      "refundAmount": 0,
      "items": [],
      "paidAt": "2025-03-28T09:00:00Z"
    }
  ],
  "summary": {
    "totalOrders": 86,
    "totalAmount": 25680.00,
    "refundCount": 3,
    "refundRate": 0.034
  }
}
```

---

## 八、财务接口

### getCashflow(period, shopId?)

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| startDate | date | 必填 | 开始日期 |
| endDate | date | 必填 | 结束日期 |
| shopId | string | 可选 | 不传查全部 |
| platform | enum | 可选 | 按平台过滤 |
| granularity | enum | 可选 | day/week/month |

**返回结构**
```json
{
  "summary": {
    "totalIncome": 328400.00,
    "totalRefund": 12680.00,
    "totalFees": 9852.00,
    "netIncome": 305868.00
  },
  "breakdown": {
    "byPlatform": [
      { "platform": "douyin", "income": 182000, "fees": 5460 },
      { "platform": "tmall", "income": 96400, "fees": 2892 }
    ],
    "byDay": [
      { "date": "2025-03-01", "income": 10600 }
    ]
  }
}
```

### getPlatformFees(shopId, month)

**返回结构**
```json
{
  "fees": [
    { "type": "commission", "amount": 5460.00, "rate": 0.03, "basis": 182000.00 },
    { "type": "service", "amount": 910.00 }
  ],
  "totalFees": 6370.00,
  "invoiceNo": "INV-DY-202503"
}
```

---

## 九、售后退款接口

### getAfterSales(filters)

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| startDate | date | 必填 | 开始日期 |
| endDate | date | 必填 | 结束日期 |
| shopId | string | 可选 | 店铺过滤 |
| reason | enum | 可选 | quality/wrong_item/no_reason/other |
| liability | enum | 可选 | supplier/buyer/platform |

**返回结构**
```json
{
  "afterSales": [
    {
      "id": "as_001",
      "orderId": "ord_abc123",
      "skuCode": "SKU-KT-001",
      "supplierId": "sup_001",
      "refundAmount": 149.50,
      "reason": "quality",
      "liability": "supplier",
      "platformSubsidy": 0,
      "buyerCompensation": 0,
      "evidence": ["photo_url_1"],
      "status": "approved",
      "createdAt": "2025-03-26T15:00:00Z"
    }
  ],
  "stats": {
    "total": 23,
    "supplierFault": 8,
    "buyerFault": 12,
    "platformSubsidy": 3
  }
}
```

---

## 十、Webhook 接收规范

### 10.1 Webhook URL 设计与租户路由

**Webhook URL 格式**：`/webhook/erp/:connectionId`

每个 ERPConnection 注册时生成唯一的 Webhook URL，租户在 ERP 管理后台配置此 URL。后端收到 Webhook 请求后，通过 `connectionId` 查询 ERPConnection 表获取 `tenantId` 和 `erpType`，实现自动租户路由。

```
配置阶段：
  租户创建 ERPConnection → 系统生成 Webhook URL
  → 如: https://api.saas.com/webhook/erp/conn_abc123
  → 租户在聚水潭/旺店通后台填写此 URL

运行阶段：
  ERP Webhook 推送到 /webhook/erp/:connectionId
  → 按 connectionId 查库获取 tenantId + erpType + credentials
  → connectionId 无效返回 404（不泄露任何租户信息）
```

### 10.2 统一处理流程

所有 ERP 的 Webhook 推送统一经过以下流程：

```
ERP Webhook 推送到 /webhook/erp/:connectionId
  → 按 connectionId 查询 ERPConnection 表（获取 tenantId + erpType）
  → connectionId 无效 → 404
  → ERPConnection.status !== 'active' → 403
  → 验签（verifyWebhook，使用该 connection 的 credentials）
  → 事件去重（基于事件ID，Redis SETNX，TTL=24h）
  → 解析为统一事件格式
  → 写入 BullMQ 队列（携带 tenantId）
  → Worker 异步消费：写入数据库 + 更新缓存
```

### 10.3 各 ERP 签名验证方式

| ERP | 签名方式 | 签名位置 |
|-----|---------|---------|
| 聚水潭 | MD5(appSecret + body + appSecret) | Header: `X-JST-Sign` |
| 旺店通 | HMAC-SHA256(secret, body) | Header: `X-WDT-Signature` |
| 管易云 | MD5(secret + timestamp + body) | Header: `X-GYY-Sign` |

### 10.4 事件去重

基于事件 ID 进行去重，防止 ERP 重复推送导致数据异常：

```javascript
async function handleWebhook(req) {
  const eventId = req.headers['x-event-id'] || req.body.event_id
  const dedupeKey = `webhook:dedup:${eventId}`

  // SETNX：仅在 key 不存在时写入，返回 true 表示首次接收
  const isNew = await redis.set(dedupeKey, '1', 'EX', 86400, 'NX')
  if (!isNew) {
    return { status: 200, message: 'duplicate event, skipped' }
  }

  // 验签
  const adapter = AdapterFactory.create(connection)
  if (!adapter.verifyWebhook(req.body, req.headers['x-signature'])) {
    throw new Error('Webhook 签名验证失败')
  }

  // 写入队列异步处理
  await webhookQueue.add(req.body.event_type, {
    tenantId: connection.tenantId,
    erpType: connection.erpType,
    payload: req.body,
  })

  return { status: 200, message: 'accepted' }
}
```

---

## 十一、TypeScript 类型定义

```typescript
type Platform = 'douyin' | 'tmall' | 'meituan' | 'jd' | 'pinduoduo' | 'eleme'

type OrderStatus = 'paid' | 'shipped' | 'completed' | 'refunded' | 'cancelled'

type Liability = 'supplier' | 'buyer' | 'platform' | 'pending'

type RefundReason = 'quality' | 'wrong_item' | 'no_reason' | 'lost' | 'other'

type AfterSaleStatus = 'pending' | 'approved' | 'rejected' | 'completed'

interface Order {
  id: string
  platformOrderId: string
  shopId: string
  tenantId: string
  platform: Platform
  status: OrderStatus
  totalAmount: number
  actualAmount: number
  refundAmount: number
  buyerName: string       // 脱敏
  supplierId: string
  items: OrderItem[]
  logistics?: Logistics
  paidAt: string          // ISO8601
  shippedAt?: string
  completedAt?: string
  createdAt: string
  rawData?: object        // 原始ERP数据备份
}

/**
 * Product — API 响应格式
 *
 * 注意：API 响应中 inventory 是嵌套对象（available/locked/warningQty），
 * 对应 Prisma 数据库模型中的扁平字段（stockQty/stockWarningQty）。
 * 适配器的 _transformProduct 方法负责两种格式之间的映射：
 *
 *   数据库字段          →  API 响应字段
 *   stockQty            →  inventory.available
 *   (stockQty - available 由业务计算) → inventory.locked
 *   stockWarningQty     →  inventory.warningQty
 */
interface Product {
  id: string
  skuCode: string
  name: string
  category: string
  salePrice: number
  costPrice: number
  supplierId: string
  shopId: string
  tenantId: string
  status: 'on_sale' | 'off_sale'
  inventory: Inventory     // API 响应格式（嵌套），数据库为扁平字段
  salesLast30d: number
  updatedAt: string
}

interface Inventory {
  available: number       // 对应 Prisma: stockQty（可用库存）
  locked: number          // 已下单未发（由业务逻辑计算）
  warningQty: number      // 对应 Prisma: stockWarningQty
  daysRemaining?: number  // 预计库存天数
}

/**
 * AfterSale — API 响应格式（与 Prisma AfterSale 表对齐）
 *
 * 数据库字段映射：
 *   AfterSale.id                  → id
 *   AfterSale.orderId             → orderId
 *   AfterSale.shopId              → shopId (冗余字段，便于按店铺查询)
 *   AfterSale.platform            → platform (冗余字段，便于按平台统计)
 *   AfterSale.platformAfterSaleId → platformAfterSaleId (平台售后单号，唯一约束)
 *   AfterSale.skuCode             → skuCode
 *   AfterSale.supplierId          → supplierId
 *   AfterSale.refundAmount        → refundAmount (Decimal → number)
 *   AfterSale.reason              → reason
 *   AfterSale.liability           → liability
 *   AfterSale.platformSubsidy     → platformSubsidy (Decimal → number)
 *   AfterSale.buyerCompensation   → buyerCompensation (Decimal → number)
 *   AfterSale.evidence            → evidence (Json → string[])
 *   AfterSale.status              → status
 *   AfterSale.createdAt           → createdAt (DateTime → ISO8601 string)
 *   AfterSale.updatedAt           → updatedAt
 */
interface AfterSale {
  id: string
  orderId: string
  shopId: string
  tenantId: string
  platform: Platform
  platformAfterSaleId: string  // 平台售后单号
  skuCode: string
  supplierId: string
  refundAmount: number
  reason: RefundReason
  liability: Liability
  platformSubsidy: number
  buyerCompensation: number
  evidence: string[]
  status: AfterSaleStatus
  createdAt: string
  updatedAt: string
}

interface Supplier {
  id: string
  name: string
  contactName?: string
  contactPhone?: string    // 脱敏
  status: 'active' | 'inactive'
  productCount: number
  orderCountLast30d: number
  afterSaleRateLast30d: number
  createdAt: string
}
```

---

## 十二、数据同步策略

| 方式 | 频率 | 适用数据 | 实现方式 |
|------|------|---------|---------|
| 实时触发 | ERP Webhook 推送 | 订单状态变更、售后申请 | Webhook → 验签 → 去重 → BullMQ 队列 → 异步写入 |
| 增量同步 | 每5分钟 | 上次同步至今的变更数据 | 从 SyncLog 读取上次同步时间，`updatedAfter=lastSyncAt`，增量 upsert |
| 全量同步 | 每天凌晨2点 | 所有历史数据 | 分批拉取（每批200条，适配层内部自动拆分） |
| 手动触发 | 按需 | 初始导入、数据修复 | 限每小时最多3次 |

### 增量同步时间窗口

增量同步不再使用固定的"近24小时"窗口，改为基于 `SyncLog` 表记录的上次同步完成时间：

```
每次同步流程：
1. 从 SyncLog 读取该租户该模块的 lastSyncAt
2. 拉取 updatedAfter=lastSyncAt 到 now 的增量数据
3. upsert 到本地数据库
4. 写入 SyncLog：syncedAt=now, status=success/fail, recordCount
5. 首次同步（无 lastSyncAt 记录）时回溯 24 小时
```

### 并发控制

同一租户同一时刻只允许运行一个同步任务，通过 Redis 分布式锁防止并发冲突：

```javascript
const lockKey = `sync:lock:${tenantId}:${module}`
const locked = await redis.set(lockKey, workerId, 'EX', 300, 'NX') // 5分钟自动过期
if (!locked) {
  console.log('同步任务已在运行，跳过本次')
  return
}
try {
  await runSync(tenantId, module)
} finally {
  await redis.del(lockKey)
}
```

### 幂等性保障

所有增量同步均使用 `upsert` 操作，依赖 Prisma 模型中的 `@@unique` 复合唯一约束确保幂等。重复写入同一条数据只会更新而不会产生重复记录。

关键唯一约束示例：
- Order: `@@unique([tenantId, platformOrderId])`
- Product: `@@unique([tenantId, shopId, skuCode])`
- AfterSale: `@@unique([tenantId, platformAfterSaleId])`（平台售后单号全局唯一）

### 失败重试策略
```
重试次数：最多 3 次
重试间隔：1分钟 → 5分钟 → 15分钟（指数退避）
全部失败：写入 ERPConnection.lastError，触发告警
限频处理：检测到 429，暂停60秒后重试
数据冲突：以 ERP 数据为准（ERP 是数据源头）
```

---

## 十三、错误码定义

| 错误码 | 说明 | 处理方式 |
|--------|------|---------|
| ERP_UNAUTHORIZED | ERP凭证失效 | 告警管理员，引导重新配置 |
| ERP_RATE_LIMITED | ERP API限频 | 进入重试队列，60秒后重试 |
| ERP_TIMEOUT | ERP API超时(>10s) | 返回缓存数据并标注时效 |
| ERP_DATA_FORMAT | 数据格式不符 | 记录原始数据，告警开发 |
| TENANT_QUOTA_EXCEEDED | AI配额用完 | 降级只读模式，通知续费 |
| PERMISSION_DENIED | 越权访问 | 记录审计日志，友好提示 |
| DATA_SYNC_STALE | 数据超过30分钟未同步 | 界面标注数据时效 |
| SHOP_NOT_CONNECTED | 店铺未配置ERP | 引导进入设置完成绑定 |
| WEBHOOK_SIGN_INVALID | Webhook签名验证失败 | 记录日志，返回 401 |
| SYNC_LOCK_CONFLICT | 同步任务并发冲突 | 跳过本次，等待下一轮 |

---

## 十四、聚水潭适配器实现要点

```javascript
// backend/src/adapters/jushuitang.js

class JSTAdapter extends ERPAdapterBase {
  constructor(connection) {
    super(connection)
    this.baseUrl = 'https://openapi.jushuitan.com'
    this.appKey = this.credentials.appKey
    this.appSecret = this.credentials.appSecret
  }

  // 聚水潭需要签名认证
  _buildSign(params) {
    const sorted = Object.keys(params).sort().map(k => `${k}${params[k]}`).join('')
    return md5(this.appSecret + sorted + this.appSecret).toUpperCase()
  }

  // 健康检查：调用聚水潭的轻量级接口验证凭证
  async healthCheck() {
    const start = Date.now()
    try {
      await this._request(`${this.baseUrl}/open/auth/check`, {
        method: 'POST',
        body: JSON.stringify({ app_key: this.appKey }),
      })
      return { ok: true, latencyMs: Date.now() - start }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: err.message }
    }
  }

  // Webhook 验签
  verifyWebhook(payload, signature) {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const expected = md5(this.appSecret + body + this.appSecret).toUpperCase()
    return expected === signature
  }

  // 数据转换
  _transformOrder(rawOrder) {
    return {
      platformOrderId: rawOrder.o_id,
      status: this._mapStatus(rawOrder.status),
      totalAmount: parseFloat(rawOrder.pay_amount),
      // ... 其他字段映射
    }
  }

  _transformProduct(rawProduct) {
    return {
      skuCode: rawProduct.sku_id,
      name: rawProduct.name,
      inventory: {
        available: rawProduct.qty,           // 数据库: stockQty
        locked: rawProduct.lock_qty || 0,
        warningQty: rawProduct.warning_qty,  // 数据库: stockWarningQty
      },
      // ... 其他字段映射
    }
  }

  async getOrders(filters) {
    // 调用聚水潭 /open/orders/query 接口
    // 聚水潭单次最多 100 条，若 pageSize > 100 则自动拆分多次请求
    // 将返回的 WaitDeliver/Delivering/Signed 映射为标准状态
    // 返回统一格式
  }
}
```

**聚水潭 API 限制**：
- 日调用限制：2000次/天（基础版）
- 单次最大返回：100条（统一接口承诺200条时，适配层自动拆为2次请求合并）
- 必须分页获取
