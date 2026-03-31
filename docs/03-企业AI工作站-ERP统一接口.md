# 企业 AI 工作站 · ERP/商城 统一接口规范

> 版本：v3.2 · 2026-03-31 · 本文档定义 ERP 和商城适配层的统一接口契约，所有适配器必须严格遵守
> v3.2 变更：v3.2全面审计统一版本号，6路审计修复（事务安全/外键约束/环境变量同步/Prometheus告警/CS数据层测试/AuditLog保留策略）
> v2.3 变更：v2.9审计同步日期，内容无变更
> v2.1 变更：新增 MallAdapter（ztdy-open 商城 API），Phase 1 主数据源（ADR-024）
> v2.2 变更：修复9人团队审查P0/P1缺陷——三层缓存校验、聚合预计算、API断供降级、Webhook乱序、限频保护、跨表校验、断点续传、迁移规划、不通端点处理

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

---

## 十五、三层缓存校验架构

> 解决问题：Redis 缓存数据未经校验就返回业务层（P0）+ 缓存键 paramsHash 碰撞风险（P1）

### 15.1 三层校验流程

```
API 响应 → [第1层] Zod 强校验 → 通过 → 写入 Redis 缓存
                                → 失败 → 拒绝写入 + 记告警 + 返回错误

Redis 读取 → [第2层] 轻校验（关键字段存在性） → 通过 → 进入第3层
                                               → 失败 → 视为缓存未命中 → 走 API

返回业务层前 → [第3层] 最终校验（完整格式校验） → 通过 → 返回
                                               → 失败 → 清除该缓存 + 告警 + 返回错误
```

**第 1 层：API 响应强校验**（写入时拦截脏数据）

```typescript
// backend/src/adapters/cache-validator.ts

import { z } from 'zod'

const OrderSchema = z.object({
  id: z.string(),
  platformOrderId: z.string(),
  status: z.enum(['paid', 'shipped', 'completed', 'refunded', 'cancelled']),
  totalAmount: z.number().nonnegative(),
  supplierId: z.string(),
  paidAt: z.string().datetime(),
})

async function writeToCache(key: string, data: unknown, schema: z.ZodSchema) {
  const result = schema.safeParse(data)
  if (!result.success) {
    logger.warn('缓存写入被拒绝：Zod 校验失败', {
      key,
      errors: result.error.issues,
    })
    await notificationService.create({
      type: 'CACHE_VALIDATION_FAIL',
      detail: `写入校验失败: ${key}`,
    })
    return false // 拒绝写入
  }
  await redis.set(key, JSON.stringify(result.data), 'EX', 300)
  return true
}
```

**第 2 层：缓存读取轻校验**（乐观策略，只检查关键字段）

```typescript
async function readFromCache(key: string, requiredFields: string[]) {
  const raw = await redis.get(key)
  if (!raw) return null

  const parsed = JSON.parse(raw)

  // 轻校验：只检查关键字段存在性
  for (const field of requiredFields) {
    if (parsed[field] === undefined || parsed[field] === null) {
      logger.warn('缓存轻校验失败，视为未命中', { key, missingField: field })
      return null // 视为缓存未命中
    }
  }
  return parsed
}
```

**第 3 层：返回业务层前最终校验**

```typescript
async function getOrdersWithValidation(filters: OrderFilters) {
  const cacheKey = buildCacheKey('getOrders', filters)
  const cached = await readFromCache(cacheKey, ['id', 'status', 'totalAmount'])

  if (cached) {
    const finalCheck = OrderResponseSchema.safeParse(cached)
    if (finalCheck.success) {
      return finalCheck.data
    }
    // 最终校验失败：清除污染缓存 + 告警
    await redis.del(cacheKey)
    logger.error('缓存最终校验失败，已清除', { cacheKey })
  }

  // 走 API
  const apiData = await adapter.getOrders(filters)
  await writeToCache(cacheKey, apiData, OrderResponseSchema) // 第1层校验在此触发
  return apiData
}
```

### 15.2 缓存污染检测

定时扫描任务，检测缓存中异常数据比例：

```typescript
// BullMQ cron: 每小时执行
async function cachePollutionScan(tenantId: string) {
  const cacheKeys = await redis.keys(`v1:erp:${tenantId}:*`)
  let totalChecked = 0
  let failCount = 0

  for (const key of cacheKeys) {
    totalChecked++
    const data = await redis.get(key)
    if (!data) continue

    try {
      const parsed = JSON.parse(data)
      // 检查关键字段完整性
      if (!parsed.id || parsed.totalAmount === undefined) {
        failCount++
      }
    } catch {
      failCount++ // JSON 解析失败也算异常
    }
  }

  const anomalyRate = totalChecked > 0 ? failCount / totalChecked : 0

  if (anomalyRate > 0.01) {
    // >1%：清除所有缓存
    logger.error('缓存异常率超 1%，执行全量清除', { tenantId, anomalyRate })
    await redis.del(...cacheKeys)
    await notificationService.create({
      type: 'CACHE_POLLUTION_CRITICAL',
      detail: `缓存异常率 ${(anomalyRate * 100).toFixed(1)}%，已清除`,
    })
  } else if (anomalyRate > 0.001) {
    // >0.1%：告警
    logger.warn('缓存异常率超 0.1%', { tenantId, anomalyRate })
    await notificationService.create({
      type: 'CACHE_POLLUTION_WARNING',
      detail: `缓存异常率 ${(anomalyRate * 100).toFixed(2)}%`,
    })
  }
}
```

### 15.3 缓存键规则（防碰撞）

原有 `paramsHash` 方案存在碰撞风险。改为 **stable JSON.stringify + SHA256**：

```typescript
import { createHash } from 'crypto'

function buildCacheKey(
  tenantId: string,
  erpType: string,
  method: string,
  params: Record<string, unknown>
): string {
  // 1. 对 key 排序，确保相同参数生成相同 hash
  const sortedParams = JSON.stringify(params, Object.keys(params).sort())
  // 2. SHA256 替代简单 hash，碰撞概率可忽略
  const hash = createHash('sha256').update(sortedParams).digest('hex').slice(0, 16)
  // 3. 带版本前缀
  return `v1:erp:${tenantId}:${erpType}:${method}:${hash}`
}
```

---

## 十六、聚合查询预计算方案

> 解决问题：getSalesStats 月数据需遍历 950 页 = 950 次 API 调用，消耗日限额 47.5%（P0）+ API 配额管理缺失（P1）

### 16.1 问题量化

| 指标 | 数值 |
|------|------|
| 月订单量 | ~95万 |
| 单页大小 | 1000 条（ztdy-open 最大） |
| 遍历页数 | 950 页 |
| API 调用数 | 950 次 |
| ztdy-open 日限额 | 2000 次 |
| 单次聚合消耗占比 | 47.5% |

结论：实时聚合不可行，必须预计算。

### 16.2 预计算任务（BullMQ cron）

```typescript
// backend/src/jobs/precompute.ts

import { Queue, Worker } from 'bullmq'

const precomputeQueue = new Queue('precompute', { connection: redisConnection })

// ==========================================
// 每小时增量计算：当日实时指标
// ==========================================
precomputeQueue.add('hourly-incremental', {}, {
  repeat: { pattern: '0 * * * *' }, // 每小时整点
})

async function hourlyIncremental(tenantId: string) {
  const today = new Date().toISOString().slice(0, 10)

  // 拉取当日订单（限制最多 100 页，超过放弃实时性）
  const orders = await fetchOrdersWithLimit(tenantId, today, today, 100)

  const metrics = {
    salesAmount: orders.reduce((sum, o) => sum + o.totalAmount, 0),
    orderCount: orders.length,
    refundCount: orders.filter(o => o.status === 'refunded').length,
    refundAmount: orders.filter(o => o.status === 'refunded')
      .reduce((sum, o) => sum + o.refundAmount, 0),
    computedAt: new Date().toISOString(),
  }

  // 存入 Redis Hash，TTL 25 小时（覆盖到次日计算完成）
  const key = `precompute:${tenantId}:daily_sales:${today}`
  await redis.hset(key, metrics)
  await redis.expire(key, 90000) // 25小时
}

// ==========================================
// 每天凌晨全量计算：月度/季度汇总
// ==========================================
precomputeQueue.add('daily-full', {}, {
  repeat: { pattern: '30 2 * * *' }, // 凌晨 2:30
})

async function dailyFull(tenantId: string) {
  // 月度汇总（本月1号到昨天）
  const monthStart = getMonthStart()
  const yesterday = getYesterday()

  // 从每日预计算结果聚合（不再逐页遍历 API）
  const dailyKeys = await redis.keys(`precompute:${tenantId}:daily_sales:${monthStart}*`)
  let monthlySales = 0
  let monthlyOrders = 0
  let monthlyRefunds = 0

  for (const key of dailyKeys) {
    const data = await redis.hgetall(key)
    monthlySales += parseFloat(data.salesAmount || '0')
    monthlyOrders += parseInt(data.orderCount || '0')
    monthlyRefunds += parseInt(data.refundCount || '0')
  }

  // TOP 供应商（从已有订单数据聚合）
  const topSuppliers = await computeTopSuppliers(tenantId, monthStart, yesterday)

  // 品类分布
  const categoryDist = await computeCategoryDistribution(tenantId, monthStart, yesterday)

  const monthKey = `precompute:${tenantId}:monthly:${monthStart}`
  await redis.hset(monthKey, {
    salesAmount: monthlySales,
    orderCount: monthlyOrders,
    refundCount: monthlyRefunds,
    topSuppliers: JSON.stringify(topSuppliers),
    categoryDistribution: JSON.stringify(categoryDist),
    computedAt: new Date().toISOString(),
  })
  await redis.expire(monthKey, 90000) // 25小时
}
```

### 16.3 查询路径

```
业务层查询 getSalesStats(period)
  → 查预计算缓存（precompute:{tenantId}:{metric}:{period}）
  → 命中 → 直接返回（附 computedAt 时间戳，业务层可判断时效）
  → 未命中 → 降级为实时 API 聚合（上限 100 页）
            → 100 页内完成 → 返回完整结果
            → 超过 100 页 → 返回部分结果 + completeness 百分比
```

### 16.4 API 配额管理

```typescript
// backend/src/adapters/quota-manager.ts

const DAILY_LIMIT = 2000
const QUOTA_KEY_PREFIX = 'api_quota'

/** 记录一次 API 调用 */
async function recordApiCall(tenantId: string, method: string) {
  const today = new Date().toISOString().slice(0, 10)
  const key = `${QUOTA_KEY_PREFIX}:${tenantId}:${today}`

  // Sorted Set：score=timestamp, member=method:uuid
  await redis.zadd(key, Date.now(), `${method}:${crypto.randomUUID()}`)
  await redis.expire(key, 172800) // 48小时

  // 检查当日消耗
  const used = await redis.zcard(key)

  if (used > DAILY_LIMIT * 0.8) {
    // >80%：自动切换为只用缓存
    await redis.set(`quota_mode:${tenantId}`, 'cache_only', 'EX', 86400)
    await notificationService.create({
      tenantId,
      type: 'QUOTA_CRITICAL',
      detail: `API 配额已用 ${used}/${DAILY_LIMIT} (${((used / DAILY_LIMIT) * 100).toFixed(0)}%)，已切换为缓存模式`,
    })
  } else if (used > DAILY_LIMIT * 0.6) {
    // >60%：告警
    await notificationService.create({
      tenantId,
      type: 'QUOTA_WARNING',
      detail: `API 配额已用 ${used}/${DAILY_LIMIT} (${((used / DAILY_LIMIT) * 100).toFixed(0)}%)`,
    })
  }
}

/** 查询配额使用情况 */
async function getQuotaUsage(tenantId: string): Promise<{
  used: number
  limit: number
  remaining: number
  percentage: number
  mode: 'normal' | 'cache_only'
}> {
  const today = new Date().toISOString().slice(0, 10)
  const key = `${QUOTA_KEY_PREFIX}:${tenantId}:${today}`
  const used = await redis.zcard(key)
  const mode = await redis.get(`quota_mode:${tenantId}`) as 'cache_only' | null

  return {
    used,
    limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - used),
    percentage: (used / DAILY_LIMIT) * 100,
    mode: mode || 'normal',
  }
}
```

---

## 十七、API 断供降级方案

> 解决问题：API 关停后缓存 TTL 过期系统瘫痪，适配器模式保护代码不保护数据（P0）

### 17.1 五级降级链

```
请求到达 MallAdapter
  → [L1] 实时 API 调用
  → 失败 → [L2] Redis 缓存（TTL=5min）
  → 过期 → [L3] 预计算缓存（TTL=25h）
  → 过期 → [L4] 本地数据快照（PostgreSQL，每日更新，保留 7 天）
  → 无数据 → [L5] 返回 { success: false, error: 'DATA_UNAVAILABLE', message: '数据暂不可用' }
```

每次降级都记录当前降级级别，供业务层标注数据时效：

```typescript
interface DegradedResponse<T> {
  data: T
  degradeLevel: 1 | 2 | 3 | 4  // L1=实时, L2=缓存, L3=预计算, L4=快照
  dataAge: string                // 数据年龄，如 "3分钟前" / "12小时前" / "昨日快照"
  isComplete: boolean            // 快照可能不完整
}
```

### 17.2 本地数据快照

每日凌晨 3 点自动拉取全量数据写入 PostgreSQL 临时表，保留 7 天轮转：

```sql
-- 快照表结构（独立 schema，不污染主业务表）
CREATE SCHEMA IF NOT EXISTS mall_snapshot;

CREATE TABLE mall_snapshot.orders (
  id            SERIAL PRIMARY KEY,
  tenant_id     VARCHAR(50) NOT NULL,
  snapshot_date DATE NOT NULL,
  data          JSONB NOT NULL,             -- 完整订单 JSON
  record_count  INT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, snapshot_date)
);

CREATE TABLE mall_snapshot.items (
  id            SERIAL PRIMARY KEY,
  tenant_id     VARCHAR(50) NOT NULL,
  snapshot_date DATE NOT NULL,
  data          JSONB NOT NULL,
  record_count  INT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, snapshot_date)
);

CREATE TABLE mall_snapshot.users (
  id            SERIAL PRIMARY KEY,
  tenant_id     VARCHAR(50) NOT NULL,
  snapshot_date DATE NOT NULL,
  data          JSONB NOT NULL,
  record_count  INT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, snapshot_date)
);

CREATE TABLE mall_snapshot.suppliers (
  id            SERIAL PRIMARY KEY,
  tenant_id     VARCHAR(50) NOT NULL,
  snapshot_date DATE NOT NULL,
  data          JSONB NOT NULL,
  record_count  INT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, snapshot_date)
);

-- 7 天轮转：删除过期快照
DELETE FROM mall_snapshot.orders WHERE snapshot_date < CURRENT_DATE - INTERVAL '7 days';
DELETE FROM mall_snapshot.items WHERE snapshot_date < CURRENT_DATE - INTERVAL '7 days';
DELETE FROM mall_snapshot.users WHERE snapshot_date < CURRENT_DATE - INTERVAL '7 days';
DELETE FROM mall_snapshot.suppliers WHERE snapshot_date < CURRENT_DATE - INTERVAL '7 days';
```

```typescript
// backend/src/jobs/snapshot.ts — BullMQ cron 凌晨 3 点

async function createDailySnapshot(tenantId: string) {
  const today = new Date().toISOString().slice(0, 10)

  // 拉取全量数据（分批，每批 1000 条）
  const allOrders = await fetchAllPages(tenantId, 'getOrders')
  const allItems = await fetchAllPages(tenantId, 'getItems')
  const allSuppliers = await fetchAllPages(tenantId, 'getSuppliers')

  // 写入快照表
  await prisma.$executeRaw`
    INSERT INTO mall_snapshot.orders (tenant_id, snapshot_date, data, record_count)
    VALUES (${tenantId}, ${today}::date, ${JSON.stringify(allOrders)}::jsonb, ${allOrders.length})
    ON CONFLICT (tenant_id, snapshot_date) DO UPDATE
    SET data = EXCLUDED.data, record_count = EXCLUDED.record_count
  `
  // items / suppliers 同理...

  // 清理 7 天前快照
  await prisma.$executeRaw`
    DELETE FROM mall_snapshot.orders WHERE snapshot_date < CURRENT_DATE - INTERVAL '7 days'
  `

  logger.info('每日快照完成', { tenantId, orders: allOrders.length, items: allItems.length })
}
```

### 17.3 降级状态通知

```typescript
async function onDegradeSwitch(tenantId: string, fromLevel: number, toLevel: number) {
  const levelNames = { 1: '实时API', 2: 'Redis缓存', 3: '预计算缓存', 4: '本地快照', 5: '不可用' }

  // 写 Notification 表
  await notificationService.create({
    tenantId,
    type: 'DATA_DEGRADE',
    severity: toLevel >= 4 ? 'critical' : 'warning',
    detail: `数据源已从 ${levelNames[fromLevel]} 降级到 ${levelNames[toLevel]}`,
  })

  // 飞书告警（Level 3+ 才发）
  if (toLevel >= 3) {
    await feishuAlert({
      title: '⚠️ 数据源降级告警',
      content: `租户 ${tenantId} 数据源降级到 ${levelNames[toLevel]}`,
    })
  }
}
```

---

## 十八、Webhook 乱序处理

> 解决问题：Webhook 事件去重做了但乱序未处理（P1）

### 18.1 版本向量方案

为每个实体维护一个 version（基于 timestamp），拒绝旧事件覆盖新状态：

```typescript
// backend/src/webhook/order-handler.ts

async function handleOrderWebhook(event: WebhookEvent) {
  const { entityType, entityId, timestamp, payload } = event
  const versionKey = `entity_version:${entityType}:${entityId}`

  // 获取当前版本
  const currentVersion = await redis.get(versionKey)
  const currentTs = currentVersion ? parseInt(currentVersion) : 0
  const eventTs = new Date(timestamp).getTime()

  if (eventTs < currentTs) {
    // 旧事件：丢弃
    logger.info('Webhook 乱序丢弃（旧事件）', { entityId, eventTs, currentTs })
    return { action: 'discarded', reason: 'stale_event' }
  }

  if (eventTs === currentTs) {
    // 幂等：已处理
    logger.info('Webhook 幂等跳过', { entityId, eventTs })
    return { action: 'skipped', reason: 'idempotent' }
  }

  // 新事件：更新版本 + 处理
  await redis.set(versionKey, eventTs.toString(), 'EX', 604800) // 7天过期
  await processWebhookPayload(entityType, entityId, payload)

  return { action: 'processed' }
}
```

### 18.2 乱序恢复：定期校验轮询

即使有版本向量，仍可能存在丢失事件的情况。每 5 分钟做一次"数据校验轮询"，从 API 拉取最新状态修正遗漏：

```typescript
// BullMQ cron: 每 5 分钟
async function webhookReconciliation(tenantId: string) {
  // 只校验最近 10 分钟内有 Webhook 事件的实体
  const recentEntities = await redis.keys(`entity_version:order:*`)

  for (const key of recentEntities.slice(0, 50)) { // 每次最多校验 50 个
    const entityId = key.split(':').pop()!
    const localVersion = await redis.get(key)

    // 从 API 获取最新状态
    const apiData = await adapter.getOrderDetail(entityId)
    if (!apiData) continue

    const apiTs = new Date(apiData.updatedAt).getTime()
    if (apiTs > parseInt(localVersion || '0')) {
      // API 数据更新，说明有事件遗漏
      logger.warn('Webhook 数据校验发现遗漏，修正中', { entityId })
      await processWebhookPayload('order', entityId, apiData)
      await redis.set(key, apiTs.toString(), 'EX', 604800)
    }
  }
}
```

---

## 十九、限频保护机制

> 解决问题：每个请求独立重试可能造成级联重试，对下游影响未分析（P1）

### 19.1 全局令牌桶

不再让每个请求自行重试，而是在 MallAdapter 层维护全局令牌桶，统一管控 API 调用频率：

```typescript
// backend/src/adapters/rate-limiter.ts

class GlobalRateLimiter {
  private bucketKey: string
  private capacity: number     // 桶容量
  private refillRate: number   // 每秒补充令牌数

  constructor(tenantId: string) {
    this.bucketKey = `rate_bucket:${tenantId}`
    // ztdy-open 日限 2000 次 / 24 小时 ≈ 83 次/小时 ≈ 1.4 次/分钟
    this.capacity = 83
    this.refillRate = 83 / 3600 // 每秒补充
  }

  /** 尝试获取令牌，返回是否成功 */
  async tryAcquire(): Promise<boolean> {
    // 使用 Redis Lua 脚本实现原子令牌桶
    const result = await redis.eval(TOKEN_BUCKET_LUA, 1, this.bucketKey,
      this.capacity, this.refillRate, Date.now())
    return result === 1
  }

  /** 查询当前状态 */
  async getStatus(): Promise<RateLimitStatus> {
    const tokens = await redis.hget(this.bucketKey, 'tokens')
    const queueLen = await apiQueue.getWaitingCount()

    return {
      remainingTokens: parseInt(tokens || '0'),
      queuedRequests: queueLen,
      estimatedWaitMs: queueLen > 0 ? (queueLen / this.refillRate) * 1000 : 0,
    }
  }
}

interface RateLimitStatus {
  remainingTokens: number
  queuedRequests: number
  estimatedWaitMs: number
}
```

### 19.2 排队机制

请求超过令牌桶容量时进入 BullMQ 队列排队，而非立即重试：

```typescript
// backend/src/adapters/mall-adapter.ts（request 方法改造）

class MallAdapter extends ERPAdapterBase {
  private rateLimiter: GlobalRateLimiter
  private apiQueue: Queue

  async request(url: string, params: Record<string, unknown>) {
    // 检查配额模式
    const quotaMode = await redis.get(`quota_mode:${this.tenantId}`)
    if (quotaMode === 'cache_only') {
      return this._fallbackToCache(url, params)
    }

    // 尝试获取令牌
    const acquired = await this.rateLimiter.tryAcquire()
    if (acquired) {
      return this._doRequest(url, params)
    }

    // 令牌不足：进入排队
    const job = await this.apiQueue.add('api-call', { url, params, tenantId: this.tenantId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60000 }, // 1min起步
    })

    // 等待结果（最长 2 分钟）
    const result = await job.waitUntilFinished(this.queueEvents, 120000)
    return result
  }
}
```

### 19.3 限频状态查询

```typescript
/** 供业务层/监控面板调用 */
async function getApiRateLimitStatus(tenantId: string): Promise<{
  quota: QuotaUsage
  rateLimit: RateLimitStatus
  mode: 'normal' | 'cache_only'
}> {
  const limiter = new GlobalRateLimiter(tenantId)
  const quota = await getQuotaUsage(tenantId)
  const rateLimit = await limiter.getStatus()

  return {
    quota,
    rateLimit,
    mode: quota.mode,
  }
}
```

---

## 二十、跨表引用校验

> 解决问题：订单的 supplierId 是否存在于供应商表等跨表完整性未校验（P1）

### 20.1 设计决策

Phase 1 **不做实时跨表校验**——性能代价太高（95 万订单每条校验 supplierId 需额外 API 调用），且 ztdy-open 是只读数据源，引用完整性由上游保障。

替代方案：**每日凌晨离线扫描**。

### 20.2 数据完整性扫描任务

```typescript
// backend/src/jobs/integrity-check.ts — BullMQ cron 凌晨 4 点

interface IntegrityIssue {
  tenantId: string
  entityType: 'order' | 'item'
  entityId: string
  field: string
  referenceType: string
  missingReferenceId: string
  detectedAt: Date
}

async function dailyIntegrityCheck(tenantId: string) {
  const issues: IntegrityIssue[] = []

  // 1. 检查订单的 supplierId 是否存在于供应商列表
  const suppliers = await adapter.getSuppliers({ tenantId })
  const supplierIds = new Set(suppliers.map(s => s.id))

  // 从快照或预计算中获取订单数据（不实时遍历 API）
  const orderSnapshot = await getLatestSnapshot(tenantId, 'orders')
  for (const order of orderSnapshot) {
    if (order.supplierId && !supplierIds.has(order.supplierId)) {
      issues.push({
        tenantId,
        entityType: 'order',
        entityId: order.id,
        field: 'supplierId',
        referenceType: 'supplier',
        missingReferenceId: order.supplierId,
        detectedAt: new Date(),
      })
    }
  }

  // 2. 检查订单中的 itemId 是否存在于商品列表
  const items = await adapter.getItems({ tenantId })
  const itemIds = new Set(items.map(i => i.id))

  for (const order of orderSnapshot) {
    for (const item of order.items || []) {
      if (item.skuCode && !itemIds.has(item.skuCode)) {
        issues.push({
          tenantId,
          entityType: 'order',
          entityId: order.id,
          field: 'items.skuCode',
          referenceType: 'item',
          missingReferenceId: item.skuCode,
          detectedAt: new Date(),
        })
      }
    }
  }

  // 3. 写入 data_integrity_issues 表
  if (issues.length > 0) {
    await prisma.dataIntegrityIssue.createMany({ data: issues })
    logger.warn('数据完整性扫描发现问题', { tenantId, issueCount: issues.length })
  }

  // 4. 生成报告
  return {
    tenantId,
    scannedAt: new Date().toISOString(),
    totalOrders: orderSnapshot.length,
    issueCount: issues.length,
    issueRate: (issues.length / Math.max(orderSnapshot.length, 1) * 100).toFixed(2) + '%',
  }
}
```

### 20.3 AI 层处理

当 AI Agent 查询遇到引用缺失时，在回答中标注数据完整性问题：

```typescript
// Agent 工具函数中
async function getOrdersForAI(filters: OrderFilters) {
  const orders = await getOrders(filters)

  // 检查是否有已知的完整性问题
  const knownIssues = await prisma.dataIntegrityIssue.findMany({
    where: {
      tenantId: filters.tenantId,
      entityType: 'order',
      entityId: { in: orders.map(o => o.id) },
    },
  })

  if (knownIssues.length > 0) {
    return {
      ...orders,
      _dataQualityNote: `${knownIssues.length} 条订单存在引用数据不完整（供应商/商品信息缺失），相关统计可能有偏差`,
    }
  }

  return orders
}
```

---

## 二十一、聚合查询断点续传

> 解决问题：分页遍历到一半中断，已获取数据丢失，重新来过浪费 API 配额（P1）

### 21.1 进度追踪

```typescript
// backend/src/adapters/aggregate-tracker.ts

interface AggregateProgress {
  taskId: string
  tenantId: string
  method: string
  currentPage: number
  totalPages: number
  partialResult: unknown
  startedAt: string
  lastPageAt: string
  status: 'running' | 'interrupted' | 'completed'
}

async function saveProgress(progress: AggregateProgress) {
  const key = `aggregate_progress:${progress.taskId}`
  await redis.set(key, JSON.stringify(progress), 'EX', 3600) // 1小时过期
}

async function getProgress(taskId: string): Promise<AggregateProgress | null> {
  const data = await redis.get(`aggregate_progress:${taskId}`)
  return data ? JSON.parse(data) : null
}
```

### 21.2 断点续传聚合

```typescript
async function aggregateWithResume(
  tenantId: string,
  method: string,
  params: Record<string, unknown>
): Promise<AggregateResult> {
  // 生成稳定的 taskId（相同参数 = 相同任务）
  const taskId = buildCacheKey(tenantId, 'aggregate', method, params)

  // 检查是否有未完成的聚合任务
  const existing = await getProgress(taskId)
  let startPage = 1
  let partialResult: any = { totalAmount: 0, orderCount: 0, refundCount: 0 }

  if (existing && existing.status === 'interrupted') {
    // 从断点继续
    startPage = existing.currentPage + 1
    partialResult = existing.partialResult
    logger.info('断点续传聚合', { taskId, fromPage: startPage })
  }

  const startTime = Date.now()
  const MAX_DURATION = 5 * 60 * 1000 // 5 分钟超时

  let currentPage = startPage
  let totalPages = existing?.totalPages || Infinity

  try {
    while (currentPage <= totalPages) {
      // 超时保护
      if (Date.now() - startTime > MAX_DURATION) {
        await saveProgress({
          taskId, tenantId, method, currentPage, totalPages,
          partialResult, startedAt: new Date(startTime).toISOString(),
          lastPageAt: new Date().toISOString(), status: 'interrupted',
        })

        const completeness = totalPages === Infinity
          ? 0 : currentPage / totalPages

        return {
          data: partialResult,
          completeness: parseFloat(completeness.toFixed(2)),
          note: `已聚合 ${(completeness * 100).toFixed(0)}% 数据（超时中断，下次调用自动续传）`,
          isPartial: true,
        }
      }

      const page = await adapter.getOrders({ ...params, page: currentPage, pageSize: 1000 })

      // 首次获取时确定总页数
      if (totalPages === Infinity && page.meta?.total) {
        totalPages = Math.ceil(page.meta.total / 1000)
      }

      // 累计结果
      for (const order of page.orders) {
        partialResult.totalAmount += order.totalAmount
        partialResult.orderCount += 1
        if (order.status === 'refunded') {
          partialResult.refundCount += 1
        }
      }

      // 每 10 页保存一次进度
      if (currentPage % 10 === 0) {
        await saveProgress({
          taskId, tenantId, method, currentPage, totalPages,
          partialResult, startedAt: new Date(startTime).toISOString(),
          lastPageAt: new Date().toISOString(), status: 'running',
        })
      }

      currentPage++
    }

    // 完成
    await redis.del(`aggregate_progress:${taskId}`)
    return {
      data: partialResult,
      completeness: 1.0,
      note: '聚合完成',
      isPartial: false,
    }
  } catch (error) {
    // 异常中断：保存进度
    await saveProgress({
      taskId, tenantId, method, currentPage, totalPages,
      partialResult, startedAt: new Date(startTime).toISOString(),
      lastPageAt: new Date().toISOString(), status: 'interrupted',
    })

    const completeness = totalPages === Infinity
      ? 0 : currentPage / totalPages

    return {
      data: partialResult,
      completeness: parseFloat(completeness.toFixed(2)),
      note: `聚合中断（${(error as Error).message}），已保存进度，下次调用自动续传`,
      isPartial: true,
    }
  }
}

interface AggregateResult {
  data: unknown
  completeness: number   // 0.0 ~ 1.0
  note: string
  isPartial: boolean
}
```

---

## 二十二、Phase 1 → Phase 2 迁移规划

> 解决问题：Phase 1（MallAdapter + ztdy-open API）到 Phase 2（自建商城 + DirectAdapter）的迁移风险未评估（P1）

### 22.1 四阶段迁移路径

| 阶段 | 名称 | 持续时间 | 描述 |
|------|------|---------|------|
| Phase 2a | 并行运行 | 2 周 | 自建商城上线，MallAdapter 和 DirectAdapter 同时运行，双写校验 |
| Phase 2b | 数据迁移 | 1 周 | ztdy 历史数据迁移到本地 PostgreSQL，全量 + 增量校验 |
| Phase 2c | 主备切换 | 1 天 | 切换为 DirectAdapter（同库直查），MallAdapter 降级为备选 |
| Phase 2d | 退役观察 | 2 周 | 观察无问题后，MallAdapter 正式退役 |

### 22.2 Phase 2a：并行运行

```typescript
// 双读校验模式
async function parallelRead(method: string, params: unknown) {
  const [mallResult, directResult] = await Promise.allSettled([
    mallAdapter[method](params),    // ztdy-open API
    directAdapter[method](params),  // 本地 PostgreSQL
  ])

  // 以 DirectAdapter 为主
  const primary = directResult.status === 'fulfilled' ? directResult.value : null
  const secondary = mallResult.status === 'fulfilled' ? mallResult.value : null

  if (primary && secondary) {
    // 比对差异，记录到 migration_diff 表
    const diff = deepDiff(primary, secondary)
    if (diff.length > 0) {
      await prisma.migrationDiff.create({
        data: { method, params: JSON.stringify(params), diff: JSON.stringify(diff) },
      })
    }
  }

  return primary || secondary // DirectAdapter 优先
}
```

### 22.3 Phase 2b：数据迁移

```typescript
// 迁移脚本
async function migrateFromZtdy() {
  // 1. 全量拉取 ztdy 数据
  const orders = await mallAdapter.getAllOrders()
  const items = await mallAdapter.getAllItems()
  const suppliers = await mallAdapter.getAllSuppliers()
  const users = await mallAdapter.getAllUsers()

  // 2. 字段映射转换（ztdy 字段名 → 本地 Schema 字段名）
  const fieldMapping = {
    orders: {
      'Id': 'platformOrderId',
      'TotalMoney': 'totalAmount',
      'RealMoney': 'actualAmount',
      'SupId': 'supplierId',
      'UserId': 'buyerId',
      'CreateDate': 'createdAt',
      // ... 完整映射表
    },
    items: {
      'Id': 'platformItemId',
      'GoodsName': 'name',
      'Price': 'salePrice',
      'CostPrice': 'costPrice',
      'SupId': 'supplierId',
      // ...
    },
  }

  // 3. 批量写入本地 PostgreSQL
  for (const batch of chunk(orders, 500)) {
    const mapped = batch.map(o => transformWithMapping(o, fieldMapping.orders))
    await prisma.order.createMany({ data: mapped, skipDuplicates: true })
  }

  // 4. 校验：对比总量和关键指标
  const localCount = await prisma.order.count()
  const apiCount = orders.length
  logger.info('迁移校验', { localCount, apiCount, match: localCount === apiCount })
}
```

### 22.4 回滚方案

任何阶段发现问题，可立即切回 MallAdapter + API 模式：

```typescript
// 配置驱动，无需重启
await redis.set('adapter_mode:${tenantId}', 'mall')  // 切回 MallAdapter
await redis.set('adapter_mode:${tenantId}', 'direct') // 使用 DirectAdapter
await redis.set('adapter_mode:${tenantId}', 'parallel') // 并行模式

// AdapterFactory 根据 mode 决定实例化哪个适配器
static async create(connection) {
  const mode = await redis.get(`adapter_mode:${connection.tenantId}`) || 'mall'

  switch (mode) {
    case 'mall': return new MallAdapter(connection)
    case 'direct': return new DirectAdapter(connection)
    case 'parallel': return new ParallelAdapter(connection) // 双读校验
  }
}
```

### 22.5 迁移风险清单

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 字段映射遗漏 | 数据丢失 | 迁移前生成完整映射表，CI 校验覆盖率 |
| 数据量导致迁移超时 | 阻塞上线 | 分批迁移，增量追赶 |
| 时区/格式差异 | 数据错乱 | 统一 ISO8601 + UTC，转换层处理 |
| ztdy API 在迁移期间关停 | 历史数据丢失 | 本地快照兜底（十七章） |
| 并行期间数据不一致 | 用户困惑 | migration_diff 表监控，差异 >1% 告警 |

---

## 二十三、不通端点处理

> 解决问题：TeamBonusPageList / ItemStockPageList 返回 HTML 而非 JSON（已知 PIT-016）

### 23.1 端点状态

| 端点 | 状态 | 影响 |
|------|------|------|
| GET /api/Open/TeamBonusPageList | 返回 HTML（不通） | 团队奖金数据无法获取 |
| GET /api/Open/ItemStockPageList | 返回 HTML（不通） | 商品库存快照无法获取 |

### 23.2 处理方案

```typescript
// backend/src/adapters/mall-adapter.ts

class MallAdapter extends ERPAdapterBase {
  /**
   * @deprecated 端点返回 HTML 而非 JSON，已知问题 PIT-016
   * Phase 1 不依赖此端点，团队奖金数据暂不可用
   */
  async getTeamBonusList(_filters: unknown) {
    return {
      success: false,
      error: 'API_ENDPOINT_UNAVAILABLE',
      errorCode: 'MALL_ENDPOINT_HTML',
      fallback: '团队奖金数据暂不可用，需联系第三方修复 API（PIT-016）',
      affectedEndpoint: '/api/Open/TeamBonusPageList',
    }
  }

  /**
   * @deprecated 端点返回 HTML 而非 JSON，已知问题 PIT-016
   * Phase 1 使用 getItems() 获取商品信息，库存变动通过订单数据间接推算
   */
  async getItemStockList(_filters: unknown) {
    return {
      success: false,
      error: 'API_ENDPOINT_UNAVAILABLE',
      errorCode: 'MALL_ENDPOINT_HTML',
      fallback: '使用 getItems() 获取商品基础信息，库存快照数据暂不可用（PIT-016）',
      affectedEndpoint: '/api/Open/ItemStockPageList',
    }
  }
}
```

### 23.3 影响范围

- **Phase 1 影响**：可控。团队奖金不在 Phase 1 scope 内；库存数据通过 getItems() 获取基础信息即可满足需求
- **后续跟进**：联系 ztdy-open 第三方确认修复排期，跟踪 PIT-016
- **Phase 2**：自建商城后这两个端点自动退役，不再需要修复
