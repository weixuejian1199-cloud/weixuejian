import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MessageSquare,
  LayoutDashboard,
  Wallet,
  LineChart,
  Headphones,
  Wrench,
  DollarSign,
  Settings,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useUIStore } from '@/stores/ui-store'

const quickLinks = [
  { path: '/chat', label: 'AI对话', icon: MessageSquare },
  { path: '/dashboard', label: '指挥中心', icon: LayoutDashboard },
  { path: '/finance', label: '财务', icon: Wallet },
  { path: '/ops', label: '运营', icon: LineChart },
  { path: '/cs', label: '客服中枢', icon: Headphones },
  { path: '/tools', label: '工具市场', icon: Wrench },
  { path: '/cost', label: '成本监控', icon: DollarSign },
  { path: '/settings', label: '设置', icon: Settings },
]

export function SearchDialog() {
  const navigate = useNavigate()
  const open = useUIStore((s) => s.searchOpen)
  const setSearchOpen = useUIStore((s) => s.setSearchOpen)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(!open)
      }
    },
    [open, setSearchOpen],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <Dialog open={open} onOpenChange={setSearchOpen}>
      <DialogContent className="top-[20%] translate-y-0 sm:max-w-[480px]">
        <DialogTitle className="sr-only">搜索</DialogTitle>
        <Input
          placeholder="搜索页面、对话、功能..."
          className="border-0 text-base shadow-none focus-visible:ring-0"
          autoFocus
        />
        <div className="mt-2">
          <p className="mb-2 px-2 text-xs font-medium text-muted-foreground">
            快速跳转
          </p>
          {quickLinks.map((link) => (
            <button
              key={link.path}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-secondary"
              onClick={() => {
                navigate(link.path)
                setSearchOpen(false)
              }}
            >
              <link.icon className="h-4 w-4 text-muted-foreground" />
              <span>{link.label}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
