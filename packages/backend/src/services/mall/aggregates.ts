/**
 * MallAdapter 聚合查询服务
 *
 * Phase 1 策略：限量实时聚合 + completeness 标记。
 * 最多遍历 SAMPLE_PAGES 页（避免耗尽 API 配额），
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

/** 快速采样页数（控制在 5 秒内返回） */
const SAMPLE_PAGES = 20;

/** 每页大小（ztdy API 实际上限 200） */
const AGGREGATE_PAGE_SIZE = 200;

/** 并发请求数 */
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

  // ztdy API 不支持服务端日期过滤，数据按时间倒序返回。
  // 策略：采样前 N 页 → 统计命中率 → 用 TotalCount 估算全量。
  const startMs = new Date(dateRange.start).getTime();
  const endMs = new Date(dateRange.end + ' 23:59:59').getTime();

  let sampleAmount = 0;
  let sampleHits = 0;
  let scannedRecords = 0;
  let totalRecords = 0;
  let hitOlderData = false;

  for (let batch = 0; batch < SAMPLE_PAGES / CONCURRENCY && !hitOlderData; batch++) {
    const pages = Array.from({ length: CONCURRENCY }, (_, i) => batch * CONCURRENCY + i + 1);
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
          sampleAmount += order.totalAmount;
          sampleHits++;
        } else if (payMs < startMs) {
          hitOlderData = true;
        }
      }
    }
  }

  // 如果采样全部命中（说明还没扫到日期范围外），用采样均值 × 估算总量
  const sampleSize = scannedRecords;
  const hitRate = sampleSize > 0 ? sampleHits / sampleSize : 0;
  const avgAmountPerOrder = sampleHits > 0 ? sampleAmount / sampleHits : 0;

  let totalAmount: number;
  let orderCount: number;

  if (hitOlderData || hitRate < 0.95) {
    // 采样已覆盖到日期边界外，直接用采样的精确值
    totalAmount = sampleAmount;
    orderCount = sampleHits;
  } else {
    // 采样全命中，说明数据量超过采样范围，用比例估算
    // 估算月订单数 = sampleHits / hitRate （近似）
    const estimatedOrders = Math.round(sampleHits / hitRate * (totalRecords / sampleSize > 1 ? Math.min(totalRecords / sampleSize, totalRecords / AGGREGATE_PAGE_SIZE / SAMPLE_PAGES) : 1));
    totalAmount = Math.round(avgAmountPerOrder * estimatedOrders * 100) / 100;
    orderCount = estimatedOrders;
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

  for (let page = 1; page <= SAMPLE_PAGES; page++) {
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

  for (let page = 1; page <= SAMPLE_PAGES; page++) {
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
