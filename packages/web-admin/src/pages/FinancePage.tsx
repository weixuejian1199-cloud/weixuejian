import { Wallet } from 'lucide-react'
import { DataScopeNote } from '@/components/DataScopeNote'

export function FinancePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-secondary">
          <Wallet className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">财务</h1>
          <p className="text-sm text-muted-foreground">
            资金、对账与报表 — 结构与岗位能力预览
          </p>
        </div>
      </div>
      <DataScopeNote
        source="ERP / 各平台开放 API 与 RPA 补采（接入方案已定义，工程阶段接入）"
        sync="按数据源配置（如 T+1 结算单、准实时余额）；以实际对接为准"
        note="本页用于产品与调研定稿，非 production 实时财务数据。"
      />
      <p className="text-sm leading-relaxed text-muted-foreground">
        后续在此挂载科目与凭证、资金看板、税务与成本等子模块。调研时请对照业务类型（单店 / 多店 /
        强合规）勾选必备能力，避免与运营、指挥中心指标重复或冲突。
      </p>
    </div>
  )
}
