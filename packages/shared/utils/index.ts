/**
 * 共享工具函数
 */

// Node/Browser 均有 setTimeout，但 shared 包不引入 DOM/Node 类型
declare function setTimeout(cb: () => void, ms: number): unknown;

/** 安全解析JSON，失败返回null */
export function safeJsonParse<T = unknown>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

/** 延迟指定毫秒 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 截断字符串并添加省略号 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}
