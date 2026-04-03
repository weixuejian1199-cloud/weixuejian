import { Outlet } from 'react-router-dom'
import { Header } from '@/components/Header'
import { Sidebar } from '@/components/Sidebar'
import { StatusBar } from '@/components/StatusBar'
import { SearchDialog } from '@/components/SearchDialog'
import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'

export function AppShell() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <Sidebar />
      <SearchDialog />

      <main
        className={cn(
          'transition-all duration-200',
          'pt-[var(--header-height)] pb-[var(--statusbar-height)]',
          sidebarCollapsed
            ? 'pl-[var(--sidebar-collapsed-width)]'
            : 'pl-[var(--sidebar-width)]',
        )}
      >
        <div className="h-full min-h-[calc(100vh-var(--header-height)-var(--statusbar-height))]">
          <Outlet />
        </div>
      </main>

      <StatusBar />
    </div>
  )
}
