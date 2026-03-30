import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { sendSuccess } from '../utils/response.js';
import { childLogger } from '../utils/logger.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadPackageVersion(): string {
  try {
    // Works in both CJS and ESM contexts
    const pkgPath = resolve(__dirname, '../../package.json');
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

async function checkComponents(requestId: string): Promise<{
  components: Record<string, ComponentStatus>;
  allHealthy: boolean;
}> {
  const log = childLogger(requestId);
  const components: Record<string, ComponentStatus> = {};

  // PostgreSQL 检查
  const pgStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    components['postgresql'] = { status: 'ok', latencyMs: Date.now() - pgStart };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.warn({ err: message }, 'PostgreSQL health check failed');
    components['postgresql'] = { status: 'error', latencyMs: Date.now() - pgStart, error: message };
  }

  // Redis 检查
  const redisStart = Date.now();
  try {
    await redis.ping();
    components['redis'] = { status: 'ok', latencyMs: Date.now() - redisStart };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.warn({ err: message }, 'Redis health check failed');
    components['redis'] = { status: 'error', latencyMs: Date.now() - redisStart, error: message };
  }

  const allHealthy = Object.values(components).every((c) => c.status === 'ok');
  return { components, allHealthy };
}

/**
 * GET /health — 轻量级健康检查
 */
basicHealthRouter.get('/', async (req: Request, res: Response, _next: NextFunction) => {
  const { components, allHealthy } = await checkComponents(req.requestId);
  sendSuccess(res, { status: allHealthy ? 'healthy' : 'degraded', components });
});

/**
 * GET /api/v1/health — 详细健康检查，含版本、运行时间、环境
 */
detailHealthRouter.get('/', async (req: Request, res: Response, _next: NextFunction) => {
  const { components, allHealthy } = await checkComponents(req.requestId);
  sendSuccess(res, {
    status: allHealthy ? 'healthy' : 'degraded',
    version: appVersion,
    uptime: process.uptime(),
    environment: process.env['NODE_ENV'] ?? 'development',
    components,
  });
});

export { basicHealthRouter, detailHealthRouter };
