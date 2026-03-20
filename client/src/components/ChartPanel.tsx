/**
 * ChartPanel — 数据可视化面板
 * 从 categoryGroupedTop20 中自动识别可视化字段，生成图表
 */

import { useMemo, useState } from "react";
import { X, BarChart2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

// ── 字段关键词分类 ──────────────────────────────────────────────────
const INFLUENCER_KEYWORDS = ["达人", "主播", "带货人"];
const STORE_KEYWORDS      = ["店铺", "商家", "门店"];
const PRODUCT_KEYWORDS    = ["商品名", "选购商品", "商品标题", "产品名"];
const PROVINCE_KEYWORDS   = ["省份", "省", "地区", "区域"];
const PAYMENT_KEYWORDS    = ["支付方式", "付款方式", "支付类型"];
const STATUS_KEYWORDS     = ["订单状态", "售后状态", "退款状态", "状态"];

function matchField(name: string, keywords: string[]) {
  return keywords.some(k => name.includes(k));
}

// 颜色方案
const BAR_COLORS = ["#4f6ef7", "#6e8cf9", "#34d399", "#10b981", "#f59e0b", "#f97316", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];
const PIE_COLORS = ["#4f6ef7", "#34d399", "#f59e0b", "#f97316", "#8b5cf6", "#ec4899", "#06b6d4", "#ef4444", "#84cc16", "#a78bfa"];

type CategoryEntry = { label: string; count: number; sum?: number; avg?: number };
type CategoryData = Record<string, CategoryEntry[]>;

interface ChartConfig {
  fieldName: string;
  title: string;
  type: "bar" | "hbar" | "pie";
  dataKey: "sum" | "count";
  unit: string;
  data: Array<{ name: string; value: number }>;
}

function detectCharts(categoryData: CategoryData): ChartConfig[] {
  const charts: ChartConfig[] = [];

  const sortedBySum = (entries: CategoryEntry[], top = 10) =>
    [...entries]
      .filter(e => e.sum !== undefined && e.sum > 0 && e.label)
      .sort((a, b) => (b.sum ?? 0) - (a.sum ?? 0))
      .slice(0, top)
      .map(e => ({ name: String(e.label).slice(0, 20), value: Math.round(e.sum ?? 0) }));

  const sortedByCount = (entries: CategoryEntry[], top = 10) =>
    [...entries]
      .filter(e => e.count > 0 && e.label)
      .sort((a, b) => b.count - a.count)
      .slice(0, top)
      .map(e => ({ name: String(e.label).slice(0, 20), value: e.count }));

  for (const [field, entries] of Object.entries(categoryData)) {
    if (!entries?.length) continue;
    // 优先用 entries[0].fieldName（原始中文字段名）匹配，fallback 用 key
    const fieldLabel = (entries[0] as any)?.fieldName ?? field;

    if (matchField(fieldLabel, INFLUENCER_KEYWORDS)) {
      const d = sortedBySum(entries);
      if (d.length >= 2) charts.push({ fieldName: field, title: "达人销售 Top10", type: "hbar", dataKey: "sum", unit: "元", data: d });
    } else if (matchField(fieldLabel, STORE_KEYWORDS)) {
      const d = sortedBySum(entries);
      if (d.length >= 2) charts.push({ fieldName: field, title: "店铺销售对比", type: "hbar", dataKey: "sum", unit: "元", data: d });
    } else if (matchField(fieldLabel, PRODUCT_KEYWORDS)) {
      const d = sortedBySum(entries);
      if (d.length >= 2) charts.push({ fieldName: field, title: "商品销售 Top10", type: "hbar", dataKey: "sum", unit: "元", data: d });
    } else if (matchField(fieldLabel, PROVINCE_KEYWORDS)) {
      const d = sortedByCount(entries);
      if (d.length >= 2) charts.push({ fieldName: field, title: "省份订单分布", type: "hbar", dataKey: "count", unit: "单", data: d });
    } else if (matchField(fieldLabel, PAYMENT_KEYWORDS)) {
      const d = sortedByCount(entries, 8);
      if (d.length >= 2) charts.push({ fieldName: field, title: "支付方式占比", type: "pie", dataKey: "count", unit: "单", data: d });
    } else if (matchField(fieldLabel, STATUS_KEYWORDS)) {
      const d = sortedByCount(entries, 8);
      if (d.length >= 2) charts.push({ fieldName: field, title: "订单状态分布", type: "pie", dataKey: "count", unit: "单", data: d });
    }
  }

  // 优先展示：达人 → 店铺 → 商品 → 省份 → 支付 → 状态
  const order = ["达人", "店铺", "商品", "省份", "支付", "订单"];
  charts.sort((a, b) => {
    const ai = order.findIndex(k => a.title.includes(k));
    const bi = order.findIndex(k => b.title.includes(k));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return charts.slice(0, 6);
}

// ── 格式化数值 ──────────────────────────────────────────────────────
function fmtNum(v: number, unit: string) {
  if (unit === "元") {
    if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
    return v.toLocaleString();
  }
  return v.toLocaleString();
}

// ── 水平柱状图 ──────────────────────────────────────────────────────
function HBarChart({ config }: { config: ChartConfig }) {
  const maxVal = Math.max(...config.data.map(d => d.value), 1);
  return (
    <div style={{ width: "100%" }}>
      <div style={{ fontSize: 11, color: "var(--atlas-text-3)", marginBottom: 6 }}>{config.title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {config.data.map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 80, fontSize: 10, color: "var(--atlas-text-2)", textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.name}>
              {item.name}
            </div>
            <div style={{ flex: 1, height: 14, background: "var(--atlas-surface-2)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${(item.value / maxVal) * 100}%`,
                background: BAR_COLORS[i % BAR_COLORS.length],
                borderRadius: 2,
                transition: "width 0.5s ease",
              }} />
            </div>
            <div style={{ width: 52, fontSize: 10, color: "var(--atlas-text-2)", flexShrink: 0, textAlign: "left" }}>
              {fmtNum(item.value, config.unit)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 饼图 ──────────────────────────────────────────────────────────
function MiniPieChart({ config }: { config: ChartConfig }) {
  const total = config.data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ width: "100%" }}>
      <div style={{ fontSize: 11, color: "var(--atlas-text-3)", marginBottom: 6 }}>{config.title}</div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <ResponsiveContainer width={120} height={120}>
          <PieChart>
            <Pie data={config.data} cx="50%" cy="50%" innerRadius={28} outerRadius={50} dataKey="value" strokeWidth={0}>
              {config.data.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v: number) => [`${v} ${config.unit}`, ""]} contentStyle={{ fontSize: 11, padding: "4px 8px" }} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          {config.data.slice(0, 6).map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: "var(--atlas-text-2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
              <span style={{ fontSize: 10, color: "var(--atlas-text-3)", flexShrink: 0 }}>
                {total > 0 ? `${((item.value / total) * 100).toFixed(0)}%` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 主面板 ──────────────────────────────────────────────────────────

interface ChartPanelProps {
  categoryGroupedTop20: CategoryData;
  onClose: () => void;
}

export function ChartPanel({ categoryGroupedTop20, onClose }: ChartPanelProps) {
  const charts = useMemo(() => detectCharts(categoryGroupedTop20), [categoryGroupedTop20]);

  if (charts.length === 0) {
    return (
      <div style={{ padding: "20px 24px", textAlign: "center", color: "var(--atlas-text-3)", fontSize: 13 }}>
        暂无可视化数据（需要分类字段如达人昵称、省份等）
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--atlas-bg)",
        borderBottom: "1px solid var(--atlas-border)",
        padding: "16px 20px 20px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <BarChart2 size={14} style={{ color: "var(--atlas-accent)" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-text)" }}>数据图表</span>
          <span style={{ fontSize: 11, color: "var(--atlas-text-3)" }}>— {charts.length} 个图表</span>
        </div>
        <button
          onClick={onClose}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, borderRadius: 4,
            background: "transparent",
            color: "var(--atlas-text-3)",
            cursor: "pointer",
            border: "none",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "var(--atlas-surface)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
        >
          <X size={13} />
        </button>
      </div>

      {/* Charts grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {charts.map((chart, i) => (
          <div
            key={i}
            style={{
              background: "var(--atlas-surface)",
              border: "1px solid var(--atlas-border)",
              borderRadius: 8,
              padding: "14px 16px",
            }}
          >
            {chart.type === "pie" ? (
              <MiniPieChart config={chart} />
            ) : (
              <HBarChart config={chart} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
