/**
 * 数据脱敏工具 — PIPL合规要求，API响应中敏感字段脱敏展示
 *
 * 脱敏规则：
 * - 手机号: 138****1234 (保留前3后4)
 * - 姓名: 张** (保留姓)
 * - 微信OpenID/企微UserID: 前4位+****+后4位
 * - IP地址: 192.168.*.*
 * - 交易号: 前6位+****+后4位
 */

/** 手机号脱敏: 138****1234 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return '****';
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

/** 姓名脱敏: 张** */
export function maskName(name: string): string {
  if (!name) return '**';
  if (name.length === 1) return name + '*';
  return name[0] + '*'.repeat(name.length - 1);
}

/** 通用ID脱敏: 前4+****+后4 */
export function maskId(id: string): string {
  if (!id || id.length < 9) return '****';
  return id.slice(0, 4) + '****' + id.slice(-4);
}

/** IP地址脱敏: 192.168.*.* */
export function maskIp(ip: string): string {
  if (!ip) return '*.*.*.*';
  const parts = ip.split('.');
  if (parts.length === 4) {
    return parts[0] + '.' + parts[1] + '.*.*';
  }
  // IPv6 简单处理
  return ip.slice(0, Math.ceil(ip.length / 2)) + '****';
}

/** 交易号脱敏: 前6+****+后4 */
export function maskTransactionId(txId: string): string {
  if (!txId || txId.length < 11) return '****';
  return txId.slice(0, 6) + '****' + txId.slice(-4);
}

/**
 * 敏感字段映射表 — 字段名 → 脱敏函数
 * 用于自动脱敏 API 响应
 */
export const SENSITIVE_FIELD_MASKS: Record<string, (value: string) => string> = {
  phone: maskPhone,
  buyerName: maskName,
  wechatOpenid: maskId,
  wecomUserid: maskId,
  externalUserId: maskId,
  ipAddress: maskIp,
  transactionId: maskTransactionId,
};

/**
 * 递归脱敏对象中的敏感字段
 * 仅处理 SENSITIVE_FIELD_MASKS 中定义的字段
 */
export function maskSensitiveFields<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => maskSensitiveFields(item)) as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const maskFn = SENSITIVE_FIELD_MASKS[key];
    if (typeof value === 'string' && maskFn) {
      result[key] = maskFn(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = maskSensitiveFields(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
