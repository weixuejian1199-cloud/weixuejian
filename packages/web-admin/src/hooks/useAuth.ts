import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth-store'

export function useAuth(requireAuth = true) {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)
  const checkAuth = useAuthStore((s) => s.checkAuth)
  const logout = useAuthStore((s) => s.logout)

  useEffect(() => {
    if (requireAuth && !isAuthenticated) {
      navigate('/login', { replace: true })
    }
  }, [requireAuth, isAuthenticated, navigate])

  useEffect(() => {
    if (isAuthenticated && !user) {
      void checkAuth()
    }
  }, [isAuthenticated, user, checkAuth])

  return { isAuthenticated, user, logout }
}
