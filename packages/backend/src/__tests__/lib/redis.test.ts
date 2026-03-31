import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/env.js', () => ({
  env: {
    REDIS_URL: 'redis://localhost:6379',
    NODE_ENV: 'test',
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { redis, connectRedis } from '../../lib/redis.js';

describe('redis', () => {
  it('should export redis instance', () => {
    expect(redis).toBeDefined();
    expect(typeof redis.get).toBe('function');
    expect(typeof redis.set).toBe('function');
    expect(typeof redis.setex).toBe('function');
    expect(typeof redis.exists).toBe('function');
    expect(typeof redis.del).toBe('function');
  });

  it('should export connectRedis function', () => {
    expect(typeof connectRedis).toBe('function');
  });

  it('should have lazyConnect enabled (not auto-connected)', () => {
    expect(redis.status).toBe('wait');
  });

  it('should have maxRetriesPerRequest configured', () => {
    expect(redis.options.maxRetriesPerRequest).toBe(3);
  });
});
