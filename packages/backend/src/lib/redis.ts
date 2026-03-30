import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (err: Error) => {
  logger.error({ err: err.message }, 'Redis connection error');
});
