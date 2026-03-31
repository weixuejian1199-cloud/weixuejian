// 环境变量验证必须最先执行
import { env } from './lib/env.js';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { logger } from './utils/logger.js';
import { redis, connectRedis } from './lib/redis.js';
import { prisma } from './lib/prisma.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { requireAuth } from './middleware/auth.js';
import { requireTenant } from './middleware/tenant.js';
import {
  createRateLimit,
  createTenantRateLimit,
  createUserRateLimit,
  createAiRateLimit,
} from './middleware/rate-limit.js';
import { notFoundHandler, globalErrorHandler } from './middleware/error-handler.js';
import { basicHealthRouter, detailHealthRouter } from './routes/health.js';
import { authRouter } from './routes/auth/index.js';
import { aiRouter } from './routes/ai/index.js';
import { csRouter } from './routes/cs/index.js';

const app = express();

// ─── 安全头 ───────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);

// ─── CORS 白名单 ─────────────────────────────────────────
const allowedOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    maxAge: 86400,
  }),
);

// ─── 请求解析 ─────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── 请求 ID + 日志（全局） ──────────────────────────────
app.use(requestIdMiddleware);
app.use(requestLogger);

// ─── 公开路由（不需要认证和限流） ─────────────────────────
app.use('/health', basicHealthRouter);
app.use('/api/v1/health', detailHealthRouter);

// ─── 全局速率限制（认证路由之前） ─────────────────────────
app.use(
  '/api/',
  createRateLimit({
    windowMs: 60 * 1000,
    max: 100,
    keyGenerator: (req) => `global:${req.ip}`,
  }),
);

// ─── 公开 API 路由（登录/注册等，不需要 JWT） ────────────
// 使用独立 Router 隔离，不经过 requireAuth
app.use('/api/v1/auth', authRouter);

// ─── 需认证的 API 路由 ───────────────────────────────────
// 使用独立 Router，统一挂载 requireAuth + requireTenant
const protectedRouter = express.Router();
protectedRouter.use(requireAuth);
protectedRouter.use(requireTenant);

// ─── 租户级 + 用户级限流（认证后才有 tenantId/userId） ────
protectedRouter.use(createTenantRateLimit());
protectedRouter.use(createUserRateLimit());

// ─── AI 接口专项限流（10 req/min，用户级） ───────────────
protectedRouter.use('/ai', createAiRateLimit());

// ─── AI 对话引擎 ─────────────────────────────────────────
protectedRouter.use('/ai', aiRouter);

// ─── ACI 客服中枢 ────────────────────────────────────────
protectedRouter.use('/cs', csRouter);

app.use('/api/v1', protectedRouter);

// ─── 404 兜底 + 全局错误处理（必须在所有路由之后） ────────
app.use(notFoundHandler);
app.use(globalErrorHandler);

// ─── 启动服务 ─────────────────────────────────────────────
async function start(): Promise<void> {
  // ─── PostgreSQL 连接验证（fail-secure: 失败则拒绝启动）───
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('PostgreSQL connected');
  } catch (err) {
    logger.error({ err }, 'PostgreSQL connection failed — refusing to start (fail-secure)');
    process.exit(1);
  }

  try {
    await connectRedis();
  } catch (err) {
    logger.error({ err }, 'Redis connection failed — refusing to start (fail-secure)');
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server running');
  });

  // ─── 飞书灵犀 Bridge（可选，功能开关）────────────────
  if (env.FEISHU_LINGXI_APP_ID) {
    try {
      const { startLingxiBridge } = await import('./services/feishu-bridge/lingxi-bridge.js');
      await startLingxiBridge();
    } catch (err) {
      logger.error({ err }, 'Feishu Lingxi bridge failed to start');
    }
  }

  // ─── 优雅关闭 ────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');

    // 1. 停止接收新连接
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // 2. 停止灵犀 Bridge（如果启动了）
    if (env.FEISHU_LINGXI_APP_ID) {
      try {
        const { stopLingxiBridge } = await import('./services/feishu-bridge/lingxi-bridge.js');
        stopLingxiBridge();
      } catch {
        // Bridge 可能未成功启动，忽略
      }
    }

    // 3. 关闭所有依赖（并行，互不阻塞）
    const results = await Promise.allSettled([
      redis.quit().catch((err: unknown) => {
        logger.error({ err }, 'Redis shutdown error');
      }),
      prisma.$disconnect().catch((err: unknown) => {
        logger.error({ err }, 'Prisma shutdown error');
      }),
    ]);

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.warn({ failedCount: failed.length }, 'Some dependencies failed to shutdown');
    } else {
      logger.info('All dependencies shutdown complete');
    }

    // 3. 强制退出兜底（防僵尸进程）
    setTimeout(() => {
      logger.warn('Forcing shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'Unhandled rejection — exiting');
    process.exit(1);
  });
}

void start();

export { app };
