/**
 * ATLAS V5.0 — 数据中枢 (Dashboard)
 * Design: Command Center / Monitor style
 * Multi-store, multi-platform real-time data overview
 *
 * V5.0 Changes:
 *   - Time range selector: 今日 / 昨日 / 本周 / 本月 / 近30天
 *   - Store cards: add order count + last updated time
 *   - Refresh button with last-updated timestamp
 *   - Data changes dynamically based on selected time range
 */
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp, TrendingDown, Store, ShoppingBag, RefreshCw,
  ArrowUpRight, ArrowDownRight, Zap, AlertTriangle,
  BarChart2, DollarSign, Package, Users, Activity,
  ChevronDown, ExternalLink, Wifi, WifiOff, Plus, Clock,
} from "lucide-react";
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAtlas } from "@/contexts/AtlasContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type TimeRange = "today" | "yesterday" | "week" | "month" | "30d";

// ── Mock Data ─────────────────────────────────────────────────────────────────

const PLATFORM_META: Record<string, { label: string; color: string; bg: string }> = {
  tmall:       { label: "天猫",   color: "#FF6B35", bg: "rgba(255,107,53,0.1)" },
  douyin:      { label: "抖音",   color: "#00F2EA", bg: "rgba(0,242,234,0.1)" },
  pinduoduo:   { label: "拼多多", color: "#E02020", bg: "rgba(224,32,32,0.1)" },
  jd:          { label: "京东",   color: "#E31D1C", bg: "rgba(227,29,28,0.1)" },
  xiaochengxu: { label: "小程序", color: "#07C160", bg: "rgba(7,193,96,0.1)" },
};

// Multipliers for different time ranges (relative to "today" baseline)
const RANGE_MULTIPLIER: Record<TimeRange, number> = {
  today:     1,
  yesterday: 0.88,
  week:      6.4,
  month:     27.2,
  "30d":     28.5,
};

const BASE_STORES = [
  { id: "s1", name: "旗舰店·上海",  platform: "tmall",       gmv: 128500, orders: 342,  refund_rate: 2.1, trend: 12.4,  status: "online", updatedMins: 3 },
  { id: "s2", name: "直播间·北京",  platform: "douyin",      gmv: 96200,  orders: 518,  refund_rate: 3.8, trend: 28.6,  status: "online", updatedMins: 1 },
  { id: "s3", name: "官方旗舰店",   platform: "pinduoduo",   gmv: 54300,  orders: 891,  refund_rate: 5.2, trend: -4.3,  status: "online", updatedMins: 7 },
  { id: "s4", name: "自营店铺",     platform: "jd",          gmv: 43100,  orders: 156,  refund_rate: 1.9, trend: 6.8,   status: "online", updatedMins: 5 },
  { id: "s5", name: "品牌小程序",   platform: "xiaochengxu", gmv: 31800,  orders: 203,  refund_rate: 1.2, trend: 45.2,  status: "online", updatedMins: 12 },
];

const TREND_DATA: Record<TimeRange, Array<Record<string, any>>> = {
  today: [
    { date: "00:00", tmall: 8200,  douyin: 5100,  pdd: 3200, jd: 2800 },
    { date: "04:00", tmall: 3100,  douyin: 2200,  pdd: 1800, jd: 1200 },
    { date: "08:00", tmall: 14500, douyin: 9800,  pdd: 6200, jd: 4100 },
    { date: "12:00", tmall: 22000, douyin: 18000, pdd: 9800, jd: 6800 },
    { date: "16:00", tmall: 31000, douyin: 25000, pdd: 12000, jd: 8200 },
    { date: "20:00", tmall: 38000, douyin: 28000, pdd: 14000, jd: 9800 },
    { date: "23:59", tmall: 42000, douyin: 32000, pdd: 15200, jd: 11000 },
  ],
  yesterday: [
    { date: "00:00", tmall: 7800,  douyin: 4800,  pdd: 3000, jd: 2600 },
    { date: "04:00", tmall: 2900,  douyin: 2000,  pdd: 1600, jd: 1100 },
    { date: "08:00", tmall: 13200, douyin: 9200,  pdd: 5800, jd: 3800 },
    { date: "12:00", tmall: 20000, douyin: 16500, pdd: 9200, jd: 6200 },
    { date: "16:00", tmall: 28000, douyin: 22000, pdd: 11000, jd: 7600 },
    { date: "20:00", tmall: 35000, douyin: 26000, pdd: 13000, jd: 9200 },
    { date: "23:59", tmall: 38500, douyin: 29000, pdd: 14000, jd: 10200 },
  ],
  week: [
    { date: "周一", tmall: 38000, douyin: 22000, pdd: 15000, jd: 12000 },
    { date: "周二", tmall: 42000, douyin: 28000, pdd: 18000, jd: 14000 },
    { date: "周三", tmall: 35000, douyin: 31000, pdd: 16000, jd: 11000 },
    { date: "周四", tmall: 51000, douyin: 38000, pdd: 21000, jd: 16000 },
    { date: "周五", tmall: 48000, douyin: 42000, pdd: 19000, jd: 13000 },
    { date: "周六", tmall: 55000, douyin: 35000, pdd: 22000, jd: 15000 },
    { date: "周日", tmall: 62000, douyin: 48000, pdd: 24000, jd: 18000 },
  ],
  month: [
    { date: "第1周", tmall: 210000, douyin: 158000, pdd: 89000, jd: 68000 },
    { date: "第2周", tmall: 245000, douyin: 182000, pdd: 102000, jd: 75000 },
    { date: "第3周", tmall: 228000, douyin: 195000, pdd: 95000, jd: 71000 },
    { date: "第4周", tmall: 268000, douyin: 210000, pdd: 115000, jd: 82000 },
  ],
  "30d": [
    { date: "3/1",  tmall: 38000, douyin: 22000, pdd: 15000, jd: 12000 },
    { date: "3/5",  tmall: 45000, douyin: 31000, pdd: 18000, jd: 14000 },
    { date: "3/10", tmall: 52000, douyin: 38000, pdd: 21000, jd: 16000 },
    { date: "3/15", tmall: 48000, douyin: 42000, pdd: 19000, jd: 13000 },
    { date: "3/20", tmall: 61000, douyin: 45000, pdd: 24000, jd: 18000 },
    { date: "3/25", tmall: 58000, douyin: 51000, pdd: 22000, jd: 17000 },
    { date: "3/30", tmall: 67000, douyin: 55000, pdd: 26000, jd: 20000 },
  ],
};

const MOCK_PIE = [
  { name: "天猫",   value: 36.2, color: "#FF6B35" },
  { name: "抖音",   value: 27.1, color: "#00F2EA" },
  { name: "拼多多", value: 15.3, color: "#E02020" },
  { name: "京东",   value: 12.1, color: "#E31D1C" },
  { name: "小程序", value: 9.3,  color: "#07C160" },
];

const MOCK_ALERTS = [
  { id: 1, type: "warning", store: "拼多多·官方旗舰店", msg: "退款率 5.2% 超过预警线", time: "5分钟前" },
  { id: 2, type: "info",    store: "抖音·直播间·北京",  msg: "今日 GMV 环比增长 28.6%", time: "12分钟前" },
  { id: 3, type: "success", store: "小程序·品牌",       msg: "新增用户 203 人，转化率 18%", time: "31分钟前" },
];

// ── Time range labels ─────────────────────────────────────────────────────────

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string; short: string }[] = [
  { value: "today",     label: "今日",   short: "今日" },
  { value: "yesterday", label: "昨日",   short: "昨日" },
  { value: "week",      label: "本周",   short: "本周" },
  { value: "month",     label: "本月",   short: "本月" },
  { value: "30d",       label: "近30天", short: "30天" },
];

// ── Components ────────────────────────────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, sub, trend, color }: {
  icon: typeof TrendingUp; label: string; value: string;
  sub?: string; trend?: number; color: string;
}) {
  const up = (trend ?? 0) >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}
    >
      <div className="flex items-center justify-between">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}18` }}>
          <Icon size={15} style={{ color }} />
        </div>
        {trend !== undefined && (
          <div className="flex items-center gap-1 text-xs font-medium"
            style={{ color: up ? "var(--atlas-success)" : "var(--atlas-danger)" }}>
            {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold" style={{ color: "var(--atlas-text)", fontVariantNumeric: "tabular-nums" }}>{value}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--atlas-text-3)" }}>{label}</p>
        {sub && <p className="text-xs mt-0.5" style={{ color: "var(--atlas-text-3)" }}>{sub}</p>}
      </div>
    </motion.div>
  );
}

function StoreRow({ store, index }: { store: typeof BASE_STORES[0] & { gmv: number; orders: number }; index: number }) {
  const meta = PLATFORM_META[store.platform];
  const up = store.trend >= 0;

  const updatedLabel = store.updatedMins < 1
    ? "刚刚"
    : store.updatedMins < 60
    ? `${store.updatedMins}分钟前`
    : `${Math.floor(store.updatedMins / 60)}小时前`;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-center gap-3 px-4 py-3 rounded-lg transition-all group"
      style={{ border: "1px solid transparent" }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = "var(--atlas-elevated)";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
        (e.currentTarget as HTMLElement).style.borderColor = "transparent";
      }}
    >
      {/* Rank */}
      <span className="w-5 text-xs text-center font-mono flex-shrink-0"
        style={{ color: index < 3 ? "var(--atlas-accent)" : "var(--atlas-text-3)" }}>
        {index + 1}
      </span>

      {/* Platform badge */}
      <div className="px-2 py-0.5 rounded text-xs font-medium flex-shrink-0"
        style={{ background: meta.bg, color: meta.color }}>
        {meta.label}
      </div>

      {/* Name + updated time */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "var(--atlas-text)" }}>{store.name}</p>
        <div className="flex items-center gap-1 mt-0.5">
          <Clock size={9} style={{ color: "var(--atlas-text-3)" }} />
          <span className="text-xs" style={{ color: "var(--atlas-text-3)", fontSize: "10px" }}>{updatedLabel}</span>
        </div>
      </div>

      {/* GMV + orders */}
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-semibold" style={{ color: "var(--atlas-text)", fontVariantNumeric: "tabular-nums" }}>
          ¥{store.gmv.toLocaleString()}
        </p>
        <p className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{store.orders.toLocaleString()} 单</p>
      </div>

      {/* Trend */}
      <div className="flex items-center gap-0.5 flex-shrink-0 w-14 justify-end"
        style={{ color: up ? "var(--atlas-success)" : "var(--atlas-danger)" }}>
        {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        <span className="text-xs font-medium">{up ? "+" : ""}{store.trend}%</span>
      </div>

      {/* Refund rate */}
      <div className="flex-shrink-0 w-12 text-right">
        <span className="text-xs px-1.5 py-0.5 rounded"
          style={{
            background: store.refund_rate > 4 ? "rgba(248,113,113,0.12)" : "rgba(52,211,153,0.08)",
            color: store.refund_rate > 4 ? "var(--atlas-danger)" : "var(--atlas-text-3)",
          }}>
          {store.refund_rate}%
        </span>
      </div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { setActiveNav } = useAtlas();
  const [refreshing, setRefreshing] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>("today");
  const [lastUpdated, setLastUpdated] = useState("刚刚");

  // Real stats from API
  const utils = trpc.useUtils();
  const { data: stats, isLoading: statsLoading } = trpc.stats.dashboard.useQuery();

  // Compute scaled demo data based on time range
  const multiplier = RANGE_MULTIPLIER[timeRange];
  const stores = useMemo(() => BASE_STORES.map(s => ({
    ...s,
    gmv: Math.round(s.gmv * multiplier),
    orders: Math.round(s.orders * multiplier),
  })), [multiplier]);

  const totalGmv = stores.reduce((s, st) => s + st.gmv, 0);
  const totalOrders = stores.reduce((s, st) => s + st.orders, 0);
  const avgRefund = (BASE_STORES.reduce((s, st) => s + st.refund_rate, 0) / BASE_STORES.length).toFixed(1);

  const handleRefresh = async () => {
    setRefreshing(true);
    await utils.stats.dashboard.invalidate();
    setRefreshing(false);
    setLastUpdated("刚刚");
    toast.success("数据已刷新");
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg px-3 py-2 text-xs"
        style={{ background: "var(--atlas-card)", border: "1px solid var(--atlas-border-2)", color: "var(--atlas-text)" }}>
        <p className="font-medium mb-1" style={{ color: "var(--atlas-text-2)" }}>{label}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.color }}>
            {p.name}: ¥{p.value?.toLocaleString()}
          </p>
        ))}
      </div>
    );
  };

  const trendLabel = TIME_RANGE_OPTIONS.find(o => o.value === timeRange)?.label || "";

  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--atlas-bg)" }}>
      <div className="max-w-7xl mx-auto px-6 py-5">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--atlas-text)" }}>数据中枢</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--atlas-text-3)" }}>
              多平台店铺实时经营监控 · {trendLabel}数据
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Time range selector */}
            <div
              className="flex items-center rounded-lg overflow-hidden"
              style={{ border: "1px solid var(--atlas-border)", background: "var(--atlas-surface)" }}
            >
              {TIME_RANGE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setTimeRange(opt.value)}
                  className="px-3 py-1.5 text-xs font-medium transition-all"
                  style={{
                    background: timeRange === opt.value ? "var(--atlas-accent)" : "transparent",
                    color: timeRange === opt.value ? "#fff" : "var(--atlas-text-3)",
                    borderRight: opt.value !== "30d" ? "1px solid var(--atlas-border)" : "none",
                  }}
                >
                  {opt.short}
                </button>
              ))}
            </div>

            {/* Refresh */}
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text-2)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-2)"}
            >
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "刷新中" : "刷新"}
            </button>

            <button
              onClick={() => toast.info("平台接入功能即将上线，敬请期待")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: "var(--atlas-accent)", color: "#fff" }}
            >
              <Plus size={12} />
              接入平台
            </button>
          </div>
        </div>

        {/* ── Platform Connection Status ── */}
        <div className="grid grid-cols-5 gap-2 mb-6">
          {Object.entries(PLATFORM_META).map(([key, meta]) => (
            <div key={key} className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
              style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
              <div className="w-1.5 h-1.5 rounded-full pulse-dot flex-shrink-0" style={{ background: meta.color }} />
              <span className="text-xs font-medium" style={{ color: "var(--atlas-text-2)" }}>{meta.label}</span>
              <span className="ml-auto text-xs" style={{ color: "var(--atlas-text-3)", fontSize: "10px" }}>已连接</span>
            </div>
          ))}
        </div>

        {/* ── KPI Cards — Real ATLAS Stats ── */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <MetricCard icon={BarChart2} label="已生成报表" value={statsLoading ? "-" : String(stats?.totalReports ?? 0)}
            sub="历史报表总数" color="#5B8CFF" />
          <MetricCard icon={Package} label="分析会话" value={statsLoading ? "-" : String(stats?.totalSessions ?? 0)}
            sub="已上传文件数" color="#34D399" />
          <MetricCard icon={Clock} label="定时任务" value={statsLoading ? "-" : String(stats?.activeScheduledTasks ?? 0)}
            sub="运行中的自动化任务" color="#A78BFA" />
          <MetricCard icon={Activity} label="我的积分" value={statsLoading ? "-" : String(stats?.credits ?? 0)}
            sub="可用于高级功能" color="#FBBF24" />
        </div>

        {/* ── Charts Row ── */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {/* Trend Chart */}
          <div className="col-span-2 rounded-xl p-4"
            style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>平台 GMV 趋势</h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--atlas-text-3)" }}>
                  {trendLabel}各平台销售额
                </p>
              </div>
              <div className="flex items-center gap-3">
                {[
                  { key: "tmall",  label: "天猫",   color: "#FF6B35" },
                  { key: "douyin", label: "抖音",   color: "#00F2EA" },
                  { key: "pdd",    label: "拼多多", color: "#E02020" },
                  { key: "jd",     label: "京东",   color: "#E31D1C" },
                ].map(l => (
                  <div key={l.key} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: l.color }} />
                    <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{l.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <motion.div key={timeRange} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={TREND_DATA[timeRange]} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <defs>
                    {[
                      { id: "tmall",  color: "#FF6B35" },
                      { id: "douyin", color: "#00F2EA" },
                      { id: "pdd",    color: "#E02020" },
                      { id: "jd",     color: "#E31D1C" },
                    ].map(g => (
                      <linearGradient key={g.id} id={`grad-${g.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={g.color} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={g.color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--atlas-text-3)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--atlas-text-3)" }} axisLine={false} tickLine={false}
                    tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  {[
                    { key: "tmall",  color: "#FF6B35", name: "天猫" },
                    { key: "douyin", color: "#00F2EA", name: "抖音" },
                    { key: "pdd",    color: "#E02020", name: "拼多多" },
                    { key: "jd",     color: "#E31D1C", name: "京东" },
                  ].map(s => (
                    <Area key={s.key} type="monotone" dataKey={s.key} name={s.name}
                      stroke={s.color} strokeWidth={1.5} fill={`url(#grad-${s.key})`} dot={false} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </motion.div>
          </div>

          {/* Pie Chart */}
          <div className="rounded-xl p-4" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
            <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--atlas-text)" }}>平台占比</h3>
            <p className="text-xs mb-3" style={{ color: "var(--atlas-text-3)" }}>{trendLabel} GMV 分布</p>
            <ResponsiveContainer width="100%" height={130}>
              <PieChart>
                <Pie data={MOCK_PIE} cx="50%" cy="50%" innerRadius={38} outerRadius={58} paddingAngle={3} dataKey="value">
                  {MOCK_PIE.map((entry, i) => <Cell key={i} fill={entry.color} stroke="none" />)}
                </Pie>
                <Tooltip
                  formatter={(v: any) => `${v}%`}
                  contentStyle={{ background: "var(--atlas-card)", border: "1px solid var(--atlas-border-2)", borderRadius: 8, fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-2">
              {MOCK_PIE.map(p => (
                <div key={p.name} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
                  <span className="text-xs flex-1" style={{ color: "var(--atlas-text-2)" }}>{p.name}</span>
                  <span className="text-xs font-medium" style={{ color: "var(--atlas-text)", fontVariantNumeric: "tabular-nums" }}>{p.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Store Rankings + Alerts ── */}
        <div className="grid grid-cols-3 gap-4">
          {/* Store list */}
          <div className="col-span-2 rounded-xl overflow-hidden"
            style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--atlas-border)" }}>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>店铺排行</h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--atlas-text-3)" }}>
                  按{trendLabel} GMV 排序
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs" style={{ color: "var(--atlas-text-3)" }}>
                <span className="w-20 text-right">GMV / 订单</span>
                <span className="w-14 text-right">环比</span>
                <span className="w-12 text-right">退款率</span>
              </div>
            </div>
            <motion.div
              key={timeRange}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="p-2"
            >
              {stores.map((store, i) => (
                <StoreRow key={store.id} store={store} index={i} />
              ))}
            </motion.div>
          </div>

          {/* Recent Reports — Real Data */}
          <div className="rounded-xl overflow-hidden" style={{ background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)" }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid var(--atlas-border)" }}>
              <BarChart2 size={13} style={{ color: "var(--atlas-accent)" }} />
              <h3 className="text-sm font-semibold" style={{ color: "var(--atlas-text)" }}>最近报表</h3>
              <div className="ml-auto w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: "var(--atlas-success)" }} />
            </div>
            <div className="p-3 space-y-2">
              {statsLoading && (
                <div className="flex items-center justify-center py-4 gap-2" style={{ color: "var(--atlas-text-3)" }}>
                  <RefreshCw size={12} className="animate-spin" />
                  <span className="text-xs">加载中...</span>
                </div>
              )}
              {!statsLoading && (!stats?.recentReports || stats.recentReports.length === 0) && (
                <div className="py-6 text-center text-xs" style={{ color: "var(--atlas-text-3)" }}>
                  暂无报表记录，上传文件并生成报表后显示
                </div>
              )}
              {stats?.recentReports?.map((report, i) => (
                <motion.div
                  key={report.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="p-3 rounded-lg"
                  style={{ background: "rgba(91,140,255,0.06)", border: "1px solid rgba(91,140,255,0.15)" }}
                >
                  <div className="flex items-start gap-2">
                    <TrendingUp size={12} style={{ color: "var(--atlas-accent)", flexShrink: 0, marginTop: 1 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: "var(--atlas-text)" }}>{report.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {report.fileSizeKb && <span className="text-xs" style={{ color: "var(--atlas-text-3)" }}>{(report.fileSizeKb / 1024).toFixed(1)} MB</span>}
                        <p className="text-xs" style={{ color: "var(--atlas-text-3)", fontFamily: "monospace" }}>
                          {report.createdAt ? new Date(report.createdAt).toLocaleString() : ""}
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Connect more platforms CTA */}
            <div className="px-3 pb-3">
              <button
                onClick={() => setActiveNav("settings")}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-all"
                style={{ background: "var(--atlas-elevated)", border: "1px solid var(--atlas-border)", color: "var(--atlas-text-3)" }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(91,140,255,0.3)";
                  (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)";
                  (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)";
                }}
              >
                <Plus size={12} />
                接入更多平台
              </button>
            </div>
          </div>
        </div>

        {/* ── Bottom note ── */}
        <div className="mt-4 flex items-center gap-2 text-xs" style={{ color: "var(--atlas-text-3)" }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--atlas-text-3)" }} />
          当前为演示数据 · 接入真实平台 API 后自动替换 ·
          <button
            onClick={() => setActiveNav("settings")}
            className="underline transition-colors"
            style={{ color: "var(--atlas-text-3)" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-accent)"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--atlas-text-3)"}
          >
            前往设置接入
          </button>
        </div>
      </div>
    </div>
  );
}
