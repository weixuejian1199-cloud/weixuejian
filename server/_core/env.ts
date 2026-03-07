export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // OpenClaw (小虾米 Agent) — optional, if not set falls back to Qwen
  openClawApiKey: process.env.OPENCLAW_API_KEY ?? "",
  openClawEndpoint: process.env.OPENCLAW_ENDPOINT ?? "https://gateway.openclaw.ai/v1/chat",
  // Alibaba DashScope (Qwen3-Max + Kimi-K2.5)
  dashScopeApiKey: process.env.DASHSCOPE_API_KEY ?? "",
  dashScopeBaseUrl: process.env.DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
  // Email (optional — if not set, email sending is silently skipped)
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: parseInt(process.env.SMTP_PORT ?? "465"),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  smtpFrom: process.env.SMTP_FROM ?? "",
};
