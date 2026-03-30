import { z } from 'zod';
import { config } from 'dotenv';

// 加载 .env 文件（必须在 Zod 解析之前）
config();

const envSchema = z.object({
  // === 必需变量 ===
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ORIGINS: z.string().min(1, 'CORS_ORIGINS is required (comma-separated)'),

  // === 可选变量 ===
  DASHSCOPE_API_KEY: z.string().optional(),
  ZTDY_API_BASE_URL: z.string().url().optional(),
  ZTDY_API_KEY: z.string().optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(
      `\n❌ Environment validation failed:\n${formatted}\n\nPlease check your .env file.\n`,
    );
    process.exit(1);
  }

  return result.data;
}

/** 类型安全的环境变量，应用启动时已验证 */
export const env: Env = validateEnv();
