import { LineChart } from 'lucide-react'
import { DataScopeNote } from '@/components/DataScopeNote'

export function OpsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-secondary">
          <LineChart className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">运营</h1>
          <p className="text-sm text-muted-foreground">
            选品、活动、流量与经营分析 — 结构与岗位能力预览
          </p>
        </div>
      </div>
      <DataScopeNote
        source="ERP 订单与商品、广告/推广平台 API 或 RPA、内部上传补录"
        sync="指标类多为 T+1；活动与库存类可按小时或准实时，以数据源为准"
        note="本页用于产品与调研定稿；与指挥中心「总览」关系为下钻明细，非第二套口径。"
      />
      <p className="text-sm leading-relaxed text-muted-foreground">
        后续在此挂载活动日历、商品健康度、渠道对比等视图。调研时区分「品牌总部运营」与「单店运营」所需字段与频次。
      </p>
    </div>
  )
}
