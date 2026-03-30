import { z } from 'zod';
import { config } from 'dotenv';

// 加载 .env 文件（必须在 Zod 解析之前）
config();

const envSchema = z.object({
  // ═══ 必需变量 ═══════════════════════════════════════════
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ORIGINS: z.string().min(1, 'CORS_ORIGINS is required (comma-separated)'),

  // ═══ JWT 配置 ═══════════════════════════════════════════
  // Phase 1: HS256 + JWT_SECRET。Phase 1b(US-P1b-001): 升级 RS256 密钥对
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // ═══ 域名 ══════════════════════════════════════════════
  API_DOMAIN: z.string().optional(),
  APP_DOMAIN: z.string().optional(),

  // ═══ 日志级别 ══════════════════════════════════════════
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .optional(),

  // ═══ AI（百炼）═══════════════════════════════════════════
  DASHSCOPE_API_KEY: z.string().optional(),
  DASHSCOPE_BASE_URL: z.string().url().optional(),
  DASHSCOPE_MODEL: z.string().optional(),

  // ═══ 商城 API（ztdy-open）══════════════════════════════
  ZTDY_API_BASE_URL: z.string().url().optional(),
  ZTDY_API_KEY: z.string().optional(),

  // ═══ ERP（聚水潭，Phase 2）═════════════════════════════
  JST_APP_KEY: z.string().optional(),
  JST_APP_SECRET: z.string().optional(),

  // ═══ 微信小程序（Phase 1b）═════════════════════════════
  WECHAT_APP_ID: z.string().optional(),
  WECHAT_APP_SECRET: z.string().optional(),

  // ═══ 阿里云（Phase 1b 备份）═══════════════════════════
  ALIYUN_ACCESS_KEY_ID: z.string().optional(),
  ALIYUN_ACCESS_KEY_SECRET: z.string().optional(),
  ALIYUN_OSS_BUCKET: z.string().optional(),
  ALIYUN_OSS_REGION: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(
      `\n❌ Environment validation failed:\n${formatted}\n\nPlease check your .env file.\n`,
    );
    process.exit(1);
  }

  return result.data;
}

/** 类型安全的环境变量，应用启动时已验证 */
export const env: Env = validateEnv();
