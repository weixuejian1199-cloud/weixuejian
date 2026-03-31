/**
 * Bridge 配置 — 启动时校验所有必需环境变量
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[FATAL] 环境变量 ${name} 未配置`);
    process.exit(1);
  }
  return value;
}

const projectDir = resolve(requireEnv('PROJECT_DIR'));
if (!existsSync(projectDir)) {
  console.error(`[FATAL] PROJECT_DIR 不存在: ${projectDir}`);
  process.exit(1);
}

export const config = {
  feishu: {
    appId: requireEnv('FEISHU_APP_ID'),
    appSecret: requireEnv('FEISHU_APP_SECRET'),
  },
  projectDir,
  bridge: {
    timeoutMs: parseInt(process.env.BRIDGE_TIMEOUT_MS ?? '180000', 10),
    maxTurns: parseInt(process.env.BRIDGE_MAX_TURNS ?? '5', 10),
    maxResponseLen: parseInt(process.env.BRIDGE_MAX_RESPONSE_LEN ?? '4000', 10),
    maxQueueSize: parseInt(process.env.BRIDGE_MAX_QUEUE_SIZE ?? '20', 10),
    sessionTtlMs: parseInt(process.env.BRIDGE_SESSION_TTL_MS ?? '14400000', 10), // 4h
    rateLimitPerMin: parseInt(process.env.BRIDGE_RATE_LIMIT ?? '10', 10),
  },
  agents: {
    /** 老板的飞书 chatId，告警和日报发送目标 */
    bossChatId: process.env.BOSS_CHAT_ID ?? '',
    /** 巡检间隔（毫秒），默认 5 分钟 */
    inspectorIntervalMs: parseInt(process.env.INSPECTOR_INTERVAL_MS ?? '300000', 10),
    /** Backend 健康检查地址 */
    backendHealthUrl: process.env.BACKEND_HEALTH_URL ?? '',
    /** 日报发送时间（小时，24h），默认 08:00 */
    dailyReportHour: parseInt(process.env.DAILY_REPORT_HOUR ?? '8', 10),
  },
};
