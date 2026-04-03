/**
 * 飞书告警服务（DEBT-002）
 *
 * 三条告警规则：
 *   RULE-A  RPA 采集失败率 > 5%（滚动 1 小时窗口）
 *   RULE-B  API P99 响应时间 > 2000ms（最近 100 次请求）
 *   RULE-C  进程堆内存 > 500MB
 *
 * 支持两种发送方式（优先级：方式一 > 方式二）：
 *   方式一 — 自定义机器人 Webhook：
 *     .env:  ALERT_FEISHU_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/xxx
 *
 *   方式二 — 应用机器人（使用现有 App ID + Secret）：
 *     .env:  ALERT_FEISHU_APP_ID=cli_xxx
 *            ALERT_FEISHU_APP_SECRET=xxx
 *            ALERT_FEISHU_CHAT_ID=oc_xxx   （目标群的 chat_id）
 *     获取 chat_id：在飞书群里 @ 机器人，或通过飞书开放平台 → 群列表 API 查询
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
  // 任意一种告警渠道配置即可运行
  const hasChannel = env.ALERT_FEISHU_WEBHOOK ||
    (env.ALERT_FEISHU_APP_ID && env.ALERT_FEISHU_APP_SECRET && env.ALERT_FEISHU_CHAT_ID);
  if (!hasChannel) return;

  await Promise.all([
    checkRpaFailureRate(),
    checkHttpP99(),
    checkHeapMemory(),
  ]);
}

async function checkRpaFailureRate(): Promise<void> {
  for (const [source, w] of rpaWindows.entries()) {
    if (w.total < 5) continue; // 样本不足，不告警
    const failRate = w.failed / w.total;
    if (failRate > 0.05) {
      const key = `rpa_fail_${source}`;
      if (isCoolingDown(key)) continue;
      await sendFeishuAlert({
        rule: 'RULE-A',
        level: 'error',
        title: `🔴 RPA 采集失败率过高`,
        body: `数据源：**${source}**\n失败率：${(failRate * 100).toFixed(1)}%（${w.failed}/${w.total}，近1小时）\n阈值：5%`,
      });
      setLastAlertAt(key);
    }
  }
}

async function checkHttpP99(): Promise<void> {
  if (httpDurations.length < 20) return; // 样本不足
  const sorted = [...httpDurations].sort((a, b) => a - b);
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  if (p99 > 2000) {
    const key = 'http_p99';
    if (isCoolingDown(key)) return;
    await sendFeishuAlert({
      rule: 'RULE-B',
      level: 'warn',
      title: `🟡 API P99 响应时间过高`,
      body: `P99：**${p99.toFixed(0)}ms**（近 ${httpDurations.length} 次请求）\n阈值：2000ms`,
    });
    setLastAlertAt(key);
  }
}

async function checkHeapMemory(): Promise<void> {
  const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
  if (heapMB > 500) {
    const key = 'heap_memory';
    if (isCoolingDown(key)) return;
    await sendFeishuAlert({
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

/** 获取飞书 App Token（方式二：应用机器人） */
async function getFeishuAppToken(appId: string, appSecret: string): Promise<string | null> {
  try {
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json() as { code: number; tenant_access_token?: string };
    if (data.code === 0 && data.tenant_access_token) return data.tenant_access_token;
  } catch { /* ignore */ }
  return null;
}

async function sendFeishuAlert(payload: AlertPayload): Promise<void> {
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const cardContent = {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: payload.title },
        template: payload.level === 'error' ? 'red' : 'yellow',
      },
      elements: [{
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `${payload.body}\n\n规则：${payload.rule} | 时间：${timestamp}`,
        },
      }],
    },
  };

  // 方式一：自定义 Webhook
  if (env.ALERT_FEISHU_WEBHOOK) {
    try {
      const res = await fetch(env.ALERT_FEISHU_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cardContent),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) console.warn(`[alert] Webhook 返回 ${res.status}`);
      return;
    } catch (err) {
      console.warn(`[alert] Webhook 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 方式二：应用机器人（App ID + Secret + Chat ID）
  const { ALERT_FEISHU_APP_ID, ALERT_FEISHU_APP_SECRET, ALERT_FEISHU_CHAT_ID } = env;
  if (ALERT_FEISHU_APP_ID && ALERT_FEISHU_APP_SECRET && ALERT_FEISHU_CHAT_ID) {
    const token = await getFeishuAppToken(ALERT_FEISHU_APP_ID, ALERT_FEISHU_APP_SECRET);
    if (!token) { console.warn('[alert] 获取飞书 App Token 失败'); return; }
    try {
      const res = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: ALERT_FEISHU_CHAT_ID,
          msg_type: 'interactive',
          content: JSON.stringify(cardContent.card),
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) console.warn(`[alert] App 消息发送返回 ${res.status}`);
    } catch (err) {
      console.warn(`[alert] App 消息发送失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // 未配置任何告警渠道，静默跳过
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
