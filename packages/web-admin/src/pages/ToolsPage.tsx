import { Wrench } from 'lucide-react'

export function ToolsPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="px-6 py-20 text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-secondary">
          <Wrench className="h-10 w-10 text-primary" />
        </div>
        <h1 className="mb-2 text-2xl font-semibold text-foreground">
          工具市场
        </h1>
        <p className="text-muted-foreground">
          工具市场即将上线，敬请期待
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          丰富的 AI 工具与插件生态
        </p>
      </div>
    </div>
  )
}
