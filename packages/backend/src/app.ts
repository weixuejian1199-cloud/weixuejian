// 环境变量验证必须最先执行
import { env } from './lib/env.js';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { logger } from './utils/logger.js';
import { redis, connectRedis } from './lib/redis.js';
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
      maxAge: 31536000, // 1 年
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
      // 允许无 origin 的请求（如服务端调用、curl）
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    maxAge: 86400, // 预检缓存 24 小时
  }),
);

// ─── 请求解析 ─────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── 请求 ID + 日志 ──────────────────────────────────────
app.use(requestIdMiddleware);
app.use(requestLogger);

// ─── 健康检查（不需要认证和限流） ─────────────────────────
app.use('/health', basicHealthRouter);
app.use('/api/v1/health', detailHealthRouter);

// ─── 全局速率限制 ─────────────────────────────────────────
app.use(
  '/api/',
  createRateLimit({
    windowMs: 60 * 1000, // 1 分钟
    max: 100,
    keyGenerator: (req) => `global:${req.ip}`,
  }),
);

// ─── 认证路由（不需要 JWT） ──────────────────────────────
// app.use('/api/v1/auth', authRouter);

// ─── JWT 认证中间件（/api/v1/* 除 auth 外都需要） ────────
app.use('/api/v1', (req, res, next) => {
  // 跳过 auth 路由和健康检查
  if (req.path.startsWith('/auth') || req.path.startsWith('/health')) {
    next();
    return;
  }
  requireAuth(req, res, next);
});

// ─── 租户隔离中间件 ──────────────────────────────────────
app.use('/api/v1', (req, res, next) => {
  // 跳过 auth 路由和健康检查
  if (req.path.startsWith('/auth') || req.path.startsWith('/health')) {
    next();
    return;
  }
  requireTenant(req, res, next);
});

// ─── 业务路由挂载点（后续 US 实现后启用） ─────────────────
// app.use('/api/v1/employee', employeeRouter);
// app.use('/api/v1/buyer', buyerRouter);
// app.use('/api/v1/admin', adminRouter);
// app.use('/webhook', webhookRouter);

// ─── 404 兜底 + 全局错误处理（必须在所有路由之后） ────────
app.use(notFoundHandler);
app.use(globalErrorHandler);

// ─── 启动服务 ─────────────────────────────────────────────
async function start(): Promise<void> {
  // 显式连接 Redis
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

    server.close(() => {
      logger.info('HTTP server closed');
    });

    try {
      await redis.quit();
      logger.info('Redis connection closed');
    } catch {
      // Redis 关闭失败不阻塞退出
    }

    // 给进行中的请求 10 秒完成
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
