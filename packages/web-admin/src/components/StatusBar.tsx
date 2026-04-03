import { Wifi, WifiOff, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/utils'

type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'

interface StatusBarProps {
  connectionStatus?: ConnectionStatus
  tokensUsed?: number
}

const statusConfig: Record<
  ConnectionStatus,
  { color: string; label: string; icon: React.ElementType }
> = {
  connected: { color: 'bg-success', label: '已连接', icon: Wifi },
  reconnecting: {
    color: 'bg-warning',
    label: '重连中...',
    icon: Loader2,
  },
  disconnected: { color: 'bg-destructive', label: '已断开', icon: WifiOff },
}

export function StatusBar({
  connectionStatus = 'connected',
  tokensUsed = 0,
}: StatusBarProps) {
  const status = statusConfig[connectionStatus]
  const StatusIcon = status.icon

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-30 flex h-[var(--statusbar-height)] items-center border-t bg-card px-4 text-xs text-muted-foreground">
      {/* Left: Connection Status */}
      <div className="flex items-center gap-1.5">
        <span className={cn('h-2 w-2 rounded-full', status.color)} />
        <StatusIcon
          className={cn(
            'h-3 w-3',
            connectionStatus === 'reconnecting' && 'animate-spin',
          )}
        />
        <span>{status.label}</span>
      </div>

      {/* Center: Token Usage */}
      <div className="flex flex-1 items-center justify-center">
        <span>
          今日已用{' '}
          <span className="font-number font-medium text-foreground">
            {formatNumber(tokensUsed)}
          </span>{' '}
          tokens
        </span>
      </div>

      {/* Right: Shortcuts */}
      <div className="hidden items-center gap-3 sm:flex">
        <span>
          <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
            &#8984;K
          </kbd>{' '}
          搜索
        </span>
        <span>
          <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
            &#8984;N
          </kbd>{' '}
          新对话
        </span>
      </div>
    </footer>
  )
}
