/**
 * ATLAS HR — 考勤汇总页面
 * 流程：上传打卡记录 → AI 识别字段 → 配置上下班时间 → 分析 → 查看异常明细 → 下载报表
 */
import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, Clock, ChevronRight, CheckCircle2,
  Download, Loader2, AlertCircle, Users,
  ArrowLeft, RefreshCw, TrendingDown, Calendar,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AttendanceFieldMap {
  nameCol: string;
  dateCol: string;
  checkInCol: string;
  checkOutCol: string;
  deptCol: string;
  statusCol: string;
}

interface UploadResult {
  id: string;
  headers: string[];
  fieldMap: AttendanceFieldMap;
  tableFormat: "detail" | "summary"; // P0-A: 考勤汇总格式识别
  preview: Record<string, unknown>[];
  rowCount: number;
}

interface AnalyzeResult {
  id: string;
  downloadUrl: string;
  summary: {
    totalEmployees: number;
    totalDays: number;
    attendanceRate: number;
    lateCount: number;
    absentCount: number;
    earlyLeaveCount: number;
    overtimeHours: number;
  };
  anomalies: Array<{
    name: string; dept: string; date: string;
    checkIn: string; checkOut: string;
    status: string; lateMinutes: number;
  }>;
  employeeStats: Array<{
    name: string; dept: string;
    presentDays: number; lateDays: number;
    absentDays: number; earlyLeaveDays: number;
    overtimeHours: number; attendanceRate: number;
  }>;
}

type Step = "upload" | "mapping" | "result";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  late:        { label: "迟到",   color: "#FBBF24" },
  absent:      { label: "旷工",   color: "#F87171" },
  early_leave: { label: "早退",   color: "#FB923C" },
  normal:      { label: "正常",   color: "#34D399" },
};

const FIELD_LABELS: { key: keyof AttendanceFieldMap; label: string; required: boolean; hint: string }[] = [
  { key: "nameCol",     label: "员工姓名",   required: true,  hint: "如：姓名、员工姓名" },
  { key: "dateCol",     label: "日期",       required: true,  hint: "如：日期、打卡日期" },
  { key: "checkInCol",  label: "上班打卡",   required: false, hint: "如：上班时间、签到时间" },
  { key: "checkOutCol", label: "下班打卡",   required: false, hint: "如：下班时间、签退时间" },
  { key: "deptCol",     label: "部门",       required: false, hint: "如：部门" },
  { key: "statusCol",   label: "考勤状态",   required: false, hint: "如：状态（迟到/旷工等，如有）" },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function AttendancePage({ onBack }: { onBack?: () => void }) {
  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("18:00");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [fieldMap, setFieldMap] = useState<AttendanceFieldMap | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);
  const [activeTab, setActiveTab] = useState<"anomalies" | "employees">("anomalies");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Upload ──────────────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast.error("请上传 Excel (.xlsx/.xls) 或 CSV 文件");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/hr/attendance/upload", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "上传失败"); }
      const data: UploadResult = await res.json();
      setUploadResult(data);
      setFieldMap(data.fieldMap);
      // 直接进入分析阶段，跳过字段确认
      toast.success(`已识别 ${data.rowCount} 条打卡记录，正在分析...`);
      setAnalyzing(true);
      try {
        const [startH, startM] = workStart.split(":").map(Number);
        const [endH, endM] = workEnd.split(":").map(Number);
        const analyzeRes = await fetch("/api/hr/attendance/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            id: data.id,
            fieldMap: data.fieldMap,
            tableFormat: data.tableFormat, // P0-A: 传递格式类型，避免服务端重新检测
            period,
            workStartHour: startH + startM / 60,
            workEndHour: endH + endM / 60,
          }),
        });
        if (!analyzeRes.ok) {
          const err = await analyzeRes.json();
          // 分析失败时跳到 mapping 步骤让用户手动调整
          setStep("mapping");
          throw new Error(err.error || "分析失败，请手动确认字段映射后重试");
        }
        const analyzeData: AnalyzeResult = await analyzeRes.json();
        setAnalyzeResult(analyzeData);
        setStep("result");
        toast.success("考勤分析完成！");
      } catch (analyzeErr: any) {
        toast.error(analyzeErr.message || "分析失败，请重试");
      } finally {
        setAnalyzing(false);
      }
    } catch (e: any) {
      toast.error(e.message || "上传失败");
    } finally {
      setUploading(false);
    }
  }, [period, workStart, workEnd]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ── Analyze ─────────────────────────────────────────────────────────────────

  const handleAnalyze = async () => {
    if (!uploadResult || !fieldMap) return;
    if (!fieldMap.nameCol || !fieldMap.dateCol) {
      toast.error("请至少配置「员工姓名」和「日期」字段");
      return;
    }
    setAnalyzing(true);
    try {
      const [startH, startM] = workStart.split(":").map(Number);
      const [endH, endM] = workEnd.split(":").map(Number);
      const res = await fetch("/api/hr/attendance/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id: uploadResult.id,
          fieldMap,
          tableFormat: uploadResult.tableFormat, // P0-A: 传递格式类型
          period,
          workStartHour: startH + startM / 60,
          workEndHour: endH + endM / 60,
        }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || "分析失败"); }
      const data: AnalyzeResult = await res.json();
      setAnalyzeResult(data);
      setStep("result");
      toast.success("考勤分析完成！");
    } catch (e: any) {
      toast.error(e.message || "分析失败");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleReset = () => {
    setStep("upload");
    setUploadResult(null);
    setFieldMap(null);
    setAnalyzeResult(null);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--atlas-bg)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        {onBack && (
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <ArrowLeft size={18} style={{ color: "var(--atlas-text-muted)" }} />
          </button>
        )}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5B8CFF,#2563EB)" }}>
            <Clock size={16} className="text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-sm" style={{ color: "var(--atlas-text)" }}>考勤汇总</h1>
            <p className="text-xs" style={{ color: "var(--atlas-text-muted)" }}>上传打卡记录 → 自动识别迟到/旷工 → 生成考勤报表</p>
          </div>
        </div>
        {/* Step indicator */}
        <div className="ml-auto flex items-center gap-1">
          {(["upload", "mapping", "result"] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all"
                style={{
                  background: step === s ? "#5B8CFF" : (["upload","mapping","result"].indexOf(step) > i ? "rgba(91,140,255,0.3)" : "rgba(255,255,255,0.1)"),
                  color: step === s ? "white" : (["upload","mapping","result"].indexOf(step) > i ? "#5B8CFF" : "var(--atlas-text-muted)"),
                }}>
                {["upload","mapping","result"].indexOf(step) > i ? <CheckCircle2 size={12} /> : i + 1}
              </div>
              {i < 2 && <div className="w-4 h-px" style={{ background: "rgba(255,255,255,0.15)" }} />}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <AnimatePresence mode="wait">

          {/* Step 1: Upload */}
          {step === "upload" && (
            <motion.div key="upload" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
              className="max-w-2xl mx-auto space-y-6">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium" style={{ color: "var(--atlas-text-muted)" }}>考勤期间</label>
                  <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
                    className="px-3 py-1.5 rounded-lg text-sm border"
                    style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.1)", color: "var(--atlas-text)" }} />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium" style={{ color: "var(--atlas-text-muted)" }}>上班时间</label>
                  <input type="time" value={workStart} onChange={e => setWorkStart(e.target.value)}
                    className="px-3 py-1.5 rounded-lg text-sm border"
                    style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.1)", color: "var(--atlas-text)" }} />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium" style={{ color: "var(--atlas-text-muted)" }}>下班时间</label>
                  <input type="time" value={workEnd} onChange={e => setWorkEnd(e.target.value)}
                    className="px-3 py-1.5 rounded-lg text-sm border"
                    style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.1)", color: "var(--atlas-text)" }} />
                </div>
              </div>

              <div
                className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all`}
                style={{ borderColor: dragging ? "#5B8CFF" : "rgba(255,255,255,0.15)", background: dragging ? "rgba(91,140,255,0.08)" : "transparent" }}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
                {(uploading || analyzing) ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 size={40} className="animate-spin" style={{ color: "#5B8CFF" }} />
                    <p className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>
                      {analyzing ? "正在分析考勤数据..." : "正在上传并识别字段..."}
                    </p>
                    <p className="text-xs" style={{ color: "var(--atlas-text-muted)" }}>请稍候，AI 正在自动处理</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(91,140,255,0.15)" }}>
                      <Upload size={28} style={{ color: "#5B8CFF" }} />
                    </div>
                    <div>
                      <p className="font-semibold" style={{ color: "var(--atlas-text)" }}>拖拽或点击上传考勤记录</p>
                      <p className="text-sm mt-1" style={{ color: "var(--atlas-text-muted)" }}>支持 .xlsx / .xls / .csv</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl p-4" style={{ background: "rgba(91,140,255,0.08)", border: "1px solid rgba(91,140,255,0.2)" }}>
                <p className="text-xs font-semibold mb-1" style={{ color: "#5B8CFF" }}>📋 考勤表格式说明</p>
                <p className="text-xs" style={{ color: "var(--atlas-text-muted)" }}>
                  每行代表一条打卡记录。建议包含：姓名、日期、上班时间、下班时间。
                  系统会自动识别迟到（超过上班时间 15 分钟）、旷工（无打卡记录）、早退情况。
                </p>
              </div>
            </motion.div>
          )}

          {/* Step 2: Field Mapping */}
          {step === "mapping" && uploadResult && fieldMap && (
            <motion.div key="mapping" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
              className="max-w-2xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold" style={{ color: "var(--atlas-text)" }}>确认字段映射</h2>
                  <p className="text-sm mt-0.5" style={{ color: "var(--atlas-text-muted)" }}>
                    共 {uploadResult.rowCount} 条记录，AI 已自动识别字段，请确认
                  </p>
                </div>
                <button onClick={handleReset} className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors border" style={{ borderColor: "rgba(255,255,255,0.12)", color: "var(--atlas-text-muted)" }}>
                  <RefreshCw size={12} /> 重新上传
                </button>
              </div>

              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                {FIELD_LABELS.map(({ key, label, required, hint }, idx) => (
                  <div key={key} className={`flex items-center gap-4 px-4 py-3 ${idx > 0 ? "border-t" : ""}`}
                    style={{ borderColor: "rgba(255,255,255,0.06)", background: idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                    <div className="w-28 flex-shrink-0">
                      <span className="text-sm font-medium" style={{ color: "var(--atlas-text)" }}>{label}</span>
                      {required && <span className="ml-1 text-xs" style={{ color: "#F87171" }}>*</span>}
                    </div>
                    <select
                      value={fieldMap[key]}
                      onChange={e => setFieldMap(prev => ({ ...prev!, [key]: e.target.value }))}
                      className="flex-1 px-3 py-1.5 rounded-lg text-sm border"
                      style={{ background: "rgba(255,255,255,0.05)", borderColor: fieldMap[key] ? "rgba(91,140,255,0.4)" : "rgba(255,255,255,0.1)", color: "var(--atlas-text)" }}
                    >
                      <option value="">— 不使用 —</option>
                      {uploadResult.headers.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                    <span className="text-xs w-40 flex-shrink-0 hidden md:block" style={{ color: "var(--atlas-text-muted)" }}>{hint}</span>
                  </div>
                ))}
              </div>

              {/* Preview */}
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: "var(--atlas-text-muted)" }}>数据预览（前 5 行）</p>
                <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.05)" }}>
                        {uploadResult.headers.slice(0, 6).map(h => (
                          <th key={h} className="px-3 py-2 text-left font-medium" style={{ color: "var(--atlas-text-muted)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {uploadResult.preview.map((row, i) => (
                        <tr key={i} className="border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                          {uploadResult.headers.slice(0, 6).map(h => (
                            <td key={h} className="px-3 py-2" style={{ color: "var(--atlas-text)" }}>{String(row[h] ?? "")}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <button
                onClick={handleAnalyze}
                disabled={analyzing || !fieldMap.nameCol || !fieldMap.dateCol}
                className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#5B8CFF,#2563EB)", color: "white" }}
              >
                {analyzing ? <><Loader2 size={16} className="animate-spin" /> 正在分析考勤数据...</> : <><TrendingDown size={16} /> 开始分析考勤</>}
              </button>
            </motion.div>
          )}

          {/* Step 3: Result */}
          {step === "result" && analyzeResult && (
            <motion.div key="result" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
              className="max-w-3xl mx-auto space-y-6">
              {/* Download banner */}
              <div className="rounded-2xl p-5 flex items-center gap-4" style={{ background: "rgba(91,140,255,0.1)", border: "1px solid rgba(91,140,255,0.25)" }}>
                <CheckCircle2 size={24} style={{ color: "#5B8CFF", flexShrink: 0 }} />
                <div className="flex-1">
                  <p className="font-semibold" style={{ color: "#5B8CFF" }}>考勤分析完成！</p>
                  <p className="text-sm mt-0.5" style={{ color: "var(--atlas-text-muted)" }}>
                    共 {analyzeResult.summary.totalEmployees} 人，{analyzeResult.summary.totalDays} 条记录，包含汇总、异常明细、统计概览三个 Sheet
                  </p>
                </div>
                <a href={analyzeResult.downloadUrl} download
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-all"
                  style={{ background: "#5B8CFF", color: "white" }}>
                  <Download size={14} /> 下载报表
                </a>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "出勤率",   value: `${analyzeResult.summary.attendanceRate}%`, color: "#34D399" },
                  { label: "迟到次数", value: analyzeResult.summary.lateCount,            color: "#FBBF24" },
                  { label: "旷工次数", value: analyzeResult.summary.absentCount,          color: "#F87171" },
                  { label: "加班小时", value: `${analyzeResult.summary.overtimeHours}h`,  color: "#A78BFA" },
                ].map(stat => (
                  <div key={stat.label} className="rounded-xl p-4 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
                    <p className="text-xs mt-1" style={{ color: "var(--atlas-text-muted)" }}>{stat.label}</p>
                  </div>
                ))}
              </div>

              {/* Tabs */}
              <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.05)" }}>
                {[{ id: "anomalies", label: `异常明细 (${analyzeResult.anomalies.length})` }, { id: "employees", label: `员工汇总 (${analyzeResult.employeeStats.length})` }].map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                    className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
                    style={{ background: activeTab === tab.id ? "rgba(91,140,255,0.3)" : "transparent", color: activeTab === tab.id ? "#5B8CFF" : "var(--atlas-text-muted)" }}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Anomalies table */}
              {activeTab === "anomalies" && (
                <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                  {analyzeResult.anomalies.length === 0 ? (
                    <div className="py-12 text-center">
                      <CheckCircle2 size={32} className="mx-auto mb-2" style={{ color: "#34D399" }} />
                      <p className="text-sm" style={{ color: "var(--atlas-text-muted)" }}>没有异常记录，全员出勤正常 🎉</p>
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: "rgba(255,255,255,0.05)" }}>
                          {["姓名", "部门", "日期", "上班", "下班", "状态", "迟到(分钟)"].map(h => (
                            <th key={h} className="px-3 py-2 text-left font-medium" style={{ color: "var(--atlas-text-muted)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {analyzeResult.anomalies.map((row, i) => {
                          const st = STATUS_LABEL[row.status] || { label: row.status, color: "var(--atlas-text-muted)" };
                          return (
                            <tr key={i} className="border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                              <td className="px-3 py-2 font-medium" style={{ color: "var(--atlas-text)" }}>{row.name}</td>
                              <td className="px-3 py-2" style={{ color: "var(--atlas-text-muted)" }}>{row.dept || "—"}</td>
                              <td className="px-3 py-2" style={{ color: "var(--atlas-text-muted)" }}>{row.date}</td>
                              <td className="px-3 py-2" style={{ color: "var(--atlas-text)" }}>{row.checkIn || "—"}</td>
                              <td className="px-3 py-2" style={{ color: "var(--atlas-text)" }}>{row.checkOut || "—"}</td>
                              <td className="px-3 py-2">
                                <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: `${st.color}20`, color: st.color }}>{st.label}</span>
                              </td>
                              <td className="px-3 py-2" style={{ color: row.lateMinutes > 0 ? "#FBBF24" : "var(--atlas-text-muted)" }}>
                                {row.lateMinutes > 0 ? row.lateMinutes : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Employee stats table */}
              {activeTab === "employees" && (
                <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.05)" }}>
                        {["姓名", "部门", "出勤天数", "迟到", "旷工", "早退", "加班(h)", "出勤率"].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-medium" style={{ color: "var(--atlas-text-muted)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analyzeResult.employeeStats.map((emp, i) => (
                        <tr key={i} className="border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                          <td className="px-3 py-2 font-medium" style={{ color: "var(--atlas-text)" }}>{emp.name}</td>
                          <td className="px-3 py-2" style={{ color: "var(--atlas-text-muted)" }}>{emp.dept || "—"}</td>
                          <td className="px-3 py-2" style={{ color: "#34D399" }}>{emp.presentDays}</td>
                          <td className="px-3 py-2" style={{ color: emp.lateDays > 0 ? "#FBBF24" : "var(--atlas-text-muted)" }}>{emp.lateDays || "—"}</td>
                          <td className="px-3 py-2" style={{ color: emp.absentDays > 0 ? "#F87171" : "var(--atlas-text-muted)" }}>{emp.absentDays || "—"}</td>
                          <td className="px-3 py-2" style={{ color: emp.earlyLeaveDays > 0 ? "#FB923C" : "var(--atlas-text-muted)" }}>{emp.earlyLeaveDays || "—"}</td>
                          <td className="px-3 py-2" style={{ color: emp.overtimeHours > 0 ? "#A78BFA" : "var(--atlas-text-muted)" }}>{emp.overtimeHours > 0 ? emp.overtimeHours : "—"}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.1)", minWidth: 40 }}>
                                <div className="h-full rounded-full" style={{ width: `${emp.attendanceRate}%`, background: emp.attendanceRate >= 90 ? "#34D399" : emp.attendanceRate >= 70 ? "#FBBF24" : "#F87171" }} />
                              </div>
                              <span style={{ color: emp.attendanceRate >= 90 ? "#34D399" : emp.attendanceRate >= 70 ? "#FBBF24" : "#F87171" }}>{emp.attendanceRate}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button onClick={handleReset} className="flex-1 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 hover:bg-white/10 transition-colors border" style={{ borderColor: "rgba(255,255,255,0.12)", color: "var(--atlas-text-muted)" }}>
                  <RefreshCw size={14} /> 分析新一期
                </button>
                <a href={analyzeResult.downloadUrl} download
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-all"
                  style={{ background: "linear-gradient(135deg,#5B8CFF,#2563EB)", color: "white" }}>
                  <Download size={14} /> 下载考勤报表
                </a>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
