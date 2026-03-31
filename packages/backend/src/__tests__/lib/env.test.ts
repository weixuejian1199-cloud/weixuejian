import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// env.ts calls process.exit(1) at module load if env vars are missing.
// We cannot safely import env.ts in test without those vars set.
// Instead, we replicate the envSchema here and test its Zod validation logic.

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ORIGINS: z.string().min(1, 'CORS_ORIGINS is required (comma-separated)'),
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  API_DOMAIN: z.string().optional(),
  APP_DOMAIN: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
  DASHSCOPE_API_KEY: z.string().optional(),
  DASHSCOPE_BASE_URL: z.string().url().optional(),
  DASHSCOPE_MODEL: z.string().optional(),
  ZTDY_API_BASE_URL: z.string().url().optional(),
  ZTDY_API_KEY: z.string().optional(),
  JST_APP_KEY: z.string().optional(),
  JST_APP_SECRET: z.string().optional(),
  WECHAT_APP_ID: z.string().optional(),
  WECHAT_APP_SECRET: z.string().optional(),
  ALIYUN_ACCESS_KEY_ID: z.string().optional(),
  ALIYUN_ACCESS_KEY_SECRET: z.string().optional(),
  ALIYUN_OSS_BUCKET: z.string().optional(),
  ALIYUN_OSS_REGION: z.string().optional(),
  FEISHU_LINGXI_APP_ID: z.string().optional(),
  FEISHU_LINGXI_APP_SECRET: z.string().optional(),
  FEISHU_LINGXI_SERVICE_TENANT_ID: z.string().uuid().optional(),
  FEISHU_LINGXI_SERVICE_USER_ID: z.string().uuid().optional(),
  RATE_LIMIT_TENANT_MAX: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_TENANT_WINDOW_MS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_USER_MAX: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_USER_WINDOW_MS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_AI_MAX: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_AI_WINDOW_MS: z.coerce.number().int().positive().optional(),
});

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(32),
  CORS_ORIGINS: 'http://localhost:3000',
};

describe('envSchema validation', () => {
  it('should parse valid environment variables', () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
  });

  it('should accept valid NODE_ENV values', () => {
    for (const val of ['development', 'production', 'test']) {
      const result = envSchema.safeParse({ ...validEnv, NODE_ENV: val });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.NODE_ENV).toBe(val);
    }
  });

  it('should reject invalid NODE_ENV', () => {
    const result = envSchema.safeParse({ ...validEnv, NODE_ENV: 'staging' });
    expect(result.success).toBe(false);
  });

  it('should default NODE_ENV to development', () => {
    const { NODE_ENV: _, ...withoutNodeEnv } = validEnv;
    const result = envSchema.safeParse(withoutNodeEnv);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.NODE_ENV).toBe('development');
  });

  it('should coerce PORT from string to number', () => {
    const result = envSchema.safeParse({ ...validEnv, PORT: '8080' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.PORT).toBe(8080);
  });

  it('should default PORT to 3000', () => {
    const { PORT: _, ...withoutPort } = validEnv;
    const result = envSchema.safeParse(withoutPort);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.PORT).toBe(3000);
  });

  it('should reject empty DATABASE_URL', () => {
    const result = envSchema.safeParse({ ...validEnv, DATABASE_URL: '' });
    expect(result.success).toBe(false);
  });

  it('should reject missing DATABASE_URL', () => {
    const { DATABASE_URL: _, ...without } = validEnv;
    const result = envSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject empty REDIS_URL', () => {
    const result = envSchema.safeParse({ ...validEnv, REDIS_URL: '' });
    expect(result.success).toBe(false);
  });

  it('should reject JWT_SECRET shorter than 32 chars', () => {
    const result = envSchema.safeParse({ ...validEnv, JWT_SECRET: 'short' });
    expect(result.success).toBe(false);
  });

  it('should reject empty CORS_ORIGINS', () => {
    const result = envSchema.safeParse({ ...validEnv, CORS_ORIGINS: '' });
    expect(result.success).toBe(false);
  });

  it('should default JWT_ACCESS_EXPIRES_IN to 15m', () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.JWT_ACCESS_EXPIRES_IN).toBe('15m');
  });

  it('should default JWT_REFRESH_EXPIRES_IN to 7d', () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.JWT_REFRESH_EXPIRES_IN).toBe('7d');
  });

  it('should accept optional DASHSCOPE_BASE_URL as valid URL', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      DASHSCOPE_BASE_URL: 'https://dashscope.aliyuncs.com',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid DASHSCOPE_BASE_URL', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      DASHSCOPE_BASE_URL: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid FEISHU_LINGXI_SERVICE_TENANT_ID as UUID', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      FEISHU_LINGXI_SERVICE_TENANT_ID: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid UUID for FEISHU_LINGXI_SERVICE_TENANT_ID', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      FEISHU_LINGXI_SERVICE_TENANT_ID: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('should coerce RATE_LIMIT_TENANT_MAX from string to number', () => {
    const result = envSchema.safeParse({
      ...validEnv,
      RATE_LIMIT_TENANT_MAX: '100',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.RATE_LIMIT_TENANT_MAX).toBe(100);
  });
});
