/**
 * 缓存预计算定时任务
 *
 * 策略：
 * - 每小时：增量刷新热点聚合数据
 * - 每日凌晨：全量刷新所有聚合缓存
 *
 * 注意：Phase 1 仅预热聚合查询缓存，不落库
 */
import { logger } from '../utils/logger.js';

// 预热间隔配置
export const REFRESH_INTERVALS = {
  HOURLY: 60 * 60 * 1000,   // 1小时
  DAILY: 24 * 60 * 60 * 1000, // 24小时
} as const;

/**
 * 增量刷新：每小时执行
 * 预热最近访问频率高的聚合查询
 */
export async function refreshHourly(): Promise<void> {
  const start = Date.now();
  logger.info('Cache refresh (hourly) started');

  try {
    // Phase 1: 预热 sales-stats 和 top-suppliers
    // 实际调用需要 tenantId，Phase 1 单租户从环境变量或DB获取
    // TODO: 接入 mall-aggregates.getSalesStats / getTopSuppliers
    logger.info({ duration: Date.now() - start }, 'Cache refresh (hourly) completed');
  } catch (err) {
    logger.error({ err, duration: Date.now() - start }, 'Cache refresh (hourly) failed');
  }
}

/**
 * 全量刷新：每日凌晨执行
 * 重建所有聚合缓存
 */
export async function refreshDaily(): Promise<void> {
  const start = Date.now();
  logger.info('Cache refresh (daily) started');

  try {
    // Phase 1: 全量刷新所有缓存分组
    // TODO: 遍历所有租户，调用各聚合查询预热缓存
    logger.info({ duration: Date.now() - start }, 'Cache refresh (daily) completed');
  } catch (err) {
    logger.error({ err, duration: Date.now() - start }, 'Cache refresh (daily) failed');
  }
}

/**
 * 启动定时任务（在 app.ts 启动后调用）
 */
export function startCacheRefreshJobs(): void {
  // 启动后延迟 30 秒执行首次预热（避免与启动竞争）
  setTimeout(() => {
    void refreshHourly();
  }, 30_000);

  // 每小时增量
  setInterval(() => {
    void refreshHourly();
  }, REFRESH_INTERVALS.HOURLY);

  // 每日全量（凌晨 3 点）
  const scheduleDaily = (): void => {
    const now = new Date();
    const next3am = new Date(now);
    next3am.setHours(3, 0, 0, 0);
    if (next3am <= now) {
      next3am.setDate(next3am.getDate() + 1);
    }
    const delay = next3am.getTime() - now.getTime();

    setTimeout(() => {
      void refreshDaily();
      // 之后每24小时重复
      setInterval(() => void refreshDaily(), REFRESH_INTERVALS.DAILY);
    }, delay);
  };

  scheduleDaily();
  logger.info('Cache refresh jobs scheduled (hourly + daily@3am)');
}
