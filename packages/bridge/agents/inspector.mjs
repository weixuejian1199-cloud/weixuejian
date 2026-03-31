/**
 * 巡检员 Agent (Inspector)
 *
 * 定时巡检服务器/API/Bridge自身状态，异常通过 eventBus 汇报决策引擎。
 *
 * 巡检项：
 * - Backend API 健康检查（fetch /health）
 * - Bridge 进程内存
 * - Bridge 运行时长
 * - 磁盘空间（df -h）
 *
 * 日报：每日指定时间汇总发送
 */
import { exec } from 'node:child_process';
import { log } from '../lib/logger.mjs';
import { eventBus } from '../lib/event-bus.mjs';
import { config } from '../lib/config.mjs';
import { sendDailyReport } from '../lib/decision-engine.mjs';

/** @type {NodeJS.Timeout | null} */
let inspectorTimer = null;

/** @type {NodeJS.Timeout | null} */
let dailyReportTimer = null;

/** @type {Array<import('./types.mjs').InspectorReport>} 最近24小时的巡检记录 */
const recentReports = [];
const MAX_RECENT_REPORTS = 288; // 24h / 5min = 288

/**
 * 检查 Backend API 健康状态
 * @returns {Promise<{ status: 'ok'|'warning'|'critical', value: string, message?: string }>}
 */
async function checkBackendHealth() {
  const url = config.agents.backendHealthUrl;
  if (!url) {
    return { status: 'ok', value: 'skip', message: 'BACKEND_HEALTH_URL not configured' };
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const elapsed = Date.now() - start;

    if (!res.ok) {
      return { status: 'critical', value: `${res.status} ${elapsed}ms`, message: `HTTP ${res.status}` };
    }
    if (elapsed > 1000) {
      return { status: 'warning', value: `${elapsed}ms`, message: `Response slow: ${elapsed}ms` };
    }
    return { status: 'ok', value: `${elapsed}ms` };
  } catch (err) {
    return { status: 'critical', value: 'unreachable', message: err.message };
  }
}

/**
 * 检查 Bridge 进程内存
 * @returns {{ status: 'ok'|'warning'|'critical', value: string, message?: string }}
 */
function checkMemory() {
  const rss = process.memoryUsage.rss();
  const mb = Math.round(rss / 1024 / 1024);

  if (mb > 450) return { status: 'critical', value: `${mb}MB`, message: `Memory critical: ${mb}MB > 450MB` };
  if (mb > 400) return { status: 'warning', value: `${mb}MB`, message: `Memory high: ${mb}MB > 400MB` };
  return { status: 'ok', value: `${mb}MB` };
}

/**
 * 检查 Bridge 运行时长（刚重启可能意味着崩溃重启）
 * @returns {{ status: 'ok'|'warning'|'critical', value: string, message?: string }}
 */
function checkUptime() {
  const uptime = process.uptime();
  const hours = (uptime / 3600).toFixed(1);

  if (uptime < 60) {
    return { status: 'warning', value: `${hours}h`, message: `Just restarted (${Math.round(uptime)}s ago)` };
  }
  return { status: 'ok', value: `${hours}h` };
}

/**
 * 检查磁盘空间
 * @returns {Promise<{ status: 'ok'|'warning'|'critical', value: string, message?: string }>}
 */
function checkDisk() {
  return new Promise((resolve) => {
    exec("df -h / | tail -1 | awk '{print $5}'", { timeout: 5000 }, (err, stdout) => {
      if (err) {
        resolve({ status: 'ok', value: 'unknown', message: 'df command failed' });
        return;
      }
      const usage = parseInt(stdout.trim().replace('%', ''), 10);
      if (isNaN(usage)) {
        resolve({ status: 'ok', value: stdout.trim() });
        return;
      }

      if (usage > 90) resolve({ status: 'critical', value: `${usage}%`, message: `Disk critical: ${usage}% > 90%` });
      else if (usage > 70) resolve({ status: 'warning', value: `${usage}%`, message: `Disk high: ${usage}% > 70%` });
      else resolve({ status: 'ok', value: `${usage}%` });
    });
  });
}

/**
 * 执行一次完整巡检
 */
async function runInspection() {
  const checks = [];

  const [backendResult, diskResult] = await Promise.all([
    checkBackendHealth(),
    checkDisk(),
  ]);

  checks.push({ name: 'Backend API', ...backendResult, threshold: '200 <500ms' });
  checks.push({ name: 'Bridge内存', ...checkMemory(), threshold: '<400MB' });
  checks.push({ name: 'Bridge运行', ...checkUptime(), threshold: '>60s' });
  checks.push({ name: '磁盘空间', ...diskResult, threshold: '<70%' });

  const hasCritical = checks.some(c => c.status === 'critical');
  const hasWarning = checks.some(c => c.status === 'warning');

  /** @type {import('./types.mjs').InspectorReport} */
  const report = {
    agent: 'inspector',
    timestamp: new Date().toISOString(),
    type: hasCritical ? 'alert' : 'routine',
    checks,
    overallStatus: hasCritical ? 'down' : hasWarning ? 'degraded' : 'healthy',
  };

  // 记录到最近报告
  recentReports.push(report);
  if (recentReports.length > MAX_RECENT_REPORTS) recentReports.shift();

  // 只在有问题时才通过 eventBus 汇报（正常时只记日志）
  if (hasCritical || hasWarning) {
    eventBus.report(report);
  } else {
    log.debug({ overallStatus: 'healthy', checks: checks.length }, 'Inspection: all clear');
  }
}

/**
 * 生成日报数据并发送
 */
async function triggerDailyReport() {
  // 从最近报告中汇总
  const latestChecks = recentReports.length > 0
    ? recentReports[recentReports.length - 1].checks
    : [{ name: '无数据', status: 'ok', value: '-', threshold: '-' }];

  const hasIssues = recentReports.some(r => r.overallStatus !== 'healthy');

  /** @type {import('./types.mjs').InspectorReport} */
  const dailyReport = {
    agent: 'inspector',
    timestamp: new Date().toISOString(),
    type: 'daily_summary',
    checks: latestChecks,
    overallStatus: hasIssues ? 'degraded' : 'healthy',
  };

  await sendDailyReport(dailyReport);
  log.info('Daily report sent');
}

/**
 * 计算距离下一次日报的毫秒数
 * @param {number} targetHour 目标小时（24h 制）
 */
function msUntilNextHour(targetHour) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(targetHour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * 启动巡检员
 */
export function startInspector() {
  const { inspectorIntervalMs, dailyReportHour } = config.agents;

  // 启动定时巡检
  inspectorTimer = setInterval(() => {
    runInspection().catch(err => {
      log.error({ err: err.message }, 'Inspection failed');
    });
  }, inspectorIntervalMs);

  // 启动时立即执行一次
  runInspection().catch(err => {
    log.error({ err: err.message }, 'Initial inspection failed');
  });

  // 设置日报定时器
  const msToReport = msUntilNextHour(dailyReportHour);
  log.info({ nextDailyReport: `${(msToReport / 3600000).toFixed(1)}h later`, intervalMs: inspectorIntervalMs }, 'Inspector started');

  dailyReportTimer = setTimeout(() => {
    triggerDailyReport().catch(err => log.error({ err: err.message }, 'Daily report failed'));
    // 之后每24小时发一次
    dailyReportTimer = setInterval(() => {
      triggerDailyReport().catch(err => log.error({ err: err.message }, 'Daily report failed'));
    }, 24 * 60 * 60 * 1000);
  }, msToReport);
}

/**
 * 停止巡检员
 */
export function stopInspector() {
  if (inspectorTimer) clearInterval(inspectorTimer);
  if (dailyReportTimer) clearTimeout(dailyReportTimer);
  log.info('Inspector stopped');
}

/**
 * 获取最近一次巡检结果（供 "状态" 指令使用）
 */
export function getLatestReport() {
  return recentReports.length > 0 ? recentReports[recentReports.length - 1] : null;
}
