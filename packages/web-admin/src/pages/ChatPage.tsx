import { MessageSquare } from 'lucide-react'

export function ChatPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="mx-auto max-w-[960px] px-6 py-20 text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-secondary">
          <MessageSquare className="h-10 w-10 text-primary" />
        </div>
        <h1 className="mb-2 text-2xl font-semibold text-foreground">
          AI 对话
        </h1>
        <p className="text-muted-foreground">
          智能对话即将上线，敬请期待
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Wave 2 将实现完整的 AI Agent 对话体验
        </p>
      </div>
    </div>
  )
}
