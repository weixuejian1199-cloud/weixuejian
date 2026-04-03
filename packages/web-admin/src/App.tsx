import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
} from 'react-router-dom'
import { AppShell } from '@/layouts/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { ChatPage } from '@/pages/ChatPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { FinancePage } from '@/pages/FinancePage'
import { OpsPage } from '@/pages/OpsPage'
import { CSPage } from '@/pages/CSPage'
import { ToolsPage } from '@/pages/ToolsPage'
import { CostPage } from '@/pages/CostPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { useAuthStore } from '@/stores/auth-store'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: 'chat', element: <ChatPage /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'finance', element: <FinancePage /> },
      { path: 'ops', element: <OpsPage /> },
      { path: 'cs', element: <CSPage /> },
      { path: 'tools', element: <ToolsPage /> },
      { path: 'cost', element: <CostPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/chat" replace />,
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
