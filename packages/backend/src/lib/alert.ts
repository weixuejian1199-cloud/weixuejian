/**
 * 飞书告警服务（DEBT-002）
 *
 * 三条告警规则：
 *   RULE-A  RPA 采集失败率 > 5%（滚动 1 小时窗口）
 *   RULE-B  API P99 响应时间 > 2000ms（最近 100 次请求）
 *   RULE-C  进程堆内存 > 500MB
 *
 * 使用方式：
 *   import { alertService } from './alert.js';
 *   alertService.recordRpaResult(source, success);
 *   alertService.checkAndAlert();          // 由 cron 每分钟调用
 *
 * 配置：.env 中添加 ALERT_FEISHU_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/...
 */

import { env } from './env.js';

// ─── 内部状态 ────────────────────────────────────────────────

interface RpaWindow {
  total: number;
  failed: number;
  resetAt: number; // unix ms，超过则重置
}

const RPA_WINDOW_MS = 60 * 60 * 1000; // 1 小时
const HTTP_P99_WINDOW = 100;           // 保留最近 100 次请求耗时

const rpaWindows = new Map<string, RpaWindow>();
const httpDurations: number[] = [];    // 循环缓冲区
let lastAlertAt = new Map<string, number>(); // ruleKey → unix ms，防重复告警（间隔 ≥ 10min）

const ALERT_COOLDOWN_MS = 10 * 60 * 1000;

// ─── 数据采集 ────────────────────────────────────────────────

export function recordRpaResult(source: string, success: boolean): void {
  const now = Date.now();
  let w = rpaWindows.get(source);
  if (!w || now > w.resetAt) {
    w = { total: 0, failed: 0, resetAt: now + RPA_WINDOW_MS };
    rpaWindows.set(source, w);
  }
  w.total++;
  if (!success) w.failed++;
}

export function recordHttpDuration(durationMs: number): void {
  if (httpDurations.length >= HTTP_P99_WINDOW) {
    httpDurations.shift();
  }
  httpDurations.push(durationMs);
}

// ─── 告警检查（每分钟执行一次）──────────────────────────────

export async function checkAndAlert(): Promise<void> {
  const webhook = env.ALERT_FEISHU_WEBHOOK;
  if (!webhook) return;

  await Promise.all([
    checkRpaFailureRate(webhook),
    checkHttpP99(webhook),
    checkHeapMemory(webhook),
  ]);
}

async function checkRpaFailureRate(webhook: string): Promise<void> {
  for (const [source, w] of rpaWindows.entries()) {
    if (w.total < 5) continue; // 样本不足，不告警
    const failRate = w.failed / w.total;
    if (failRate > 0.05) {
      const key = `rpa_fail_${source}`;
      if (isCoolingDown(key)) continue;
      await sendFeishuAlert(webhook, {
        rule: 'RULE-A',
        level: 'error',
        title: `🔴 RPA 采集失败率过高`,
        body: `数据源：**${source}**\n失败率：${(failRate * 100).toFixed(1)}%（${w.failed}/${w.total}，近1小时）\n阈值：5%`,
      });
      setLastAlertAt(key);
    }
  }
}

async function checkHttpP99(webhook: string): Promise<void> {
  if (httpDurations.length < 20) return; // 样本不足
  const sorted = [...httpDurations].sort((a, b) => a - b);
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  if (p99 > 2000) {
    const key = 'http_p99';
    if (isCoolingDown(key)) return;
    await sendFeishuAlert(webhook, {
      rule: 'RULE-B',
      level: 'warn',
      title: `🟡 API P99 响应时间过高`,
      body: `P99：**${p99.toFixed(0)}ms**（近 ${httpDurations.length} 次请求）\n阈值：2000ms`,
    });
    setLastAlertAt(key);
  }
}

async function checkHeapMemory(webhook: string): Promise<void> {
  const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
  if (heapMB > 500) {
    const key = 'heap_memory';
    if (isCoolingDown(key)) return;
    await sendFeishuAlert(webhook, {
      rule: 'RULE-C',
      level: 'warn',
      title: `🟡 进程堆内存超限`,
      body: `堆内存：**${heapMB.toFixed(0)}MB**\n阈值：500MB`,
    });
    setLastAlertAt(key);
  }
}

// ─── 飞书 Webhook 发送 ───────────────────────────────────────

interface AlertPayload {
  rule: string;
  level: 'error' | 'warn' | 'info';
  title: string;
  body: string;
}

async function sendFeishuAlert(webhook: string, payload: AlertPayload): Promise<void> {
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const text = `**【企业AI工作站告警】${payload.title}**\n\n${payload.body}\n\n规则：${payload.rule} | 时间：${timestamp}`;

  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'interactive',
        card: {
          config: { wide_screen_mode: true },
          header: {
            title: { tag: 'plain_text', content: payload.title },
            template: payload.level === 'error' ? 'red' : 'yellow',
          },
          elements: [
            {
              tag: 'div',
              text: { tag: 'lark_md', content: text },
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn(`[alert] 飞书 Webhook 返回 ${res.status}`);
    }
  } catch (err) {
    console.warn(`[alert] 飞书 Webhook 发送失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── 工具 ────────────────────────────────────────────────────

function isCoolingDown(key: string): boolean {
  const last = lastAlertAt.get(key) ?? 0;
  return Date.now() - last < ALERT_COOLDOWN_MS;
}

function setLastAlertAt(key: string): void {
  lastAlertAt.set(key, Date.now());
}

// ─── 定时器（由 app 启动时注册）─────────────────────────────

let _alertTimer: ReturnType<typeof setInterval> | null = null;

export function startAlertScheduler(): void {
  if (_alertTimer) return;
  _alertTimer = setInterval(() => {
    checkAndAlert().catch((err) => {
      console.warn(`[alert] checkAndAlert error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, 60_000); // 每分钟检查一次
  _alertTimer.unref(); // 不阻止进程退出
}

export function stopAlertScheduler(): void {
  if (_alertTimer) {
    clearInterval(_alertTimer);
    _alertTimer = null;
  }
}
