/**
 * 启序 Bridge 配置 — 全局 Claude Code Bot
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[FATAL] 环境变量 ${name} 未配置`);
    process.exit(1);
  }
  return value;
}

export const config = {
  feishu: {
    appId: requireEnv('QIXU_APP_ID'),
    appSecret: requireEnv('QIXU_APP_SECRET'),
  },
  bridge: {
    timeoutMs: parseInt(process.env.QIXU_TIMEOUT_MS ?? '180000', 10),
    maxTurns: parseInt(process.env.QIXU_MAX_TURNS ?? '5', 10),
    maxResponseLen: parseInt(process.env.QIXU_MAX_RESPONSE_LEN ?? '4000', 10),
    maxQueueSize: parseInt(process.env.QIXU_MAX_QUEUE_SIZE ?? '20', 10),
    sessionTtlMs: parseInt(process.env.QIXU_SESSION_TTL_MS ?? '14400000', 10),
    rateLimitPerMin: parseInt(process.env.QIXU_RATE_LIMIT ?? '10', 10),
  },
};
