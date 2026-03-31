import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { sendSuccess } from '../utils/response.js';
import { childLogger } from '../utils/logger.js';
import { env } from '../lib/env.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const isProduction = env.NODE_ENV === 'production';

/** 健康检查单项超时（毫秒） */
const HEALTH_CHECK_TIMEOUT_MS = 2000;

function loadPackageVersion(): string {
  try {
    const pkgPath = resolve(dirname(__filename), '../../package.json');
    const content = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    return content.version;
  } catch {
    return 'unknown';
  }
}

const appVersion = loadPackageVersion();

/** 轻量健康检查路由 — 挂载到 GET /health */
const basicHealthRouter = Router();
/** 详细健康检查路由 — 挂载到 GET /api/v1/health */
const detailHealthRouter = Router();

interface ComponentStatus {
  status: 'ok' | 'error';
  latencyMs?: number;
  error?: string;
}

/**
 * 带超时的 Promise — 防止外部依赖无响应导致健康检查挂起
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} health check timeout (${timeoutMs}ms)`)),
        timeoutMs,
      ),
    ),
  ]);
}

async function checkComponents(requestId: string): Promise<{
  components: Record<string, ComponentStatus>;
  allHealthy: boolean;
}> {
  const log = childLogger(requestId);
  const components: Record<string, ComponentStatus> = {};

  // PostgreSQL 检查（带超时）
  const pgStart = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, HEALTH_CHECK_TIMEOUT_MS, 'PostgreSQL');
    components['postgresql'] = { status: 'ok', latencyMs: Date.now() - pgStart };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.warn({ err: message }, 'PostgreSQL health check failed');
    components['postgresql'] = { status: 'error', latencyMs: Date.now() - pgStart, error: message };
  }

  // Redis 检查（带超时）
  const redisStart = Date.now();
  try {
    await withTimeout(redis.ping(), HEALTH_CHECK_TIMEOUT_MS, 'Redis');
    components['redis'] = { status: 'ok', latencyMs: Date.now() - redisStart };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.warn({ err: message }, 'Redis health check failed');
    components['redis'] = { status: 'error', latencyMs: Date.now() - redisStart, error: message };
  }

  const allHealthy = Object.values(components).every((c) => c.status === 'ok');
  return { components, allHealthy };
}

/** async route handler — 统一错误捕获 */
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * GET /health — 轻量级健康检查
 */
basicHealthRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { components, allHealthy } = await checkComponents(req.requestId);
    sendSuccess(res, { status: allHealthy ? 'healthy' : 'degraded', components });
  }),
);

/**
 * GET /api/v1/health — 详细健康检查，含版本、运行时间、环境
 * 生产环境隐藏 version 和 environment 详情
 */
detailHealthRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { components, allHealthy } = await checkComponents(req.requestId);

    const data: Record<string, unknown> = {
      status: allHealthy ? 'healthy' : 'degraded',
      components,
    };

    if (!isProduction) {
      data['version'] = appVersion;
      data['uptime'] = process.uptime();
      data['environment'] = env.NODE_ENV;
    }

    sendSuccess(res, data);
  }),
);

export { basicHealthRouter, detailHealthRouter };
