import { getValidToken, clearTokens } from './auth'

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: unknown
  }
  requestId?: string
}

type RequestInterceptor = (config: RequestInit & { url: string }) => RequestInit & { url: string }
type ResponseInterceptor = (response: Response) => Response | Promise<Response>

const requestInterceptors: RequestInterceptor[] = []
const responseInterceptors: ResponseInterceptor[] = []

export function addRequestInterceptor(fn: RequestInterceptor): void {
  requestInterceptors.push(fn)
}

export function addResponseInterceptor(fn: ResponseInterceptor): void {
  responseInterceptors.push(fn)
}

function getBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || ''
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const token = await getValidToken()

  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let config: RequestInit & { url: string } = {
    ...options,
    headers,
    url: `${getBaseUrl()}${endpoint}`,
  }

  for (const interceptor of requestInterceptors) {
    config = interceptor(config)
  }

  const { url, ...fetchOptions } = config

  try {
    let response = await fetch(url, fetchOptions)

    for (const interceptor of responseInterceptors) {
      response = await interceptor(response)
    }

    if (response.status === 401) {
      clearTokens()
      window.location.href = '/login'
      return { success: false, error: { code: 'UNAUTHORIZED', message: '登录已过期' } }
    }

    const data = (await response.json()) as ApiResponse<T>
    return data
  } catch (err) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : '网络错误',
      },
    }
  }
}

export const api = {
  get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return request<T>(endpoint, { method: 'GET' })
  },

  post<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
  },

  put<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    })
  },

  patch<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return request<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    })
  },

  delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return request<T>(endpoint, { method: 'DELETE' })
  },
}
