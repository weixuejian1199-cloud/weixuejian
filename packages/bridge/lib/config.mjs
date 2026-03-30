/**
 * Bridge 配置 — 启动时校验所有必需环境变量
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
    appId: requireEnv('FEISHU_APP_ID'),
    appSecret: requireEnv('FEISHU_APP_SECRET'),
  },
  projectDir: requireEnv('PROJECT_DIR'),
  bridge: {
    timeoutMs: parseInt(process.env.BRIDGE_TIMEOUT_MS ?? '180000', 10),
    maxTurns: parseInt(process.env.BRIDGE_MAX_TURNS ?? '5', 10),
    maxResponseLen: parseInt(process.env.BRIDGE_MAX_RESPONSE_LEN ?? '4000', 10),
    maxQueueSize: parseInt(process.env.BRIDGE_MAX_QUEUE_SIZE ?? '20', 10),
    sessionTtlMs: parseInt(process.env.BRIDGE_SESSION_TTL_MS ?? '14400000', 10), // 4h
    rateLimitPerMin: parseInt(process.env.BRIDGE_RATE_LIMIT ?? '10', 10),
  },
};
