import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Wallet,
  LineChart,
  Headphones,
} from 'lucide-react'
import { DataScopeNote } from '@/components/DataScopeNote'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const entries = [
  {
    path: '/finance',
    title: '财务',
    description: '资金、对账、报表与合规视图',
    icon: Wallet,
  },
  {
    path: '/ops',
    title: '运营',
    description: '选品、活动、流量与经营分析',
    icon: LineChart,
  },
  {
    path: '/cs',
    title: '客服中枢',
    description: '会话、工单与 ACI 判断入口',
    icon: Headphones,
  },
] as const

export function DashboardPage() {
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-secondary">
          <LayoutDashboard className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">指挥中心</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            全局态势与各业务板块入口；定稿期用于对齐岗位窗口与数据叙事
          </p>
        </div>
      </div>

      <DataScopeNote
        source="多源聚合：ERP/API、RPA 补采、人工上传（具体以租户开通的数据通路为准）"
        sync="总览指标多为定时任务汇总；各板块下钻可更细粒度"
        note="以下为板块入口预览，指标卡片与实时告警在方案确认后挂载。"
      />

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          业务板块
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {entries.map(({ path, title, description, icon: Icon }) => (
            <Card
              key={path}
              role="button"
              tabIndex={0}
              className="cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/20"
              onClick={() => navigate(path)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate(path)
                }
              }}
            >
              <CardHeader className="space-y-3">
                <Icon className="h-8 w-8 text-primary" />
                <CardTitle className="text-lg">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
