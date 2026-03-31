/**
 * MallAdapter — ztdy-open 商城 API 适配器
 *
 * Phase 1 主数据源，封装 6 个 API 端点为统一接口。
 * 所有响应经过 Zod 校验，异常数据不进入系统。
 * Redis 缓存 + 差异化 TTL + fail-secure 降级。
 */
import type { ZodSchema } from 'zod';
import { logger } from '../../utils/logger.js';
import { env } from '../../lib/env.js';
import { buildCacheKey, getCache, setCache } from './cache.js';
import { MallApiError } from './errors.js';
import {
  ztdyEnvelopeSchema,
  rawUserSchema,
  rawOrderSchema,
  rawItemSchema,
  rawSupplierSchema,
  rawSupplierWithdrawSchema,
  rawUserWithdrawSchema,
  userFilterSchema,
  orderFilterSchema,
  itemFilterSchema,
  supplierFilterSchema,
  withdrawFilterSchema,
} from './schemas.js';
import type {
  CacheGroup,
  PaginatedResult,
  MallUser,
  MallOrder,
  MallItem,
  MallSupplier,
  SupplierWithdraw,
  UserWithdraw,
  UserFilter,
  OrderFilter,
  ItemFilter,
  SupplierFilter,
  WithdrawFilter,
} from './types.js';

/** API 请求超时 10 秒 */
const REQUEST_TIMEOUT_MS = 10_000;

/** 网络错误重试 1 次，间隔 2 秒 */
const RETRY_DELAY_MS = 2_000;
const MAX_RETRIES = 1;

export class MallAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly tenantId: string;
  private readonly log: typeof logger;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
    this.baseUrl = env.ZTDY_API_BASE_URL ?? 'https://admin.ztdy.cc';
    this.apiKey = env.ZTDY_API_KEY ?? '';
    this.log = logger.child({ adapter: 'mall', tenantId });

    if (!this.apiKey) {
      this.log.warn('ZTDY_API_KEY not configured, API calls will fail with MALL_API_UNAUTHORIZED');
    }
  }

  // ─── AC-03: 用户查询 ──────────────────────────────────

  async getUsers(filters: UserFilter = {}): Promise<PaginatedResult<MallUser>> {
    const parsed = userFilterSchema.parse(filters);
    const params = this._buildParams(parsed);
    return this._callApi(
      '/api/Open/UserPageList',
      params,
      rawUserSchema,
      'users',
      this._transformUser,
    );
  }

  // ─── AC-04: 订单查询 ──────────────────────────────────

  async getOrders(filters: OrderFilter = {}): Promise<PaginatedResult<MallOrder>> {
    const parsed = orderFilterSchema.parse(filters);
    const params = this._buildParams(parsed);
    return this._callApi(
      '/api/Open/OrderPageList',
      params,
      rawOrderSchema,
      'orders',
      this._transformOrder,
    );
  }

  // ─── AC-05: 商品查询 ──────────────────────────────────

  async getItems(filters: ItemFilter = {}): Promise<PaginatedResult<MallItem>> {
    const parsed = itemFilterSchema.parse(filters);
    const params = this._buildParams(parsed);
    return this._callApi<
      {
        ItemID: number;
        ItemName: string;
        Keywords?: string | null;
        IsShelf: boolean;
        CreateDate?: string | null;
        SortID?: number | null;
        Price?: number | null;
      },
      MallItem
    >(
      '/api/Open/ItemPageList',
      params,
      rawItemSchema as ZodSchema<{
        ItemID: number;
        ItemName: string;
        Keywords?: string | null;
        IsShelf: boolean;
        CreateDate?: string | null;
        SortID?: number | null;
        Price?: number | null;
      }>,
      'items',
      this._transformItem,
    );
  }

  // ─── AC-06: 供应商查询 ─────────────────────────────────

  async getSuppliers(filters: SupplierFilter = {}): Promise<PaginatedResult<MallSupplier>> {
    const parsed = supplierFilterSchema.parse(filters);
    const params = this._buildParams(parsed);
    return this._callApi(
      '/api/Open/SupplierPageList',
      params,
      rawSupplierSchema,
      'suppliers',
      this._transformSupplier,
    );
  }

  // ─── AC-07: 供应商提现查询 ─────────────────────────────

  async getSupplierWithdraws(
    filters: WithdrawFilter = {},
  ): Promise<PaginatedResult<SupplierWithdraw>> {
    const parsed = withdrawFilterSchema.parse(filters);
    const params = this._buildParams(parsed);
    return this._callApi(
      '/api/Open/SupplierWithdrawPageList',
      params,
      rawSupplierWithdrawSchema,
      'supplierWithdraws',
      this._transformSupplierWithdraw,
    );
  }

  // ─── AC-08: 用户提现查询 ───────────────────────────────

  async getUserWithdraws(filters: WithdrawFilter = {}): Promise<PaginatedResult<UserWithdraw>> {
    const parsed = withdrawFilterSchema.parse(filters);
    const params = this._buildParams(parsed);
    return this._callApi(
      '/api/Open/UserWithdrawPageList',
      params,
      rawUserWithdrawSchema,
      'userWithdraws',
      this._transformUserWithdraw,
    );
  }

  // ─── 健康检查 ──────────────────────────────────────────

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.getUsers({ pageIndex: 1, pageSize: 1 });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof MallApiError ? err.message : 'Unknown error',
      };
    }
  }

  // ─── 内部核心方法 ──────────────────────────────────────

  private async _callApi<TRaw, TOut>(
    endpoint: string,
    params: Record<string, string>,
    entitySchema: ZodSchema<TRaw>,
    cacheGroup: CacheGroup,
    transform: (raw: TRaw) => TOut,
  ): Promise<PaginatedResult<TOut>> {
    const cacheKey = buildCacheKey(this.tenantId, endpoint, params);

    // 1. 查缓存
    const cached = await getCache<PaginatedResult<TOut>>(cacheKey);
    if (cached) {
      this.log.debug({ endpoint, cacheKey }, 'Cache hit');
      return { ...cached.data, source: 'cache', cachedAt: cached.cachedAt };
    }

    // 2. 调 API（含重试）
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this._fetchApi(endpoint, params, entitySchema, transform);

        // 3. 写缓存（fail-secure：写失败不影响返回）
        await setCache(cacheKey, result, cacheGroup);

        return { ...result, source: 'api' };
      } catch (err) {
        lastError = err;

        // 不重试的错误类型
        if (err instanceof MallApiError) {
          if (err.code === 'MALL_API_UNAUTHORIZED' || err.code === 'MALL_DATA_INVALID') {
            throw err;
          }
        }

        // 最后一次重试也失败
        if (attempt >= MAX_RETRIES) break;

        this.log.warn({ err, endpoint, attempt: attempt + 1 }, 'API call failed, retrying');
        await this._sleep(RETRY_DELAY_MS);
      }
    }

    // 4. API 全部失败，尝试读过期缓存（降级）
    this.log.warn({ endpoint }, 'All API attempts failed, trying stale cache');
    const staleCache = await getCache<PaginatedResult<TOut>>(cacheKey);
    if (staleCache) {
      this.log.info({ endpoint, cachedAt: staleCache.cachedAt }, 'Serving stale cache');
      return { ...staleCache.data, source: 'cache', cachedAt: staleCache.cachedAt };
    }

    // 5. 缓存也没有 → 抛错（fail-secure）
    if (lastError instanceof MallApiError) throw lastError;
    throw new MallApiError(
      'MALL_API_ERROR',
      `API call to ${endpoint} failed after ${MAX_RETRIES + 1} attempts`,
      { cause: lastError },
    );
  }

  private async _fetchApi<TRaw, TOut>(
    endpoint: string,
    params: Record<string, string>,
    entitySchema: ZodSchema<TRaw>,
    transform: (raw: TRaw) => TOut,
  ): Promise<PaginatedResult<TOut>> {
    if (!this.apiKey) {
      throw new MallApiError('MALL_API_UNAUTHORIZED', 'ZTDY_API_KEY not configured');
    }

    const url = new URL(endpoint, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'api-key': this.apiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new MallApiError(
          'MALL_API_TIMEOUT',
          `Request to ${endpoint} timed out (${REQUEST_TIMEOUT_MS}ms)`,
          { cause: err },
        );
      }
      throw new MallApiError('MALL_API_ERROR', `Network error calling ${endpoint}`, { cause: err });
    }

    if (response.status === 401) {
      throw new MallApiError('MALL_API_UNAUTHORIZED', 'API key invalid or expired');
    }

    if (!response.ok) {
      throw new MallApiError('MALL_API_ERROR', `HTTP ${response.status} from ${endpoint}`);
    }

    // 解析响应
    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      throw new MallApiError('MALL_DATA_INVALID', `Invalid JSON from ${endpoint}`, { cause: err });
    }

    // Zod 校验信封
    const envelopeResult = ztdyEnvelopeSchema.safeParse(body);
    if (!envelopeResult.success) {
      throw new MallApiError(
        'MALL_DATA_INVALID',
        `Response envelope validation failed for ${endpoint}`,
        { cause: envelopeResult.error.issues },
      );
    }

    const envelope = envelopeResult.data;
    if (envelope.Status !== 1) {
      throw new MallApiError(
        'MALL_API_ERROR',
        `API error: ${envelope.Message ?? 'Unknown'} (Code: ${envelope.Code})`,
      );
    }

    // Zod 校验每个实体
    const items: TOut[] = [];
    const errors: Array<{ index: number; issues: unknown }> = [];

    for (let i = 0; i < envelope.Data.PageData.length; i++) {
      const raw = envelope.Data.PageData[i];
      const result = entitySchema.safeParse(raw);
      if (result.success) {
        items.push(transform(result.data));
      } else {
        errors.push({ index: i, issues: result.error.issues });
      }
    }

    if (errors.length > 0) {
      this.log.warn(
        { endpoint, errorCount: errors.length, totalCount: envelope.Data.PageData.length },
        'Some records failed Zod validation, skipping invalid records',
      );
    }

    // 如果所有记录都校验失败
    if (items.length === 0 && envelope.Data.PageData.length > 0) {
      throw new MallApiError(
        'MALL_DATA_INVALID',
        `All ${envelope.Data.PageData.length} records from ${endpoint} failed validation`,
        { cause: errors },
      );
    }

    const totalCount = envelope.Data.TotalCount;
    const pageSize = envelope.Data.PageSize;

    return {
      items,
      pagination: {
        pageIndex: envelope.Data.PageIndex,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
      },
      source: 'api',
    };
  }

  // ─── 参数构建 ──────────────────────────────────────────

  private _buildParams(filters: Record<string, unknown>): Record<string, string> {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        // ztdy API 用 PascalCase 参数
        const apiKey = key.charAt(0).toUpperCase() + key.slice(1);
        params[apiKey] = String(value);
      }
    }
    return params;
  }

  // ─── 数据转换（PascalCase → camelCase）─────────────────

  private _transformUser(raw: {
    UserID: number;
    LoginID?: string | null;
    UserName?: string | null;
    Avatar?: string | null;
    LevelID?: number | null;
    CreateDate?: string | null;
    Phone?: string | null;
  }): MallUser {
    return {
      userId: raw.UserID,
      loginId: raw.LoginID ?? null,
      userName: raw.UserName ?? null,
      avatar: raw.Avatar ?? null,
      levelId: raw.LevelID ?? null,
      createDate: raw.CreateDate ?? null,
      phone: raw.Phone ?? null,
    };
  }

  private _transformOrder(raw: {
    OrderItemID: number;
    OrderItemNo: string;
    UserID: number;
    SupplierID: number;
    SupplierName?: string | null;
    Status: number;
    ProcessNode: number;
    PayDate?: string | null;
    TotalAmount: number;
    ItemName?: string | null;
    Quantity?: number;
    CreateDate?: string | null;
  }): MallOrder {
    return {
      orderItemId: raw.OrderItemID,
      orderItemNo: raw.OrderItemNo,
      userId: raw.UserID,
      supplierId: raw.SupplierID,
      supplierName: raw.SupplierName ?? null,
      status: raw.Status,
      processNode: raw.ProcessNode,
      payDate: raw.PayDate ?? null,
      totalAmount: raw.TotalAmount,
      itemName: raw.ItemName ?? null,
      quantity: raw.Quantity ?? 1,
      createDate: raw.CreateDate ?? null,
    };
  }

  private _transformItem(raw: {
    ItemID: number;
    ItemName: string;
    Keywords?: string | null;
    IsShelf: boolean;
    CreateDate?: string | null;
    SortID?: number | null;
    Price?: number | null;
  }): MallItem {
    return {
      itemId: raw.ItemID,
      itemName: raw.ItemName,
      keywords: raw.Keywords ?? null,
      isShelf: raw.IsShelf,
      createDate: raw.CreateDate ?? null,
      sortId: raw.SortID ?? null,
      price: raw.Price ?? null,
    };
  }

  private _transformSupplier(raw: {
    SupplierID: number;
    SupplierName: string;
    ContactPerson?: string | null;
    ContactPhone?: string | null;
    SettleRuleID?: number | null;
    CreateDate?: string | null;
  }): MallSupplier {
    return {
      supplierId: raw.SupplierID,
      supplierName: raw.SupplierName,
      contactPerson: raw.ContactPerson ?? null,
      contactPhone: raw.ContactPhone ?? null,
      settleRuleId: raw.SettleRuleID ?? null,
      createDate: raw.CreateDate ?? null,
    };
  }

  private _transformSupplierWithdraw(raw: {
    SupplierID: number;
    PayNo: string;
    BankAccountNo?: string | null;
    TranAmount: number;
    Status: number;
    FinishDate?: string | null;
    CreateDate?: string | null;
  }): SupplierWithdraw {
    return {
      supplierId: raw.SupplierID,
      payNo: raw.PayNo,
      bankAccountNo: raw.BankAccountNo ?? null,
      tranAmount: raw.TranAmount,
      status: raw.Status,
      finishDate: raw.FinishDate ?? null,
      createDate: raw.CreateDate ?? null,
    };
  }

  private _transformUserWithdraw(raw: {
    UserID: number;
    PayNo: string;
    Award: number;
    Status: number;
    TranType?: number | null;
    CreateDate?: string | null;
  }): UserWithdraw {
    return {
      userId: raw.UserID,
      payNo: raw.PayNo,
      award: raw.Award,
      status: raw.Status,
      tranType: raw.TranType ?? null,
      createDate: raw.CreateDate ?? null,
    };
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
