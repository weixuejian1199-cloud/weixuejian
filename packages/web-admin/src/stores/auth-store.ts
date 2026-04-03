import { create } from 'zustand'
import { api } from '@/lib/api'
import { setTokens, clearTokens, getAccessToken } from '@/lib/auth'

interface User {
  id: string
  username: string
  displayName: string
  phone?: string
  avatar?: string
  role: string
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<boolean>
  loginByPhone: (phone: string, code: string) => Promise<boolean>
  logout: () => void
  checkAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: !!getAccessToken(),
  isLoading: false,

  login: async (username, password) => {
    set({ isLoading: true })
    const res = await api.post<{
      accessToken: string
      refreshToken: string
      user: User
    }>('/api/v1/auth/login', { username, password })

    if (res.success && res.data) {
      setTokens(res.data.accessToken, res.data.refreshToken)
      set({ user: res.data.user, isAuthenticated: true, isLoading: false })
      return true
    }

    set({ isLoading: false })
    return false
  },

  loginByPhone: async (phone, code) => {
    set({ isLoading: true })
    const res = await api.post<{
      accessToken: string
      refreshToken: string
      user: User
    }>('/api/v1/auth/login/phone', { phone, code })

    if (res.success && res.data) {
      setTokens(res.data.accessToken, res.data.refreshToken)
      set({ user: res.data.user, isAuthenticated: true, isLoading: false })
      return true
    }

    set({ isLoading: false })
    return false
  },

  logout: () => {
    clearTokens()
    set({ user: null, isAuthenticated: false })
  },

  checkAuth: async () => {
    const token = getAccessToken()
    if (!token) {
      set({ isAuthenticated: false, user: null })
      return
    }

    const res = await api.get<User>('/api/v1/auth/me')
    if (res.success && res.data) {
      set({ user: res.data, isAuthenticated: true })
    } else {
      clearTokens()
      set({ user: null, isAuthenticated: false })
    }
  },
}))
