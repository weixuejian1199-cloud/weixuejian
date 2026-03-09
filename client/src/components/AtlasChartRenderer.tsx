/**
 * AtlasChartRenderer — 图表渲染组件
 * 解析 AI 返回的 ```atlas-chart JSON 代码块，渲染为交互式图表
 *
 * 支持的图表类型：
 * - bar: 柱状图
 * - line: 折线图
 * - pie: 饼图
 * - area: 面积图
 *
 * JSON 格式示例：
 * {
 *   "type": "bar",
 *   "title": "各门店销售额对比",
 *   "xKey": "store",
 *   "yKey": "sales",
 *   "unit": "元",
 *   "data": [{ "store": "北京店", "sales": 12000 }, ...]
 * }
 */
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useState } from "react";
import { Download } from "lucide-react";

// ATLAS accent color palette
const COLORS = [
  "#5b8cff", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#14b8a6",
];

interface ChartData {
  type: "bar" | "line" | "pie" | "area";
  title?: string;
  xKey: string;
  yKey: string | string[];
  unit?: string;
  data: Record<string, string | number>[];
  /** Optional: color overrides per series */
  colors?: string[];
}

interface AtlasChartRendererProps {
  rawJson: string;
}

function formatValue(value: number, unit?: string): string {
  if (value >= 10000) {
    return `${(value / 10000).toFixed(1)}万${unit || ""}`;
  }
  return `${value.toLocaleString()}${unit || ""}`;
}

function CustomTooltip({
  active, payload, label, unit,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  unit?: string;
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        background: "var(--atlas-surface)",
        border: "1px solid var(--atlas-border)",
        color: "var(--atlas-text)",
      }}
    >
      {label && <div className="font-medium mb-1">{label}</div>}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: entry.color }}
          />
          <span style={{ color: "var(--atlas-text-2)" }}>{entry.name}:</span>
          <span className="font-medium">{formatValue(entry.value, unit)}</span>
        </div>
      ))}
    </div>
  );
}

function PieCustomTooltip({
  active, payload, unit,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { percent: number } }>;
  unit?: string;
}) {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0];
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        background: "var(--atlas-surface)",
        border: "1px solid var(--atlas-border)",
        color: "var(--atlas-text)",
      }}
    >
      <div className="font-medium">{entry.name}</div>
      <div>{formatValue(entry.value, unit)}</div>
      <div style={{ color: "var(--atlas-text-3)" }}>
        占比 {(entry.payload.percent * 100).toFixed(1)}%
      </div>
    </div>
  );
}

export function AtlasChartRenderer({ rawJson }: AtlasChartRendererProps) {
  let data: ChartData | null = null;
  try {
    data = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!data || !data.data || !data.xKey || !data.yKey) return null;
  return <ChartView data={data} />;
}

function ChartView({ data }: { data: ChartData }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const yKeys = Array.isArray(data.yKey) ? data.yKey : [data.yKey];
  const colors = data.colors || COLORS;

  const handleDownloadSVG = () => {
    const svgEl = document.querySelector(".atlas-chart-container svg");
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.title || "chart"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const tickStyle = { fill: "var(--atlas-text-3)", fontSize: 11 };

  return (
    <div
      className="atlas-chart-container rounded-xl overflow-hidden my-2"
      style={{
        background: "var(--atlas-elevated)",
        border: "1px solid var(--atlas-border)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--atlas-border)" }}
      >
        <div className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>
          {data.title || "数据图表"}
        </div>
        <button
          onClick={handleDownloadSVG}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-all"
          style={{
            color: "var(--atlas-text-3)",
            background: "transparent",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
            (e.currentTarget as HTMLElement).style.background = "var(--atlas-surface)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
          title="下载 SVG"
        >
          <Download size={12} />
          导出
        </button>
      </div>

      {/* Chart */}
      <div className="px-4 py-4" style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          {data.type === "pie" ? (
            <PieChart>
              <Pie
                data={data.data}
                dataKey={yKeys[0]}
                nameKey={data.xKey}
                cx="50%"
                cy="50%"
                outerRadius={100}
                innerRadius={50}
                paddingAngle={2}
                onMouseEnter={(_, index) => setActiveIndex(index)}
                onMouseLeave={() => setActiveIndex(null)}
              >
                {data.data.map((_, index) => (
                  <Cell
                    key={index}
                    fill={colors[index % colors.length]}
                    opacity={activeIndex === null || activeIndex === index ? 1 : 0.6}
                    stroke="none"
                  />
                ))}
              </Pie>
              <Tooltip content={<PieCustomTooltip unit={data.unit} />} />
              <Legend
                formatter={(value) => (
                  <span style={{ color: "var(--atlas-text-2)", fontSize: 11 }}>{value}</span>
                )}
              />
            </PieChart>
          ) : data.type === "line" ? (
            <LineChart data={data.data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--atlas-border)" vertical={false} />
              <XAxis dataKey={data.xKey} tick={tickStyle} axisLine={false} tickLine={false} />
              <YAxis tick={tickStyle} axisLine={false} tickLine={false} tickFormatter={v => formatValue(v, "")} />
              <Tooltip content={<CustomTooltip unit={data.unit} />} />
              {yKeys.length > 1 && (
                <Legend formatter={(v) => <span style={{ color: "var(--atlas-text-2)", fontSize: 11 }}>{v}</span>} />
              )}
              {yKeys.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={colors[i % colors.length]}
                  strokeWidth={2}
                  dot={{ r: 3, fill: colors[i % colors.length] }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          ) : data.type === "area" ? (
            <AreaChart data={data.data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <defs>
                {yKeys.map((key, i) => (
                  <linearGradient key={key} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={colors[i % colors.length]} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={colors[i % colors.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--atlas-border)" vertical={false} />
              <XAxis dataKey={data.xKey} tick={tickStyle} axisLine={false} tickLine={false} />
              <YAxis tick={tickStyle} axisLine={false} tickLine={false} tickFormatter={v => formatValue(v, "")} />
              <Tooltip content={<CustomTooltip unit={data.unit} />} />
              {yKeys.length > 1 && (
                <Legend formatter={(v) => <span style={{ color: "var(--atlas-text-2)", fontSize: 11 }}>{v}</span>} />
              )}
              {yKeys.map((key, i) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={colors[i % colors.length]}
                  strokeWidth={2}
                  fill={`url(#grad-${i})`}
                />
              ))}
            </AreaChart>
          ) : (
            // Default: bar chart
            <BarChart data={data.data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--atlas-border)" vertical={false} />
              <XAxis dataKey={data.xKey} tick={tickStyle} axisLine={false} tickLine={false} />
              <YAxis tick={tickStyle} axisLine={false} tickLine={false} tickFormatter={v => formatValue(v, "")} />
              <Tooltip content={<CustomTooltip unit={data.unit} />} />
              {yKeys.length > 1 && (
                <Legend formatter={(v) => <span style={{ color: "var(--atlas-text-2)", fontSize: 11 }}>{v}</span>} />
              )}
              {yKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={colors[i % colors.length]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={48}
                  onMouseEnter={(_, index) => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  opacity={activeIndex === null || activeIndex === yKeys.indexOf(key) ? 1 : 0.7}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * Parse ```atlas-chart ... ``` blocks from markdown text
 */
export function parseAtlasChartBlocks(text: string): Array<{
  type: "text" | "chart";
  content: string;
}> {
  const parts: Array<{ type: "text" | "chart"; content: string }> = [];
  const regex = /```atlas-chart\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "chart", content: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: "text", content: text }];
}
