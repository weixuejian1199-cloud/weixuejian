import { Settings } from 'lucide-react'

export function SettingsPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="px-6 py-20 text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-secondary">
          <Settings className="h-10 w-10 text-primary" />
        </div>
        <h1 className="mb-2 text-2xl font-semibold text-foreground">
          设置
        </h1>
        <p className="text-muted-foreground">
          系统设置即将上线，敬请期待
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          个人偏好、团队管理与系统配置
        </p>
      </div>
    </div>
  )
}
