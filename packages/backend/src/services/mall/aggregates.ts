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
  SlowSupplierInfo,
  UserGrowthTrend,
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

/**
 * Wave 8: 出货最慢的供应商
 *
 * 查询 processNode=2（待发货）的订单，按 supplierId 分组，
 * 按最早待发货日期升序排序（越早 = 越慢）。
 */
export async function getSlowSuppliers(
  adapter: MallAdapter,
  tenantId: string,
  limit = 10,
): Promise<AggregateResult<SlowSupplierInfo[]>> {
  const cacheKey = buildAggregateCacheKey(tenantId, 'slowSuppliers', { limit });
  const cached = await getCache<AggregateResult<SlowSupplierInfo[]>>(cacheKey);
  if (cached) return cached.data;

  const supplierMap = new Map<
    number,
    { name: string | null; pendingCount: number; oldestOrderDate: string | null }
  >();
  let scannedRecords = 0;
  let totalRecords = 0;

  let done = false;
  for (let batch = 0; batch < SAMPLE_PAGES / CONCURRENCY && !done; batch++) {
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
        if (order.processNode !== 2) continue;

        const existing = supplierMap.get(order.supplierId);
        if (existing) {
          existing.pendingCount++;
          if (!existing.name && order.supplierName) {
            existing.name = order.supplierName;
          }
          if (order.createDate && (!existing.oldestOrderDate || order.createDate < existing.oldestOrderDate)) {
            existing.oldestOrderDate = order.createDate;
          }
        } else {
          supplierMap.set(order.supplierId, {
            name: order.supplierName,
            pendingCount: 1,
            oldestOrderDate: order.createDate,
          });
        }
      }

      if (result.pagination.pageIndex >= result.pagination.totalPages) {
        done = true;
        break;
      }
    }
  }

  const ranked = Array.from(supplierMap.entries())
    .map(([supplierId, stats]) => ({
      supplierId,
      supplierName: stats.name,
      pendingCount: stats.pendingCount,
      oldestOrderDate: stats.oldestOrderDate,
    }))
    .sort((a, b) => {
      if (!a.oldestOrderDate && !b.oldestOrderDate) return 0;
      if (!a.oldestOrderDate) return 1;
      if (!b.oldestOrderDate) return -1;
      return a.oldestOrderDate.localeCompare(b.oldestOrderDate);
    })
    .slice(0, limit);

  const data: AggregateResult<SlowSupplierInfo[]> = {
    data: ranked,
    computedAt: new Date().toISOString(),
    completeness: totalRecords > 0 ? Math.min(scannedRecords / totalRecords, 1) : 1,
    totalRecords,
    scannedRecords,
  };

  await setAggregateCache(cacheKey, data);
  logger.debug({ tenantId, limit, supplierCount: ranked.length }, 'Slow suppliers computed');
  return data;
}

/**
 * Wave 8: 用户增长趋势
 *
 * 查询指定日期范围的用户，按天分组统计新增数。
 * ztdy API 用户数据按时间倒序，碰到日期范围外即可停止扫描。
 */
export async function getUserGrowthTrend(
  adapter: MallAdapter,
  tenantId: string,
  dateRange: { start: string; end: string },
): Promise<AggregateResult<UserGrowthTrend>> {
  const cacheKey = buildAggregateCacheKey(tenantId, 'userGrowth', dateRange);
  const cached = await getCache<AggregateResult<UserGrowthTrend>>(cacheKey);
  if (cached) return cached.data;

  const startDate = dateRange.start;
  const endDate = dateRange.end;

  const dailyMap = new Map<string, number>();
  let scannedRecords = 0;
  let totalRecords = 0;
  let hitOlderData = false;

  for (let batch = 0; batch < SAMPLE_PAGES / CONCURRENCY && !hitOlderData; batch++) {
    const pages = Array.from({ length: CONCURRENCY }, (_, i) => batch * CONCURRENCY + i + 1);
    const results = await Promise.all(
      pages.map((page) =>
        adapter.getUsers({ pageIndex: page, pageSize: AGGREGATE_PAGE_SIZE }),
      ),
    );

    for (const result of results) {
      if (totalRecords === 0) totalRecords = result.pagination.totalCount;

      for (const user of result.items) {
        scannedRecords++;
        if (!user.createDate) continue;

        const dateStr = user.createDate.slice(0, 10);
        if (dateStr < startDate) {
          hitOlderData = true;
          break;
        }
        if (dateStr > endDate) continue;

        dailyMap.set(dateStr, (dailyMap.get(dateStr) ?? 0) + 1);
      }

      if (hitOlderData) break;
      if (result.pagination.pageIndex >= result.pagination.totalPages) {
        hitOlderData = true;
        break;
      }
    }
  }

  const dailyBreakdown = Array.from(dailyMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalNew = dailyBreakdown.reduce((sum, d) => sum + d.count, 0);

  const data: AggregateResult<UserGrowthTrend> = {
    data: { totalNew, dailyBreakdown },
    computedAt: new Date().toISOString(),
    completeness: totalRecords > 0 ? Math.min(scannedRecords / totalRecords, 1) : 1,
    totalRecords,
    scannedRecords,
  };

  await setAggregateCache(cacheKey, data);
  logger.debug({ tenantId, dateRange, totalNew, days: dailyBreakdown.length }, 'User growth trend computed');
  return data;
}
