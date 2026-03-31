/**
 * MallAdapter 聚合查询服务
 *
 * Phase 1 策略：限量实时聚合 + completeness 标记。
 * 最多遍历 MAX_AGGREGATE_PAGES 页（避免耗尽 API 配额），
 * 返回 completeness 让调用方知道数据完整度。
 */
import type { MallAdapter } from '../../adapters/erp/mall-adapter.js';
import { buildAggregateCacheKey, getCache, setAggregateCache } from '../../adapters/erp/cache.js';
import { logger } from '../../utils/logger.js';
import type {
  AggregateResult,
  SalesStats,
  SupplierRank,
  StatusDistribution,
} from '../../adapters/erp/types.js';

/** 聚合查询最多遍历的页数 */
const MAX_AGGREGATE_PAGES = 300;

/** 每页大小（ztdy API 实际上限 200） */
const AGGREGATE_PAGE_SIZE = 200;

/** 并发请求数（加速分页遍历） */
const CONCURRENCY = 5;

/**
 * AC-11: 销售统计
 *
 * 按日期范围查询订单，计算总金额/订单数/平均客单价。
 */
export async function getSalesStats(
  adapter: MallAdapter,
  tenantId: string,
  dateRange: { start: string; end: string },
): Promise<AggregateResult<SalesStats>> {
  const cacheKey = buildAggregateCacheKey(tenantId, 'salesStats', dateRange);
  const cached = await getCache<AggregateResult<SalesStats>>(cacheKey);
  if (cached) return cached.data;

  let totalAmount = 0;
  let orderCount = 0;
  let scannedRecords = 0;
  let totalRecords = 0;
  let hitOlderData = false;

  // ztdy API 不支持日期过滤，数据按时间倒序返回
  // 策略：并发拉取，客户端按 PayDate 过滤，遇到旧数据停止
  const startMs = new Date(dateRange.start).getTime();
  const endMs = new Date(dateRange.end + ' 23:59:59').getTime();

  for (let batch = 0; batch < MAX_AGGREGATE_PAGES / CONCURRENCY && !hitOlderData; batch++) {
    const pages = Array.from({ length: CONCURRENCY }, (_, i) => batch * CONCURRENCY + i + 1)
      .filter((p) => p <= MAX_AGGREGATE_PAGES);

    const results = await Promise.all(
      pages.map((page) =>
        adapter.getOrders({ pageIndex: page, pageSize: AGGREGATE_PAGE_SIZE }),
      ),
    );

    for (const result of results) {
      if (totalRecords === 0) totalRecords = result.pagination.totalCount;

      for (const order of result.items) {
        scannedRecords++;
        if (!order.payDate) continue;
        const payMs = new Date(order.payDate).getTime();
        if (payMs >= startMs && payMs <= endMs) {
          totalAmount += order.totalAmount;
          orderCount++;
        } else if (payMs < startMs) {
          hitOlderData = true;
        }
      }

      if (results[0] && batch * CONCURRENCY + 1 >= results[0].pagination.totalPages) {
        hitOlderData = true;
      }
    }
  }

  const data: AggregateResult<SalesStats> = {
    data: {
      totalAmount: Math.round(totalAmount * 100) / 100,
      orderCount,
      avgOrderAmount: orderCount > 0 ? Math.round((totalAmount / orderCount) * 100) / 100 : 0,
    },
    computedAt: new Date().toISOString(),
    completeness: totalRecords > 0 ? Math.min(scannedRecords / totalRecords, 1) : 1,
    totalRecords,
    scannedRecords,
  };

  await setAggregateCache(cacheKey, data);
  return data;
}

/**
 * AC-11: TOP 供应商排行
 *
 * 按订单数或金额排序供应商。
 */
export async function getTopSuppliers(
  adapter: MallAdapter,
  tenantId: string,
  metric: 'orderCount' | 'amount',
  limit = 10,
): Promise<AggregateResult<SupplierRank[]>> {
  const cacheKey = buildAggregateCacheKey(tenantId, 'topSuppliers', { metric, limit });
  const cached = await getCache<AggregateResult<SupplierRank[]>>(cacheKey);
  if (cached) return cached.data;

  const supplierMap = new Map<
    number,
    { name: string | null; orderCount: number; amount: number }
  >();
  let scannedRecords = 0;
  let totalRecords = 0;

  for (let page = 1; page <= MAX_AGGREGATE_PAGES; page++) {
    const result = await adapter.getOrders({
      pageIndex: page,
      pageSize: AGGREGATE_PAGE_SIZE,
    });

    totalRecords = result.pagination.totalCount;

    for (const order of result.items) {
      const existing = supplierMap.get(order.supplierId);
      if (existing) {
        existing.orderCount++;
        existing.amount += order.totalAmount;
        if (!existing.name && order.supplierName) {
          existing.name = order.supplierName;
        }
      } else {
        supplierMap.set(order.supplierId, {
          name: order.supplierName,
          orderCount: 1,
          amount: order.totalAmount,
        });
      }
    }
    scannedRecords += result.items.length;

    if (page >= result.pagination.totalPages) break;
  }

  const ranked = Array.from(supplierMap.entries())
    .map(([supplierId, stats]) => ({
      supplierId,
      supplierName: stats.name,
      value: metric === 'orderCount' ? stats.orderCount : Math.round(stats.amount * 100) / 100,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  const data: AggregateResult<SupplierRank[]> = {
    data: ranked,
    computedAt: new Date().toISOString(),
    completeness: totalRecords > 0 ? Math.min(scannedRecords / totalRecords, 1) : 1,
    totalRecords,
    scannedRecords,
  };

  await setAggregateCache(cacheKey, data);
  logger.debug({ tenantId, metric, limit, supplierCount: ranked.length }, 'Top suppliers computed');
  return data;
}

/**
 * AC-11: 订单状态分布
 *
 * 统计各 ProcessNode 状态的订单数量。
 */
export async function getOrderStatusDistribution(
  adapter: MallAdapter,
  tenantId: string,
  dateRange?: { start: string; end: string },
): Promise<AggregateResult<StatusDistribution>> {
  const cacheKey = buildAggregateCacheKey(tenantId, 'statusDist', dateRange ?? {});
  const cached = await getCache<AggregateResult<StatusDistribution>>(cacheKey);
  if (cached) return cached.data;

  const distribution: StatusDistribution = {};
  let scannedRecords = 0;
  let totalRecords = 0;

  for (let page = 1; page <= MAX_AGGREGATE_PAGES; page++) {
    const result = await adapter.getOrders({
      pageIndex: page,
      pageSize: AGGREGATE_PAGE_SIZE,
      startDate: dateRange?.start,
      endDate: dateRange?.end,
    });

    totalRecords = result.pagination.totalCount;

    for (const order of result.items) {
      const key = String(order.processNode);
      distribution[key] = (distribution[key] ?? 0) + 1;
    }
    scannedRecords += result.items.length;

    if (page >= result.pagination.totalPages) break;
  }

  const data: AggregateResult<StatusDistribution> = {
    data: distribution,
    computedAt: new Date().toISOString(),
    completeness: totalRecords > 0 ? Math.min(scannedRecords / totalRecords, 1) : 1,
    totalRecords,
    scannedRecords,
  };

  await setAggregateCache(cacheKey, data);
  return data;
}
