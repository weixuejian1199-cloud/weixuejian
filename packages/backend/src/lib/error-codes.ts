/**
 * 错误码注册表 — 与 brain.json errorCodes 保持同步
 *
 * 所有 sendError 调用必须使用此注册表中的错误码，
 * TypeScript 编译时即可校验错误码合法性。
 */
export const ERROR_CODES = {
  // === 认证 ===
  AUTH_INVALID_TOKEN: { httpStatus: 401, message: '无效的访问令牌' },
  AUTH_TOKEN_EXPIRED: { httpStatus: 401, message: '访问令牌已过期' },
  AUTH_TOKEN_BLACKLISTED: { httpStatus: 401, message: '令牌已被吊销' },
  AUTH_REFRESH_INVALID: { httpStatus: 401, message: '刷新令牌无效或已过期' },
  AUTH_WECHAT_CODE_INVALID: { httpStatus: 400, message: '微信登录code无效' },
  AUTH_PHONE_REQUIRED: { httpStatus: 400, message: '需要绑定手机号' },
  AUTH_PHONE_ALREADY_BOUND: { httpStatus: 409, message: '手机号已被其他账号绑定' },
  AUTH_SMS_CODE_INVALID: { httpStatus: 400, message: '短信验证码无效或已过期' },

  // === 租户 ===
  TENANT_NOT_FOUND: { httpStatus: 403, message: '租户不存在或已停用' },
  TENANT_SUSPENDED: { httpStatus: 403, message: '租户已停用' },
  TENANT_QUOTA_EXCEEDED: { httpStatus: 429, message: '租户配额已用尽' },
  TENANT_MISMATCH: { httpStatus: 403, message: '租户ID不匹配' },

  // === 权限 ===
  PERMISSION_DENIED: { httpStatus: 403, message: '权限不足' },
  SCOPE_EXCEEDED: { httpStatus: 403, message: '超出数据访问范围' },

  // === 校验 ===
  VALIDATION_ERROR: { httpStatus: 400, message: '请求参数校验失败' },
  RESOURCE_NOT_FOUND: { httpStatus: 404, message: '请求的资源不存在' },
  RESOURCE_CONFLICT: { httpStatus: 409, message: '资源冲突' },

  // === 限流 ===
  RATE_LIMITED: { httpStatus: 429, message: '请求过于频繁，请稍后再试' },
  AUTH_RATE_LIMITED: { httpStatus: 429, message: '登录尝试过于频繁' },

  // === ERP ===
  ERP_UNAUTHORIZED: { httpStatus: 502, message: 'ERP认证失败' },
  ERP_RATE_LIMITED: { httpStatus: 502, message: 'ERP接口限频' },
  ERP_TIMEOUT: { httpStatus: 504, message: 'ERP接口超时' },
  ERP_SYNC_FAILED: { httpStatus: 502, message: 'ERP数据同步失败' },

  // === 商城API ===
  MALL_API_UNAUTHORIZED: { httpStatus: 502, message: '商城API认证失败' },
  MALL_API_TIMEOUT: { httpStatus: 504, message: '商城API请求超时' },
  MALL_API_ERROR: { httpStatus: 502, message: '商城API返回异常' },
  MALL_DATA_INVALID: { httpStatus: 502, message: '商城API返回数据格式异常' },

  // === AI ===
  AI_RATE_LIMITED: { httpStatus: 429, message: 'AI调用频率超限' },
  AI_SERVICE_UNAVAILABLE: { httpStatus: 503, message: 'AI服务暂不可用' },
  AI_CONTEXT_TOO_LONG: { httpStatus: 400, message: '对话上下文超出长度限制' },

  // === 客服 ===
  CS_SESSION_NOT_FOUND: { httpStatus: 404, message: '客服会话不存在' },
  CS_SESSION_CLOSED: { httpStatus: 400, message: '客服会话已关闭' },
  CS_MESSAGE_NOT_FOUND: { httpStatus: 404, message: '客服消息不存在' },
  CS_MESSAGE_NOT_DRAFT: { httpStatus: 400, message: '只能确认草稿状态的消息' },
  CS_TICKET_NOT_FOUND: { httpStatus: 404, message: '客服工单不存在' },
  CS_ORDER_NOT_FOUND: { httpStatus: 404, message: '关联订单不存在' },
  CS_ESCALATED: { httpStatus: 200, message: '已升级到人工处理' },
  CS_IMAGE_NOT_SUPPORTED: { httpStatus: 400, message: '暂不支持图片消息' },

  // === 系统 ===
  INTERNAL_ERROR: { httpStatus: 500, message: '服务器内部错误' },
  SERVICE_UNAVAILABLE: { httpStatus: 503, message: '服务暂不可用' },

  // === 工具 ===
  TOOL_TIMEOUT: { httpStatus: 504, message: '工具调用超时' },
  TOOL_DEGRADED: { httpStatus: 200, message: '工具降级返回缓存数据' },
  TOOL_CHAIN_PARTIAL: { httpStatus: 207, message: '链式调用部分失败' },
  TOOL_NOT_FOUND: { httpStatus: 404, message: '工具定义不存在' },
  TOOL_ALREADY_ACTIVE: { httpStatus: 200, message: '工具已激活' },
  TOOL_INSTANCE_NOT_FOUND: { httpStatus: 404, message: '工具实例不存在' },

  // === 确认记录 ===
  CONFIRMATION_NOT_FOUND: { httpStatus: 404, message: '确认记录不存在' },
  CONFIRMATION_ALREADY_RESPONDED: { httpStatus: 400, message: '确认记录已被响应' },
  CONFIRMATION_EXPIRED: { httpStatus: 400, message: '确认记录已过期' },

  // === ACI ===
  ACI_RULE_CONFLICT: { httpStatus: 500, message: 'ACI规则冲突' },
  ACI_DATA_INCOMPLETE: { httpStatus: 422, message: 'ACI判断数据不完整' },

  // === 缓存 ===
  CACHE_STALE: { httpStatus: 200, message: '缓存数据过期' },

  // === 配额 ===
  API_QUOTA_EXCEEDED: { httpStatus: 429, message: 'API配额超限' },

  // === SSE ===
  SSE_RECONNECT: { httpStatus: 200, message: 'SSE重连中' },
} as const;

/** 注册表中的合法错误码类型 */
export type ErrorCode = keyof typeof ERROR_CODES;

/** 类型化业务错误 — 替代 throw new Error('CODE_STRING') + 字符串匹配 */
export class AppError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
    this.name = 'AppError';
  }
}
