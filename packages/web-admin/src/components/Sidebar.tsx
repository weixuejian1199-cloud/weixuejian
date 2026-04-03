import { useNavigate } from 'react-router-dom'
import {
  Plus,
  MessageSquare,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useChatStore, type ChatSession } from '@/stores/chat-store'
import { useUIStore } from '@/stores/ui-store'
import { cn, formatRelativeTime } from '@/lib/utils'

function groupSessionsByDate(sessions: ChatSession[]) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const groups: { label: string; sessions: ChatSession[] }[] = [
    { label: '今天', sessions: [] },
    { label: '昨天', sessions: [] },
    { label: '更早', sessions: [] },
  ]

  for (const session of sessions) {
    const d = new Date(session.updatedAt)
    d.setHours(0, 0, 0, 0)
    if (d.getTime() >= today.getTime()) {
      groups[0]!.sessions.push(session)
    } else if (d.getTime() >= yesterday.getTime()) {
      groups[1]!.sessions.push(session)
    } else {
      groups[2]!.sessions.push(session)
    }
  }

  return groups.filter((g) => g.sessions.length > 0)
}

export function Sidebar() {
  const navigate = useNavigate()
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const sessions = useChatStore((s) => s.sessions)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const setCurrentSession = useChatStore((s) => s.setCurrentSession)
  const groups = groupSessionsByDate(sessions)

  return (
    <aside
      className={cn(
        'fixed left-0 z-30 flex flex-col border-r bg-secondary transition-all duration-200',
        'top-[var(--header-height)] bottom-[var(--statusbar-height)]',
        collapsed
          ? 'w-[var(--sidebar-collapsed-width)]'
          : 'w-[var(--sidebar-width)]',
      )}
    >
      {/* Top Actions */}
      <div className="flex items-center gap-2 p-3">
        {!collapsed && (
          <Button
            className="flex-1 gradient-primary text-white hover:opacity-90"
            size="sm"
            onClick={() => {
              setCurrentSession(null)
              navigate('/chat')
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            新建对话
          </Button>
        )}
        {collapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="mx-auto"
            onClick={() => {
              setCurrentSession(null)
              navigate('/chat')
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={toggleSidebar}
        >
          {collapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
      </div>

      <Separator />

      {/* Session List */}
      <ScrollArea className="flex-1">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1 p-2">
            {sessions.slice(0, 10).map((session) => (
              <Button
                key={session.id}
                variant="ghost"
                size="icon"
                className={cn(
                  'h-9 w-9',
                  currentSessionId === session.id &&
                    'bg-primary/10 text-primary',
                )}
                onClick={() => {
                  setCurrentSession(session.id)
                  navigate('/chat')
                }}
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
            ))}
          </div>
        ) : (
          <div className="p-2">
            {groups.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <MessageSquare className="mb-2 h-8 w-8 opacity-50" />
                <p className="text-sm">暂无对话</p>
                <p className="text-xs">点击上方按钮新建</p>
              </div>
            )}
            {groups.map((group) => (
              <div key={group.label} className="mb-3">
                <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">
                  {group.label}
                </p>
                {group.sessions.map((session) => (
                  <div
                    key={session.id}
                    className={cn(
                      'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted',
                      currentSessionId === session.id &&
                        'bg-primary/10 text-primary',
                    )}
                    onClick={() => {
                      setCurrentSession(session.id)
                      navigate('/chat')
                    }}
                  >
                    <MessageSquare className="h-4 w-4 shrink-0 opacity-50" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{session.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelativeTime(session.updatedAt)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        // TODO: delete session
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <Separator />

      {/* Bottom */}
      <div className="p-2">
        <Button
          variant="ghost"
          size={collapsed ? 'icon' : 'sm'}
          className={cn('w-full', !collapsed && 'justify-start')}
          onClick={() => navigate('/settings')}
        >
          <Settings className="h-4 w-4" />
          {!collapsed && <span className="ml-2">设置</span>}
        </Button>
      </div>
    </aside>
  )
}
