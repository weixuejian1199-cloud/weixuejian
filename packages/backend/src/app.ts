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
import { createRateLimit } from './middleware/rate-limit.js';
import { notFoundHandler, globalErrorHandler } from './middleware/error-handler.js';
import { basicHealthRouter, detailHealthRouter } from './routes/health.js';

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
// app.use('/api/v1/auth', authRouter);

// ─── 需认证的 API 路由 ───────────────────────────────────
// 使用独立 Router，统一挂载 requireAuth + requireTenant
const protectedRouter = express.Router();
protectedRouter.use(requireAuth);
protectedRouter.use(requireTenant);

// 业务路由挂载点（后续 US 实现后启用）
// protectedRouter.use('/employee', employeeRouter);
// protectedRouter.use('/buyer', buyerRouter);
// protectedRouter.use('/admin', adminRouter);

app.use('/api/v1', protectedRouter);

// ─── Webhook 路由（使用签名验证，不走 JWT） ──────────────
// app.use('/webhook', webhookRouter);

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
    logger.warn({ err }, 'Redis connection failed, starting without Redis');
  }

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      'Server running',
    );
  });

  // ─── 优雅关闭 ────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');

    // 1. 停止接收新连接
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // 2. 关闭所有依赖（并行，互不阻塞）
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
}

void start();

export { app };
