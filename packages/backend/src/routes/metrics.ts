/**
 * Prometheus metrics 端点
 *
 * 返回文本格式的 Prometheus metrics，供 /api/v1/metrics 暴露。
 * 不使用 prom-client 库 — Phase 1 保持轻量，手动收集关键指标。
 */
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';

const metricsRouter = Router();

// ─── 运行时计数器（进程内累积）──────────────────────────────

let httpRequestsTotal = 0;
let httpRequestsErrorsTotal = 0;
let httpRequestDurationSum = 0;
let httpRequestCount = 0;
let rateLimitRejectedTotal = 0;
let aiRequestTotal = 0;
let aiRequestErrorsTotal = 0;

/** 记录 HTTP 请求（由 request-logger 中间件调用） */
export function recordHttpRequest(statusCode: number, durationMs: number): void {
  httpRequestsTotal++;
  httpRequestDurationSum += durationMs / 1000;
  httpRequestCount++;
  if (statusCode >= 500) httpRequestsErrorsTotal++;
}

/** 记录限流拒绝 */
export function recordRateLimitRejection(): void {
  rateLimitRejectedTotal++;
}

/** 记录 AI 请求 */
export function recordAiRequest(success: boolean): void {
  aiRequestTotal++;
  if (!success) aiRequestErrorsTotal++;
}

// ─── Metrics 端点 ────────────────────────────────────────────

metricsRouter.get('/', async (_req, res) => {
  try {
    const lines: string[] = [];

    // Process metrics
    const memUsage = process.memoryUsage();
    const uptimeSeconds = process.uptime();

    lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes');
    lines.push('# TYPE process_resident_memory_bytes gauge');
    lines.push(`process_resident_memory_bytes ${memUsage.rss}`);

    lines.push('# HELP process_heap_used_bytes Heap used in bytes');
    lines.push('# TYPE process_heap_used_bytes gauge');
    lines.push(`process_heap_used_bytes ${memUsage.heapUsed}`);

    lines.push('# HELP process_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${uptimeSeconds.toFixed(0)}`);

    lines.push('# HELP nodejs_eventloop_lag_seconds Event loop lag in seconds');
    lines.push('# TYPE nodejs_eventloop_lag_seconds gauge');
    // Approximate event loop lag using a short timer
    const lagStart = performance.now();
    await new Promise((resolve) => setImmediate(resolve));
    const lagMs = performance.now() - lagStart;
    lines.push(`nodejs_eventloop_lag_seconds ${(lagMs / 1000).toFixed(6)}`);

    // HTTP metrics
    lines.push('# HELP http_requests_total Total HTTP requests');
    lines.push('# TYPE http_requests_total counter');
    lines.push(`http_requests_total ${httpRequestsTotal}`);

    lines.push('# HELP http_requests_errors_total Total HTTP 5xx errors');
    lines.push('# TYPE http_requests_errors_total counter');
    lines.push(`http_requests_errors_total ${httpRequestsErrorsTotal}`);

    lines.push('# HELP http_request_duration_seconds_avg Average request duration');
    lines.push('# TYPE http_request_duration_seconds_avg gauge');
    const avgDuration = httpRequestCount > 0 ? httpRequestDurationSum / httpRequestCount : 0;
    lines.push(`http_request_duration_seconds_avg ${avgDuration.toFixed(4)}`);

    // Rate limit metrics
    lines.push('# HELP rate_limit_rejected_total Total rate-limited requests');
    lines.push('# TYPE rate_limit_rejected_total counter');
    lines.push(`rate_limit_rejected_total ${rateLimitRejectedTotal}`);

    // AI metrics
    lines.push('# HELP ai_request_total Total AI API calls');
    lines.push('# TYPE ai_request_total counter');
    lines.push(`ai_request_total ${aiRequestTotal}`);

    lines.push('# HELP ai_request_errors_total Total AI API call failures');
    lines.push('# TYPE ai_request_errors_total counter');
    lines.push(`ai_request_errors_total ${aiRequestErrorsTotal}`);

    // Dependency health (1 = healthy, 0 = unhealthy)
    lines.push('# HELP dependency_up Whether a dependency is reachable (1=up, 0=down)');
    lines.push('# TYPE dependency_up gauge');

    try {
      await prisma.$queryRaw`SELECT 1`;
      lines.push('dependency_up{name="postgresql"} 1');
    } catch {
      lines.push('dependency_up{name="postgresql"} 0');
    }

    try {
      await redis.ping();
      lines.push('dependency_up{name="redis"} 1');
    } catch {
      lines.push('dependency_up{name="redis"} 0');
    }

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(lines.join('\n') + '\n');
  } catch {
    res.status(500).setHeader('Content-Type', 'text/plain');
    res.send('# metrics collection failed\n');
  }
});

export { metricsRouter };
