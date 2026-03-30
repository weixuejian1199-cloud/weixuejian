import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

// 延迟导入 env 避免循环依赖：redis 模块在 env 验证之后才被使用
// 但模块加载时 env.ts 已经执行完毕
const getRedisUrl = (): string => {
  // 从已验证的环境变量读取（支持密码，如 redis://:password@host:port/db）
  return process.env['REDIS_URL'] ?? 'redis://localhost:6379';
};

export const redis = new Redis(getRedisUrl(), {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  retryStrategy(times: number) {
    const delay = Math.min(times * 200, 5000);
    return delay;
  },
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (err: Error) => {
  logger.error({ err: err.message }, 'Redis connection error');
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

/**
 * 显式连接 Redis — 在应用启动时调用
 * lazyConnect 模式下必须手动调用 connect()
 */
export async function connectRedis(): Promise<void> {
  await redis.connect();
}
