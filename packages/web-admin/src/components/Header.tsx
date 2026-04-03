import { useNavigate, useLocation } from 'react-router-dom'
import {
  MessageSquare,
  LayoutDashboard,
  Wallet,
  LineChart,
  Headphones,
  Wrench,
  DollarSign,
  Search,
  Bell,
  LogOut,
  Settings,
  User,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'

const navItems = [
  { path: '/chat', label: 'AI工作站', icon: MessageSquare },
  { path: '/dashboard', label: '指挥中心', icon: LayoutDashboard },
  { path: '/finance', label: '财务', icon: Wallet },
  { path: '/ops', label: '运营', icon: LineChart },
  { path: '/cs', label: '客服中枢', icon: Headphones },
  { path: '/tools', label: '工具市场', icon: Wrench },
  { path: '/cost', label: '成本监控', icon: DollarSign },
]

export function Header() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const setSearchOpen = useUIStore((s) => s.setSearchOpen)

  return (
    <header className="fixed top-0 left-0 right-0 z-40 flex h-[var(--header-height)] items-center border-b bg-card px-4">
      {/* Logo */}
      <div
        className="flex shrink-0 cursor-pointer items-center gap-2"
        onClick={() => navigate('/chat')}
      >
        <div className="gradient-primary flex h-8 w-8 items-center justify-center rounded-lg">
          <span className="text-sm font-bold text-white">S</span>
        </div>
        <span className="hidden text-base font-semibold text-foreground md:block">
          时皙AI
        </span>
      </div>

      {/* Navigation Tabs */}
      <nav className="mx-6 flex flex-1 items-center justify-center gap-1">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.path)
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <item.icon className="h-4 w-4" />
              <span className="hidden lg:inline">{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Right Section */}
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="hidden gap-2 text-muted-foreground sm:flex"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="h-4 w-4" />
          <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <span className="text-xs">&#8984;</span>K
          </kbd>
        </Button>

        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="relative h-8 w-8 rounded-full"
            >
              <Avatar className="h-8 w-8">
                <AvatarImage src={user?.avatar} alt={user?.displayName} />
                <AvatarFallback className="text-xs">
                  {user?.displayName?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {user?.displayName || '用户'}
                </p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user?.phone || user?.username}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <User className="mr-2 h-4 w-4" />
              个人信息
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Settings className="mr-2 h-4 w-4" />
              设置
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                logout()
                navigate('/login')
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
