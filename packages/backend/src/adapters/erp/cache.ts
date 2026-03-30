/**
 * MallAdapter Redis 缓存工具
 *
 * 缓存 key 格式: v1:mall:{tenantId}:{method}:{sha256(sortedParams)[0:16]}
 * TTL 按数据类型差异化（PIT-017）。
 */
import { createHash } from 'node:crypto';
import { redis } from '../../lib/redis.js';
import { logger } from '../../utils/logger.js';
import type { CacheGroup } from './types.js';

/** 按数据类型差异化的缓存 TTL（秒）*/
export const CACHE_TTL: Record<CacheGroup, number> = {
  orders: 300,            // 5 分钟 — 状态变化频繁
  items: 1800,            // 30 分钟 — 相对稳定
  users: 3600,            // 60 分钟 — 很少变化
  suppliers: 1800,        // 30 分钟
  supplierWithdraws: 1800, // 30 分钟
  userWithdraws: 300,     // 5 分钟 — 活跃提现需要新数据
};

/** 聚合查询缓存 TTL */
export const AGGREGATE_CACHE_TTL = 600; // 10 分钟

/**
 * 构建缓存 key
 *
 * 使用 SHA256 哈希排序后的参数确保：
 * 1. 相同参数（不同顺序）→ 相同 key
 * 2. 不同参数 → 不同 key
 * 3. key 长度固定，不会因参数多少膨胀
 */
export function buildCacheKey(
  tenantId: string,
  method: string,
  params: Record<string, unknown>,
): string {
  const sortedKeys = Object.keys(params).sort();
  const sortedObj: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    const value = params[key];
    if (value !== undefined && value !== null) {
      sortedObj[key] = value;
    }
  }
  const hash = createHash('sha256')
    .update(JSON.stringify(sortedObj))
    .digest('hex')
    .slice(0, 16);
  return `v1:mall:${tenantId}:${method}:${hash}`;
}

/**
 * 读取缓存
 *
 * fail-secure: Redis GET 失败 → 当作 cache miss，不抛错。
 */
export async function getCache<T>(key: string): Promise<{ data: T; cachedAt: string } | null> {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: T; cachedAt: string };
    return parsed;
  } catch (err) {
    logger.warn({ err, key }, 'Cache read failed, treating as cache miss');
    return null;
  }
}

/**
 * 写入缓存
 *
 * fail-secure: Redis SET 失败 → 只记日志，不影响 API 返回。
 */
export async function setCache(
  key: string,
  data: unknown,
  group: CacheGroup,
): Promise<void> {
  try {
    const ttl = CACHE_TTL[group];
    const payload = JSON.stringify({
      data,
      cachedAt: new Date().toISOString(),
    });
    await redis.set(key, payload, 'EX', ttl);
  } catch (err) {
    logger.warn({ err, key, group }, 'Cache write failed, data served without caching');
  }
}

/**
 * 写入聚合查询缓存（固定 TTL）
 */
export async function setAggregateCache(
  key: string,
  data: unknown,
): Promise<void> {
  try {
    const payload = JSON.stringify({
      data,
      cachedAt: new Date().toISOString(),
    });
    await redis.set(key, payload, 'EX', AGGREGATE_CACHE_TTL);
  } catch (err) {
    logger.warn({ err, key }, 'Aggregate cache write failed');
  }
}

/**
 * 构建聚合查询缓存 key
 */
export function buildAggregateCacheKey(
  tenantId: string,
  func: string,
  params: Record<string, unknown>,
): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(params))
    .digest('hex')
    .slice(0, 16);
  return `v1:agg:${tenantId}:${func}:${hash}`;
}
