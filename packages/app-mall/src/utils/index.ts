import Taro from '@tarojs/taro';

/** 格式化价格 (分→元) */
export function formatPrice(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 手机号脱敏 138****8888 */
export function maskPhone(phone: string): string {
  if (phone.length !== 11) return phone;
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

/** 需要登录的页面跳转 */
export function navigateWithAuth(url: string) {
  const token = Taro.getStorageSync('access_token');
  if (!token) {
    Taro.navigateTo({ url: '/pages/login/index' });
    return;
  }
  Taro.navigateTo({ url });
}

/** 复制到剪贴板 */
export function copyText(text: string) {
  Taro.setClipboardData({ data: text });
}

/** 数字格式化 1280 → 1,280 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}
