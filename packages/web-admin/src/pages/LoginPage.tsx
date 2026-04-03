import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, Lock, User, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'

type LoginMode = 'phone' | 'password'

export function LoginPage() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const loginByPhone = useAuthStore((s) => s.loginByPhone)
  const isLoading = useAuthStore((s) => s.isLoading)

  const [mode, setMode] = useState<LoginMode>('password')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    let success = false
    if (mode === 'phone') {
      success = await loginByPhone(phone, code)
    } else {
      success = await login(username, password)
    }

    if (success) {
      navigate('/chat', { replace: true })
    } else {
      setError(mode === 'phone' ? '验证码错误或已过期' : '用户名或密码错误')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-[400px]">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="gradient-primary mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg">
            <span className="text-2xl font-bold text-white">S</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">时皙AI工作站</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            对话即一切的企业级AI操作系统
          </p>
        </div>

        <Card className="border-0 shadow-lg">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-center text-lg">登录</CardTitle>
            <CardDescription className="text-center">
              {mode === 'phone' ? '使用手机号验证码登录' : '使用账号密码登录'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              {mode === 'phone' ? (
                <>
                  <div className="relative">
                    <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="tel"
                      placeholder="手机号"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="pl-9"
                      maxLength={11}
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="text"
                        placeholder="验证码"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="pl-9"
                        maxLength={6}
                      />
                    </div>
                    <Button type="button" variant="outline" size="default">
                      获取验证码
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="用户名"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="pl-9"
                      autoComplete="username"
                    />
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="password"
                      placeholder="密码"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-9"
                      autoComplete="current-password"
                    />
                  </div>
                </>
              )}

              {error && (
                <p className="text-center text-sm text-destructive">{error}</p>
              )}

              <Button
                type="submit"
                className="w-full gradient-primary text-white hover:opacity-90"
                disabled={isLoading}
              >
                {isLoading ? '登录中...' : '登录'}
              </Button>
            </form>

            <div className="mt-4 text-center">
              <button
                type="button"
                className="text-sm text-muted-foreground transition-colors hover:text-primary"
                onClick={() => {
                  setMode(mode === 'phone' ? 'password' : 'phone')
                  setError('')
                }}
              >
                {mode === 'phone' ? '使用账号密码登录' : '使用手机号登录'}
              </button>
            </div>
          </CardContent>
        </Card>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          &copy; 2026 时皙 SHISHI. All rights reserved.
        </p>
      </div>
    </div>
  )
}
