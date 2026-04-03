import { Headphones } from 'lucide-react'
import { DataScopeNote } from '@/components/DataScopeNote'

export function CSPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-secondary">
          <Headphones className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">客服中枢</h1>
          <p className="text-sm text-muted-foreground">
            ACI 判断、会话与工单 — 结构与岗位能力预览
          </p>
        </div>
      </div>
      <DataScopeNote
        source="各渠道 IM / 工单系统接入（API 或服务商模式）；订单与商品数据来自 ERP 聚合"
        sync="会话准实时；订单快照按拉取策略；执行动作默认人在环（Phase 1）"
        note="本页用于产品与调研定稿；全渠道正式接入在方案与资质就绪后实施。"
      />
      <p className="text-sm leading-relaxed text-muted-foreground">
        后续在此挂载待办队列、判断建议、升级与留痕视图。调研时明确高频场景与必须人工确认的节点。
      </p>
    </div>
  )
}
