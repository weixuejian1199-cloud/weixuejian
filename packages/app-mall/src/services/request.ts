import Taro from '@tarojs/taro';

const BASE_URL = process.env.TARO_APP_API_URL || 'https://api.shishi.life/api/v1';

interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: Record<string, unknown>;
  header?: Record<string, string>;
  showLoading?: boolean;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  requestId: string;
}

function getToken(): string | null {
  return Taro.getStorageSync('access_token') || null;
}

export async function request<T = unknown>(options: RequestOptions): Promise<T> {
  const { url, method = 'GET', data, header = {}, showLoading = false } = options;

  if (showLoading) {
    Taro.showLoading({ title: '加载中...' });
  }

  const token = getToken();
  if (token) {
    header['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await Taro.request({
      url: `${BASE_URL}${url}`,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        ...header,
      },
    });

    if (showLoading) {
      Taro.hideLoading();
    }

    if (res.statusCode === 401) {
      Taro.removeStorageSync('access_token');
      Taro.redirectTo({ url: '/pages/login/index' });
      throw new Error('登录已过期，请重新登录');
    }

    if (res.statusCode >= 400) {
      const errMsg = (res.data as ApiResponse)?.error?.message || '请求失败';
      throw new Error(errMsg);
    }

    const body = res.data as ApiResponse<T>;
    if (!body.success) {
      throw new Error(body.error?.message || '请求失败');
    }

    return body.data as T;
  } catch (err) {
    if (showLoading) {
      Taro.hideLoading();
    }
    throw err;
  }
}

export const api = {
  get: <T>(url: string, data?: Record<string, unknown>) =>
    request<T>({ url, method: 'GET', data }),
  post: <T>(url: string, data?: Record<string, unknown>) =>
    request<T>({ url, method: 'POST', data }),
  put: <T>(url: string, data?: Record<string, unknown>) =>
    request<T>({ url, method: 'PUT', data }),
  del: <T>(url: string, data?: Record<string, unknown>) =>
    request<T>({ url, method: 'DELETE', data }),
};
